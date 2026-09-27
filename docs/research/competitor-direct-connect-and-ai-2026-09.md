# 调研：竞品的「国内直连」实现 + 「AI 增值能力」实现（vs Pictelio）

> 调研日期：**2026-09-27**
> 调研者：技术调研 worker（子会话）
> 关联文档：`docs/research/competitor-features-comparison.md`（功能存在性对比，本文是它的**实现层深化**，并在其中修正 5 处已过时的结论）、`openwiki/architecture/api-layer.md`、`openwiki/architecture/image-pipeline.md`、`openwiki/integrations/android-native.md`
> 上游基线：Pictelio v5.5.0（webview 客户端）+ app-lynx pre-alpha

---

## 0. 元信息

### 0.1 取数方式与时间

| 项 | 说明 |
|---|---|
| 取数时间 | 2026-09-27 14:00–14:20（CST） |
| 主要工具 | `gh` CLI（`gh api repos/<o>/<r>/contents/<path>` 抓原始文件 base64 解码；`gh api repos/<o>/<r>/releases` 取版本时间；`gh search repos` 定位仓库） |
| 补充工具 | `web_fetch`（仅 `https://pivlite.com/` 一处闭源商业站点）、`codegraph explore`（核实 Pictelio 自身三接入点） |
| 未使用 | 训练记忆。所有实现结论均来自本次抓取的源码文本 |

### 0.2 证据等级标记

| 标记 | 含义 |
|---|---|
| **【源码】** | 逐字读过仓库源文件，关键行附文件路径 + 符号名 |
| **【仓库文档】** | 仓库自带的 `docs/*.md` / README（项目方自述，但通常是工程纪要，可信度较高） |
| **【官方站】** | 闭源商业项目官网文案（**纯自述，无技术细节**） |
| **【未核实】** | 假设存在但本次未取得一手证据 |

### 0.3 竞品版本快照（GitHub Releases，`published_at`，UTC）

| 项目 | 仓库 | 最新 release | 日期 | Star |
|---|---|---|---|---|
| Pixiv-Shaft | `CeuiLiSA/Pixiv-Shaft`（默认分支 `classic`） | `v4.9.4` | **2026-09-18** | 7,927 |
| PiPixiv | `darriousliu/PiPixiv` | `v2.5.1` | **2026-09-25** | 252 |
| Pixiv-SwiftUI | `Eslzzyl/Pixiv-SwiftUI` | `v0.16.1` | **2026-09-26** | 107 |
| pixez-flutter | `Notsfsssf/pixez-flutter` | `0.9.109` | **2026-09-07** | 12,942 |
| P站助手 | 无公开仓库 | — | — | — |
| 开源阅读 Legado | `gedoor/legado` | **已下架**（见 §1.6） | 2026-05-27 | 47,102 |

### 0.4 对 `competitor-features-comparison.md` 的 5 处修正

| # | 原文结论 | 实际情况（本次核实） | 证据 |
|---|---|---|---|
| 1 | Shaft `v4.7.7` | **`v4.9.4`（2026-09-18）**，跨了 8 个 minor | `gh api repos/CeuiLiSA/Pixiv-Shaft/releases` |
| 2 | Shaft「AI 套件**订阅制**（5×/20× 配额，免费版有上限）」 | **错**。订阅配额只作用于「任意关键字按热度排序」。**AI 超分 / 抠图 / 漫画翻译 / 动图补帧 三档订阅全部 ✅ 不上锁**。云端 LLM 翻译（v4.9.3 起）另有独立用量比例，非订阅档位 | README「💎 订阅」表格 + FAQ；`v4.9.3` release notes |
| 3 | PiPixiv `v2.4.0` | **`v2.5.1`（2026-09-25）** | releases API |
| 4 | Pixiv-SwiftUI `v0.16.0` / pixez-flutter `v0.9.102` | **`v0.16.1`（2026-09-26）** / **`0.9.109`（2026-09-07）** | releases API |
| 5 | Legado「活跃（书源 v284，2026-09）」 | **项目已下架**。`gedoor/legado` main 分支 2026-05-27 08:30:57 UTC 起只剩一个「公告」commit（涉侵权法律公告），代码全部删除，仓库体积 52 KB / 2 个文件 | `gh api repos/gedoor/legado/git/trees/HEAD?recursive=1` + commits API |

---

# 方向一：国内直连（免代理访问 Pixiv）—— 竞品怎么做的

## 1.1 物理前提（先说清楚，否则后面全是玄学）

GFW 对 `*.pixiv.net` 的封锁是**按 TLS ClientHello 里的 SNI 做全端口 TCP RST**，不是按端口、不是按 IP。这一条决定了所有直连方案只能从「SNI 藏起来 / 换个 SNI / 换传输层」三个方向走，DNS 绕过只是**必要不充分**条件。

Shaft 把这段背景写进了仓库文档，并且**明确纠正了自家早期 release note 的错误说法**：

> 「Pixiv API 在 Cloudflare 上不是最近的事：`app-api.pixiv.net`、`oauth.secure.pixiv.net` 至少从 2025 年中起就由 Cloudflare CDN 托管」
> 「域前置（SNI 操纵）"失效"的原因不是 SNI-RST……它在 Cloudflare 上不可用的真正原因是：Cloudflare 边缘会校验 SNI 与 HTTP Host 一致，经典 domain fronting 已不再工作」

**【仓库文档】** `CeuiLiSA/Pixiv-Shaft/docs/direct-connect.md`（默认分支 `classic`）

同一份文档还给出了一条**极重要的自曝**：Shaft 承认自己这条路是**赌来的**，并且写明赌注：

> 「我们之所以能走通 QUIC，是因为 **`pixiv.net` 目前不在它的 QUIC SNI 黑名单里**。换句话说：这不是一条『GFW 管不了的路』，而是一条『GFW 暂时还没来管的路』。一旦 `pixiv.net` 进 QUIC 黑名单，这条路径也会失效。」
> （引用 GFW Report 的 USENIX Security 2025 论文）

同时，文档记录了老方案的**已确证退化**：

> 「2026 年 4 月前后，这套方案在 API 侧出现明显退化——部分账户开始遇到 403 或握手异常，而图片加载（`i.pximg.net`，仍走 Pixiv 自有基础设施）不受影响。」

**这条是本次调研对 Pictelio 最有价值的一条情报**：历史主流方案（无 SNI TLS + 自定义 DNS）**在 2026-04 已经在 API 侧实际失效了**，且失效形态是「部分账户 403」——即**不是全挂，是风控式随机挂**，用户会归因为「app 有 bug」。

---

## 1.2 Pixiv-Shaft（`CeuiLiSA/Pixiv-Shaft`）—— 双通道：Cronet QUIC + No-SNI TLS

### 1.2.1 架构总览

```
API 请求  → Retrofit → OkHttp → CronetInterceptor → Cronet(QUIC/h3, UDP:443) → Cloudflare 104.18.42.239
图片加载  → Glide    → OkHttp → RubySSLSocketFactory(无 SNI) + HttpDns(硬编码 IP) → Pixiv 210.140.139.x
```

**【源码】** 架构图与两通道职责：`docs/direct-connect.md`

### 1.2.2 通道一：Cronet QUIC（关键实现事实）

**【源码】** `app/src/main/java/ceui/lisa/http/CronetInterceptor.java`

| 事实 | 证据（行/符号） |
|---|---|
| 白名单硬编码 6 个 host 才走 Cronet，其余 `chain.proceed()` 透传 | `DIRECT_CONNECT_HOSTS = {app-api, oauth.secure, www, accounts, comic.pixiv.net, api.fanbox.cc}`（`shouldInterceptHost`） |
| 硬编码 Cloudflare Anycast IP `104.18.42.239` / `172.64.145.17` | `CF_IP_PRIMARY` / `CF_IP_SECONDARY`（`public static final`） |
| DNS 绕过用 Cronet 的 `HostResolverRules` MAP 规则，不是自建 DNS 客户端 | `buildEngine()`：`"MAP app-api.pixiv.net 104.18.42.239, MAP oauth.secure.pixiv.net …, MAP www.pixiv.net …"` 塞进 `ExperimentalCronetEngine.Builder.setExperimentalOptions()` |
| QUIC Hint 加速协议发现 | `.addQuicHint("app-api.pixiv.net", 443, 443)` 等三条 |
| **实现是 OkHttp `Interceptor` 桥接**，Retrofit 层零改动 | `class CronetInterceptor implements Interceptor`，`Retro.java:51` `before.addInterceptor(new CronetInterceptor(...))` |
| **响应全量缓冲进内存**，硬上限 10 MB | `MAX_RESPONSE_BYTES = 10 * 1024 * 1024`（`onReadCompleted` 超限即 `req.cancel()`） |
| 30 s 硬超时 + 100 ms 轮询探测 `chain.call().isCanceled()` 传播协程取消 | `REQUEST_TIMEOUT_MILLIS = 30_000`，`CANCEL_POLL_MILLIS = 100L` |
| 剥离 `content-encoding` / `content-length` 响应头（Cronet 已解码） | `intercept()` 尾部 `Headers.Builder` 循环里 `continue` 掉这两个 key |

**工程代价【仓库文档】**：「APP 体积会大几 MB（Chrome 的网络引擎打包进去了）」。

### 1.2.3 通道二：No-SNI TLS（图片）

**【源码】** `app/src/main/java/ceui/lisa/http/RubySSLSocketFactory.java` + `HttpDns.java` + `TrustAllCertManager.java`

| 事实 | 证据 |
|---|---|
| 核心手法：`delegate.createSocket(socket, null, port, autoClose)` —— **传 `null` 作为 hostname，Java TLS 就不会在 ClientHello 里写 SNI 扩展** | `RubySSLSocketFactory.createSocket(Socket, String, int, boolean)`，注释原文：「传 null hostname → Java TLS 不在 ClientHello 中包含 SNI 扩展」 |
| 硬编码图片 IP 池：`210.140.139.134 / .133 / .131` | `HttpDns.FALLBACK_IMAGE_IPS` |
| API 域名的 fallback 直接复用 Cronet 的两个 CF IP（同一份常量） | `HttpDns.FALLBACK_API_IPS = {CronetInterceptor.CF_IP_PRIMARY, CF_IP_SECONDARY}` |
| DNS 按后缀分流：`hostname.endsWith("pximg.net")` → 图片 IP 池，否则 → API IP 池 | `HttpDns.lookup()` 尾部 |
| **DoH 双端点串行回退**：`https://1.0.0.1/` → `https://185.222.222.222/`（`doh.dns.sb`）；另有 `ALIDNS_DOH_POINT = https://223.5.5.5/` 定义但 `HttpDns` 未使用 | `CloudFlareDNSService.kt` 常量 + `HttpDns.DOH_ENDPOINTS`（只取前两个） |
| DoH 客户端强制 HTTP/1.1 + 3 s 超时 | `dohClient = OkHttpClient.Builder().protocols([HTTP_1_1]).connectTimeout(3s).readTimeout(3s)` |
| DoH 开关是用户设置项，关掉后**主动信任系统 DNS** | `isSecureDnsEnabled()` 读 `sSettings.isUseSecureDns()`；注释引用 issue #616 |
| **图片客户端强制 HTTP/1.1**（不做 H2 连接复用） | `Shaft.java:832` `glideBuilder.protocols(singletonList(HTTP_1_1))` |
| 配套 `IPv4OnlyDns`：只对 4 个 pixiv 域名过滤 IPv6（防 IPv6 污染），**且只解析出 IPv6 时保留原结果**（NAT64 回退） | `IPv4OnlyDns.kt` `IPV4_ONLY_HOSTS` + `keepIpv4IfPossible` |

**安全性代价【源码】**：`TrustAllCertManager` 三个方法全空 + `Shaft.java:846` `hostnameVerifier((hostname, session) -> true)`。仓库自己的文档 `docs/image-host.md` 明确写：「`TrustAllCertManager` + `hostnameVerifier((h, s) -> true)` 全放行（**自定义反代时是安全风险**）」。

### 1.2.4 镜像域名（与直连互斥，Shaft 自己踩过坑）

**【源码】** `app/src/main/java/ceui/lisa/http/ImageHostManager.kt`

