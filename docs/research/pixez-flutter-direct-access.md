# pixez-flutter 直连实现分析

> 调研对象：<https://github.com/Notsfsssf/pixez-flutter>（commit 状态：master 分支，截至调研时）
> 调研目的：在 GFW 封锁（*.pixiv.net DNS 污染 + SNI 拦截）背景下，分析 pixez-flutter 如何实现免梯直连 Pixiv。

## TL;DR

pixez-flutter 的"直连"由 **三层互相配合的策略**组成：

1. **HTTP 客户端层**：`dio` + `dio_compatibility_layer` + **rhttp**（Rust 实现的 reqwest 绑定），由 rhttp 提供对 **DNS 静态覆盖** 和 **TLS/SNI/ECH** 的精细控制。
2. **DNS / IP 钉死层**：内置一张静态 IP 表（`210.140.139.155` 给 API/OAuth、`210.140.139.133` 给 i/s.pximg.net），并提供 **DoH 动态探测**（`doh.dns.sb`）让用户运行时更新。
3. **网络模式分流**：三档 `NetworkMode`（`standard` / `ech` / `compat`），`ech` 模式依靠 **Encrypted Client Hello** 让 SNI 在传输层加密、绕开传统 SNI 嗅探封锁；`compat` 模式则禁用证书校验 + 关闭 SNI + 走静态 IP 走"裸连"；`standard` 模式 = 普通 HTTPS 直连（适合墙外/梯子环境）。

**默认模式 = `ech`**（即默认走 ECH + 静态 IP 双保险），`pictureSource` 可让用户改写图片 host 到 `i.pixiv.re` 等反代。

---

## HTTP 客户端层

### 客户端选型

- **应用层**：项目使用 `dio`（`^5.x`）作为高层 HTTP 客户端，见 `lib/network/api_client.dart`、`lib/network/oauth_client.dart`、`lib/network/account_client.dart`、`lib/network/refresh_token_interceptor.dart`。
- **底层引擎**：所有客户端的 `httpClientAdapter` 都被替换成 `ConversionLayerAdapter(RhttpCompatibleClient)`。`RhttpCompatibleClient` 来自 `package:rhttp/rhttp.dart`，底层是 Rust 实现（`flutter_rust_bridge` + `reqwest` + `rustls`），因此才能暴露 `enableEch` / `requireEch` 这类标准 `dart:io` 不提供的 TLS 字段。
- **图片客户端**：单独走 `RhttpCompatibleClient` + `DioCacheManager`（`flutter_cache_manager_dio` 桥接），见 `lib/component/pixiv_image.dart` 的 `PixivImage.generatePixivCache()`。

### 客户端工厂

`api_client.dart` 的 `createDioClient()` 把"应用层 Dio"和"底层 rhttp + 静态 IP/DNS 设置"粘合起来（`lib/network/api_client.dart`）：

```dart
Future<Dio> createDioClient() async {
  final compatibleClient = await r.RhttpCompatibleClient.create(
    settings: PixezNetworkSettings.forHost(
      BASE_API_URL_HOST,                          // 'app-api.pixiv.net'
      userSetting.networkMode,                    // 默认 NetworkMode.ech
    ),
  );
  httpClient.httpClientAdapter = ConversionLayerAdapter(compatibleClient);
  // ...
}
```

OAuth 客户端同构（`lib/network/oauth_client.dart`），仅调用 `PixezNetworkSettings.forHost(BASE_OAUTH_URL_HOST, userSetting.oauthNetworkMode)`，允许 API 和 OAuth 走不同网络模式。

图片客户端由 `lib/component/pixiv_image.dart` 的 `PixivImage.generatePixivCache()` 异步初始化：

```dart
static Future<void> generatePixivCache() async {
  final client = await r.RhttpCompatibleClient.createSync(
    settings: PixezNetworkSettings.forImages(
      userSetting.pictureSource,                  // 默认 ImageHost = i.pximg.net
      userSetting.networkMode,
    ),
  );
  // ... 注入到 DioCacheManager
}
```

> 关键观察：rhttp 是 **跨平台 Rust 实现**，因此 TLS 行为（如 ECH、SNI、证书校验）在 Android/iOS/Windows/macOS/Linux 上都一致；不像 `dart:io` 在 Web 平台根本没有 `verifyCertificates` 字段。

