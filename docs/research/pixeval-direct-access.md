# Pixeval 直连实现分析

> 调研时间：2026-09-08
> 调研目标：Pixeval/Pixeval（v3.x，master 分支，C# Avalonia 桌面客户端）
> 网络核心库：Mako（独立 git 子模块，github.com/Pixeval/Mako）与 Pixeval.Network.Maho（独立 git 子模块）
> 调研方式：源码逐文件阅读（所有引用均给出文件路径 + 行号 + 代码片段）

---

## TL;DR

Pixeval 把"直连"和"域前置（domain fronting）"完全解耦：

- **HTTP 客户端**基于 `SocketsHttpHandler.ConnectCallback` 自定义 socket 层，把"解析域名 → TCP 连接 → TLS 握手"三步拆开手动接管。
- **DNS** 用 `Dictionary<string, IPAddress[]>` 在 `MakoConfiguration.NameResolvers` 里钉死每个 Pixiv 域名对应的 IP（Cloudflare 的 104.18.x / 172.64.x + 日本本土 210.140.139.x），连接时直接用 `IPAddress[]` 重载连 443 端口，**依赖 SNI 把真实 host 名传给服务器**（SocketsHttpHandler 自动使用 `context.DnsEndPoint.Host`）。
- **域前置**有三种实现：`Fragmentation`（TLS ClientHello 分片，活跃）、`Ech` / `Desync`（已注释掉的占位）。`Fragmentation` 把 ClientHello 在 SNI 字段中间切一刀，伪装 TLS 版本号 0x03 0x09，每段 100ms 间隔发出，欺骗 GFW 状态机。
- **图片**走专用 `PixivImageHttpMessageHandler`：开启域前置时强制 `Scheme = "http"`（HTTPS 终止在 `SocketsHttpHandler` 内层）；另外支持 `MirrorHost` 用户可填任意镜像。
- **代理**三态：null=系统代理、`""`=禁用、非空=自定义 URI（解析为 `WebProxy`），每条 `SocketsHttpHandler` 按 `(proxySetting, bypass)` 缓存。
- **TLS 校验**在 `MakoHttpOptions.CreateConnectionAsync`（line 49）有一处 `(_, _, _, _) => true` 全接受 —— 仅在域前置路径使用；直连路径走 `SocketsHttpHandler` 默认校验。

---

## HTTP 客户端层

### 选型

- **`HttpClient` + `SocketsHttpHandler`**（.NET 内置），不依赖 Flurl / Refit。
- 通过 `Microsoft.Extensions.DependencyInjection` 的 `IHttpClientFactory` 注册 4 个具名客户端（`Mako/MakoClient.cs:107-129`）：
  - `AppApi` → `app-api.pixiv.net` + `PixivAppApiHttpMessageHandler`
  - `WebApi` → `www.pixiv.net` + `PixivWebApiHttpMessageHandler`
  - `AuthApi` → `oauth.secure.pixiv.net` + `PixivOAuthHttpMessageHandler`
  - `ImageApi` → `i.pximg.net` + `PixivImageHttpMessageHandler`
- WebApi 端点用 `WebApiClientCore`（refit 风格的接口生成客户端，见 `MakoClient.cs:131-133`）。

### `HttpMessageHandler` 抽象

基类 `MakoClientSupportedHttpMessageHandler`（`Mako/Net/MakoClientSupportedHttpMessageHandler.cs:9-29`）暴露 `SendApiAsync`：

```csharp
private protected Task<HttpResponseMessage> SendApiAsync(HttpRequestMessage request, CancellationToken token)
{
    var configuration = MakoClient.Configuration;
    var invoker = configuration.DomainFronting
        ? InvokerProvider.GetApiDomainFrontingInvoker(configuration.DomainFrontingType)
        : InvokerProvider.GetDirectInvoker();
    return invoker.SendAsync(request, token);
}
```

—— 因此所有 API 直连 / 域前置的分流**只在 handler 入口做一次**，图片 handler 自己再分流一次。

### 限流

`PixivAppApiHttpMessageHandler`（`Mako/Net/PixivAppApiHttpMessageHandler.cs:13-56`）用 `PixivAppApiRequestThrottleState` 的 `SemaphoreSlim` 全局串行 429 退避，触发后把 `CooldownUntil` 推到 60s 后。