| 事实 | 证据 |
|---|---|
| 4 个模式：`PIXIV` / `PIXIV_CAT` / `PIXIV_RE` / `PIXIV_NL` / `CUSTOM` | `enum class Mode` |
| 镜像 host：`i.pixiv.cat` / `i.pixiv.re` / `i.pixiv.nl` | `PIXIV_CAT_I` / `PIXIV_RE_I` / `PIXIV_NL_I` 常量 |
| **`pixiv.cat` 主域名在中国大陆被墙，`pixiv.re` 为大陆推荐镜像** | 源码注释：「pixiv.cat 主域名在中国大陆被墙，pixiv.re 为大陆推荐镜像(issue #865 追加)」 |
| 镜像**不服务 `s.pximg.net`**（`s.pixiv.*` 是 NXDOMAIN，且 `i.pixiv.*` 对 `/common/...` 返 404），所以 `s.pximg.net` 保持原样 | 源码注释 + issue #1152 |
| **改写只发生在 load 时，data model 仍存原始 pximg URL**（分享/复制 URL 走原值） | 注释：「rewrite 在 load 时应用，不在 store 时」 |
| 直连 bypass 与镜像模式**互斥**，用 `requiresStandardClient()` 探针 gate 住 | `Shaft.java:837` `if (sSettings.isDirectConnect() && !ImageHostManager.requiresStandardClient())` |
| 模式变更**下次启动生效**（图片 OkHttpClient 在启动时构建一次被 Glide 捕获） | 注释：「a mode change persists to Settings and takes effect on the next app launch via hydration」 |

**【仓库文档】** `docs/image-host.md` 记录了 12 个文件的接线清单、4 个待决策项，以及**未接线的 13 处分享/复制 URL 全部保留原始 pximg** 的设计决定。

### 1.2.5 「首次登录后免代理」的完整链路

Shaft 不是一个开关，而是**三个正交维度**的组合（**【源码】**）：

1. **传输层**：`sSettings.isDirectConnect()` → `Shaft.onCreate` 构建图片 OkHttpClient 时挂 `RubySSLSocketFactory` + `TrustAllCertManager` + `hostnameVerifier(true)` + `HttpDns`（`Shaft.java:837-851`）；API 侧 `Retro.java:103 applyDirectConnect(builder, directConnect)` 挂 `CronetInterceptor`。
2. **DNS 层**：`sSettings.isUseSecureDns()` → `HttpDns` 是否走 DoH（`HttpDns.isSecureDnsEnabled()`）。
3. **图片源层**：`ImageHostManager.mode` + `customHost`（`Shaft.java:372-376` 启动时从 Settings 灌入）。

首次登录（OAuth）**不走 Cronet 直连**：`CronetInterceptor.DIRECT_CONNECT_HOSTS` 里虽然有 `oauth.secure.pixiv.net`，但 OAuth 走 `OAuthPlugin`/独立 client；`AppApiProxyInterceptor` 注释明确说明「与直连（Cronet）不互斥」——代理改写后的域名不在 Cronet MAP 规则内，自然走系统 DNS/TLS。

### 1.2.6 一个容易被忽略的工程细节

**【源码】** `app/src/main/java/ceui/lisa/http/CfBlockDetector.kt`：Shaft 专门写了一个**纯函数**来区分「Cloudflare 边缘答的 403」和「pixiv 源站答的 403」：

- 判据不能用 `CF-RAY` / `Server`（源码注释：「app-api 常年就在 Cloudflare CDN 后面……实测（2026-09-18）：200/400/404 源站应答与 403 CF 拦截，四个头一模一样」）。
- 真正判据是**源站指纹** `x-envoy-upstream-service-time`（pixiv 前置 envoy 注入）+ `cf-cache-status`，**两个头都不在**才判为 CF 边缘拦截。
- `Content-Type` 只用来「提高确信度」，不作独立依据（因为 `GET /v1/novel/text?novel_id=1` 源站自己也返 `text/html`）。
- 两条独立通路（头通路 / 正文通路）任一命中即认定，正文通路覆盖「自建源把上游拦截页原样转发回来」。

**这条对 Pictelio 极有价值**：一旦走反代/直连，就会遇到「403 到底是 Pixiv 风控还是链路被中间设备拦了」这个判别问题，而它给了可复用的判据。

---

## 1.3 PiPixiv（`darriousliu/PiPixiv`）—— SNI 替换 + CNAME 源站解析（本次调研技术含量最高）

**【源码】** `common/network/src/androidJvmMain/kotlin/com/mrl/pixiv/common/network/OkHttpSni.kt`（单文件 ~480 行，含全部实现）

### 1.3.1 两个精妙手法

PiPixiv 不用 QUIC、不去 SNI，而是**把 SNI 换成一个 GFW 不管、但 Cloudflare 认识的名字**：

| 事实 | 证据 |
|---|---|
| **API / OAuth 域名：SNI 替换为 `pixiv.me`，HTTP Host 保持原样** | `PIXIV_TLS_SERVER_NAME = "pixiv.me"`；`PIXIV_SNI_REPLACEMENT_HOSTS = setOf(API_HOST, AUTH_HOST)` |
| 实现方式：建连后改 `sslParameters.serverNames` | `Socket.configureServerName()`：`this.serverNames = listOf(SNIHostName(PIXIV_TLS_SERVER_NAME))` |
| 连 TLS 时也用替换名（不是 IP） | `createSocket(socket, host, ...)` 里 `peerHost = when(host) { in PIXIV_SNI_REPLACEMENT_HOSTS -> PIXIV_TLS_SERVER_NAME; ... }` |
| **图片域名（`i.pximg.net` / `s.pximg.net`）：完全不发 SNI** | `PIXIV_NO_SNI_HOSTS = setOf(IMAGE_HOST, STATIC_IMAGE_HOST)` → `serverNames = emptyList()`；且 `peerHost = peerAddress.hostAddress`（用 IP 连） |
| **主机名校验保持严格**（用系统 TrustManager + 默认 HostnameVerifier，不 `ignoreSSL`） | `SystemTls` 用 `TrustManagerFactory.getInstance(default)` + `init(null as KeyStore?)` |
| 集成测试逐条钉死了这三个行为 | `common/network/src/jvmTest/.../SniTlsIntegrationTest.kt`：`apiClientHelloUsesReplacementSniAndKeepsOriginalHttpHost` / `imageClientHelloOmitsSniAndKeepsStrictHostnameVerification` 等 |
| **DNS 查的是 CNAME 源站名，不是真域名** | `PIXIV_ORIGIN_ALIAS = "pixiv.net.cdn.cloudflare.net"`；`PIXIV_ORIGIN_ALIASES = {app-api → pixiv.net.cdn.cloudflare.net, i.pximg.net → i.pximg.net.cdn.cloudflare.net, ...}` |
| DoH 与系统 DNS **竞速**，先返回者胜 | `RacingOriginDnsResolver`：`executor.invokeAny(tasks, timeout, TimeUnit)`，两个 task：DoH / `Dns.SYSTEM` |
| DoH 客户端本身也强制直连（不继承系统代理） | `DnsJsonResolver.client`：`proxy(Proxy.NO_PROXY)` + `socketFactory(DirectSocketFactory)` |
| `DirectSocketFactory` = `Socket(Proxy.NO_PROXY)` | `common/network/src/androidJvmMain/.../DirectSocketFactory.kt` |
| 整个 SNI 模式把 OkHttp 代理设为 `NO_PROXY` | `bypassSNI()` 里 `.proxy(Proxy.NO_PROXY)` |
| 硬编码 fallback IP 池 | `Constants.kt`：`app-api`/`oauth` → `210.140.139.152/155/158/161`；图片 → `210.140.139.129`–`138`（10 个） |
| 非托管 host 一律走系统 DNS（不污染用户自建代理） | `SniReplaceDns.lookup()`：`if (!isManagedHost) return systemDns.lookup(hostname)` |
| 非 Pixiv host **不做 IPv6 过滤**（代理可能有合法 IPv6） | 源码注释 + 对照 Shaft 的 `IPv4OnlyDns`（Shaft 只列 4 个固定 host） |

### 1.3.2 配置面（**【源码】** `UserPreference.BypassSetting`）

```kotlin
@SerialName("sni")
data class SNI(
    val url: String = "https://doh.pub/dns-query",   // DoH 端点，默认腾讯 DNSPod
    val fallback: Map<String, String> = Constants.hostMap,  // 用户可改的 fallback IP 表
    val nonStrictSSL: Boolean = true,               // 关掉主机名校验（对应 ignoreSSL()）
    val dohTimeout: Int = 5,                         // 秒
) : BypassSetting
```

四档网络模式：`System`（用系统代理）/ `Direct`（直连）/ `Proxy(host, port, HTTP|SOCKS)` / `SNI`。**只有 Android 和桌面端提供 SNI 模式**（iOS 无）——`BypassSettingEditor.kt` 里 `import com.mrl.pixiv.common.util.isIOS` + `platform` 条件渲染。

### 1.3.3 关于「HarmonyOS 适配」

**【未核实】** —— 仓库全树（793 个文件）grep `harmony|ohos|鸿蒙` **零命中**，README 也未提。当前 PiPixiv 只有 Android / iOS / Windows / macOS / Linux 五端 target。`competitor-features-comparison.md` 里「HarmonyOS / SNI 直连」这一栏应修正为「SNI 直连（无 HarmonyOS target）」。

### 1.3.4 失败模式的直接证据

`RacingOriginDnsResolver` 的容错设计本身就是失效模式的目录：`invokeAny` 超时返回 `null` → `SniReplaceDns` 落到 `fallbackAddresses` → 空则 `throw UnknownHostException("No bypass addresses found for $hostname")`。**硬编码 IP 池是最后一道保险，也是最大的一颗定时炸弹**（Pixiv 换 IP 即全线失效，且用户无感知，只会觉得「直连坏了」）。

---

## 1.4 Pixiv-SwiftUI（`Eslzzyl/Pixiv-SwiftUI`）—— 从零手写 HTTP/3 + QPACK

这是四家里工程量最夸张的：**不用 Cronet、不用 rhttp、不用系统 URLSession 的 HTTP/3，而是用 Swift `Network` 框架手写完整 HTTP/3 客户端（含 QPACK 编解码）**。

**【源码】** `Pixiv-SwiftUI/Core/Network/PixivDirectConnection.swift`（1021 行）

| 事实 | 证据 |
|---|---|
| 手写 HTTP/3 客户端，错误枚举里就有 `qpackDecompressionFailed` / `qpackEncoderStreamError` / `qpackDecoderStreamError` / `frameUnexpected` / `settingsError` | `enum PixivDirectConnectionError`（32 个 case） |
| 用 `NWProtocolQUIC` + 自写 QPACK 编码器 | `import Network`；`PixivQPACKEncoder.encode(headerBlock)`（`:559`）；`NWProtocolQUIC.Metadata`（`:856`） |
| **GzipSwift 的真实角色**：自写栈不享受系统 HTTP 栈的自动 content-encoding 解压，所以响应体要自己解 | `import Gzip`（`:5`）；`decodeContentEncoding(in:)`；错误 `unsupportedContentEncoding` / `decompressedResponseTooLarge` |
| 硬编码 Cloudflare fallback IP `104.18.42.239` / `172.64.145.17` | `cloudflareFallbackAddresses`（**与 Shaft 完全相同的两个 IP**） |
| DNS 解析器是 actor，带 stale-while-revalidate 缓存 | `PixivDirectDNSResolver`：`maximumCachedLifetime = 300` / `staleGracePeriod = 300` / `failedLookupCooldown = 30` / `lookupTimeout = 3` / `maximumCachedHosts = 16` / `maximumAddressesPerHost = 4` |
| **有静态优选 IP 时首屏不等 DoH 往返** | 注释：「快速路径：若已有静态优选 IP，首屏无需等待 DoH 网络往返，直接瞬时返回建连」 |
| 端点健康度排序（把坏 IP 沉底） | `PixivDirectEndpointHealth.ordered(candidateAddresses)` |
| 响应硬上限 128 MB / 请求 32 MB | `maxResponseBytes = 128 * 1024 * 1024` |
| 只对「非图片 pixiv 域」+ 镜像域开直连 | `PixivNetworkConfiguration.supportsHTTP3DirectConnection(host)` = `(isPixivHost && !isPixivImageHost) || isHTTP3ImageRelayHost` |
| 图片源两档：`i.pximg.net`（官方）/ `i.pixiv.re`（**HTTP/3 第三方中转**） | `PixivImageDomain.swift`：`.http3Relay` 描述「直连模式通过 i.pixiv.re 使用 HTTP/3；图片请求经第三方中转」 |
| 网络模式三档：标准（依赖系统 VPN）/ HTTP/3 直连 / 自定义代理（HTTP CONNECT / SOCKS5） | `NetworkMode.swift`；切换时 `CacheManager.shared.clearAll()` + `reconfigureKingfisherDownloader` |
| 图片走 Kingfisher 自定义 `ImageDataProvider`，不走 URLSession | `DirectImageDataProvider.swift`：`ImageDataProvider` 实现，按 `ImageRequestPriority` 映射 Swift TaskPriority |

**注意一处事实纠正**：任务简报里说「手写 HTTP 绕开 SNI」。**准确说法是：手写 HTTP/3（QUIC/UDP）绕开 TCP+TLS 层**——它不碰 SNI 问题，而是换传输层，与 Shaft 的 Cronet 是同一思路的两种实现。它对图片域（`i.pximg.net`）反而**不做 No-SNI**（因为 `supportsHTTP3DirectConnection` 把图片域排除），而是让用户切到 `i.pixiv.re` 中转。

---

## 1.5 pixez-flutter（`Notsfsssf/pixez-flutter`）—— rhttp + ECH（唯一用 ECH 的）

**【源码】** `lib/network/pixez_network_settings.dart` + `lib/network/network_mode.dart` + `lib/er/hoster.dart`

| 事实 | 证据 |
|---|---|
| HTTP 客户端用 **`rhttp`（Rust 写，b3http 系）** + `dio_compatibility_layer` 适配回 dio | `import 'package:rhttp/rhttp.dart' as r`；`RhttpCompatibleClient.create(...)` + `ConversionLayerAdapter` |
| **三档模式：`ech` / `compat` / `standard`** | `enum NetworkMode { compat, ech, standard }` |
| **`ech` 档强制 ECH（Encrypted ClientHello）+ 静态 CF IP 覆盖** | `r.ClientSettings(enableEch: true, requireEch: true, tlsSettings: TlsSettings(verifyCertificates: true, rootCertSource: webpki, sni: true), dnsSettings: DnsSettings.static(overrides: {app-api/oauth/accounts → ['104.18.10.118','104.18.10.118']}))` |
| **`compat` 档 = 不校验证书 + 不发 SNI + 动态 DNS** | `TlsSettings(verifyCertificates: false, sni: false)` + `DnsSettings.dynamic(resolver: ...)` |
| 静态兜底 IP 表（4 个 host） | `Hoster._constMap`：`app-api`/`oauth` → `210.140.139.155`；`i.pximg`/`s.pximg` → `210.140.139.133`；`doh` → `doh.dns.sb` |
| DoH 走 Cloudflare `1dot1dot1dot1.cloudflare-dns.com`，且**该 DoH 客户端自己也关 SNI + 硬编码 IP `104.16.248.249/104.16.249.249`** | `Hoster.createDioClient()`（`sni: false` + `verifyCertificates: true` 的有趣组合） |
| DoH 解析结果按 TTL 排序取最高，并**持久化到本地 Prefer** | `dnsQuery()`：`answer.sort((l,r) => r.ttl.compareTo(l.ttl))`；`initMap()` 读 `Prefer.getString('h_hoster_$key')` |
| 启动时**主动 DoH 刷新图片 host** | `dnsQueryAll()` / `dnsQueryFetcher()` |
| **图片域只走 `compat`，不享受 ECH** | `forImages(host, mode)`：`if (host != imageHost) return null;` → 只返回 `compatible()` |
| 模式语义：`allowsImageSource` = 非 standard 才允许切图片源 | `bool get allowsImageSource => this != NetworkMode.standard;` |

**ECH 是四家里唯一一条「原理上不可被 GFW 降级」的路**（GFW 看不到明文 SNI 就无法做名单封锁），前提是**目标 CDN 真的部署了 ECH**。Shaft 的 `docs/direct-connect.md` 明确记录 Pixiv 侧**没有启用 ECH**（「Pixiv 的 Cloudflare 配置未启用 ECH」）——但那是 2026 上半年前后的判断，pixez-flutter 2026-09 仍在默认提供 `ech` 档，说明 **Cloudflare 侧后来启用了**。**【未核实】**：我未直接探测 `app-api.pixiv.net` 是否当前提供 ECH config（需要 HTTPS 记录查询 / ECH config endpoint，本次未做）。

---

## 1.6 Legado「直连模式」—— ❌ 无法核实，项目已下架

**【源码】** `gh api repos/gedoor/legado/git/trees/HEAD?recursive=1` 返回 `truncated: false`，`tree` 只有 2 项：`README.md` + `公告链接.png`。仓库元数据：`size = 52 KB`、`pushed_at = 2026-05-27T08:41:54Z`、`archived = false`。main 分支唯一 commit：**2026-05-27 08:30:57 UTC，标题「公告」**。

README 全文（去图片）：

> 「本项目涉及侵权行为的违法，也为此承担了相应的法律责任，在此郑重发布公告，**删除项目内容**并规劝所有人：……法律底线不可逾越，违法违规必将付出代价……」

引用了[阅文知识产权保护公告](https://mp.weixin.qq.com/s/bcTbqBQA1T0YoRwq76xcWQ)。

**结论：Legado 的「直连模式」本次无法挖到实现层——源码已从主干消失。** 社区 fork 存在（`lismc33/-legado-forks` 汇总了第三方 fork 仓库与包名对比，最后 push 2026-06-16），但 fork 的内容与法律状态未核实，**不建议作为参考基线**。`competitor-features-comparison.md` 中 Legado 一行应标注为「2026-05-27 已下架」。

---

## 1.7 P站助手（`pivlite.com`）—— ❌ 闭源，只有一方文案

**【官方站】** `https://pivlite.com/`（`web_fetch` 2026-09-27）+ 落地页 JS bundle `https://www.pivlite.com/assets/main-07574855.js`（1.5 MB，已下载并 grep）

- **无公开仓库**：`gh search repos "PixHelper" / "pivlite" / "P站助手"` 全部零命中。
- 运营主体：**杭州子非语网络科技有限公司**（页面 JSON-LD `author`）。
- 落地页自述能力（`features.sections`，逐字）：
  - 「国内直连 Pixiv —— 无需额外网络工具即可访问 Pixiv 插画、漫画与小说内容，支持登录 Pixiv 账号同步收藏与关注。」
  - 「图片代理加速 —— 可选**订阅**图片代理服务，通过 CDN 网络加速 Pixiv 图片加载，适合网络较慢或不稳定的场景。」
  - 授权码机制：「我们的一个授权码最多只能同时绑定两台设备」，找回邮箱 `notify@pixivlite.com`。
  - 另推独立产品「彩虹喵译」（AI 驱动的漫画翻译工具，支持多语言）。
- **⚠️ 官网对「直连」的技术机制零披露**：没有 DNS / SNI / IP / HTTP3 任何字样。落地页 bundle 里 `直连` 出现 9 次、`排队` 出现 **0 次**。

**因此本节所有实现层结论一律标记「无法核实」。** 唯一可确认的间接线索是「图片代理加速 = 可选订阅 CDN 代理」，说明它的**图片**路径可能与 API 路径用不同机制（API 直连 + 图片走自家 CDN 代理），与 Shaft 的 `ImageHostManager` + P站助手的「订阅代理」思路同构。

---

## 1.8 方案归类表（跨项目横向归纳）

| # | 方案类 | 机制 | 采用者 | 需要 SNI 改动？ | 需要服务端？ |
|---|---|---|---|---|---|
| **A** | **换传输层：QUIC / HTTP3 走 UDP** | Chromium 网络栈（Android：`cronet-embedded`）/ Swift Network（Apple）/ Rust rhttp（跨端） | Shaft（API 通道）、Pixiv-SwiftUI（全部 API）、pixez-flutter（`ech` 档间接依赖） | 否（QUIC 仍有 SNI，靠 GFW 名单未覆盖） | 否 |
| **B** | **SNI 替换** | TLS ClientHello 里 SNI 写一个 GFW 不拦、CDN 认识的名字（PiPixiv 写 `pixiv.me`） | PiPixiv（`app-api` / `oauth`） | 是（改成假名） | 否（需该假名也在同一 CDN 上） |
| **C** | **No-SNI TLS** | 传给 `SSLSocketFactory` 的 hostname 传 `null` / `serverNames = emptyList()` | Shaft（图片）、PiPixiv（`i.pximg` / `s.pximg`）、pixez-flutter（`compat` 档全部） | 是（彻底不发） | 否 |
| **D** | **ECH（加密 ClientHello）** | 客户端用 DNS HTTPS 记录取 ECH config，把 SNI 加密 | pixez-flutter（`ech` 档） | 是（加密掉） | 需 CDN 部署 ECH |
| **E** | **CNAME 源站解析** | DoH 不查真域名，查 `<host>.cdn.cloudflare.net` 这个 CNAME 目标（不在污染/黑名单里） | PiPixiv | — | 否 |
| **F** | **DoH 绕污染** | 独立 DoH 客户端（Cloudflare / DNSPod / dns.sb / AliDNS），可硬编码端点 IP | 全部四家 | — | 否（DoH 端点本身可能被封） |
| **G** | **硬编码 IP 兜底** | 记住 `210.140.139.x` / `104.18.x` 等，做最后一道保险 | 全部四家 | — | 否 |
| **H** | **镜像域名** | 把 `i.pximg.net` 换成 `i.pixiv.cat` / `.re` / `.nl` | Shaft（4 模式）、Pixiv-SwiftUI（`i.pixiv.re`） | — | **是**（需第三方镜像持续可用） |
| **I** | **API 反代（PxveAPI 风格）** | 改写为 `https://<proxy>/pixiv-app-api/...`，反向转发到官方 | Shaft（`AppApiProxyInterceptor`，用户自建） | — | **是** |
| **J** | **系统代理伪装** | 走系统 VPN / SOCKS5 / HTTP CONNECT | PiPixiv（`Proxy` 档）、Pixiv-SwiftUI（`customProxy`）、Pictelio 现状 | — | 否（但需外部工具） |

**Shaft 明确列出的「试过但不行」【仓库文档】**（这段本身就是最有价值的情报）：

| 方案 | 失败原因（Shaft 原话） |
|---|---|
| 纯 DoH + 自定义 DNS | 「DNS 可以绕过，但 TCP+TLS 握手包里只要还带 pixiv SNI 就会被 RST」 |
| 修改 TLS 指纹 / Cipher Suite | 「防火墙按 SNI 内容封锁，与 TLS 指纹无关」 |
| 域前置 / SNI 操纵（经典 domain fronting） | 「Cloudflare 边缘校验 SNI 与 HTTP Host 一致，经典 domain fronting 在 Cloudflare 上不可用」 |
| ECH | 「Pixiv 的 Cloudflare 配置未启用 ECH」（⚠️ 2026 上半年前判断，pixez-flutter 现状与之矛盾，见 §1.5） |
| 备用端口（8443 等） | 「TCP 层 SNI 检测是全端口的，换端口无效」 |
| 中继 / 代理服务器 | 「依赖第三方服务，可用性不可控」 |

---

## 1.9 失效模式表

| 失效模式 | 触发条件 | 症状 | 谁最脆弱 | 有无自愈 |
|---|---|---|---|---|
| **SNI 全端口 RST 回归** | GFW 把 API 域加进 TCP SNI 黑名单 | API 全挂，图片可能仍好（不同基础设施） | 所有 B/C/J 类用户 | 无。Shaft 的应对是**换 A 类**（QUIC） |
| **QUIC SNI 黑名单** | GFW 把 `pixiv.net` 加进 QUIC 名单 | API 全挂 | **Shaft（唯一 API 全押 QUIC 的）** | 无。Shaft 文档自认这是当前命门 |
| **源站 403 风控退化** | Pixiv / Cloudflare 规则变化 | **部分账户** 403 或握手异常，间歇性 | Shaft 记录 2026-04 已实际发生 | 无；用户归因为「app 坏了」 |
| **硬编码 IP 漂移** | Pixiv / Cloudflare 换 IP 或 anycast 段调整 | 解析到死 IP → `UnknownHostException` / 连接超时 | 全部四家（PiPixiv 4 IP、Shaft 2 IP、pixez 1 IP、SwiftUI 2 IP，池越小越脆） | 部分：Shaft 有 DoH 优先 + 硬编码仅兜底；pixez 有 DoH 刷新 + 本地持久化 |
| **DoH 端点被封** | `1.0.0.1` / `185.222.222.222` / `doh.pub` / `1dot1dot1dot1.cloudflare-dns.com` 不可达 | DNS 全挂 | 各家都有多端点回退，但**没有一家做端点竞速**（Shaft 是串行回退，延迟叠加） | 部分 |
| **CNAME 目标被改** | Cloudflare 调整 CNAME 链 | PiPixiv 的 `PIXIV_ORIGIN_ALIAS` 失效 | **PiPixiv（唯一依赖 CNAME 目标名）** | 无 |
| **SNI 替换被 CDN 拒绝** | Cloudflare 开启 SNI≠Host 强校验 | PiPixiv API 全挂（403/TLS 错误） | **PiPixiv（唯一做 SNI 替换）** | 无 |
| **镜像域名被墙 / 停服** | `pixiv.cat` 已被墙（源码注释自认）；`.re` / `.nl` 随时可能 | 图片加载失败或极慢 | Shaft / Pixiv-SwiftUI / P站助手 | 有：Shaft 5 模式切换；SwiftUI 2 档 |
| **无 SNI 撞上强制 SNI 的 CDN** | 目标从 Pixiv 自有设施迁到 Cloudflare | TLS 握手失败（`hostnameVerifier` 关掉也救不了，因为根本拿不到对端 cert） | 所有 C 类用户；Shaft 源码注释明写「pixiv.cat / Cloudflare 反代强校验」 | Shaft 有 `requiresStandardClient()` 探针自动禁用 bypass |
| **证书校验被绕过引入 MITM 风险** | 直连模式全局 `TrustAllCertManager` + `hostnameVerifier(true)` | 静默降级为不校验证书 | Shaft（图片通道）、pixez（`compat` 档）、PiPixiv（`nonStrictSSL=true` 默认！） | 无。**PiPixiv 默认 `nonStrictSSL = true` 值得注意** |
| **模型/资产下载被限速** | AI 模型托管在 GitHub Releases（Shaft 全部模型 zip 都在 `releases/download/v4.5.1/`） | 国内下载 GitHub 极慢 | Shaft AI 套件 | 无 |

---

## 1.10 对 Pictelio 栈的可行性评估

### 1.10.1 先确认 Pictelio 的三接入点（**已用 codegraph + 逐字读源码核实**）

| 接入点 | 实际实现 | 是否在 JS 层发外网请求 | 证据 |
|---|---|---|---|
| **① Pixiv API** | Native 分支**完全不发 JS fetch**：`nativeExecuteRequest()` 直接调 Capacitor 插件 `PixivApi.request({method, path, params, body})` | **否** | `packages/app/src/api/client.ts:337`（`nativeExecuteRequest`）、`:363` 起 `if (isNative) { … PixivApi.request(…) }`；Web 分支才走 Vite 代理（`packages/app/vite.config.ts:27-32` 读 `https_proxy` 回退 `http://127.0.0.1:7897`，**仅影响 web 预览**） |
| **② AI 翻译** | `CapacitorHttp.request()`（native）/ `fetch`（web），目标是 DeepSeek / OpenAI，**不是 Pixiv** | 是 | `packages/app/src/api/translate.ts:15` `import { Capacitor, CapacitorHttp }`、`:98` `CapacitorHttp.request` |
| **③ 图片** | WebView 请求 `/pixiv-img/…`（相对路径）→ `shouldInterceptRequest` → `ImageIntercept.interceptImage()` → `PixivImageLoader.rewriteUrl()` 拼出真实 `i.pximg.net` URL → **Java OkHttp 下载** → `WebResourceResponse(bytes)` | **否**（浏览器只拿到 bytes） | `packages/app/android/app/src/webview/java/io/pictelio/app/ImageIntercept.java:60`（`if (url == null \|\| !url.contains("/pixiv-img/")) return null;`）、`:73` `PixivImageLoader.rewriteUrl(url)`、`:103/110` `loader.loadBytes(pixivUrl)` / `loader.download(pixivUrl)`；`PixivImageLoader.java:33` 注释「`/pixiv-img/{path}` → `OAuthConfig.IMAGE_CDN_URL + "/" + path`」 |

**两个关键的有利发现**：

1. **所有 Pixiv 流量已经天然汇聚到 Java 侧的两个 OkHttpClient**：
   - API：`packages/app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java:59`（`new OkHttpClient.Builder()`，插件 `PixivApiPlugin.java:32` 委托给它）
   - OAuth：`packages/app/android/app/src/webview/java/io/pictelio/app/OAuthPlugin.java:65`（独立 client）
   - 图片：`PixivImageLoader.java:73`（`private final OkHttpClient client`，构造注入）
   - 另有 `NetDiagProbe.java:265`（网络自检用）
2. **图片镜像回退机制已经存在**：`PixivImageLoader.java:67-68` 已有 `MIRROR_CONNECT_TIMEOUT_SECONDS = 5` / `MIRROR_CALL_TIMEOUT_SECONDS = 15`，`:154-165` 与 `:256-267` 两处 `mirrorClient` + `catch → Log.w("镜像下载失败，回退官方")`。**H 类（镜像域名）方案在 Pictelio 上是增量扩展，不是从零建。**

### 1.10.2 逐类方案 × 三个接入点的可行性

| 方案类 | ① API（`PixivApiCore` OkHttp） | ③ 图片（`PixivImageLoader` OkHttp） | ② AI 翻译（CapacitorHttp） | 综合判断 |
|---|---|---|---|---|
| **F/G DoH + 硬编码 IP** | ✅ **最易**：OkHttp `Dns` 接口可直接换（`.dns(new HttpDns())`） | ✅ 同上 | N/A | **✅ 立刻可做，几十行**。但 2026-04 已证明单靠它不够 |
| **C No-SNI TLS** | ⚠️ 可做但**不该做**：API 侧需要 SNI 才能选对 Cloudflare 站点 | ✅ **主战场**：`SSLSocketFactory` 传 `null` hostname（照抄 `RubySSLSocketFactory`） | N/A | **⚠️ 仅对图片有意义**；照搬 Shaft 的 `TrustAllCertManager` 会引入 MITM 风险，须与 `ImageHostManager.requiresStandardClient()` 同款探针 gate |
| **B SNI 替换（`pixiv.me`）** | ⚠️ 技术可行（OkHttp 自定义 `SSLSocketFactory` 改 `serverNames`），但**依赖 Cloudflare 不校验 SNI≠Host** | ❌ 不需要 | N/A | **⚠️ 高风险赌注**：PiPixiv 的存活性完全押在 Cloudflare 当前宽容度上，无任何冗余 |
| **A QUIC / HTTP3** | ⚠️ **需要引入 `org.chromium.net:cronet-embedded`**（+ 几 MB APK）；需在 `PixivApiCore` 挂 OkHttp `Interceptor` 桥接；**有 10 MB 响应缓冲上限**要设计绕过 | ❌ `i.pximg.net` 不支持 QUIC | N/A | **🟡 可行但重**。Shaft 花了 2 个文件 + 一次架构迁移；且响应全缓冲对「分页列表 API」是可接受的（Shaft 用了 2 年），但会让大 JSON 全部走内存 |
| **D ECH** | ❌ **Capacitor 架构下不可控**：OkHttp / Cronet 均**不暴露 ECH 接口**；Java 层唯一可行路径是自己实现 ECH 客户端（需 `ssl_client_hello` 内层构造 + 密文长度扩展），工程量以人月计 | ❌ 同 | N/A | **❌ 不建议**。 pixez-flutter 能做是因为 rhttp 底层是 Rust/boring |
| **E CNAME 源站解析** | ✅ **容易且优雅**（PiPixiv 的 `PIXIV_ORIGIN_ALIASES` 只有 4 行映射），DoH 查 `app-api.pixiv.net.cdn.cloudflare.net` | ✅ 同理（`i.pximg.net.cdn.cloudflare.net`） | N/A | **✅ 强烈建议采纳**。这是本次调研性价比最高的一招：绕开的是「污染/黑名单针对真域名」而不是「绕过封锁本身」，与 GFW 检测维度正交 |
| **H 镜像域名** | ❌ 无意义（API 无镜像） | ✅ **已有回退骨架**，扩一个模式列表即可 | N/A | **✅ 建议采纳**（但要接受「.cat 已被墙」这个事实，`.re` 才是当前可用的） |
| **I API 反代** | ✅ 就是加一个 OkHttp `Interceptor` 改写 URL（Shaft `AppApiProxyInterceptor` 78 行） | N/A | N/A | **✅ 建议作为兜底开关**（用户自建），不做内置服务 |
| **J 系统代理** | ✅ 已可用（Capacitor 默认走系统代理） | ✅ 已可用 | ✅ 已可用 | **现状**，不需要动 |

### 1.10.3 结构性困难（Capacitor 架构下的真·硬约束）

| # | 困难 | 说明 | 能否绕过 |
|---|---|---|---|
| **1** | **WebView 自身网络栈不可控** | 若有任何资源绕过 `/pixiv-img/` 直接以 `https://i.pximg.net/...` 出现在 DOM 里，WebView 会用 Chromium 自带栈发请求。Android **没有公开 API** 能改 WebView 的 DNS / SNI / 代理（`WebSettings.setProxy()` 在 API 24+ 被移除且行为未定义） | ✅ **Pictelio 当前架构已天然规避**：所有图片 URL 都经 `rewriteUrl` 变相对路径、由 `shouldInterceptRequest` 返回 bytes。**风险是回归**——任何新加的直连 `i.pximg.net` URL（`<img src>`、CSS background、`@font-face`、iframe）都会绕开 Java 层。这需要一条 lint 级硬约束：**`src/` 内禁止出现 `i.pximg.net` / `pximg.net` 字面量** |
| **2** | **JS `fetch` 无法自定义 DNS** | 接入点 ②（`CapacitorHttp`）是 Capacitor 封装的 `HttpURLConnection`/OkHttp，**不暴露 `Dns` / `SSLSocketFactory` 注入点**。若将来 AI 翻译要 BYOK 直连某个被特殊处理的端点，CapacitorHttp 做不到 | 🟡 部分绕过：像 `PixivApiPlugin` 那样写一个自定义 Plugin 接管（`PixivApiCore` 已是这个模式） |
| **3** | **App-lynx 引擎是 LynxView，不是 WebView** | `shouldInterceptRequest` 钩子**不存在**。app-lynx 走的是原生 `PictelioImageService`（与 `PixivImageLoader` 同源，见 `ImageIntercept.java:71-72` 注释） | ✅ 已在架构内，但**任何直连方案必须同时覆盖 Lynx 侧的图片服务**，否则双引擎表现分叉 |
| **4** | **Cronet 会与 Capacitor 的 WebView 抢网络栈** | 引入 `cronet-embedded` 意味着 App 里有两套 Chromium 网络栈（WebView 内置 + Cronet），内存 +几 MB，且两者的 DNS/连接池互不共享 | 🟡 理论可行（Shaft 不是 WebView 应用，未暴露过这个交互），**但 Pictelio 是——这是 Shaft 经验完全无法覆盖的新风险面，必须实测** |
| **5** | **Vite 代理路径与 Native 路径行为分叉** | 代理只作用于 web 预览；`pnpm dev` 下「直连成功」不代表 APK 里成功 | ✅ 需一条明确验收口径：**所有直连结论必须在真机 APK 上验证**（项目已有 `docs/research/network-selfcheck-java-capability-audit.md` 可复用） |

---

# 方向二：AI 增值能力 —— 竞品怎么做的，我们值不值得跟

## 2.1 Pixiv-Shaft 的 AI 套件（本次调研中技术细节最完整的一家）

### 2.1.1 四项能力 = 四个**纯本机**推理链（NCNN + ONNX Runtime）

**【源码】** APK 内预置 NCNN 原生库（`app/libs/arm64-v8a/`）：

| 库文件 | 用途 |
|---|---|
| `librealcugan_ncnn.so` | Real-CUGAN Pro 超分 |
| `librealsr_ncnn.so` | Real-ESRGAN 超分 |
| `librembg_ncnn.so` | 抠图 |
| `librife_ncnn.so` | ugoira RIFE 补帧 |
| `libncnn.so` | NCNN 运行时 |
| `app/src/main/assets/models/u2netp/{u2netp.bin,u2netp.param}` | **唯一内置的模型权重**（4 MB） |

其余模型**全部走 GitHub Releases 资产下载**（`DownloadableModel.downloadUrl` 全部指向 `https://github.com/CeuiLiSA/Pixiv-Shaft/releases/download/v4.5.1/...`）：

| 能力 | 模型 | 格式 / 体积 | 源码 |
|---|---|---|---|
| **超分** | Real-ESRGAN v3 anime | NCNN bin/param，`-s 2`（注释：`-s` 默认 4 会去找不存在的 x4 模型导致**红黄条纹乱图**，issue #861） | `upscale/UpscaleModel.kt` |
| **超分** | Real-CUGAN Pro（B站开源） | `up2x-conservative.*`，`-n -1 -s 2` | 同上 |
| **抠图** | U2Net-P（4 MB，**内置 APK**） | NCNN，`-p u2netp` | `upscale/RembgModel.kt`（`bundledInApk = true`） |
| **抠图** | ISNet-Anime（84 MB，Danbooru 训练） | NCNN，`-p isnet-anime` | 同上（`bundledInApk = false`） |
| **漫画翻译 OCR** | Manga-OCR-base（**ViT+GPT2**，int8 ONNX） | `encoder_model_quantized.onnx` + `decoder_model_quantized.onnx` + `config.json` + `vocab.json`，91 MB | `translate/MangaOcrModel.kt` |
| **漫画翻译 检测** | Comic-Text-Detector（dmMaze，`comictextdetector.pt.onnx`） | 57 MB | `translate/ComicTextDetectorModel.kt` |
| **漫画翻译 兜底 MT** | Opus-MT ja→zh（Helsinki-NLP，int8 ONNX，离线推理） | 87 MB | `translate/TranslationModel.kt` |
| **ugoira 补帧** | RIFE v4.6（nihui/rife-ncnn-vulkan） | `flownet.param/bin`，11 MB | `interpolate/RifeModel.kt` |

**【源码】** ONNX Runtime 依赖声明：`app/build.gradle` → `implementation libs.onnxRuntime`（仅此一条 AI 依赖，Manga-OCR / CTD / Opus-MT 三个模型共用）。

**执行方式【源码】**：`RealESRGANUpscaler.kt`（`object NcnnUpscaler`）用 `ProcessBuilder` 跑 `$nativeLibraryDir/librealcugan_ncnn.so`，正则解析 stdout 的 `(\d+\.?\d*)%\s*\[\s*[\d.]+s\s*/\s*([\d.]+)\s*ETA` 和 `TILE (\d+)` 拿进度。**即：不是 JNI 绑定，是 fork 出 .so 当可执行文件跑。**

**缓存【源码】**：结果按 `md5(输入文件) + 模型名 + 参数签名` 缓存到 `filesDir/upscale-cache`。注释明确记录了踩坑：「cache key 必须含影响输出的参数(scale 等)，否则改了参数后旧的(损坏)结果会被继续命中(#861)」。

### 2.1.2 漫画翻译流水线（交互形态的确切答案）

**【源码】** `translate/MangaPageTranslatePipeline.kt`（单页与「翻译整部」共用的无状态 object）

流水线 5 步：
1. **模型按需加载**（OCR + CTD + 翻译引擎）
2. **OCR**：`MangaOcr.recognize()` → `OcrTextRegion` 列表。**坐标系契约：统一在「原图」分辨率**——CTD/Manga-Ocr 内部为防 OOM 先降采样，返回前把 region 坐标乘回 sample 倍。region 字段含 `cx/cy/width/height/angle/orientation(0=横 1=竖)/prob/corners/recogConfidence`
3. **batch 翻译**：整页 OCR 文本装进**一个 JSON 数组**发给模型，要求原样回等长 JSON 数组（选数组而非 `\n` 拼接，因为「OCR 文本自身可能含换行，行数协议会错位」）
4. **擦字回填**：`TextEraser` + 气泡扩展 + `TextRenderer` 排版；像素常量在「短边 ≤ 2400」上调（`LAYOUT_REFERENCE_SHORT_SIDE`），回填在原分辨率做，超出用 `RenderBase.pxScale` 等比放大；回填位图最多占可用内存 50%（`RENDER_MEMORY_FRACTION`）
5. **落盘 PNG**

**「圈选翻译」的确切形态【源码】** `translate/SelectionBoxView.kt`：
- 全屏透明 View，**橡皮筋框选**画一个矩形，松手把 **View 坐标系**的 `RectF` 通过 `onSelected` 回吐给宿主（`FragmentImageDetail` 换算到内容坐标）
- 只在 overlay 可见时挂在图片上，接走触摸；overlay GONE 时不拦截任何事件
- `DOWN` 即 `requestDisallowInterceptTouchEvent`，防横向拖拽被 ViewPager 当翻页吞掉
- 拖动距离两方向都小于 `minDragPx`（≈ 一次误触）→ 视作取消

**所以「圈选翻译」= 自动检测 + 圈选补翻两个入口共存**：自动模式走 CTD 全图检测气泡；圈选模式让用户手动指定矩形补翻。**不是**「框选 → OCR → 翻译 → 重绘」的纯手工链路（OCR 和重绘两端都是复用的）。

### 2.1.3 自定义 AI 翻译端点（`AiTranslator.kt`，OpenAI 兼容）

**【源码】** `translate/AiTranslator.kt` KDoc 逐条写明：

| 事实 | 证据 |
|---|---|
| base URL 可指向任何 OpenAI 兼容端点，包括 **Ollama / llama.cpp server（Sakura 模型）等本地部署**，API key 可空 | KDoc「base URL 可以指向任何兼容端点 — OpenAI / DeepSeek 等云服务，也可以是 Ollama、llama.cpp server(Sakura 模型)这类本地部署；API key 对本地服务可空」 |
| 流式用 **okhttp-sse**（`EventSource` / `EventSourceListener`），thinking 阶段经 `AiTranslatePhase.Thinking/Generating` 回调 UI | import `okhttp3.sse.*`；`sealed interface AiTranslatePhase` |
| 流式失败**自动降级非流式** | KDoc「失败自动降级非流式」 |
| **思考参数按厂商分支** | KDoc：「DeepSeek 用 `thinking.type=disabled`；SiliconFlow/千问用 `enable_thinking=false`；OpenAI 系推理模型用 `reasoning_effort=low`」 |
| readTimeout 可配，默认 120 s，范围 30–600 s | `MIN_READ_TIMEOUT_SECONDS = 30` / `MAX_READ_TIMEOUT_SECONDS = 600` |
| **batch 压并发上限 4**（自建 Semaphore，因为「OkHttp 的 dispatcher 限流只管 enqueue 的异步调用，同步 execute() 不设限」） | `REQUEST_CONCURRENCY = 4`；`Semaphore` + `withPermit` |
| 单 batch 上限 3000 字符 | `MAX_BATCH_CHARS = 3000` |
| 瞬时故障（IO / 429 / 5xx）**自动重试一次 + 1 s 退避**；4xx 配置类错误**不重试**，抽 `error.message` 给用户人话提示 | `RETRY_DELAY_MS = 1_000L`；KDoc |
| `onRequestSent` 回调用于「退出二次确认」——POST 出去后 Token 已开烧 | 接口注释 |
| 另有免费兜底：Google web 端点翻译（`GoogleWebTranslator.kt`），逐条并发 + per-item fallback | 文件存在 + `MangaPageTranslatePipeline` 注释「Google 多半是代理半通不通，per-item fallback 全失败」 |

**⚠️ 但 2026-09 起 Shaft 加了云端翻译**（**【仓库文档】** `v4.9.3` release，2026-09-07）：
> 「接入云端 OpenAI (**gpt-5.6-luna**) 翻译，支持评论、标题、标签和漫画翻译（灰度接入，小说暂不支持）」
> 「云翻译服务关闭时自动切换 Google 翻译，设置与用量页显示**翻译模型和额度比例**」
> 标题：「免费用户将恢复原有用量，体验版的 2 倍额度将结束。Pro 与 Max 用户用量不变」

**即：Shaft = 本机 AI（免费无限制）+ 云端 LLM（有独立用量比例，灰度）双轨。** README「订阅」表格说 AI 四项三档全 ✅，指的是**本机 AI**；云端翻译另计。

### 2.1.4 ugoira RIFE 补帧 + MP4 导出（两处硬核工程）

**【源码】** `interpolate/RifeInterpolator.kt` KDoc：

- **一次 pass 直出 m 倍，不做递归 2×**：「RIFE v4 是 timestep-conditioned 的，t=0.25 直接从原始相邻帧算，比『先合成中点、再拿合成帧当输入插一次』画质好(后者伪影会叠加)，而且只启动一次进程(省一次 Vulkan 初始化)、不落中间帧(峰值磁盘减半)」
- **无限循环缝处理**：把首帧复制一份追加到输入序列末尾（M = N+1 帧），用 `-n m*(N+1)` 让均匀 timestep 正好落在 1/m 整数倍上，取前 m×N 帧
- **timestep 公式经真机实测钉死为 `fi = i * M / T`**（M=输入帧数，T=`-n` 值），并给出验证探针：2 帧输入跑 `-n 4` 得 `[A, mid, B, B]`，跑 `-n 8` 得 `[A, ¼, ½, ¾, B, B, B, B]`，两次的 ½ 帧 md5 相同；「若公式是 `i*(M-1)/(T-1)` 则 `-n 4` 应输出四帧互不相同」；KDoc 明确写「这是整套循环缝推导唯一的承重假设，改倍率/帧数前先重跑这个探针」
- **自适应上限**：`MIN_DELAY_MS = 40`（原始帧延迟低于 40 ms 就不补，减半后逼近 GIF 10 ms 粒度下限）；补帧后单帧延迟下限 20 ms（注释：「Glide 把 <20ms 的帧按 100ms 处理 —— 20ms(50fps) 就是 GIF 容器的物理上限，『60 帧』到此为止」）
- **失败即放弃**：模型没下 / 进程非 0 / 输出帧数不符 → 返回 `null`，调用方回落到原始帧序列，「播放永远不会因为补帧挂掉」；取消时立刻销毁子进程

**【源码】** `bulk/UgoiraVideoEncoder.kt`（H.264 MP4 导出）：
- `MediaCodec` 硬件编码 + `MediaMuxer` 封装，**零第三方依赖、不引 FFmpeg，APK 增量为 0**
- **为什么需要它**（KDoc 原话）：「`FrameSequencePlayer` 是纯 CPU 逐帧解 JPEG，50fps(4x 补帧)下解码预算只有 20ms，机器一降频就跟不上，只能按时间轴丢帧保时长 —— 动作是对的，但看起来一顿一顿。换成 mp4 后解码走硬件解码器…**每一帧都会送显，不再有丢帧策略**」
- 输入走 GPU Surface（`createInputSurface()` + EGL），因为「编码器的 input surface **不支持 `lockCanvas`**，所以必须走 GL」，且「RGB→YUV 转换由硬件做，比在 Java 里逐像素转快一个数量级」
- **变帧长精确时序**：每个 sample 自带 PTS，直接把 `delays.txt` 的累积毫秒喂给 `eglPresentationTimeANDROID`，「不做任何重采样(重采样 = 丢帧或补重复帧，正是要避免的)」
- **偶数尺寸**：H.264 要求宽高偶数，ugoira 尺寸任意 → **裁掉**最多 1 像素（纹理坐标裁边、1:1 映射 + NEAREST），**不缩放**
- 设备级失败（编解码器创建/配置）置 `deviceUnsupported`，整个会话不再重试
- Release 时间：**v4.8.6（2026-08-17）**「动图改存 H.264 mp4，体积只有 GIF 的十几分之一，补帧后一帧不丢」

### 2.1.5 Shaft 的商业化真相（修正 §0.4 #2）

**【仓库文档】** README「💎 订阅」表格（2026-09-27 抓取）：

| | Free | Pro | Max |
|---|---|---|---|
| Popularity-sort quota | 1× | 5× | 20× |
| All illustration / manga / novel / ranking features | ✅ | ✅ | ✅ |
| **AI upscaling, cut-out, translation, interpolation** | **✅** | ✅ | ✅ |
| Sort any keyword by popularity | basic quota → 降级为 popularity preview | ✅ | ✅ |

**结论：Shaft 的 AI 套件不是订阅变现点。** 唯一订阅项是「按热度排序」——理由是「它要占用公共搜索资源」（即用自己搭的 PxveAPI 代理跑 Pixiv 搜索接口，会被 Pixiv 限流）。这对 Pictelio 有一个直接启示：**Shaft 证明了「AI 能力免费 + 代理搜索能力收费」这条商业路径是可行的**。

---

## 2.2 P站助手（`pivlite.com`）—— ❌ 闭源，只有功能自述

**【官方站】** 落地页 JS bundle `features.sections` 逐字（2026-09-27 抓取）：

| 自述能力 | 原文 |
|---|---|
| **AI 翻译服务端化** | 「翻译能力由**服务端 AI 提供（DeepSeek 等大模型）**；部分功能**按字数或次数计费，会员用户享折扣**」 |
| 漫画翻译 | 「智能识别漫画图中的文字区域，在原位替换为译文」 |
| 小说翻译 | 「支持 Pixiv 小说与杂谈的 AI 翻译，**保留原文排版**；**流式输出翻译进度**，长篇阅读更流畅，不满意可重新翻译」 |
| **高清化双通道** | 「**本机高清化**：利用设备算力在本地即时处理图片；大图会自动缩放以保障稳定性，适合快速预览」/「**云端高清化**：将图片提交至**服务器队列**处理，适合高分辨率大图；完成后下载到本机，可与原图对比查看」 |
| 批量高清 | 「支持多张图片批量提交高清任务；本机处理结果可自动保存到相册指定目录」 |
| 免责声明 | 「部分 AI 翻译、云端高清化、**图片代理加速**等功能可能需要登录账号或开通会员/充值后使用」 |
| 图片代理 | 「可选**订阅**图片代理服务，通过 CDN 网络加速 Pixiv 图片加载」 |

**可确认的**：「服务端 DeepSeek 等大模型」（文案明确点名 DeepSeek）、「按字数或次数计费」、「云端队列」、「本机算力」。

**无法确认的**：具体模型版本、排队策略实现、并发上限、失败重试、漫画 OCR 用什么模型（本地还是云）、「本机高清化」用什么推理引擎（**大概率是 ncnn/Real-ESRGAN/Real-CUGAN 一类，因为只有这些能塞进手机 APK**，但**这是推断不是证据**）、云端高清化用什么模型和 GPU。

---

## 2.3 PiPixiv 的 AI 翻译套件（竞品中最完整，挖到最细）

### 2.3.1 多 provider 适配

**【源码】** `common/ai/src/commonMain/kotlin/com/mrl/pixiv/common/ai/provider/`

| 文件 | 角色 |
|---|---|
| `AiTextProviderClient.kt` | 接口：`generateText(request): AiTextResponse` + `generateTextStream(request): Flow<AiTextStreamEvent>`（`Delta(text)` / `Completed(text)`） |
| `OpenAiTextClient.kt` | OpenAI 兼容（354 行） |
| `ClaudeTextClient.kt` | Anthropic |
| `GeminiTextClient.kt` | Google |

**Chat Completions vs Responses 双协议【源码】** `OpenAiTextClient.kt`：
- `base.endsWith("/responses")` → `OpenAiApiType.RESPONSES`，否则 `CHAT_COMPLETIONS`
- 保留字段按协议分：`CHAT_COMPLETIONS -> setOf("model","messages","stream")`；`RESPONSES -> setOf("model","input","stream")`
- 最后 `return JsonObject(merged + ("stream" to JsonPrimitive(true)))`
- 配置项 `responseApi: Boolean = false`（`AiTranslationConfig`）

**`extra_body` 自定义【源码】** `common/ai/.../internal/ExtraBody.kt`：
- 解析用户填的 JSON；**若顶层有 `extra_body` 子对象则拍平**（兼容「从 OpenAI SDK 复制粘贴」的用法），否则整个对象当作 extra
- 与基础 body **递归深合并**（两个都是 `JsonObject` 时逐层合并）
- `reservedKeys` 保护关键键不被覆盖
- 非法 JSON → `IllegalStateException("$providerName extra_body must be a valid JSON object.")`

### 2.3.2 「流式首片实时 + 后续并发按原文顺序合并」的调度（本次调研最想要的一段）

**【源码】** `common/repository/src/commonMain/kotlin/com/mrl/pixiv/common/repository/NovelAiTranslationService.kt` `translateStreaming()`

```kotlin
coroutineScope {
    val requests = chunks.mapIndexed { index, chunk -> buildRequest(... chunkIndex = index + 1, totalChunks = chunks.size, ...) }
    val remainingTranslations = requests.drop(1).map { request ->
        async(start = CoroutineStart.LAZY) {          // ← 全部 LAZY，不立刻发
            generateCompleteText(client, request, maxConcurrentRequests)
        }
    }
    combineTranslatedChunks(
        firstChunk = generateTextStream(
            client, requests.first(), maxConcurrentRequests,
            onPermitAcquired = { remainingTranslations.forEach { it.start() } },  // ← 拿到令牌才唤醒其余分片
        ),
        remainingChunks = remainingTranslations,
        totalChunks = chunks.size,
    ).collect { emit(it) }
}
```

**设计要点**：
1. **第 1 个分片走流式**（用户立刻看到第一个字），**其余分片走非流式**
2. **其余分片全部 `CoroutineStart.LAZY`**，直到第 1 片拿到 `NovelTranslationLimiter` 的并发令牌才 `.start()` —— 这样**并发上限由令牌闸门保证，而不是靠"发出去再说"**
3. `combineTranslatedChunks(..., remainingChunks = Deferred 列表, ...)` 按**原文顺序**合并输出，不按完成顺序
4. 每个 prompt 显式带 `第 ${chunkIndex}/${totalChunks} 段内容` + `当前分片策略：每批最多 $maxParagraphCount 个段落`
5. 提示词约束里有一条专为 Pixiv 小说格式设计的：「必须保留原文中的特殊标记、URL、数字和符号格式（例如 `[newpage]`、`[chapter]`、#、@、链接）」

**分片策略**：`splitChunks()` 先按 `\n` 切段；`text.length <= MAX_CHARS_PER_CHUNK` 则单片；否则按段落数打包成 `ChunkPlan(chunks, maxParagraphCount)`。

**并发与超时【源码】** `AiTranslationConfig`：

```kotlin
const val GENERATION_TIMEOUT_MIN_SECONDS = 30
const val GENERATION_TIMEOUT_DEFAULT_SECONDS = 180
const val GENERATION_TIMEOUT_MAX_SECONDS = 1800
const val MAX_CONCURRENT_REQUESTS_MIN = 1
const val MAX_CONCURRENT_REQUESTS_DEFAULT = 2
```

**注意：这里的方向与 Shaft 相反** —— PiPixiv 默认并发 **2**（保守），Shaft 默认 **4**（`REQUEST_CONCURRENCY`）。PiPixiv 允许把超时拉到 **1800 s**（30 分钟），Shaft 上限 600 s。

### 2.3.3 Read Later + 预翻译队列 + 缓存 + 失败重试 + 断点恢复

**【源码】** `common/repository/src/commonMain/kotlin/com/mrl/pixiv/common/repository/NovelReadLaterRepository.kt`（734 行）

| 机制 | 实现 |
|---|---|
| **自动重试上限 3 次** | `NovelReadLaterQueuePolicy.MAX_AUTOMATIC_RETRIES = 3` |
| **指数退避** | `retryDelayMillis(retryCount) = 1000L * (1L shl (retryCount - 1).coerceAtMost(2))` → 1 s / 2 s / 4 s |
| **只重试瞬时错误** | `isRetryable(isTransient, retryCount)`：`isTransient && retryCount < MAX` |
| **任务认领用 UUID attemptToken 做 CAS** | `attemptToken: String`；`Uuid.random().toHexString()`；回写前 `if (activeTask?.attemptToken == attemptToken)` 校验（防旧任务覆盖新任务） |
| **缓存指纹双因子** | `cacheConfigFingerprint`（配置变了就失效）+ `cacheSourceMd5`（原文变了就失效） |
| 缓存命中判定 | `isExact = cached != null && cacheConfigFingerprint == currentConfigFingerprint && cacheSourceMd5 == currentSourceMd5 && cached.provider == normalizedConfig.provider && cached.model == normalizedConfig.model && cached.translatedText.isNotBlank()` |
| 配置不完整直接短路 | 「AI translation configuration is incomplete.」 |
| 手动重试入口 | `suspend fun retry(...)` → `dao.retry(...)` |
| 数据层 | `NovelReadLaterDao` / `NovelReadLaterEntity` / `NovelReadLaterSource`；翻译结果落 `NovelTranslationDao` / `NovelTranslationEntity` |
| 配套单测 | `commonTest/.../NovelReadLaterQueuePolicyTest.kt`、`NovelTranslationStreamingTest.kt`、`NovelTranslationLimiterTest.kt` |

**【README】** 用户可见面：「📚 稍后阅读翻译队列，支持查看任务状态、重试失败任务和重新生成译文」「💾 自动保存和恢复阅读进度，支持 Pixiv 小说书签及 TXT 导出」「🤖 小说 AI 翻译：支持 OpenAI / Claude / Gemini 和兼容接口，**可配置局域网服务**、模型、超时及请求参数；**支持获取可用模型列表**、限制全局并发，以及正文、标题和简介翻译」

**局域网服务**有专门的 gate【源码】`common/ai/.../AiLocalNetworkAccessGate.kt` + 对应单测 + `LocalNetworkPermissionEffect.{android,ios,jvm}.kt` —— 即**用户自托管的 Ollama / llama.cpp** 等局域网端点被显式支持（需申请局域网权限）。

**模型列表拉取**【源码】`AiModelCatalogService.kt` + `AiEndpointPolicy.kt`（含端点策略判定）+ `AiHttpStatusException.kt`。

**内置模型目录快照日期【源码】** `AiTranslationConfig.kt` 注释：「Built-in text models, verified against the provider catalogs on **2026-09-24**」—— 列出 `gpt-6-astra/sol/luna`、`claude-fable-5-1/opus-5-5/sonnet-5/haiku-4-5`、`gemini-3.8-flash/3.1-pro-preview/3.5-flash-lite`。

---

## 2.4 Pixiv-SwiftUI（`Eslzzyl/Pixiv-SwiftUI`）—— 多服务 + 双语对照 + LLM 小说上下文优化

**【README】** 自述：「沉浸式翻译：可配置的翻译服务，支持双语对照」「支持翻译插画标题、简介，小说标题、简介，用户简介和所有评论」「多翻译服务支持：可配置主要/备用翻译服务」「智能语言检测」「双语对照阅读模式」「针对LLM在小说场景下的特别优化：提交多段结合上下文翻译」

**【源码】** `Core/Translation/Services/` —— **9 个翻译服务实现**：

| 服务 | 文件 | 类型 |
|---|---|---|
| Google web（免费） | `GoogleTranslateService.swift` + `Crypto/RLSigner.swift` + `Crypto/GoogleSignature.swift` | 打 `translate_a/single` 端点，**自带 RL 签名器**（`BaseTranslateService.buildTranslateURL` 里 25 个 `dt=` 参数） |
| Google API | `GoogleAPIService.swift` | 付费 key |
| OpenAI / LLM | `OpenAITranslateService.swift` | `LLMChatClient(baseURL:apiKey:)`，`model` 默认 `gpt-5.1-nano`，`temperature` 默认 `0.3` |
| Bing | `BingTranslateService.swift` | |
| 百度 | `BaiduTranslateService.swift` | |
| 腾讯 | `TencentTranslateService.swift` | |
| 有道智云 | `YoudaoZhiyunService.swift` | |
| DeepL | `DeepLTranslateService.swift` | |
| 抽象基类 | `BaseTranslateService.swift` | |

**双语对照排版怎么做【源码】** `Shared/Components/Text/TranslatableParagraph.swift`：

```swift
VStack(alignment: .leading, spacing: 4) {
    Text(parsedText)                       // 原文，.font(font)
    if showTranslation, let translated = translatedText {
        Text(translatedParsed)             // 译文
            .font(.caption)                 // ← 译文用更小字号
            .foregroundColor(.secondary)    // ← 次要色
            .transition(.opacity)           // ← 淡入
    }
    if isTranslating { ProgressView() }
}
```

**结论：双语对照 = 同一段落容器内 `VStack` 上下堆叠，译文降级为 `.caption` + `.secondary` + 淡入过渡。** 简单但有效；没有做「左右分栏」或「段间交替」这类复杂排版。长按 `contextMenu` 触发翻译，`TranslationCacheStore` 缓存。

**LLM 小说多段上下文【源码】** `Core/Services/NovelBatchTranslator.swift`（actor）：

```swift
struct NovelBatchRequest: Codable {
    let targetLanguage: String
    let context: [NovelBatchContextItem]     // ← 参考上下文，显式声明「不翻译」
    let items: [NovelBatchInput]             // ← 待译段落，带 id
}
struct NovelBatchResponseItem: Codable { let id: Int; let translation: String }
```

系统提示词逐字：
> `Translate all items[*].text into {targetLang}.`
> `The context field is reference-only and must not be translated.`
> `Output must be strict JSON only, with this exact shape: {"items":[{"id":123,"translation":"..."}]}`
> `Return every input item exactly once with the same id.`

**这是「让 LLM 保持人名/称谓一致性」的标准做法**：把前后段落作为**只读 context** 一起送，让模型在有上下文的情况下译当前段，再用 id 回填保证顺序。默认 system prompt 也专门针对 Pixiv 日文小说：`"You are a professional literary translator for Pixiv Japanese novels. Ensure the translation is fluent and natural, maintaining the original meaning and style."`

**⚠️ 事实纠正**：任务简报里说「多服务主备」。源码里 `Translate.swift` grep `fallback|backup|primary|备用|主` **零命中**。README 声称「可配置主要/备用翻译服务」，但**主备切换逻辑本次未在源码中找到**。可能的实现是「用户自己选一个服务」而非自动 fallback。**标记「未核实」。**

---

## 2.5 四维打分表

评分：★ = 1 分，★★★★★ = 5 分。「服务端依赖」一列分数越高 = 越依赖服务端（越差）。

| 能力 | 竞品归属 | 技术门槛 | 服务端依赖 | 内容合规风险 | ToS 暴露面 | 合计（满分 20，门槛/风险/ToS 越高越差，服务端越低越好 → **加权分越低越值得做**） |
|---|---|---|---|---|---|---|
| **小说 AI 翻译（BYOK 直连）** | PiPixiv / SwiftUI / Shaft（OpenAI 兼容端点） | ★★ | ★（无，用户自带 key） | ★ | ★★ | **7** ← Pictelio **已做** |
| **小说翻译的调度增强**（首片流式 + 并发按序合并 + 队列重试 + 缓存指纹） | PiPixiv（最完整） | ★★★ | ★ | ★ | ★★ | **8** |
| **评论 / 标题 / 简介 翻译** | Shaft（v4.9.3 云端 + 本机）、SwiftUI | ★★ | ★★ | ★★ | ★★ | **8** |
| **本机超分（Real-ESRGAN / Real-CUGAN）** | Shaft（NCNN） | ★★★ | ★（无） | ★ | ★ | **7** |
| **ugoira RIFE 补帧** | Shaft（NCNN） | ★★★★ | ★（无） | ★ | ★ | **7** |
| **本机高清化** | P站助手（自述）、Shaft 超分同源 | ★★★ | ★（无） | ★ | ★ | **7** |
| **ugoira H.264 MP4 导出** | Shaft（MediaCodec + MediaMuxer） | ★★★ | ★（无） | ★ | ★ | **7** |
| **API 反代（用户自建 PxveAPI）** | Shaft | ★★ | ★★★（需用户自建服务） | ★★ | ★★★★ | **10** |
| **漫画圈选/整部翻译** | Shaft（CTD + Manga-OCR + 擦字回填） | ★★★★★ | ★★（可本机 Opus-MT，也可 OpenAI 兼容端点） | ★★★ | ★★★ | **14** |
| **云端高清化（排队）** | P站助手 | ★★★ | ★★★★★ | ★★ | ★★★ | **14** |
| **服务端 AI 翻译** | P站助手（DeepSeek 等）、Shaft 云端（gpt-5.6-luna） | ★★ | ★★★★★ | ★★★ | ★★★ | **14** |
| **cut-out 前景抠图** | Shaft（u2netp / isnet-anime） | ★★★ | ★（无） | ★★（人像/角色抠图本身无合规问题，但导出物可能被二次使用） | ★ | **8** |
| **E2E 加密 ClientHello（ECH）** | pixez-flutter | ★★★★★ | ★ | ★ | ★ | **8**（门槛单项即劝退） |

### 2.5.1 纯客户端可做（零服务端成本）—— 可做清单

| 能力 | 前提 |
|---|---|
| 本机超分 | 需引入 NCNN（~2–4 MB/arm64）+ 模型权重（Real-CUGAN x2 约 4–8 MB，Real-ESRGAN 类似量级）**并自建分发**（Shaft 借 GitHub Releases，国内下载是已知痛点） |
| ugoira RIFE 补帧 | 模型 11 MB（`flownet`），Shaft 已给出可复现的 timestep 公式与验证探针 |
| ugoira H.264 MP4 导出 | **零新依赖**（`MediaCodec` + `MediaMuxer` 都是系统 API），Shaft 实测 APK 增量 0 |
| cut-out 抠图 | NCNN + u2netp（4 MB 可内置）/ isnet-anime（84 MB 需下载） |
| 小说/评论/标题/简介 BYOK 翻译 | 已有 |
| 翻译调度增强（首片流式 + 并发按序 + 队列 + 指纹缓存） | 纯逻辑，无新依赖 |
| 镜像域名切换（方向一的 H 类） | 已有回退骨架 |

### 2.5.2 必须有服务端/模型 —— 不可做清单

| 能力 | 为什么纯客户端做不到 |
|---|---|
| 云端高清化 | 高分辨率大图本机 OOM；Shaft 自己的 `BoundedBitmapDecode.kt` + `RENDER_MEMORY_FRACTION = 0.5` 就是内存墙的证据 |
| 服务端 AI 翻译 | 主要不是技术问题而是**商业模式**：P站助手按字数/次数计费，说明成本模型是「用户用得多 = 我们赔得多」 |
| API 反代 | 必须是服务端；且 Shaft 明确判断「依赖第三方服务，可用性不可控」 |
| 漫画自动翻译 | **不是**「需要服务端」而是「需要两个 50–90 MB 的视觉模型 + 像素级回填管线」；翻译那一步可以 BYOK，但检测 + OCR + 回填的工程量是最大拦路虎 |

---

## 2.6 对 Pictelio：BYOK 直连优势的诚实评估

**先复述 Pictelio 的现状（已核实）**：两个客户端都是 BYOK 直连。webview 走 DeepSeek（`packages/app/src/api/translate.ts`，`CapacitorHttp` / `fetch` 双模）；app-lynx 走 OpenAI Responses（ADR-0169–0178）。`translate.ts:5-6` 注释写明原因：「Android WebView fetch 直连多数国内服务商会 CORS 失败，Native 必须走 CapacitorHttp」。

### 2.6.1 诚实的结论

**BYOK 直连在隐私与成本上确实是真优势，但在能力上，它现在换不来任何 Shaft / P站助手 / PiPixiv 都已经拥有的东西；而在「能被用户感知到的 AI 能力广度」这一维上，BYOK 目前是纯负债。**

拆开说三点：

1. **隐私优势是真的，但受众很窄。** BYOK 的实质是「我们的服务器看不到你的小说正文和你的 API key」。这个优势只对两类用户有决定性意义：(a) 愿意为了隐私而自己申请 DeepSeek/OpenAI key 的技术用户；(b) 明确不接受任何内容上传的合规敏感用户。**但这两类人恰好是竞品的核心用户群**——Shaft 的本机 AI 套件（超分/抠图/补帧/OCR）**同样不上传任何东西**（README 明写「On-device inference · nothing uploaded」），而 Shaft 的云端翻译是 2026-09-07 才灰度接入、且**小说明确不支持**。所以对最在意隐私的那批用户，Shaft 的本机路线和 Pictelio 的 BYOK 隐私水位是**平的**，BYOK 没有拿到差异化。

2. **成本优势是真的，但它省的是一笔我们本来就没有的成本。** BYOK 让 Picteligio 零推理成本、零 GPU 成本、零 API 账单——这是 P站助手（有服务成本，所以必须按字数计费）和 Shaft 云端翻译（有推理成本，所以有「额度比例」）都不具备的。**但反过来说，我们没有服务，就没有可以收费的东西。** Shaft 走通了「AI 全免费 + 代理搜索收费」的模式，说明「有服务才有钱赚」这件事在 Pixiv 客户端这个赛道是成立的。BYOK 让我们**结构性地放弃了这条变现路径**。这不是缺点，但如果我们期待用 AI 能力反哺项目，那么 BYOK 是与这个目标冲突的选择——这一点必须承认，不能包装成「优势」。

3. **能力上限受限于用户自己配的模型，这一点比想象的更严重。** 关键区分是：**BYOK 只能解决「翻译」这一类纯文本任务，而竞品的 AI 能力早就溢出了这个范围。** Shaft 的超分（Real-CUGAN Pro）、抠图（ISNet-Anime）、ugoira 补帧（RIFE v4.6）、漫画 OCR（Manga-OCR ViT+GPT2）——**这四项没有一项能靠「让用户填个 API key」实现**，因为它们要么是本地视觉模型（用户的 key 帮不上忙），要么是 Cloudflare 屏蔽条件下的传输层问题（跟 AI 无关）。用户拿 Pictelio 的 BYOK 翻译去和 Shaft 的「本机 AI 全家桶 + 免费无限制」对比时，结论是可预期的：**翻译这一项打平甚至更好（我们支持 R18 三段式门控、章节搜索、LRU 缓存等竞品没有的阅读体验），其余全部是 0 分。**

4. **最刺痛的一条：Pictelio 已经具备、但没有对外讲的能力。** 逐条对比下来，Pictelio 在**翻译调度**这一维上并不落后——甚至领先：we have S1–S7 阶段 + LRU 缓存 + 流式注入 + R18 三段式门控（webview），app-lynx 有 OpenAI Responses + 跨流污染防护 + 恶意时序守卫（见 `docs/research/app-lynx-translation-cross-stream-contamination.md`）。PiPixiv 那套「首片流式 + 并发按序合并 + 队列重试 + 缓存指纹」我们**部分具备**（流式注入有；并发按序合并与队列重试未见证据）。**但这些全是「翻译做得更稳」，没有一个是「翻译之外的新能力」。** 在一个功能对比表里，「翻译质量更好 10%」和「多了 4 项本地 AI 能力」是完全不同量级的说服力。

**净判断**：BYOK 直连让 Pictelio 在 AI 这一格上**没有输得很难看**（翻译主场景持平），但**也没有任何理由让用户从 Shaft 换过来**。它是一个**防守性的选择**，不是**进攻性的差异化**。如果我们把 AI 方向作为重点，BYOK 该被重新定位成「翻译这一格的护城河（隐私 + 阅读体验）」，而不是「AI 能力的差异化」——后一个说法目前站不住。

---

# 3. 结论：这两块若要补，建议顺序与理由

## 3.1 方向一（直连）—— 建议顺序

| 优先级 | 动作 | 理由 | 依赖 | 工作量估 |
|---|---|---|---|---|
| **P0** | **E 类：DoH 查 CNAME 源站名**（`app-api.pixiv.net.cdn.cloudflare.net` / `i.pximg.net.cdn.cloudflare.net`） | 性价比最高。绕开的是「污染/黑名单针对真域名」，与 GFW 检测维度正交；4 行映射 + 一个 OkHttp `Dns` 实现即可 | 无新依赖 | **极小** |
| **P0** | **F/G 类：DoH + 硬编码 IP 兜底**（DoH 端点串行回退 + fallback IP 池） | 必要的地基；Shaft / PiPixiv / pixez / SwiftUI **四家全部**都有。Pictelio 缺这块是国内直连的第一道门槛 | ONNX 无关 | 小 |
| **P1** | **C 类：图片通道 No-SNI TLS**（只对 `i.pximg.net` / `s.pximg.net`） | 图片是流量大头；Shaft / PiPixiv / pixez 三家都这么做。**必须同时照搬 `requiresStandardClient()` 探针**，否则切镜像时 TLS 会打死 | 无新依赖 | 中 |
| **P1** | **H 类：镜像域名扩模式**（`.re` 优先，`.cat` 已知被墙） | 已有回退骨架（`PixivImageLoader` mirrorClient），是增量。`.cat` 已被墙这个事实要写进 UI 文案 | 无 | 小 |
| **P2** | **A 类：API 走 QUIC/Cronet** | Shaft 已证明可行但**自认是赌 GFW 名单**；且引入 cronet-embedded 会带来「WebView 内置 Chromium 栈 + Cronet 双栈并存」这个 Shaft 从未面对的新风险（结构困难 #4）。**建议先做 3 个月观察，等 Pixiv 侧或 GFW 侧有明确信号再动** | `cronet-embedded`（APK + 几 MB） | **大** |
| **P2** | **I 类：用户自建 API 反代开关**（PxveAPI 风格 URL 改写） | 78 行 OkHttp Interceptor；给愿意自建的用户一条兜底 | 无 | 小 |
| **P3** | **B 类：SNI 替换（`pixiv.me`）** | 依赖 Cloudflare 继续宽容 SNI≠Host，零冗余。**不建议** | — | — |
| **❌** | **D 类：ECH** | OkHttp / Cronet 均不暴露 ECH 接口；Java 侧唯一路径是自己实现 ECH 客户端（内层 ClientHello 构造 + 长度扩展），工程量以人月计 | — | **不建议** |
| **❌** | **J 类：系统代理** | 已是现状 | — | 无需做 |

**方向一的真正风险不在实现，在「这条路的有效期」**：Shaft 自己的文档承认 2026-04 老方案已退化、QUIC 方案是「GFW 暂时还没来管的路」。所以**方向一应该按「可随时失效」来设计**——因此 P0/P1 全都是**加法**（在现有 Java OkHttp 链路上叠 DNS/SSL 覆盖），而不是**替换**（不推翻 `/pixiv-img/` 代理与 `PixivApiCore` 架构）。这也是为什么我建议不做 A/B/D：它们要么是重投入的赌注，要么是零冗余的赌注。

## 3.2 方向二（AI）—— 建议顺序

| 优先级 | 动作 | 理由 |
|---|---|---|
| **P0** | **把 BYOK 重新定位**（文档 + UI 措辞）：从「AI 能力差异化」改为「翻译这一格的护城河 = 隐私 + 阅读体验（R18 门控 / 章节搜索 / 流式注入）」 | 当前定位站不住（§2.6）。不改定位，后面每一个 AI 投入都会用错误的尺子衡量 |
| **P0** | **补齐翻译调度三件套**（对应 PiPixiv）：并发按原文顺序合并、Read-Later 式预翻译队列（3 次自动重试 + 1s/2s/4s 退避 + attemptToken CAS）、缓存指纹（配置 + 原文 md5 双因子） | 纯逻辑，零新依赖，且是我们**已有一半**的赛道。PiPixiv 这三项都有单测（`NovelTranslationStreamingTest` / `NovelReadLaterQueuePolicyTest`），可对标 |
| **P1** | **ugoira H.264 MP4 导出** | 零新依赖（`MediaCodec` + `MediaMuxer`），APK 增量 0，Shaft 实测「体积只有 GIF 的十几分之一」。这是**唯一一个「零依赖 + 强感知 + 不需要模型」**的 AI 邻接能力 |
| **P1** | **本机超分（Real-CUGAN Pro 优先）** | Shaft 的 v4.5.1 release notes 明确推荐 CUGAN over ESRGAN for 动漫。**但模型分发是真问题**——Shaft 全部模型挂 GitHub Releases，国内下载体验差；我们需要自建 CDN 或考虑让用户从设置里指定本地模型路径 |
| **P2** | **ugoira RIFE 补帧** | 复用超分的 NCNN + `ProcessBuilder` 链路，**边际成本最低**（同一个 .so 目录、同一个执行器模式）。Shaft 已给出可复现的 timestep 公式 + 验证探针，直接照抄 |
| **P2** | **翻译目标语言扩展 + 标题/简介/评论翻译** | SwiftUI 做了标题/简介/用户简介/全部评论；Shaft v4.9.3 做了评论/标题/标签。门槛低，纯复用现有 BYOK 通道 |
| **P3** | **cut-out 抠图** | 门槛与超分同级，但**合规/ToS 暴露面更高**（导出人物抠图 PNG 是典型的二创素材）。收益/风险比不如超分 |
| **P3** | **漫画自动翻译** | 门槛最高（评分 14/20）。**但如果只做「翻译」不做「检测+回填」**——即让用户截图或导出漫画页 → BYOK 翻译文本 —— 门槛会从 14 掉到 6。**这是被忽略的降级方案** |
| **❌** | **云端高清化** | 必须有 GPU 服务 = 必须有成本 = 必须有计费 = 必须有服务器。与 Pictelio 当前的 BYOK / 无服务端定位直接冲突 |
| **❌** | **服务端 AI 翻译** | 同上。且这条路上有 Shaft（云端 gpt-5.6-luna）和 P站助手（DeepSeek）两家在打，我们没有成本优势也没有先发优势 |
| **❌** | **API 反代作为内置服务** | Shaft 的 `docs/direct-connect.md` 判断「依赖第三方服务，可用性不可控」+ 评分 10/20。**只做用户自建开关（P2），不做内置服务** |
| **❌** | **漫画全链路（CTD + Manga-OCR + 像素级回填）** | 单项即 5 星门槛，评估值 14/20，是本清单里唯一「光工程量就能压垮一个版本」的项目。除非确定要做，否则连 ticket 都不该开 |

---

# 附录 A：本次未能核实 / 只基于自述的断言（逐条）

## A.1 闭源 / 无源码

| 断言 | 状态 |
|---|---|
| P站助手「国内直连」的**技术机制**（DNS / SNI / IP / HTTP3 任一） | **❌ 完全无法核实**。官网（2026-09-27 抓取）与落地页 bundle 均零技术细节。`直连` 出现 9 次全为营销文案 |
| P站助手「本机高清化」用的**推理引擎/模型** | **❌ 无法核实**。官网只说「利用设备算力在本地即时处理」 |
| P站助手「云端高清化」的**模型、GPU、排队策略** | **❌ 无法核实**。只确认「提交至服务器队列处理」 |
| P站助手「服务端 AI = DeepSeek 等大模型」 | **⚠️ 官方站自述**（文案点名 DeepSeek），**无技术验证** |
| P站助手「按字数或次数计费」的**具体费率** | **❌ 未找到**（可能需登录/内测才可见） |
| P站助手 2026 年最新版本号与发布日期 | **❌ 未找到**。无公开仓库，落地页有「历史版本」路由但本次未逐版抓取 |

## A.2 项目已消失

| 断言 | 状态 |
|---|---|
| Legado「直连模式」的**实现机制** | **❌ 无法核实**。`gedoor/legado` main 分支自 2026-05-27 08:30:57 UTC 起仅剩「公告」commit，代码全删（仓库 52 KB / 2 文件） |
| Legado 是否有活跃社区 fork 继续维护 | **❌ 未核实**。`lismc33/-legado-forks` 存在（最后 push 2026-06-16）但内容与法律状态未查 |
| `competitor-features-comparison.md` 中 Legado「书源 v284，2026-09 活跃」 | **❌ 已证伪**（见 §0.4 #5） |

## A.3 只基于 README / 官方文档自述

| 断言 | 状态 |
|---|---|
| Shaft「DoH DNS 配置」的用户可见表现 | **⚠️ 仓库文档 + 源码双证**（`CloudFlareDNSService.kt` / `HttpDns.java` 已逐行核实），**但未在真机验证过** |
| Shaft「网络自检页能识别 IPv6 污染」 | **⚠️ 仓库文档自述**。源码有 `CfBlockDetector.kt`（CF 403 鉴别）但 IPv6 污染检测未逐行核实 |
| Pixiv-SwiftUI README「可配置**主要/备用**翻译服务」 | **❌ 源码中未找到主备切换逻辑**（`Translate.swift` grep 零命中）。可能只是「用户选一个」 |
| Pixiv-SwiftUI README「所有代码由 LLM 生成」（Vibe Coding 自标） | **⚠️ README 自述**。但从 `PixivDirectConnection.swift` 1021 行含 QPACK 的工程质量看，**这句自述与代码观感不符**，存疑 |
| Pixiv-SwiftUI「iOS 17 / macOS 14/15 仅理论支持未测」 | **⚠️ README 自述**，未核验 |
| Shaft AI 模型在 GitHub Releases 的**国内实际下载速度** | **❌ 未测**（我未下载任何模型 zip） |
| PiPixiv「HarmonyOS 适配」 | **❌ 已证伪**。793 个文件的 tree 里 `harmony|ohos|鸿蒙` 零命中，README 未提，无 HarmonyOS target |

## A.4 明确未做的探查（时间/工具限制）

| 项 | 说明 |
|---|---|
| `app-api.pixiv.net` 当前是否提供 ECH config | 需 HTTPS 记录查询或 ECHConfigList 端点探测，本次未做。**这直接影响 §1.5 中「Shaft 说 Pixiv 未启用 ECH」与「pixez-flutter 2026-09 仍提供 ech 档」的矛盾如何裁决** |
| `104.18.42.239` / `172.64.145.17` / `210.140.139.x` 是否仍然可达 | 未做任何连通性测试；所有 IP 均照抄竞品源码的硬编码值，**不能假设 2026-09 仍有效** |
| 各竞品在中国大陆的实际直连成功率 | 全部为源码级推断，**零真机验证**。任何「我们做了直连所以更可用」的说法在实测前都不成立 |
| Shaft 4.9.3 云端翻译的「额度比例」具体数值 | release notes 只说「设置与用量页显示翻译模型和额度比例」，数值需跑 App |
| PiPixiv `AiModelCatalogService` 拉模型列表的具体端点 | 未逐行读该文件 |
| Shaft `CrownDet` 之外是否还有其他 AI 入口 | 已 grep 全 tree 的 `upscale\|rife\|ocr\|rembg`，覆盖完整 |

## A.5 工具路由自检

| 项 | 记录 |
|---|---|
| 架构概览 / 领域概念 | ✅ 先读了 `openwiki/architecture/api-layer.md`、`openwiki/architecture/image-pipeline.md`、`openwiki/integrations/android-native.md` 及既有 `docs/research/competitor-features-comparison.md` |
| 具体符号 / 调用链 / 影响面 | ✅ 用 `codegraph explore "PixivApiPlugin shouldInterceptRequest CapacitorHttp nativeFetch"` 与 `codegraph explore "ImageProxyInterceptor interceptImage"`（索引健康：1,262 文件 / 17,071 节点 / 55,573 边） |
| 降级使用 grep/read | ✅ 仅用于：(a) 已从 codegraph 拿到源码的文件的后续片段读取；(b) 竞品仓库（不在本项目索引内，`gh api` 不可被 codegraph 覆盖） |
| 第三方库文档 | ✅ 未查 Context7（本次不需要外部库文档——所有结论均来自竞品源码本身） |
| 索引健康 | ✅ `codegraph status` 正常，边数非零 |