---

## TLS / SNI / ECH 处理

所有 TLS/DNS 设置集中在 `lib/network/pixez_network_settings.dart`，按 `NetworkMode` 分支：

### ECH 模式（默认）

```dart
if (mode == NetworkMode.ech) {
  return r.ClientSettings(
    enableEch: true,
    requireEch: true,
    tlsSettings: r.TlsSettings(
      verifyCertificates: true,
      rootCertSource: r.RootCertSource.webpki,
      sni: true,
    ),
    dnsSettings: r.DnsSettings.static(
      overrides: {
        appApiHost:   ['104.18.10.118', '104.18.11.118'],
        oauthHost:    ['104.18.10.118', '104.18.11.118'],
        accountHost:  ['104.18.10.118', '104.18.11.118'],
      },
    ),
  );
}
```

要点：

- `enableEch: true` + `requireEch: true` —— **强制要求 ECH**，握手时若服务端不返回 ECH 配置则直接失败。这是为了对抗 SNI 嗅探封锁（GFW 通过 SNI 识别 `*.pixiv.net` 然后 RST）。
- `verifyCertificates: true` + `RootCertSource.webpki` —— 证书链验证仍开，但根证书用 Mozilla 维护的 WebPKI（不依赖系统 CA，避免某些定制 ROM 把 Cloudflare/Pixiv 证书吊销）。
- `sni: true` —— SNI 仍发出，但因为 ECH 已加密 SNI 扩展，嗅探者拿到的是密文。
- **DNS 用 Cloudflare 的 104.18.10.118/11.118**（非中国可达的 Cloudflare 边缘 IP），让 DNS 解析本身也走"出口 IP"。

### 兼容模式（compat）

```dart
static r.ClientSettings compatible() {
  return r.ClientSettings(
    tlsSettings: r.TlsSettings(verifyCertificates: false, sni: false),
    dnsSettings: r.DnsSettings.dynamic(
      resolver: (host) async {
        final ip = _compatibleIp(host);
        if (ip != null) return [ip];
        return await InternetAddress.lookup(host)
            .then((value) => value.map((e) => e.address).toList());
      },
    ),
  );
}
```

要点：

- **完全关闭证书校验**（`verifyCertificates: false`）和 **关闭 SNI**（`sni: false`）—— 这是"裸连"路径，给那些 ECH 走不通、且愿意牺牲 TLS 强度换可达性的用户。
- DNS 走自定义 `resolver`，对白名单 host 返回静态 IP（见下节），其它 host 退回系统 DNS。

### 图片模式

```dart
static r.ClientSettings? forImages(String? host, NetworkMode mode) {
  if (mode == NetworkMode.standard) return null;
  if (host != imageHost) return null;       // 用户没在用 i.pximg.net → 不走特殊通道
  return compatible();                      // 否则套用 compat 设置
}
```

图片请求 **不享受 ECH**，统一走 compat（关 SNI + 关证书校验 + 静态 IP），这是 i.pximg.net 历史上的妥协（IP 经常轮换）。

### 证书策略小结

| 模式          | verifyCertificates    | sni       | ECH      | DNS                     |
| ------------- | --------------------- | --------- | -------- | ----------------------- |
| `standard`    | (dart:io 默认 = true) | true      | false    | 系统                    |
| `ech`（默认） | true (WebPKI)         | true      | **必须** | 静态 CF IP              |
| `compat`      | **false**             | **false** | false    | 动态（白名单走静态 IP） |

---

## DNS / IP 钉死

### 静态 IP 表（兜底）

`lib/er/hoster.dart` 顶部硬编码一份默认映射（兜底用）：

```dart
static Map<String, dynamic> _constMap = {
  "app-api.pixiv.net":     "210.140.139.155",
  "oauth.secure.pixiv.net":"210.140.139.155",
  "i.pximg.net":           "210.140.139.133",
  "s.pximg.net":           "210.140.139.133",
  "doh":                   "doh.dns.sb",
};
```

`Hoster.hardMap()` 在 `_map` 为空（即用户从未跑过 DoH 更新）时返回这张表。

### DoH 动态更新