---

## TLS / SNI 处理

### 证书校验

**只在域前置路径上关闭**。`Mako/Net/MakoHttpOptions.cs:43-60`：

```csharp
private async Task<SslStream> CreateConnectionAsync(string host, CancellationToken token = default)
{
    var client = new TcpClient(); // disposed by netStream
    var ipAddresses = await makoClient.GetAddressesAsync(host, token).ConfigureAwait(false);
    await client.ConnectAsync(ipAddresses, 443, token).ConfigureAwait(false);
    var netStream = client.GetStream(); // disposed by sslStream
    var sslStream = new SslStream(netStream, false, (_, _, _, _) => true);   // ← 全接受证书
    try
    {
        await sslStream.AuthenticateAsClientAsync("").ConfigureAwait(false);  // ← 空 SNI host（由 IP 直连）
        return sslStream;
    }
    ...
}
```

注意：第一个 `CreateConnectionAsync` 用 `""` 作为目标名（line 52），所以 TLS 不带 SNI。但**真正的 `SocketsHttpHandler.ConnectCallback` 走的是另一条 `DomainFrontingConnectCallback`**（同文件 line 40-41），使用 `context.InitialRequestMessage.RequestUri!.Host` 作为 `host`：

```csharp
internal async ValueTask<Stream> DomainFrontingConnectCallback(SocketsHttpConnectionContext context, CancellationToken token)
    => await makoClient.CreateConnectionAsync(context.InitialRequestMessage.RequestUri!.Host, token).ConfigureAwait(false);
```

—— 也就是说**域前置流的 SNI 是 request URI 的 host**（Pixiv 真域名），只不过 TCP 连接走的是钉死的 IP。TLS 校验放行是必须的（拿到的证书是 Cloudflare CDN 签发，host 校验会被 .NET 默认策略拦掉）。

### Fragmentation：TLS ClientHello 分片

核心实现在 `Pixeval.Network.Maho/Pixeval.Network.Maho/Fragmentation/TlsRecordFragmentedStream.cs`。

工作流：

1. `ClientHelloStateMachine`（`ClientHelloStateMachine.cs`）检测写入流里出现的 `0x16`（Handshake record），把整段 ClientHello 攒齐。
2. `ServerNameLocator`（`ServerNameLocator.cs`）解析 SNI extension 的位置列表（`ReadOnlySpan<byte>` ref struct）。
3. `TlsRecordFragmentedStream.SplitTlsRecordAndSendAsync`（`TlsRecordFragmentedStream.cs:117-186`）把整段 ClientHello 按 SNI 字段"前一半 / 后一半"切成多段：
   - 第 1 段保留原 5 字节 record header，把 `item.Span[1]=0x03; item.Span[2]=0x09;`（伪装 TLS 主/次版本号，欺骗状态机）。
   - 后续每段重新构造 record header，载荷长度重新计算。
   - 每段间隔 `await Task.Delay(100, …)`。
   - 每段独立 `FlushAsync`。

### 注册方式

`Mako/MakoClient.cs:39-47`：

```csharp
.AddKeyedSingleton<HttpMessageHandler>(
    DomainFrontingType.Fragmentation,
    static (serviceProvider, key) => TlsRecordFragmentationSocketsHttpHandlerFactory.GetTlsFragmentedHandler(serviceProvider.GetRequiredService<MakoClient>().Configuration))
```

`TlsRecordFragmentationSocketsHttpHandlerFactory`（`Pixeval.Network.Maho/Fragmentation/TlsRecordFragmentationSocketsHttpHandlerFactory.cs:7-22`）包装 `SocketsHttpHandler`，`ConnectCallback` 内 `await dnsResolver.LookupAsync(ctx.DnsEndPoint.Host)` → `Socket.ConnectAsync(IPAddress[], port)` → `NetworkStream` → `TlsRecordFragmentedStream` → 交回 SocketsHttpHandler 跑默认 `SslStream`。

### Ech / Desync

`Mako/MakoClient.cs:48-76` 把这两类实现的 DI 注册整体 `/* ... */` 注释掉了，`DomainFrontingType.cs` 也只保留 `Fragmentation`。源码已就位但未启用：

