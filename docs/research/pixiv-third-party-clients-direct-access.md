# 三个 Pixiv 第三方客户端的"直连 Pixiv"实现横向对比

> 调研对象：
>
> - [Notsfsssf/pixez-flutter](https://github.com/Notsfsssf/pixez-flutter)（Flutter，跨平台）
> - [asadahimeka/pixiv-viewer-app](https://github.com/asadahimeka/pixiv-viewer-app)（Vue 3 + Tauri + Capacitor）
> - [Pixeval/Pixeval](https://github.com/Pixeval/Pixeval)（C# Avalonia，Windows 桌面）
>
> 调研时间：2026-09-08
> 调研方式：三份独立子报告 ([pixez-flutter-direct-access.md](pixez-flutter-direct-access.md)、[pixiv-viewer-app-direct-access.md](pixiv-viewer-app-direct-access.md)、[pixeval-direct-access.md](pixeval-direct-access.md))，全部基于源码直读（每个结论附文件路径 + 行号）
> 调研背景：GFW 对 `*.pixiv.net`（含 `i.pximg.net`）实施 DNS 污染 + SNI 拦截；本仓库 Pictelio 当前主走"分片代理"治标（[direct-fragmentation-effort-403](pixiv-gfw-blocking-and-bypass.md)），需要看清生态里的成熟方案做选型参考

---

## 一句话总结（TL;DR）

| 项目                 | "直连"含义                               | 是否真的 GFW 抵抗 | 核心机制                                                                                                                                                   |
| -------------------- | ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pixez-flutter**    | **完整直连**（API/OAuth/图片/账号）      | ✅ 真正抗 GFW     | **rhttp Rust TLS 抽象** + **三档 `NetworkMode`（standard/ech/compat）** + **静态 IP 表 + DoH 兜底** + **OAuth 独立网络模式**                               |
| **pixiv-viewer-app** | **只对图片直连**（API 反代/镜像兜底）    | ⚠️ 仅图片域       | **API 直连分支已注释** + **图片 Cronet/QUIC + IP 替换 + Host 头** + **DoH 走自有代理**                                                                     |
| **Pixeval**          | **"直连"= 系统 DNS，"域前置"= TLS 分片** | ✅ 真正抗 GFW     | **`SocketsHttpHandler.ConnectCallback` 自接管 socket** + **TLS ClientHello 分片（在 SNI 字段中间切开 + 伪装 TLS 版本号）** + **6 域静态 IP 表 + 可独立配** |

**Pictelio 当前方案对照**：

- 已实现：[分片代理（HTTP CONNECT 分片，治标）](pixiv-gfw-blocking-and-bypass.md)（[direct-fragmentation-effort-403](direct-fragmentation-effort-403.md)，commit 已合入 main）
- 待评估：客户端级直连（IP 钉死 + Host 头 + ECH/TLS 分片）+ 反代（CF Worker，治本）

---

## 1. 横向对比矩阵

### 1.1 基础架构

| 维度             | pixez-flutter                                                                     | pixiv-viewer-app                                                                                    | Pixeval                                                                            | Pictelio（现状）                                           |
| ---------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **平台**         | Flutter（iOS/Android/桌面/Web）                                                   | Vue 3 + Tauri（桌面）+ Capacitor（iOS/Android）                                                     | C# Avalonia（Windows 桌面）                                                        | SolidJS SPA + Capacitor（Android 原生）+ iOS               |
| **HTTP 客户端**  | `dio` + `rhttp`（Rust 绑 reqwest/rustls）                                         | `axios`（Web）+ `@tauri-apps/plugin-http`（Tauri）+ `capacitor-plugin-pixiv-cronet`（Android QUIC） | `HttpClient` + `SocketsHttpHandler`（.NET 内置）                                   | `fetch`（Web）+ Java `OkHttp`（Native PixivApiPlugin）     |
| **DNS 处理**     | 自定义 `resolver` 回调 + DoH（`doh.dns.sb` / `1dot1dot1dot1.cloudflare-dns.com`） | DoH（`1.1.1.1/dns-query`）+ **必须走 `COMMON_PROXY`**                                               | `Dictionary<string, IPAddress[]>`（6 域）+ `IDnsResolver.LookupAsync`              | Java 侧硬编码 IP，无 DoH（ADR-0145/0146 已落"反代主路径"） |
| **TLS 抽象深度** | **深**（Rust 侧可拿到 `enableEch/requireEch/sni/verifyCertificates`）             | 浅（依赖 Cronet/NSURLSession/reqwest 默认）                                                         | **极深**（`SocketsHttpHandler.ConnectCallback` + 自定义 `SslStream` + TLS 流拦截） | 中（Java `OkHttp` 自定义 `hostnameVerifier` 已具备扩展点） |

### 1.2 直连策略

| 策略点               | pixez-flutter                                                                                               | pixiv-viewer-app                                          | Pixeval                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| **模式分类**         | **三档**：`standard`（HTTPS 海外）/ `ech`（默认，强制 ECH + CF IP 覆盖）/ `compat`（关证书+关 SNI+静态 IP） | **二分**：`direct`（仅图片）/ `proxy`（API 走反代）       | **二分**：`直连`（系统 DNS）/ `域前置`（IP 钉死 + TLS 分片）                |
| **用户可配置性**     | **高**：每个域独立模式 + 自定义 IP + pictureSource 镜像                                                     | 中：图片直连开关 + IP 覆盖                                | **极高**：6 域 5 GitHub 域 IP 全部暴露 + 分片类型 + 镜像 + 代理三态         |
| **API 直连路径**     | ✅ ech 模式强制 ECH + Cloudflare IP 覆盖（默认开）                                                          | ❌ **代码注释禁用**，作者主动放弃                         | ✅ 域前置路径生效（IP 钉死 + TLS 分片）                                     |
| **图片直连路径**     | ✅ compat 模式（关 SNI + 关证书 + 静态 IP）                                                                 | ✅ Cronet/QUIC + IP 替换 + Host 头                        | ✅ 域前置 + `MirrorHost` 支持                                               |
| **OAuth 直连路径**   | ✅ 独立 `oauthNetworkMode`（与 API 可分开）                                                                 | ❌ 走 HibiAPI 反代                                        | ✅ 走 OAuth 域前置（与 API 同 IP 段）                                       |
| **静态 IP 表**       | API/OAuth/账号：`210.140.139.155`；i/s.pximg：`210.140.139.133`（DoH 刷新）                                 | 图片：`210.140.139.131`；API（已注释）：`210.140.139.161` | 6 域默认 Cloudflare + 日本本土（用户可改）                                  |
| **DoH 动态刷新**     | ✅ `doh.dns.sb` + `1dot1dot1dot1.cloudflare-dns.com`                                                        | ✅ `1.1.1.1/dns-query`（走 `COMMON_PROXY`）               | ❌ 用户手动改设置项                                                         |
| **Host 头注入**      | 隐式（rhttp 自动）                                                                                          | ✅ 显式 Android `Host: i.pximg.net`                       | 隐式（`SocketsHttpHandler` 自动用 `context.DnsEndPoint.Host`）              |
| **TLS 证书校验绕过** | ech 模式开（WebPKI）；compat 模式关                                                                         | ❌ 不需要（Pixiv 证书合法）                               | **仅域前置路径**关（`(_, _, _, _) => true`），直连路径开                    |
| **GFW 主动对抗**     | **ECH**（让 SNI 加密，嗅探失效）                                                                            | QUIC（部分场景绕开）                                      | **TLS ClientHello 分片**（在 SNI 字段中间切开 + 伪装 TLS 版本号 0x03 0x09） |
| **反代/镜像回退**    | ✅ pictureSource 可改 host（如 `i.pixiv.re`）                                                               | ✅ `PXIMG_PROXY_BASE` + HibiAPI 镜像 + `COMMON_PROXY`     | ✅ `MirrorHost` 字段 + 系统代理读取                                         |
| **代理配置**         | 依赖系统代理（无内置 UI）                                                                                   | 依赖系统代理（无内置 UI）                                 | **三态**：`System / None / Custom`（通过 `UnsafeAccessor` 反射读 WinHTTP）  |

---

## 2. 各项目的"独门绝技"

### 2.1 pixez-flutter 的"rhttp + 三档模式"

**最值得借鉴的核心设计**：

```dart
// lib/network/pixez_network_settings.dart
static r.ClientSettings? forHost(String host, NetworkMode mode) {
  if (mode == NetworkMode.standard) return null;          // 海外用系统
  if (mode == NetworkMode.ech) {
    return r.ClientSettings(
      enableEch: true, requireEch: true,                 // 强制 ECH
      tlsSettings: r.TlsSettings(verifyCertificates: true, rootCertSource: r.RootCertSource.webpki, sni: true),
      dnsSettings: r.DnsSettings.static(overrides: {      // DNS 静态覆盖
        appApiHost: ['104.18.10.118', '104.18.11.118'],   // Cloudflare IP
        ...
      }),
    );
  }
  // compat: 关证书 + 关 SNI + 自定义 resolver
}
```

**亮点**：

- **三档 NetworkMode** 比单一开关可维护性显著更好
- **rhttp 的 Rust TLS 抽象**让 dart:io 没有的 `enableEch/requireEch` 字段可用
- **OAuth/API/账号 可独立配网络模式**——登录流程对 MITM 更敏感，可以走更严格的 ech 模式
- **DNS 静态覆盖用 Cloudflare IP**（非中国可达的 CF 边缘）—— 让 DNS 解析本身也走"出口 IP"
- **`webpki` 根证书**——不依赖系统 CA，避免某些定制 ROM 把 Cloudflare/Pixiv 证书吊销

### 2.2 pixiv-viewer-app 的"只对图片直连"取舍

**最值得借鉴的设计决策**：**主动放弃 API 直连**

```javascript
// src/api/client/pixiv-api.js:80-85
}/*  else if (window.p_api_hosts) {            // ← 整段注释掉
  options.headers.Host = fUrl.host
  fUrl.host = window.p_api_hosts[fUrl.hostname]
  finalUrl = fUrl.href
} */
```

**为什么放弃 API 直连**（README 暗示）：

- Pixiv API 的 OAuth + App 签名安全策略复杂，自己跑反代更省心
- API 流量小、缓存命中率高，反代成本低
- **图片才是流量大头**——CDN 上百 KB × N 张，**只对图片做 IP 钉死就能解决 80% 的 GFW 问题**

**图片直连的三平台实现**：

- **Android**：`url.host = window.p_pximg_ip` + `Host: i.pximg.net` 头注入 + `Filesystem.downloadFile`
- **iOS**：`Capacitor.Filesystem.downloadFile` + **HTTP 而非 HTTPS**（ATS 限制）
- **Tauri**：`invoke('download_file', ...)` → Rust `reqwest` 走 IP + Host 头

**亮点**：

- **DoH 必须走代理**——GFW 污染 1.1.1.1，用 `COMMON_PROXY`（Cloudflare Workers）包一层
- **回落硬编码 IP**——DoH 失败时用 `210.140.139.131` 兜底
- **Cronet/QUIC 选型**——QUIC UDP 443 自带加密，部分场景绕开 GFW
- **README 明确承认参考了 PixEz**

### 2.3 Pixeval 的"TLS ClientHello 分片"

**最值得借鉴的核心实现**（也是 GFW 对抗的硬核方案）：

```csharp
// Pixeval.Network.Maho/Fragmentation/TlsRecordFragmentedStream.cs:117-186
// 把整段 ClientHello 按 SNI 字段"前一半 / 后一半"切成多段：
// - 第 1 段保留原 5 字节 record header
// - 把 item.Span[1]=0x03; item.Span[2]=0x09;（伪装 TLS 版本号，欺骗 GFW 状态机）
// - 后续每段重新构造 record header
// - 每段间隔 await Task.Delay(100, …)
// - 每段独立 FlushAsync
```

**亮点**：

- **域前置 vs 直连 解耦**：`SocketsHttpHandler.ConnectCallback` 接管 socket 层，IP 钉死只在域前置路径生效
- **`Dictionary<string, IPAddress[]>` 6 域全配**：Cloudflare（`104.18.x/172.64.x`）+ 日本本土（`210.140.139.x`）
- **`ConnectCallback` 模式**：依赖 SocketsHttpHandler 自动用 `context.DnsEndPoint.Host` 做 SNI，省掉手工 TLS 握手
- **证书校验放行仅限域前置路径**（`SslStream(..., (_, _, _, _) => true)`），直连路径保留默认校验——**安全边界清晰**
- **`MirrorHost` 设计优雅**：用户填 `i.pixiv.re`（纯 host）或 `https://i.pixiv.re`（完整 URL）皆可生效
- **`ProxyType` 三态** + **按 `(proxySetting, bypass)` 缓存不同 handler**——多个代理配置可共存
- **系统代理读取**用 `[UnsafeAccessor]` 反射读 .NET 内部 `SystemProxyInfo.ConstructSystemProxy`

---

## 3. 三个项目 vs Pictelio 现状对照

### 3.1 Pictelio 当前直连方案

| 维度                     | 现状                                                                                                                                            | 备注                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Android 直连**         | Java `MainActivity.shouldInterceptRequest` 拦截 `/pixiv-img/` 代理到 `i.pximg.net`，注入 Referer                                                | 已落（[ADR-0037](architecture/image-pipeline.md)） |
| **图片直连**             | `/pixiv-img/` 路径代理                                                                                                                          | 同上                                               |
| **API 直连**             | **不直连**——反代主路径（[ADR-0145/0146](pixiv-gfw-blocking-and-bypass.md)）                                                                     | 反代 = Cloudflare Workers 治本路线                 |
| **TLS 分片（分片代理）** | **已实现并推送 main**（[direct-fragmentation-effort-403](direct-fragmentation-effort-403.md)）：Java `RedirectingSocket` + IOException 错误归类 | 治标策略                                           |
| **GFW 主动对抗**         | ❌ 无（依赖分片代理 + 反代）                                                                                                                    |                                                    |
| **用户可配置性**         | 中：`/image-host` 改 host + `/image-cache` 改 UA/Referer                                                                                        | [ADR-0090 → ADR-0037]                              |
| **DoH**                  | ❌ 无                                                                                                                                           | 当前硬编码 IP                                      |

### 3.2 Pictelio 与三家对比的差距

| 能力                     | pixez-flutter    | pixiv-viewer-app    | Pixeval           | Pictelio                            |
| ------------------------ | ---------------- | ------------------- | ----------------- | ----------------------------------- |
| **三档网络模式**         | ✅               | ❌                  | ✅（二分）        | ❌（仅"反代/默认"两态）             |
| **ECH 加密 SNI**         | ✅（默认开）     | ❌                  | ❌（已注释）      | ❌                                  |
| **TLS ClientHello 分片** | ❌               | ❌                  | ✅（核心）        | ❌（HTTP CONNECT 分片，不是 TLS）   |
| **Cronet/QUIC**          | ❌               | ✅（Android）       | ❌                | ❌                                  |
| **OAuth 独立网络模式**   | ✅               | ❌                  | ❌                | ❌                                  |
| **DoH 兜底刷新**         | ✅（双重）       | ✅（走代理）        | ❌                | ❌                                  |
| **Host 头显式注入**      | 隐式             | ✅ 显式             | 隐式              | ✅ 隐式（`shouldInterceptRequest`） |
| **6 域独立 IP 配**       | ❌（统一映射）   | ❌                  | ✅（用户全控）    | ❌                                  |
| **MirrorHost 用户可填**  | ✅ pictureSource | ✅ PXIMG_PROXY_BASE | ✅ MirrorHost     | ✅ imageHostStore                   |
| **TLS 校验仅域前置关**   | ✅（按模式）     | ❌（默认开）        | ✅（路径隔离）    | N/A                                 |
| **系统代理读取**         | ✅（依赖）       | ✅（依赖）          | ✅ + **三态配置** | ✅ `https_proxy` 环境变量           |

---

## 4. 对 Pictelio 直连方案的启示

> 以下综合三家之长，按可落地优先级排序。每条都标注来源（哪个项目给了灵感）+ Pictelio 现状 + 建议落地路径。

### P0：HTTP CONNECT 分片代理 = 治标，建议与"客户端直连"互补并存

**现状**：分片代理已合入 main（[direct-fragmentation-effort-403](direct-fragmentation-effort-403.md)），但用户质疑"治标不治本"。
**三家启示**：

- **pixez-flutter**：API 默认走 `ech` + CF IP 静态覆盖（**治本**思路）
- **pixiv-viewer-app**：API 走反代 + 图片直连（**二分法**）
- **Pixeval**：走域前置 TLS 分片（**最强对抗**）
  **建议**：

1. **保留分片代理**作为兜底通道（直连全失效时的备胎）
2. **新增"客户端直连"模式**（用户可选）：图片 IP 钉死 + 反代 API
3. **保留反代（CF Worker，治本）**作为主路径（[ADR-0145/0146](pixiv-gfw-blocking-and-bypass.md) 已立）

### P0：图片直连 = 90% 收益，优先落地

**三家共同路径**：

- pixiv-viewer-app 主动放弃 API 直连，但图片直连**完整保留**（"图片才是流量大头"）
- pixez-flutter 图片走 compat 模式（关 SNI + 关证书 + 静态 IP `210.140.139.133`）
- Pixeval 图片独立 `PixivImageHttpMessageHandler` + MirrorHost

**对 Pictelio 的建议**（Pixiv-side 直接落地）：

1. **Java 侧已实现的 `shouldInterceptRequest` 拦截 `/pixiv-img/` 路径**就是直连机制——保持现状即可
2. **新增 DoH 刷新按钮**（仿 pixiv-viewer-app `setPximgIP()`）：通过 Cloudflare Workers 解析 `i.pximg.net` → 写入硬编码 IP 失败时的 fallback
3. **加 IP 回落池**（仿 Pixeval）：内置 2-3 个 Akamai 边缘 IP（`210.140.139.131/133/134/137`），按顺序重试避免单 IP 失效

### P1：HTTP CONNECT 分片代理 = 治标，建议保留但与"客户端直连"互补并存

### P1：引入"三档网络模式"（仿 pixez-flutter）

**当前 Pictelio**：

- 仅 `/image-host` 改 host（图片反代）
- 仅 `/image-cache` 改 UA/Referer

**建议新增 UI**：

| 模式               | API 通道              | 图片通道                                      | 用户场景          |
| ------------------ | --------------------- | --------------------------------------------- | ----------------- |
| **反代（推荐）**   | CF Worker 反代        | CF Worker 反代                                | 通用，免配置      |
| **直连（高级）**   | CF Worker 反代        | Java `shouldInterceptRequest` 钉 IP + Host 头 | 高带宽/低反代成本 |
| **纯代理（兜底）** | HTTP CONNECT 分片代理 | HTTP CONNECT 分片代理                         | 直连全失效时      |

### P1：DoH 兜底刷新（仿 pixez-flutter + pixiv-viewer-app）

**两家的做法**：

- pixez-flutter 用 `doh.dns.sb` + `1dot1dot1dot1.cloudflare-dns.com`（双重）
- pixiv-viewer-app 用 `1.1.1.1/dns-query` 但**必须走 `COMMON_PROXY`**（GFW 污染 1.1.1.1）

**对 Pictelio 的建议**：

1. 在 `/image-cache` 设置页加 "**刷新直连 IP**" 按钮
2. 通过自有 CF Worker 解析 `i.pximg.net` → 返回最新 Akamai 边缘 IP 列表
3. 失败时回落硬编码 IP（兜底）
4. **DNS 解析必须走自有代理**——不能直连 1.1.1.1

### P1：Host 头显式注入（仿 pixiv-viewer-app）

**现状**：Pictelio Java `shouldInterceptRequest` 注入了 **Referer** + **User-Agent**，但**未注入 Host 头**。
**pixiv-viewer-app 的明确做法**：

```javascript
headers: { Host: 'i.pximg.net', Referer: 'https://www.pixiv.net' }
```

**Akamai 虚拟主机必须显式 `Host: i.pximg.net`**——不注入会被路由到错误 bucket，返回 403/404。

**对 Pictelio 的建议**：

- 检查 `MainActivity.shouldInterceptRequest` 是否已注入 Host 头；如未，加 `connection.setRequestProperty("Host", "i.pximg.net")`
- 验证：当前 Android 真机图片请求是否带 Host 头（可用 tcpdump/wireshark 验证）

### P2：ECH 加密 SNI（仿 pixez-flutter，治本）

**pixez-flutter `ech` 模式核心**：

```dart
return r.ClientSettings(
  enableEch: true, requireEch: true,             // 强制 ECH
  tlsSettings: r.TlsSettings(verifyCertificates: true, rootCertSource: r.RootCertSource.webpki, sni: true),
  dnsSettings: r.DnsSettings.static(overrides: {
    appApiHost: ['104.18.10.118', '104.18.11.118'],   // Cloudflare IP
  }),
);
```

**rhttp 的 Rust TLS 抽象**让 dart:io 没有的 `enableEch/requireEch` 字段可用——Pictelio 同样可以在 **Android 侧用 OkHttp 5.x ECH 镜像实现**（OkHttp 5.x 已支持 ECH），Web 侧保持 `Vite 代理 + fetch` 不变。

**对 Pictelio 的建议（长期）**：

1. **Android Java 侧**：`OkHttpClient.Builder().eventListenerFactory` + 自定义 `Dns` 实现（钉 Cloudflare IP）+ ECH 配置
2. **Web 侧不变**：继续走 Vite 代理
3. **优先级**：中等——Pixiv 当前通过 Cloudflare 边缘（`app-api.pixiv.net` 已迁 CF），ECH 价值受限（CF 边缘本身无 SNI handshake_failure 问题）
4. **预研价值**：如果未来 Pixiv 域前置策略加强，ECH 是治本路径

### P2：TLS ClientHello 分片（仿 Pixeval，最强对抗）

**Pixeval 的 `TlsRecordFragmentedStream` 核心**：

```csharp
// 把 ClientHello 在 SNI 字段中间切开 + 伪装 TLS 版本号 0x03 0x09
item.Span[1] = 0x03;
item.Span[2] = 0x09;
```

**对 Pictelio 的可行性评估**：

- ❌ **依赖 .NET 特性**（`ref struct` + `[UnsafeAccessor]`），**不宜直接迁 Web/JS**
- ✅ **可在 Android native 实现**：Java `Socket` + 自定义 `InputStream`/`OutputStream` 包装 TLS ClientHello
- ⚠️ **风险**：GFW 已经升级针对分片（参见 [GFW Report 2025 关于 TLS 分片反制](https://github.com/net4people/bbs/issues/296)），效果可能衰减

**对 Pictelio 的建议**：

- **短期不落地**——风险/收益不匹配
- **保留为应急储备**——如果分片代理+反代全部失效，启动 native 分片实现
- **优先级**：低

### P2：OAuth 独立网络模式（仿 pixez-flutter）

**pixez-flutter 的做法**：`oauthNetworkMode` 与 `networkMode` 分离，因为登录流程对 MITM 更敏感。

**对 Pictelio 的建议**：

- 当前 OAuth 走 Java `PixivApiPlugin` + 反代（CF Worker），**已是"独立通道"**
- 如未来直连 OAuth，建议：**OAuth 走 ech 模式（加密 SNI）** + **图片/Feed 走 compat 模式（裸连）**——登录更安全，浏览更激进

### P3：代理三态配置（仿 Pixeval）

**Pixeval `ProxyType { System, None, Custom }`**——比 Pictelio 当前"读 `https_proxy` 环境变量"更灵活。

**对 Pictelio 的建议（长期）**：

- 在 Android 设置页加 "**代理模式**"：`系统 / 禁用 / 自定义`
- 配合 `https_proxy` 环境变量读取，写入 `OkHttpClient.Builder().proxy(...)`
- **优先级**：低——大多数用户用系统代理即可

### P3：6 域独立 IP 配（仿 Pixeval，最强可控）

**Pixeval `NetworkSettingsGroup` 暴露**：

- 6 个 Pixiv 域的 IP 列表（每个域 2-4 个候选 IP）
- 5 个 GitHub 域的 IP 列表（用于更新检查）

**对 Pictelio 的可行性**：

- ⚠️ **过度暴露**——普通用户不懂 IP 列表
- ✅ **可改为"高级模式"折叠面板**——开发者向
- **优先级**：低

---

## 5. 落地路线图（综合建议）

### Phase 1（短期 1-2 周）

1. ✅ 保留分片代理（已合入 main）
2. ✅ 反代（CF Worker）主路径（[ADR-0145/0146](pixiv-gfw-blocking-and-bypass.md)）
3. **新增**：DoH 刷新按钮（仿 pixiv-viewer-app `setPximgIP`）
4. **新增**：图片 IP 回落池（仿 Pixeval `NameResolvers`）
5. **验证**：Java `shouldInterceptRequest` 是否注入 Host 头（补齐如缺失）

### Phase 2（中期 1-2 月）

1. **新增**：图片直连模式（仿 pixiv-viewer-app `PXV_PXIMG_DIRECT`）
2. **新增**：三档网络模式 UI（仿 pixez-flutter `NetworkMode`）
3. **重构**：把 imageHostService + imageCacheStore 整合到"网络模式"概念

### Phase 3（长期 3+ 月）

1. **Android Java 侧 ECH 支持**（仿 pixez-flutter `rhttp` + OkHttp 5.x）
2. **TLS ClientHello 分片 native 实现**（仿 Pixeval `TlsRecordFragmentedStream`，仅应急用）
3. **代理三态配置**（仿 Pixeval `ProxyType`）
4. **6 域独立 IP 高级配置**（仿 Pixeval `NetworkSettingsGroup`）

---

## 6. 调研边界声明

- 所有结论来自源码直读 + README/issue 引用，每个结论在三份子报告中都有"文件路径 + 行号"标注
- **pixez-flutter**：调研覆盖 `lib/network/`、`lib/component/pixiv_image.dart`、`lib/er/hoster.dart` 等核心网络模块；未交叉验证 issue tracker 所有 #xxxx 编号
- **pixiv-viewer-app**：调研覆盖 `src/api/`、`src/platform/`、`src-tauri/`；未交叉验证 Capacitor 插件 `capacitor-plugin-pixiv-cronet` 内部实现
- **Pixeval**：调研覆盖 `Mako/Net/` + `Pixeval.Network.Maho/Fragmentation/`；`Mako.SourceGen` 自动生成代码未直接读到；Ech/Desync 实现细节未深入
- **未做**：用户实际体验评测（这三个项目的真实使用感受需真机测试）；GFW 当前最新封锁策略对比（依赖 [gfw.report](https://gfw.report/) 等外部信源）

---

## 7. 关联文档

- 三份子报告：
  - [pixez-flutter-direct-access.md](pixez-flutter-direct-access.md)
  - [pixiv-viewer-app-direct-access.md](pixiv-viewer-app-direct-access.md)
  - [pixeval-direct-access.md](pixeval-direct-access.md)
- Pictelio 相关 ADR：
  - [ADR-0037：PixivApiPlugin 网关架构](../adr/)（Java 侧图片拦截 `/pixiv-img/` 路径）
  - [ADR-0090 → ADR-0037 修订：三层图片缓存架构](../adr/)
  - [ADR-0145：直连认证韧性](../adr/)
  - [ADR-0146：直连 v2 多候选竞速/分层超时](../adr/)
- Pictelio 已落地 effort：
  - [pixiv-gfw-blocking-and-bypass.md](pixiv-gfw-blocking-and-bypass.md)：GFW 封锁模型 + 三层免梯通路原型验证
  - [direct-fragmentation-effort-403.md](direct-fragmentation-effort-403.md)：分片代理 10 commits 已合入 main
- 外部参考：
  - [GFW Report](https://github.com/net4people/bbs/issues/296)：TLS 分片反制研究
  - [pixez-flutter](https://github.com/Notsfsssf/pixez-flutter) / [pixiv-viewer-app](https://github.com/asadahimeka/pixiv-viewer-app) / [Pixeval](https://github.com/Pixeval/Pixeval) 仓库