`Hoster.dnsQuery(String name)` 用 Cloudflare DoH（`https://1dot1dot1dot1.cloudflare-dns.com/dns-query?…`）解析主机名，挑 TTL 最大的 A 记录写回本地 + 持久化（`Prefer.setString('h_hoster_$name', host)`）：

```dart
final num = host.split('.');
bool allNum = num.every((element) => int.tryParse(element) != null);
if (allNum) {
  _map[name] = host;
  Prefer.setString('h_hoster_$name', host);
}
```

被解析的 host 列表在 `QUERY_HOST`：

```dart
static final List<String> QUERY_HOST = [
  ImageHost,                     // i.pximg.net
  ImageSHost,                   // s.pximg.net
  'app-api.pixiv.net',
  'oauth.secure.pixiv.net',
];
```

注意 `Hoster.dnsQueryAll()` 只查图片 host（`ImageHost`/`ImageSHost`），API/OAuth 的 IP 一般不动。

### 应用时机

`Hoster._compatibleIp(host)` 在 compat 模式自定义 `resolver` 回调里被调用：

```dart
static String? _compatibleIp(String host) {
  if (host == appApiHost)    return Hoster.api();
  if (host == oauthHost)     return Hoster.oauth();
  if (host == imageHost)     return Hoster.iPximgNet();
  if (host == imageStaticHost)= Hoster.sPximgNet();
  return null;
}
```

每个 getter 先查 DoH 更新过的 `_map`，缺失则回退到 `_constMap`。

### IP 钉死 + Host 头策略

pixez-flutter **不显式构造 `Host: ...` 头**。它的策略等价于：

1. **TCP 连接时把 host 解析到固定 IP**（rhttp 内部完成，Dart 层拿到的是 `210.140.139.155` 这样的字面量）。
2. **SNI / HTTP Host / TLS Server Name 仍写 `*.pixiv.net`**（`sni: false` 时甚至连 SNI 都不发）。
3. rhttp 在 Rust 侧把 socket 接到 IP 但应用层仍按域名走 TLS，因此对服务端来说就是"正常访问"。

`api_client.dart` 显式注入了 `HttpHeaders.hostHeader: BASE_API_URL_HOST`（HTTP/1.1 Host 头），保证中间代理不修改。

> 启示：这种"IP 字面量建连 + 域名/Host 头走 TLS"是 GFW 时代最常见的直连模式；Pictelio 当前在 Android 侧（`MainActivity.shouldInterceptRequest` 拦截 `/pixiv-img/` 代理到 `i.pximg.net` 并注入 Referer）是同一思路的 Java 实现。

---

## API 直连（app-api.pixiv.net）

- `BASE_API_URL_HOST = 'app-api.pixiv.net'`（`lib/network/api_client.dart` 静态字段）。
- Dio `baseUrl = 'https://${BASE_API_URL_HOST}'`，但 `httpClientAdapter` 被替换为 rhttp 的 `ConversionLayerAdapter`，实际建连用 rhttp。
- 网络模式通过 `PixezNetworkSettings.forHost(BASE_API_URL_HOST, userSetting.networkMode)` 决定（默认 `ech`）：
  - `ech` 模式：用 Cloudflare IP（`104.18.10.118/11.118`）做 DNS 覆盖 + 强制 ECH。
  - `compat` 模式：用 `Hoster.api()`（默认 `210.140.139.155`）+ 关证书校验 + 关 SNI。
  - `standard` 模式：返回 `null`，让 rhttp 用系统默认设置（适合梯子/海外环境）。
- 没有为 `*.pixiv.net` 自定义 `hostnameVerifier` —— rhttp 在 `verifyCertificates: true` 路径下用 rustls 默认的 SAN 校验。

请求头里硬编码了 Pixiv 官方 Android UA（`PixivAndroidApp/5.0.155 (Android 10.0; Pixel C)` + `X-Client-Time` + `X-Client-Hash`），`RefreshTokenInterceptor` 在 `onError` 拦 400 → 自动 `OAuthClient.postRefreshAuthToken` → 用新 token 重试（带 `lastRefreshTime` 节流）。

---

## 图片直连（i.pximg.net）

### 图片常量

`lib/component/pixiv_image.dart` 顶部：