- `Ech` → `NativeInteropEchEnabledHttpMessageHandlerFactory`（需 native interop）
- `Desync` → `DesynchronizationSocketsHttpHandlerFactory`，参数 `TtlSniffer` + `EmpiricalTtlSpoofer`，参考 `https://github.com/Pixeval/Pixeval.Network.Maho/tree/master/Pixeval.Network.Maho/Desync`

---

## DNS / IP 钉死

### 数据结构

`Mako/MakoConfiguration.cs:51-58`：

```csharp
public Dictionary<string, IPAddress[]> NameResolvers { get; } = new()
{
    [MakoHttpOptions.ImageHost]     = [],   // i.pximg.net
    [MakoHttpOptions.WebApiHost]    = [],   // www.pixiv.net
    [MakoHttpOptions.AccountHost]   = [],   // accounts.pixiv.net
    [MakoHttpOptions.AppApiHost]    = [],   // app-api.pixiv.net
    [MakoHttpOptions.ImageHost2]    = [],   // s.pximg.net
    [MakoHttpOptions.OAuthHost]     = []    // oauth.secure.pixiv.net
};
```

并实现 `IDnsResolver.LookupAsync`（line 62-65）—— 命中静态表则直接返回，否则 fallback `Dns.GetHostAddressesAsync`。

### 默认 IP 清单

`Pixeval/src/Pixeval/AppManagement/NetworkSettingsGroup.cs` 把每个域的默认 IP 都写在 settings record 的字段初始值里（line 35-86）：

| 域                       | 默认 IP                          | 类型       |
| ------------------------ | -------------------------------- | ---------- |
| `app-api.pixiv.net`      | `104.18.42.239`, `172.64.145.17` | Cloudflare |
| `www.pixiv.net`          | `210.140.139.155/156/157`        | 日本本土   |
| `accounts.pixiv.net`     | `210.140.139.155/156/157`        | 日本本土   |
| `oauth.secure.pixiv.net` | `104.18.42.239`, `172.64.145.17` | Cloudflare |
| `i.pximg.net`            | `210.140.139.134-137`            | 日本本土   |
| `s.pximg.net`            | `210.140.139.135-137`            | 日本本土   |

### 注入时机

`Pixeval/src/Pixeval/AppManagement/AppViewModel.cs:165-186`：

```csharp
public void SetNameResolvers()
{
    var networkSettings = AppSettings.NetworkSettings;
    SetNameResolver(MakoHttpOptions.AppApiHost, networkSettings.PixivAppApiNameResolver);
    SetNameResolver(MakoHttpOptions.ImageHost, networkSettings.PixivImageNameResolver);
    SetNameResolver(MakoHttpOptions.ImageHost2, networkSettings.PixivImageNameResolver2);
    SetNameResolver(MakoHttpOptions.OAuthHost, networkSettings.PixivOAuthNameResolver);
    SetNameResolver(MakoHttpOptions.AccountHost, networkSettings.PixivAccountNameResolver);
    SetNameResolver(MakoHttpOptions.WebApiHost, networkSettings.PixivWebApiNameResolver);
    ...
    static void SetNameResolver(string host, ObservableCollection<string> ips)
    {
        App.AppViewModel.MakoClient.Configuration.NameResolvers[host] =
            [.. ips.SelectNotNull(static ip => IPAddress.TryParse(ip, out var address) ? address : null)];
        ...
    }
}
```

`InitializeProvider`（line 60-66）在创建 `AppServiceProvider` 之后立刻调用 `SetNameResolvers()`，确保后续 MakoClient 调用 `LookupAsync` 时静态表非空。

### IP 解析器查找

域前置路径：`MakoHttpOptions.CreateConnectionAsync` (line 46) → `GetAddressesAsync` (line 62-65) → `Configuration.NameResolvers[host]`。
直连路径：`SocketsHttpHandler` 默认会走系统 DNS，**只有开启域前置时才走静态表**（`MakoHttpMessageInvokerProvider.GetDirectInvoker` line 67-68 没传 `ConnectCallback`）。

---

## API 直连（app-api.pixiv.net / www.pixiv.net）

### handler 选择

`MakoClientSupportedHttpMessageHandler.SendApiAsync`（已引）—— 直连走 `InvokerProvider.GetDirectInvoker()`：

```csharp
// Mako/Net/MakoHttpMessageInvokerProvider.cs:57-77
public HttpMessageInvoker GetDirectInvoker()
{
    var proxySetting = makoClient.Configuration.Proxy;
    var proxy = makoClient.GetConfiguredProxy(proxySetting);  // 源码生成器生成
    var cacheKey = GetProxyCacheKey(proxySetting, proxy);

    lock (_gate)
    {
        ...
        invoker = new(new SocketsHttpHandler
        {
            UseProxy = proxy is not null,
            Proxy = proxy
        });
        ...
    }
}
```

直连模式下 `SocketsHttpHandler` 用默认 DNS 解析 —— IP 钉死表**只对域前置生效**。这是关键事实：**Mako 的"直连"≠ "IP 钉死"，"直连"= `DomainFronting = false` 时使用系统 DNS**。

### OAuth（oauth.secure.pixiv.net）

`Mako/Net/PixivOAuthHttpMessageHandler.cs:10-21`：

```csharp
internal sealed class PixivOAuthHttpMessageHandler(...)
    : MakoClientSupportedHttpMessageHandler(...)
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Debug.Assert(request.RequestUri is { Host: MakoHttpOptions.OAuthHost });
        return SendApiAsync(request, cancellationToken);
    }
}
```

—— 仅断言 URI，走通用的 `SendApiAsync`，**没有 OAuth 专属特殊处理**（token 刷新由 `PixivTokenProvider` 独立管理，见 `Mako/Net/PixivTokenProvider.cs`）。

### accounts.pixiv.net

**没有专属 handler**，登录流程走 `WebApi` 通道（`www.pixiv.net`）。`accounts.pixiv.net` 在 `NameResolvers` 表里有 IP 但没有对应 handler —— 它在 OAuth token 流程（`PixivTokenProvider.RequestTokenAsync` 调用 `IAuthEndPoint.RefreshAsync` → 走 `PixivOAuthHttpMessageHandler`）。

---

## 图片直连（i.pximg.net）

`Mako/Net/PixivImageHttpMessageHandler.cs`：

```csharp
internal class PixivImageHttpMessageHandler(...)
    : MakoClientSupportedHttpMessageHandler(...)
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var configuration = MakoClient.Configuration;
        var domainFronting = configuration.DomainFronting;
        var userAgent = configuration.UserAgent;
        var mirrorHost = configuration.MirrorHost;

        request.Headers.UserAgent.AddRange(userAgent);

        // 镜像替换：用户填 MirrorHost 就替换 Host
        if (request.RequestUri is { Host: MakoHttpOptions.ImageHost } requestUri
            && !string.IsNullOrWhiteSpace(mirrorHost))
        {
            request.RequestUri = mirrorHost switch
            {
                _ when Uri.CheckHostName(mirrorHost) is not UriHostNameType.Unknown => new UriBuilder(requestUri) { Host = mirrorHost }.Uri,
                _ when Uri.IsWellFormedUriString(mirrorHost, UriKind.Absolute) => new Uri(mirrorHost).Let(mirrorUri => new UriBuilder(requestUri) { Host = mirrorUri.Host, Scheme = mirrorUri.Scheme }).Uri,
                _ => throw new UriFormatException("Expecting a valid Host or URI")
            };
        }

        var invoker = domainFronting
            ? InvokerProvider.GetImageDomainFrontingInvoker()
            : InvokerProvider.GetDirectInvoker();

        if (domainFronting && request.RequestUri is not null)
            request.RequestUri = new UriBuilder(request.RequestUri) { Scheme = "http" }.Uri;

        return invoker.SendAsync(request, cancellationToken);
    }
}
```

要点：

1. **UA 始终**用 `configuration.UserAgent`（`Mozilla/5.0 … Chrome/149`）追加到请求（line 22）。
2. **Referer 头**在客户端构建时设（`MakoClient.cs:115-119`，`ImageApi` 通道）`https://www.pixiv.net` + UA `PixivIOSApp/5.8.7`（iOS 客户端身份）。
3. **MirrorHost**支持两种输入：纯 host（如 `i.pixiv.re`）或完整 URL；后者还会取它的 scheme/host。
4. **域前置 + 图片**：把 URI 强制改成 `http`（line 38）—— TLS 终止发生在 `TlsRecordFragmentedStream` 这一层，SocketsHttpHandler 看到的 URI 是 http，由 `.NET` 框架内部再做 TLS 包装。
5. **图片专属 invoker**：`InvokerProvider.GetImageDomainFrontingInvoker()`（`MakoHttpMessageInvokerProvider.cs:48-57`）每次都返回**新构造**的 `SocketsHttpHandler`，`ConnectCallback = makoClient.DomainFrontingConnectCallback`，`UseProxy = false`。