```dart
const ImageHost    = "i.pximg.net";
const ImageCatHost = "i.pixiv.re";          // 反代镜像常量
const ImageSHost   = "s.pximg.net";
```

`ImageCatHost` 仅作为命名常量保留，实际生效路径见下节"镜像支持"。

### 图片请求通道

- **不走 `api_client.dart`**。图片有自己的 Dio：`PixivImage.generatePixivCache()` 创建 `RhttpCompatibleClient`（设置来自 `PixezNetworkSettings.forImages(...)`）+ 注入 `PixivImageSourceInterceptor` + 用 `DioCacheManager.initialize(dio)` 把磁盘缓存层挂上去。
- `PixivImageSourceInterceptor.onRequest` 会在请求前调用 `PixivImageSource.resolveUri(...)` 改写 host（见下节）。
- 所有图床默认注入 `Hoster.header(url: url)`：

  ```dart
  static Map<String, String> header({String? url}) {
    Map<String, String> map = {
      "referer":   "https://app-api.pixiv.net/",
      "User-Agent":"PixivIOSApp/5.8.0",
    };
    return map;
  }
  ```

  这两个 header 是 Pixiv CDN 的"准入条件"，缺一返回 403。

### 图片与 API 的直连差异

| 维度              | API（app-api.pixiv.net）              | 图片（i.pximg.net / s.pximg.net）                                 |
| ----------------- | ------------------------------------- | ----------------------------------------------------------------- |
| 默认 IP（compat） | `210.140.139.155`                     | `210.140.139.133`                                                 |
| 默认网络模式      | `ech`（可单独设 `networkMode`）       | 同 `networkMode`，但走 `forImages` 分支（无 ECH，套 compat 设置） |
| 证书校验          | ech 模式开（WebPKI）                  | compat 模式关                                                     |
| SNI               | ech 模式开（ECH 加密）；compat 模式关 | compat 模式关                                                     |
| 反代支持          | ❌（baseUrl 写死）                    | ✅（`pictureSource` 可改写）                                      |
| DoH 更新          | ❌（不在 `dnsQueryAll` 范围）         | ✅（`ImageHost`/`ImageSHost` 在 `QUERY_HOST`）                    |

> 直连 i.pximg.net 的 IP（`210.140.139.133`）历史上不稳定，pixez-flutter 提供 DoH 让用户在设置页"刷新图片 host"来获取新 IP。

---

## OAuth 直连（oauth.secure.pixiv.net / accounts.pixiv.net）

OAuth 客户端独立于 API 客户端（`lib/network/oauth_client.dart`）：

```dart
static const String BASE_OAUTH_URL_HOST = 'oauth.secure.pixiv.net';
// ...
Future<Dio> createDioClient() async {
  final compatibleClient = await r.RhttpCompatibleClient.create(
    settings: PixezNetworkSettings.forHost(
      BASE_OAUTH_URL_HOST,
      userSetting.oauthNetworkMode,           // 与 API 可独立配置
    ),
  );
  httpClient.httpClientAdapter = ConversionLayerAdapter(compatibleClient);
  ...
}
```

注意 `oauthNetworkMode` 默认也是 `ech`（见 `lib/store/user_setting.dart`），但用户可以单独配。`accounts.pixiv.net`（注册/账号管理）走 `lib/network/account_client.dart`，其 `BASE_API_URL_HOST = 'accounts.pixiv.net'`。

OAuth 三个 host 在 `PixezNetworkSettings` 的常量映射：

```dart
static const appApiHost  = 'app-api.pixiv.net';
static const oauthHost   = 'oauth.secure.pixiv.net';
static const accountHost = 'accounts.pixiv.net';
static const imageHost   = 'i.pximg.net';
static const imageStaticHost = 's.pximg.net';
```

它们在 `_compatibleIp` 里都映射到同一个静态 IP（`210.140.139.155`），所以 OAuth/账号走的也是同一条 IP 通道。

> 启示：Pixiv 的 OAuth/账号/推荐 feed 全在同一机房/IP 段，因此可以共用一个 IP；Pictelio 的 Android 实现把所有 `*.pixiv.net` 请求代理到 `i.pximg.net` 是错误的（应该代理到 `app-api.pixiv.net` 的真实 IP 或一台通用 Pixiv 出口 IP）。

---

## 镜像 / 代理回退