---

## OAuth 直连

`Mako/Net/PixivOAuthHttpMessageHandler.cs` 没有任何特殊 IP / 代理逻辑，统一走 `SendApiAsync` → `GetDirectInvoker`（直连）或 `GetApiDomainFrontingInvoker`（域前置）。

OAuth 端点的默认 IP 写的是 `104.18.42.239 / 172.64.145.17`（Cloudflare），与 `app-api` 相同；开启域前置时进入 `TlsRecordFragmentationSocketsHttpHandlerFactory` 路径。

`accounts.pixiv.net` 没有专属 handler（前面提到），其 IP 表中的 `210.140.139.155-157` 默认未被任何 handler 使用 —— 推测是早期 / 内部分流遗留，**当前 OAuth 路径已统一走 oauth.secure.pixiv.net**。

---

## 镜像 / 代理回退

### 用户可填镜像

`NetworkSettingsGroup.MirrorHost`（line 49-53），默认 `""`，任意字符串：

- 纯主机名（`i.pixiv.re`）→ `UriBuilder { Host = mirrorHost }`
- 完整 URL（`https://i.pixiv.re`）→ 取 host + scheme
- 非法 → 抛 `UriFormatException`

注意：**MirrorHost 只对 `i.pximg.net`（`MakoHttpOptions.ImageHost`）生效**，`ImageHost2 = "s.pximg.net"` 不走镜像替换。

### 代理三态

`MakoHelper.ToMakoProxy`（`Pixeval/src/Pixeval/Utilities/MakoHelper.cs:117-127`）：

```csharp
public static string? ToMakoProxy(ProxyType type, string? proxy) =>
    type switch
    {
        ProxyType.System  => null,                                      // 系统代理
        ProxyType.None    => "",                                     // 禁用代理
        ProxyType.Custom  => NormalizeProxyUri(proxy) ?? "",          // 自定义
        _ => throw new ArgumentOutOfRangeException(nameof(type))
    };
```

`ProxyType`（`Pixeval/src/Pixeval/Models/Options/ProxyType.cs`）：

```csharp
public enum ProxyType { System, None, Custom }
```

`GetDirectInvoker` 内 `GetProxyCacheKey`（`MakoHttpMessageInvokerProvider.cs:79-91`）按 `(proxySetting, isBypassed, getProxy)` 生成缓存键，多个不同代理配置可共存。

### 系统代理读取

`Mako/Net/SystemProxyProvider.cs`（29 行）：

- 静态构造设置 `HttpClient.DefaultProxy = ConstructSystemProxy()`
- `GetCurrent()` 每 2 秒刷新一次
- `ConstructSystemProxy` 用 `[UnsafeAccessor]` 反射调 `System.Net.Http.SystemProxyInfo.ConstructSystemProxy`（.NET 内部 API）

—— 这就是为什么 `proxySetting == null` 时 SocketsHttpHandler 会读系统代理设置（WinHTTP）。

---

## 用户配置

`NetworkSettingsGroup`（`Pixeval/src/Pixeval/AppManagement/NetworkSettingsGroup.cs`）通过 `AutoSettingsPage` 暴露在设置页：

| 设置项                       | 类型                         | 默认            | 说明                                      |
| ---------------------------- | ---------------------------- | --------------- | ----------------------------------------- |
| `EnablePixivDomainFronting`  | bool                         | **true**        | 开启域前置（GFW bypass）                  |
| `PixivDomainFrontingType`    | enum                         | `Fragmentation` | 分片 / Ech / Desync（后两种仅 enum 占位） |
| `ProxyType`                  | enum                         | `System`        | 系统 / 禁用 / 自定义                      |
| `Proxy`                      | string                       | `""`            | 自定义代理 URI                            |
| `EnableGitHubDomainFronting` | bool                         | true            | GitHub 域前置（用于更新检查）             |
| `MirrorHost`                 | string                       | `""`            | 图片镜像                                  |
| `WebCookie`                  | string                       | `""`            | web 端 cookie                             |
| `PixivAppApiNameResolver`    | ObservableCollection<string> | 2 IP            | 用户可改 IP 列表                          |
| `PixivWebApiNameResolver`    | 同上                         | 3 IP            |                                           |
| `PixivAccountNameResolver`   | 同上                         | 3 IP            |                                           |
| `PixivOAuthNameResolver`     | 同上                         | 2 IP            |                                           |
| `PixivImageNameResolver`     | 同上                         | 4 IP            |                                           |
| `PixivImageNameResolver2`    | 同上                         | 3 IP            |                                           |
| 5 组 GitHub 域解析器         | 同上                         | 若干 IP         |                                           |

—— 用户**完整控制**：可禁用域前置走系统代理、可只开域前置、可自定义 IP 列表、可加代理。

迁移机制：`AppSettings.Initialize()`（`AppSettings.cs:16-46`）注释里保留了"版本变更时刷新所有 IP 解析器列表"的代码段，目前是注释掉的。

---

## 关键源文件清单