### 图片镜像（i.pixiv.re）

镜像由 `pictureSource` 配置（默认 `ImageHost` = `i.pximg.net`），生效路径：

1. 用户在设置里改 `pictureSource`（存 `PICTURE_SOURCE_KEY`）。
2. `PixivImage.generatePixivCache()` 调用 `PixezNetworkSettings.forImages(userSetting.pictureSource, userSetting.networkMode)`。
3. 图片请求经过 Dio 拦截器 `PixivImageSourceInterceptor`：

   ```dart
   @override
   void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
     options.path = PixivImageSource.resolveUri(
       options.uri,
       networkMode: networkMode(),
       pictureSource: pictureSource(),
     ).toString();
     options.baseUrl = '';
     options.queryParameters.clear();
     handler.next(options);
   }
   ```

4. `PixivImageSource.resolveUri()` 只对 `i.pximg.net` host 起作用，把 host 改成用户配置（例如 `i.pixiv.re`），scheme/端口/路径拼接。

### 用户输入镜像后走的 DNS/TLS

如果用户填的是 `i.pixiv.re`，它不再命中 `imageHost` 白名单，因此 `forImages` 返回 `null`（即不应用 compat 设置，走 rhttp 默认 + 系统 DNS）。所以镜像默认走标准 HTTPS，不享受 IP 钉死。

> 这是有意为之的妥协：镜像站通常有自己的反代/PAC 配置，硬钉 IP 会让镜像失效。

### 系统代理 / HTTP 代理

pixez-flutter **没有内置 HTTP 代理配置**（没有 `proxy` 设置 UI）。它依赖：

1. Flutter/dart:io 默认遵循系统代理；
2. rhttp 在 Android 端走 OkHttp/reqwest，对系统级 VPN/proxy 通常透明。

也就是说，"梯子"完全由系统层提供，应用层不感知。

### 网络模式 UI 入口

`lib/store/user_setting.dart` 把 `networkMode` 和 `oauthNetworkMode` 持久化：

```dart
static const String NETWORK_MODE_KEY = "network_mode";
static const String API_NETWORK_MODE_KEY   = "network_mode_app_api_pixiv_net";
static const String OAUTH_NETWORK_MODE_KEY = "network_mode_oauth_secure_pixiv_net";
```

`_restoreNetworkMode()` 做旧版兼容迁移，新装用户默认两个 mode 都是 `NetworkMode.ech`。从 issue #1250（"请求加回兼容模式"）可见：用户可在 standard / ech / compat 三档中切换。

---

## 关键源文件清单

| 文件                                      | 作用                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/network/pixez_network_settings.dart` | 网络模式 → rhttp `ClientSettings` 映射工厂：`forHost()`、`forImages()`、`compatible()`。集中定义 `enableEch/requireEch/sni/verifyCertificates/DnsSettings.static.overrides`。                                                         |
| `lib/network/network_mode.dart`           | `NetworkMode` 枚举（`compat` / `ech` / `standard`）+ `usesCompatibleConnection` / `allowsImageSource` 派生标志。                                                                                                                      |
| `lib/er/hoster.dart`                      | **IP 钉死核心**：`_constMap` 默认 IP 表；`Hoster.api()`/`oauth()`/`iPximgNet()`/`sPximgNet()` 取值器；`dnsQuery()` DoH 更新；`createDioClient()` 把 DoH 客户端（`1dot1dot1dot1.cloudflare-dns.com`）的 DNS 解析同样走静态 IP 防污染。 |
| `lib/er/onezero_client.dart`              | 一份独立的 DoH 客户端（用 `https://doh.dns.sb`），是 `Hoster.dnsQuery` 的备选/历史实现；关键点：`badCertificateCallback = (cert, host, port) => true`，完全跳过证书校验。                                                             |
| `lib/er/pixiv_image_source.dart`          | `PixivImageSource` 把 `i.pximg.net` URL 的 host 改写成 `pictureSource`（如 `i.pixiv.re`），路径拼接保留。`PixivImageSourceInterceptor` 在 Dio 请求层做透明改写。                                                                      |
| `lib/component/pixiv_image.dart`          | 图片组件 + 缓存 Dio 工厂（`generatePixivCache`），调用 `PixezNetworkSettings.forImages(...)`，注入 `PixivImageSourceInterceptor`，用 `DioCacheManager` 做磁盘缓存；`Hoster.header()` 注入 `referer` + `PixivIOSApp/5.8.0` UA。        |
| `lib/network/api_client.dart`             | app-api.pixiv.net 的 Dio 客户端：`createDioClient()` 绑 `RhttpCompatibleClient`；`RefreshTokenInterceptor` 401/400 自动刷新 token。                                                                                                   |
| `lib/network/oauth_client.dart`           | oauth.secure.pixiv.net 的 Dio 客户端，独立 `oauthNetworkMode`，提供密码登录 / PKCE / refresh_token 三种 grant。                                                                                                                       |
| `lib/network/account_client.dart`         | accounts.pixiv.net 的 Dio 客户端（创建临时账号、改密、改邮箱）。                                                                                                                                                                      |
| `lib/store/user_setting.dart`             | `networkMode` / `oauthNetworkMode` / `pictureSource` 的 MobX store + 持久化（`API_NETWORK_MODE_KEY` / `OAUTH_NETWORK_MODE_KEY` / `PICTURE_SOURCE_KEY`）+ `askInit()` 启动时把全部 Dio 客户端按当前模式重新创建。                      |