| 文件                                                                                    | 作用                                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Mako/Net/MakoHttpOptions.cs`                                                           | 域前置路径的 `ConnectCallback` + 禁用证书校验的 `SslStream`（直连的端点常量定义也在此） |
| `Mako/Net/MakoHttpMessageInvokerProvider.cs`                                            | 三类 `HttpMessageInvoker` 工厂：域前置（API / Image）/ 直连（带代理缓存）               |
| `Mako/Net/MakoClientSupportedHttpMessageHandler.cs`                                     | 所有 API handler 的基类，统一"域前置 vs 直连"分流                                       |
| `Mako/Net/PixivAppApiHttpMessageHandler.cs`                                             | app-api 限流（429/Retry-After → SemaphoreSlim 串行）                                    |
| `Mako/Net/PixivOAuthHttpMessageHandler.cs`                                              | OAuth 通道（pass-through + 调试断言）                                                   |
| `Mako/Net/PixivWebApiHttpMessageHandler.cs`                                             | www.pixiv.net 通道 + 注入 Cookie                                                        |
| `Mako/Net/PixivImageHttpMessageHandler.cs`                                              | 图片通道：UA/MirrorHost/域前置 Scheme 改写                                              |
| `Mako/Net/PixivTokenProvider.cs`                                                        | Refresh token + Code→Token 自动刷新                                                     |
| `Mako/Net/MakoConfiguration.cs`                                                         | `NameResolvers` 字典、`IDnsResolver.LookupAsync`、`UserAgent`                           |
| `Mako/Net/SystemProxyProvider.cs`                                                       | 通过 `UnsafeAccessor` 拿 .NET 内部系统代理构造器                                        |
| `Pixeval.Network.Maho/Fragmentation/TlsRecordFragmentationSocketsHttpHandlerFactory.cs` | 把 `SocketsHttpHandler` 套上 TLS 分片 + IP 直连 socket 层                               |
| `Pixeval.Network.Maho/Fragmentation/TlsRecordFragmentedStream.cs`                       | TLS ClientHello 分片核心实现（切 SNI、改 record header、100ms 间隔）                    |
| `Pixeval.Network.Maho/Fragmentation/ClientHelloStateMachine.cs`                         | 把多次 `Write` 拼成完整 ClientHello packet 的状态机                                     |
| `Pixeval.Network.Maho/ServerNameLocator.cs`                                             | 纯 ref-struct 的 TLS ClientHello SNI extension 位置解析器                               |
| `Pixeval.Network.Maho/IDnsResolver.cs`                                                  | 整个域前置体系的 DNS 抽象（5 行接口）                                                   |
| `Mako/MakoClient.cs`                                                                    | 4 个 HttpClient 注册 + keyed HttpMessageHandler DI 装配                                 |
| `Pixeval/src/Pixeval/AppManagement/NetworkSettingsGroup.cs`                             | 用户设置 record（含所有默认 IP 列表）                                                   |
| `Pixeval/src/Pixeval/AppManagement/AppViewModel.cs`                                     | `InitializeProvider` → `SetNameResolvers` → 注入到 MakoClient                           |
| `Pixeval/src/Pixeval/AppManagement/AppSettings.cs`                                      | `ToMakoConfiguration()` 把用户设置转 `MakoConfiguration`                                |
| `Pixeval/src/Pixeval/Utilities/MakoHelper.cs`                                           | `ToMakoProxy` / `NormalizeProxyUri`（Pixeval 侧桥接）                                   |
| `Pixeval/src/Pixeval/Models/Options/ProxyType.cs`                                       | 代理三态枚举                                                                            |

---

## 启示（对 Pictelio 直连方案）

> 以下为调研后个人建议，不构成 Pixeval 的事实陈述。每条都映射到我们 Pictelio 项目的现状。

1. **采用"域前置 vs 直连"两路 SocketsHttpHandler** 的模式值得借鉴，但**只在域前置时钉 IP**（默认走系统 DNS）；直接复用 `IPAddress[]` 重载的 `Socket.ConnectAsync` + 默认 `SslStream`，省掉手工 TLS 握手。Pictelio 的 `src/api/client.ts` + `src/native/PixivApi.ts` 已把图片二进制零进 JS 堆（`/pixiv-img/` 代理 → Java `shouldInterceptRequest`），直连层交给原生 WebView 处理；如要做客户端级 IP 钉死，参考 `NetworkSettingsGroup` 把每个 Pixiv 域的 IP 列为设置项 + `NameResolvers` 字典。

2. **域前置分片（Fragmentation）** 目前仅 .NET 端活跃（Pixeval 的 Ech/Desync 已注释），不适合直接迁到 Web/JS（依赖 `ref struct` + `[UnsafeAccessor]`）。如果未来要做客户端 GFW bypass，**优先看 iOS NetworkExtension / Android VpnService** 走 native 实现，Web 侧继续依赖代理。

3. **图片镜像 MirrorHost** 是 Pixeval 最优雅的可降级设计：一个文本框，用户填 `i.pixiv.re` 即可生效，Pictelio 的 `imageHostStore.ts` + `services/imageHostService.ts` 已实现等价方案（见 ADR-0090 → ADR-0037），但当前入口在 `/image-host` 设置页，可以参考 Pixeval 的 `[SettingsEntry(Symbol.HardDrive, …)]` 把图标（`HardDrive`）做得更直白。

4. **直连 + 代理 互斥但并存**：Pixeval 的 `DomainFronting = true` 时**强制 `UseProxy = false`**（`GetApiDomainFrontingInvoker` 注册的 handler 设了 `UseProxy = false`），避免代理 + 域前置双重封装；直连模式下按 `ProxyType` 三态分流。Pictelio 在 native 侧已通过 `https_proxy` 环境变量做系统代理读取（`scripts/deploy.mjs` / Vite proxy），但**没有"完全禁用代理"的用户开关**——值得加一个"代理模式" 设置项（系统 / 禁用 / 自定义）。

5. **证书校验放行** 只在域前置路径上做（`SslStream(..., (_, _, _, _) => true)`），直连路径保留默认校验。Pictelio 的 native 层（Capacitor WebView + Java `shouldInterceptRequest`）天然走 WebView 默认证书校验；如要做客户端域前置，需要在 native 层单独处理（OkHttp 自定义 `TrustManager`），**不能影响 API 通道的证书校验**——这条边界规则值得在 ADR 中固定下来。

---

## 调研边界声明

- 仅调研 `Pixeval/Pixeval` 仓库 master 分支（v3.x Avalonia 重写版）网络相关代码，不涉及原 WPF 版（`Rinacm/Pixeval` 旧仓库）的实现细节。
- `Pixeval.Network.Maho/Desync/`、`Ech/` 两个目录代码存在但 `DomainFrontingType` 中只有 `Fragmentation` 活跃使用；Ech/Desync 实现细节未深入。
- `Mako.SourceGen` 自动生成的扩展方法（`GetConfiguredProxy` 等）未直接读到代码，但 `MakoHttpMessageInvokerProvider.GetDirectInvoker` 第 60 行确认了它的存在和入参语义。
- 没有交叉验证 Pixeval 的 release notes / issue tracker 关于域前置的演进历史；所有结论来自源码 + README 引用。