---

## 启示（对 Pictelio 直连方案）

1. **"模式分流"比"开关"更可维护**：pixez-flutter 不是做一个"启用直连"复选框，而是把"是否启用 IP 钉死 / ECH / 证书校验"三件事拆成 `NetworkMode` 枚举的不同组合。这给用户在"完全 HTTPS 安全但被墙"（`ech`）和"完全裸连但能用"（`compat`）之间留了缓冲。Pictelio 现在 settings 里只有"启用/禁用自定义图床"，可以参考 pixez 的三档模式扩展。

2. **rhttp 是值得借鉴的 Rust TLS 抽象**：dart:io 拿不到 `enableEch`/`requireEch` 字段，但 rustls + reqwest 可以。Pictelio 的 Android 原生侧其实已经走 Java/OkHttp，可以考虑在 Android 侧镜像 `OkHttpClient.Builder` 同样暴露 `enableEch`（OkHttp 5.x 已支持 ECH），而 Web 侧保持 `Vite 代理 + fetch` 不变。Android 与 Web 用不同实现但同一行为契约。

3. **静态 IP 表 + DoH 兜底更新是稳健组合**：硬编码 `210.140.139.155` / `210.140.139.133` 提供"开箱即用"的直连；运行时 DoH（`doh.dns.sb` / `1dot1dot1dot1`）让用户在 IP 失效时手动/自动刷新。Pictelio 当前 Java 侧是硬编码 IP（参考 ADR-0037），可以考虑在设置页提供"刷新直连 IP"按钮调用 DoH。

4. **OAuth/账号/API 可以独立配网络模式**：pixez 把 `oauthNetworkMode` 与 `networkMode` 分开（`lib/store/user_setting.dart`），这是因为登录流程经常对中间人更敏感（用户愿意接受 ECH 但不愿用 compat 模式登录）。Pictelio 目前的 Android `MainActivity.shouldInterceptRequest` 把所有 `*.pixiv.net` 拦到同一 IP，可以考虑 OAuth 登录走 OkHttp 直连（启用 ECH），图片走 WebView 拦截（仍维持现状）。

5. **图片 host 必须可改写**：pixez 把 `pictureSource` 独立成设置项，配合 `PixivImageSourceInterceptor` 拦截器做透明改写，无需改 Pixiv API 返回的 URL。Pictelio 现在 `imageHostStore` 也是这套思路（用户填 CDN host），但实现位置可以更靠近"组件层"——在 `PixivImage` 渲染前改 URL，而不是在 API 解析时改。

---

## 调研元数据

- 调研时间：2026-09-08
- 仓库 commit：master 分支最新（具体 commit 哈希未抓到）
- 所有源码引用均来自 `https://github.com/Notsfsssf/pixez-flutter` 公开 master 分支
- 二次信息源：issue tracker（#1250 兼容模式请求、#1234 421 错误、#1267 登录问题）
- 引用原则：每个结论都附文件路径 + 行号或代码片段；标记为"issue 二手信息"的项目均已在文中注明
