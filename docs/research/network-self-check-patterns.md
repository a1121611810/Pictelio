# 网络自检 / 网络诊断（Network Diagnostics）业界做法调研

> 调研日期：**2026-09-11**
> 调研对象：为 Pictelio（SolidJS + Capacitor，Android）与 pictelio-app-lynx（vue-lynx）设计"网络自检"功能提供业界基线
> 调研范围：与 Pictelio **不同类**的产品（社交/IM、流媒体、测速工具、浏览器内置、操作系统内置、云与开发者工具、游戏网络诊断），另附同类第三方 Pixiv 客户端的对照点
> 方法：以**一手来源**（官方文档、官方帮助中心、官方规范/RFC、官方开源仓库源码与 README）为准，逐条附 URL；无法回溯到一手来源的记为**「推断」**，与**「有据可查」**严格区分
> 来源分级约定：**【官方一手】**=厂商官方域名文档/帮助页；**【源码一手】**=官方仓库源码/README；**【规范】**=IETF/WHATWG/Chromium 等标准与实现文档；**【推断】**=本文基于上述事实的推理，非原文结论

---

> ⚠️ **勘误（2026-09-11，研究票 #440 核实）**：本文件 §6.2 / §6.4 / §6.5 与结论速览第 10 条基于「网络直连（ADR-0144）仍在树上」的过期前提。该功能已由提交 `bf32620e`（2026-09-08「refactor(app): 彻底移除网络直连功能，回归官方域基线」）整体移除；当前 HEAD / main 无 `DirectAccessPolicy` / `ChannelCircuitBreaker` / `directAccessStatus()` / `SniStrippingSSLSocketFactory`。相关检查项（L1 直连路由 / 熔断快照、L4 去 SNI 对照）在当前树上应显式 skipped。以 `docs/research/network-selfcheck-java-capability-audit.md` 为准。分层漏斗、移动端无 ICMP、交互范式、反模式等其余结论不受影响。

## 0. 结论速览

1. **"网络自检"的本质是一个分层漏斗，不是一次测速。** 成熟做法按协议栈自下而上：本机网络类型/门户 → DNS → TCP → TLS → HTTP →（可选）吞吐，且各层能互相证伪——[RFC 8305](https://www.rfc-editor.org/rfc/rfc8305.txt) 开篇即指出"特定地址或协议族被阻断、损坏或次优"是常态。见第一节。
2. **第一层永远是"系统说有没有网"，而不是先发包。** Android `NetworkCapabilities`（`NET_CAPABILITY_VALIDATED` / `NET_CAPABILITY_CAPTIVE_PORTAL` / `TRANSPORT_*`）与 Apple `NWPathMonitor` / `NWPath.Status` 是零成本信息源（见 1.1 / 1.15）。Chrome `net/` 栈的同类事件是 `TRANSPORT_CONNECT_JOB_IPV6_FALLBACK`、`CONNECT_JOB_TIMED_OUT`（见 5.6）。
3. **移动端没有 ICMP。** `InetAddress.isReachable()` 源码写明"有特权才用 ICMP ECHO，否则退回 TCP:7"；移动端"ping"实为 DNS / TCP connect / HTTP RTT（见 1.3 / 3.7 / 4.10）。
4. **交互范式是"一键给结论 + 分步给原因"。** Discord 分步 + 错误码表、Slack 分步 + `slack.com/help/test`、Netflix 一键 fast.com、Chrome 会话式 NetLog 导出——纯一键与纯向导都少见（见 2.1 / 2.10）。
5. **"你的问题 / 我们的问题"必须分开。** Discord 把错误分为 "something on your end" 与 "Errors from Our Side" 并指向 discordstatus.com；Slack 的 Server error 指向状态页；Netflix 有 Is Netflix Down?（见 2.9）。
6. **证据要能归因到具体环节。** Chrome NetLog 用 `net_error` 整数码 + 分层事件；云厂商给出"阻塞组件 / 命中的规则名 / 逐跳"（见 1.16）。但 Chromium 自己承认错误码"并非逐个有文档"，所以用户层必须是人话、原始层折叠（见 2.4 / 4.3）。
7. **最容易踩的三个误报**：只测一个域名/IP（4.1）、缓存造成的假阳性（4.4）、把逐跳丢包当节点故障（4.11，mtr 官方明确警告）；此外**双栈黑洞与门户劫持**是误报两大来源（4.12）。
8. **弱网不要雪上加霜**：诊断必须有自己的预算（总时长 / 总流量）、串行化，并遵守 `Retry-After`（[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) / [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html)）；注意 Media3/ExoPlayer 默认是**线性**退避（1s 递增、5s 封顶）而非指数（见 3.8 / 4.5）。
9. **可复用方案**：吞吐用 **LibreSpeed**（可自托管、不上报）或 **`@cloudflare/speedtest`**（README 明说结果会被 Cloudflare 聚合）；分层结构抄 **Chrome NetLog**；平台判定用 **Android/Apple 原生 API**（见第五节）。
10. **对 Pictelio（第六节）**：两个引擎的网络出口已经收敛到**同一个 Java OkHttp 层**，因此**执行层必须放 Java**、纯逻辑抽共享包（仿 `@pictelio/update-check`）、两套 UI 各自渲染；应优先暴露已有的**直连路由决策 + 双通道熔断器状态**（零网络成本、最难伪造的一层）。隐私上只用 `TRANSPORT_*` / `NET_CAPABILITY_*`（不碰 SSID），报告不含任何 token。


---

## 一、网络自检通常包含哪些检查项（按层列举）

下表把业界常见的自检项**按协议栈自下而上**排列，并给出"测什么 / 用什么测 / 失败时给用户看什么"。每行的技术依据都指向一手来源；具体产品怎么做见下方"产品实例"。

> 设计要点（**【推断】**）：自检项必须能**互相证伪**。"DNS 成功但 TCP connect 超时"（域名被污染 vs 端口被重置）是完全不同的故障；只测一个 HTTP 请求，用户永远只能看到"网络错误"。

### 1.1 本机网络类型与系统连通性

| | 内容 |
|---|---|
| **测什么** | 是否有可用网络；当前网络类型（Wi-Fi / 蜂窝 / 以太网 / VPN）；系统是否认为该网络"已验证可上网"；是否处于强制门户（captive portal） |
| **用什么技术测** | Android：`ConnectivityManager` + `NetworkCapabilities`（`TRANSPORT_WIFI`/`TRANSPORT_CELLULAR`/`TRANSPORT_VPN` 等传输类型，`NET_CAPABILITY_INTERNET`/`NET_CAPABILITY_VALIDATED`/`NET_CAPABILITY_CAPTIVE_PORTAL` 等能力位）：[**官方一手** ConnectivityManager](https://developer.android.com/reference/android/net/ConnectivityManager)、[NetworkCapabilities](https://developer.android.com/reference/android/net/NetworkCapabilities)、[ConnectivityManager.NetworkCallback](https://developer.android.com/reference/android/net/ConnectivityManager.NetworkCallback)。<br>iOS/macOS：`NWPathMonitor` 观察 path 变化，`NWPath.Status`（`.satisfied`/`.unsatisfied`/`.requiresConnection`）与 `isExpensive`/`isConstrained`：[**官方一手** NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor)（纯文本版 <https://developer.apple.com/documentation/network/nwpathmonitor.md>）。<br>强制门户：[**规范** RFC 8910](https://www.rfc-editor.org/rfc/rfc8910.txt)。 |
| **失败时给用户看什么** | "当前无网络连接" / "仅蜂窝网络，可能受限" / "该 Wi-Fi 需要先登录（强制门户）"。**关键**：先排除本机原因，再谈远端。 |
| **产品实例** | Apple 系统内置 **Network Responsiveness**（Wi-Fi 响应性测试，[官方](https://support.apple.com/en-us/101942)）；开发者侧入口（Android `ConnectivityManager` / Apple `NWPathMonitor`）见 1.15；Windows 疑难解答的官方文章 URL **未找到一手来源**。 |

### 1.2 DNS 解析

| | 内容 |
|---|---|
| **测什么** | 域名能否解析；解析耗时；解析到的 IP 是否合理；系统解析器与公共解析器结果是否一致（**污染/劫持检测**） |
| **用什么技术测** | DNS 查询往返；DoH（[RFC 8484](https://www.rfc-editor.org/rfc/rfc8484.txt)）与 DoT（[RFC 7858](https://www.rfc-editor.org/rfc/rfc7858.txt)）作为对照通道——系统解析器返回错误 IP 而 DoH 正确，即可判定本地 DNS 被污染。<br>**Pictelio 背景**：官方直连方案之所以存在，正是因为大陆网络"DNS 污染 + HTTPS SNI 阻断"（ADR-0144，[OpenWiki 直连文档](/openwiki/architecture/direct-access.md)）。 |
| **失败时给用户看什么** | 解析到的 IP 列表、耗时、所用解析器；"能连 DNS 但解析结果异常"应单独成一类结论。 |
| **产品实例** | Cloudflare 官方排障给出 `dig @1.1.1.1` / `@1.0.0.1` / `@8.8.8.8` 对比与 `dig +short CHAOS TXT id.server @1.1.1.1`（[官方](https://developers.cloudflare.com/1.1.1.1/troubleshooting/)）；Chrome NetLog 以 `HOST_RESOLVER_MANAGER_*` / `HOST_RESOLVER_DNS_TASK` 记录 DNS（见 5.6）。 |

### 1.3 延迟 / 抖动 / 丢包

| | 内容 |
|---|---|
| **测什么** | 单次往返时延（RTT）、时延抖动（jitter）、丢包率（loss） |
| **用什么技术测** | **移动端通常拿不到 ICMP**：JDK/Android 的 `InetAddress.isReachable()` 明确写 "uses ICMP ECHO REQUESTs **if the privilege can be obtained**, otherwise it will try to establish a TCP connection on port 7 (Echo)"——[**源码一手** OpenJDK InetAddress.java](https://raw.githubusercontent.com/openjdk/jdk/jdk-11%2B28/src/java.base/share/classes/java/net/InetAddress.java)、[Android 工具链同源副本](https://android.googlesource.com/toolchain/jdk/jdk17/+/b0059e1eefaefc4d4b86650ea21107eeb4282180/src/java.base/share/classes/java/net/InetAddress.java)。移动端替代：DNS 查询 RTT / TCP connect RTT / HTTP RTT。<br>丢包的真实实现路径之一是 **TURN/STUN**：`@cloudflare/speedtest` 用 `turnServerUri`（默认 `turn.cloudflare.com:3478`）测丢包（[**源码一手** cloudflare/speedtest](https://github.com/cloudflare/speedtest)）。<br>抖动与失败率：LibreSpeed 的 stability 测试 "repeatedly measures ping over a selected duration and reports current, average, minimum, maximum, jitter, and failed request percentage values with a live chart"（[**源码一手** LibreSpeed README](https://github.com/librespeed/speedtest)）。 |
| **失败时给用户看什么** | 三个数值 + 阈值分级（"延迟 850ms、抖动 300ms、丢包 12% → 不适合语音/大图"）。高丢包 + 正常带宽，往往就是"能打开页面但图片总加载失败"的真实原因。 |
| **产品实例** | LibreSpeed stability（current/avg/min/max/jitter/failed% + 实时图表 + CSV）；`@cloudflare/speedtest` 用 TURN/UDP 测丢包；Xbox GDK `XNetworkingQueryStatistics`（见 1.16）。**"游戏内 ping/loss 显示"未找到一手产品文档**。 |

### 1.4 TCP 握手（可达性）

| | 内容 |
|---|---|
| **测什么** | 目标主机 443/80 端口能否完成三次握手；connect 耗时；**解析成功但 connect 失败**这一最典型的"墙/重置"信号 |
| **用什么技术测** | 直接 TCP connect 计时。多地址/多协议族网络必须考虑竞速：[**规范** RFC 8305 Happy Eyeballs](https://www.rfc-editor.org/rfc/rfc8305.txt)——"Since specific addresses or address families (IPv4 or IPv6) may be blocked, broken, or sub-optimal on a network, clients that attempt multiple connections in parallel have a chance of establishing a connection more quickly."（这句话几乎就是"网络自检"存在的理由） |
| **失败时给用户看什么** | "DNS 解析成功（x.x.x.x），但 443 端口连接超时/被重置"——可操作的结论，比"网络异常"高一个量级。 |
| **产品实例** | Chrome NetLog 的 `TCP_CONNECT` / `TCP_CONNECT_ATTEMPT` / `CONNECT_JOB_TIMED_OUT`（见 5.6）；云侧配置推演与数据面探测（AWS Reachability Analyzer / Azure Connection troubleshoot / GCP Connectivity Tests，见 1.16）。 |

### 1.5 TLS 握手

| | 内容 |
|---|---|
| **测什么** | TLS 握手能否完成；证书链与主机名校验；协商到的版本/密码套件；**是否因 SNI 被阻断** |
| **用什么技术测** | TLS ClientHello + 证书校验。Pictelio 已有"**去掉 SNI** 的 SSLSocketFactory"路线（ADR-0144：no-SNI 握手仍返回合法 `*.pixiv.net` 通配证书，因此证书链与主机名校验得以保留），所以**自检必须能分别报告"带 SNI 路径"与"去 SNI 路径"的结果**，否则无法解释"开了直连就好了"。 |
| **失败时给用户看什么** | 区分"证书错误"`SSLHandshakeException: Trust anchor`、"连接被重置"`SSLException: Connection reset`（常见于 ClientHello 携 SNI 时）、"协议不支持"。 |
| **产品实例** | Chrome NetLog 的 `SSL_CONNECT` / `SSL_SERVER_HANDSHAKE` / `SSL_HANDSHAKE_ERROR` / `SSL_CERTIFICATES_RECEIVED`（见 5.6）；Edge 与其同源（**【推断】**，见 1.15）。 |

### 1.6 HTTP 往返（端到端）

| | 内容 |
|---|---|
| **测什么** | 一次真实 HTTP(S) 往返：状态码、TTFB、总耗时、响应头（CDN 命中、边缘节点、缓存） |
| **用什么技术测** | 轻量 GET + 分层计时。浏览器可直接读 [PerformanceResourceTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming) 的逐阶段时间戳（`domainLookupStart/End`、`connectStart/End`、`secureConnectionStart`、`requestStart`、`responseStart`、`transferSize`）。`@cloudflare/speedtest` 正是 "relies on the PerformanceResourceTiming browser api to extract timing results"（[**源码一手**](https://github.com/cloudflare/speedtest)）。<br>**防缓存假阳性**：探测 URL 必须带随机串且响应 `Cache-Control: no-store`，否则第二次自检命中缓存、显示"一切正常"。 |
| **失败时给用户看什么** | HTTP 状态码 + 上游返回体错误消息（Pictelio 已有 `extractPixivErrorMessage`）。 |
| **产品实例** | Netflix **fast.com**（HTTP 下载/上传 + loaded latency）；Slack 的 `slack.com/help/test` 连接测试页（见 1.12）。 |

### 1.7 CDN / 边缘节点

| | 内容 |
|---|---|
| **测什么** | 命中的边缘节点是谁/在哪；命中缓存还是回源；回源是否失败；不同 DNS 解析是否导向不同边缘 |
| **用什么技术测** | 读响应头中的边缘标识与缓存状态；对照全局可用性数据。Cloudflare 提供 **Radar** 数据集与 API（[**官方一手**](https://developers.cloudflare.com/radar/)）。 |
| **失败时给用户看什么** | "边缘可达但回源失败"与"边缘不可达"必须分开——前者是服务方故障，不应归因给用户。 |
| **产品实例** | Cloudflare **1.1.1.1/help** 显示"服务你的数据中心"（见 1.14）；Cloudflare **Radar** 的区域中断/质量数据（含 Cause/Scope/ASN，见 1.16）。 |

### 1.8 代理 / VPN 可达性

| | 内容 |
|---|---|
| **测什么** | 系统是否处于 VPN（`TRANSPORT_VPN`）；本地代理端口是否在监听；经代理的 CONNECT 隧道是否可用 |
| **用什么技术测** | Android `NetworkCapabilities` 的 `TRANSPORT_VPN`（[官方文档](https://developer.android.com/reference/android/net/NetworkCapabilities)）；本地端口探测；隧道内一次轻量 HTTP。<br>**Pictelio 已有实现**：`classifyError` 对本地代理失败有专门分支，文案为"本地代理连接失败（127.0.0.1:10808），请检查代理软件是否运行"（`packages/app/src/api/client.ts:152`）。 |
| **失败时给用户看什么** | 明确"你的代理软件没在运行"——这是**唯一能把责任正确交还用户**的一层；反之代理开着仍失败，就不该说"检查你的网络"。 |
| **产品实例** | Telegram 代理 **Check Status**（Checking/Warning，并提示会向代理管理员暴露 IP，见 1.12）；Chrome NetLog 的 `PAC_FILE_DECIDER` / `PROXY_RESOLUTION_SERVICE` / `SOCKS5_CONNECT`（见 5.6）。 |

### 1.9 API 鉴权（应用层可达性）

| | 内容 |
|---|---|
| **测什么** | 带凭证调用轻量受保护端点：能否 200；401（会话过期）/403（权限）/429（限流）/5xx（服务端）分别是什么 |
| **用什么技术测** | 真实业务端点（而非裸 `/ping`），因为鉴权链路本身（token 刷新、时钟偏移、风控）才是用户实际遇到的失败。<br>**Pictelio 已有实现**：401 自动刷新在 Java 侧（`synchronized` + `isRefreshing` 锁防并发刷新风暴），JS 零知 access_token（ADR-0037，[OpenWiki API 层](/openwiki/architecture/api-layer.md)）。 |
| **失败时给用户看什么** | "登录已过期，请重新登录" ≠ "网络异常"。**把 401 显示成网络错误是典型误诊**。 |
| **产品实例** | Slack/Discord 把"服务端错误"与"你的网络"分开（见 2.9）；Telegram 用常驻状态文案 + ping 表达"连接中/失败"（见 1.12）。**专门展示 401/403/429/5xx 区分的一手产品 UI 说明未找到。** |

### 1.10 下载吞吐

| | 内容 |
|---|---|
| **测什么** | 从 CDN 边缘下载/上传的实际带宽（Mbps） |
| **用什么技术测** | 分片下载/上传到边缘测速端点。Cloudflare 默认端点 `https://speed.cloudflare.com/__down` / `__up`（[**源码一手**](https://github.com/cloudflare/speedtest)）；LibreSpeed 用 "XMLHttpRequest and Web Workers" 实现 Download/Upload/Ping/Jitter（[**源码一手**](https://github.com/librespeed/speedtest)），并有 Android 客户端模板 <https://github.com/librespeed/speedtest-android> 与 CLI <https://github.com/librespeed/speedtest-cli>。 |
| **失败时给用户看什么** | 带宽数字 + "你当前可流畅加载 1080p 大图/视频"这类**可理解**的结论，而不是裸 Mbps。 |
| **产品实例** | Ookla（TCP 为主 + HTTP fallback，最多 4 线程）、fast.com（下载/上传 + loaded latency）、Cloudflare（`__down`/`__up` + AIM 场景评分）、LibreSpeed（XHR + Web Worker + 稳定性测试）——见 1.14。 |

### 1.11 应用层专用通道

| | 内容 |
|---|---|
| **测什么** | 若 App 有实时能力：WebSocket 长连能否建立、媒体通道（WebRTC）能否打洞、语音 RTT/丢包 |
| **用什么技术测** | WebSocket 握手 + ping 往返；WebRTC ICE/STUN/TURN 候选与连通性检查 |
| **失败时给用户看什么** | 分通道报告（文本通道 OK / 语音通道失败），并提示"路由器可能阻止了 UDP" |
| **产品实例** | Slack 的 WebSocket 主/备/移动三域名与 Socket Mode；Discord 的 ICE/RTC 连接态；Telegram 的 VoipConnecting / VoipReconnecting（见 1.12）。 |

### 1.12 逐产品一手证据：社交 / IM

| 产品 | 用户可见入口 | 一键/分步 | 测的层与技术 | 失败呈现 |
|---|---|---|---|---|
| **Discord** | Voice & Video → **Debugging** 标签（Debug Log、Reset Voice and Video Settings）；Mic Test 的 "Let's Check"；语音连接错误态 **ICE Checking / RTC Connecting / No Route / Connecting / Waiting for Voice Server** | 分步向导（帮助文章按 静音权限 → 设备 → Debugging → 高级 分层） | 自建私有语音托管系统上的 **UDP/WebRTC 连接**（ICE/RTC 状态）、QoS 高包优先级、丢包/帧率、区域覆盖；官方建议语音至少 **300 kbps 上下行**；官方让用户用第三方 speedtest.net 测带宽 | 具名错误码 **1001–4001**（1001 无声音、1003 采样率不匹配、3001–3002 麦克风、4001 Debug Log 上传失败）逐码配"发生了什么 + 怎么修"；控制台日志（Ctrl+Shift+I）；明确区分"你这边的问题" vs "我们这边的问题" |
| **Slack** | Help → Troubleshooting → **Restart and collect net logs**（复现后 Stop → 生成 zip）；错误横幅带 Restart Slack / Download logs；**连接测试页 `slack.com/help/test`** | 分步向导（Step 1/2/3）+ 一键连接测试 | 四类故障：**Connectivity failure / Loading trouble / Server error / WebSocket trouble**；WebSocket 主/备/移动三域名 `wss-primary.slack.com`、`wss-backup.slack.com`、`wss-mobile.slack.com`（故障转移）；代理/firewall/VPN/杀毒；DNS/缓存/浏览器扩展 | 错误类型化 + 分步修复 + net log zip 上传；Server error → 状态页；WebSocket trouble → 让网络管理员放行域名 |
| **Telegram**（官方 Android 源码 strings） | 常驻连接状态文案 **Waiting for network… / Connecting… / Updating…**；**Ping: %d ms**；代理 **Check Status**（Checking/Warning，并提示会向代理管理员暴露 IP）+ 代理轮换超时；隐藏 **Debug Menu**（Enable/Send/Send Last/Clear Logs）；Data Usage 分 All/Mobile/Wi-Fi/Roaming | 常驻状态指示 + 单点工具（Check Status 近似一键）；Debug Menu 需手动 | 连接状态、ping、代理连通性、按网络类型流量统计；VoipConnecting / VoipReconnecting / VoipGroupConnecting 状态 | 状态文案 + 可发送日志；通话评分可勾选"附带技术信息"（文案称不含聊天内容） |
| **微信** | 消费端 App 内"网络检测"入口：**未找到一手来源**。官方一手只找到 **微信支付**侧的网络监控/排查工具与小程序「网络通信检测」 | 开发者/商户侧工具 | 微信支付监控工具输出：**RemoteIp（DNS 解析 IP）、Lookup duration（DNS）、Connection duration（Connect）、Request duration、Total duration、UserIp、LocalDns、TIME(ping)**；商户平台「网络云排查」可视化 DNS 解析 / TCP 连接 / 网络请求**三段耗时**（保留 7 天）；手工命令含 `ping -c 100`、`traceroute`/`tracert`、`mtr -4 -i 1`、`curl -w time_namelookup:time_connect:time_starttransfer:time_total` | 可视化耗时曲线 + 字段级耗时（面向开发者/商户，而非普通用户） |

来源：[Discord Voice Connection Errors](https://support.discord.com/hc/en-us/articles/115001310031-Voice-Connection-Errors)、[Discord Voice/Video 排障指南](https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide)、[Discord Audio/Video Error Codes](https://support.discord.com/hc/en-us/articles/30952914470807-Discord-Audio-and-Video-Error-Codes-Troubleshooting-Guide)、[Discord Voice Regions FAQ](https://support.discord.com/hc/en-us/articles/1500007645701-Voice-Regions-on-Discord-FAQ)、[Discord Troubleshooting Guide](https://support.discord.com/hc/en-us/articles/31623498041623-Discord-Troubleshooting-Guide)、[Slack Troubleshoot connection issues](https://slack.com/help/articles/205138367-Troubleshoot-connection-issues)、[Slack Manage connection issues](https://slack.com/help/articles/360001603387-Manage-Slack-connection-issues)、[Slack Rate limits](https://docs.slack.dev/apis/web-api/rate-limits)、[Telegram 官方 Android strings.xml](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/res/values/strings.xml)、[Telegram FAQ](https://telegram.org/faq)、[微信支付网络监控工具指引](https://pay.wechatpay.cn/doc/v2/merchant/4012203398)、[微信支付网络排查指引](https://pay.wechatpay.cn/doc/v2/merchant/4011985066)、[小程序网络通信检测](https://developers.weixin.qq.com/doc/subscription/api/base/api_callbackcheck)。

> **【推断】可抄的三点**：(1) Discord 的**错误码即文案**（每个码配"发生了什么+怎么修"）；(2) Slack 的**日志收集器做成一次会话**（start → 复现 → stop → zip），比"导出全部日志"更可用；(3) Telegram 的**常驻状态 + ping 数值**是最低成本的"实时进度"，不需要专门的诊断页。

### 1.13 逐产品一手证据：流媒体

| 产品 | 用户可见入口 | 一键/分步 | 测的层与技术 | 失败呈现 |
|---|---|---|---|---|
| **YouTube** | 播放器右键 **Stats for nerds** / **Copy debug info**（移动端 More；投屏支持） | 分步 | 播放侧技术信息（连接速度/网络活动等，官方帮助页未逐项列出字段）；**DNS 检查**；官方给出**建议持续带宽**：2160p 20 Mbps / 1080p 5 / 720p 2.5 / 480p 1.1 / 360p 0.7 | 播放错误文案（"Playback error. Tap to retry."、"Connection to server lost."）+ 分步（重启网络、测速、降分辨率、确认 DNS）；**Copy debug info** 可粘贴分享 |
| **Spotify** | **未找到** App 内网络诊断工具的一手来源；仅有帮助文档（offline / not playing / firewall+ISP / 流量与音质） | 分步 | 连接稳定性、offline 模式、firewall（仅桌面）、带宽与 Data Saver、Lossless 建议强 Wi-Fi | 通用步骤 + 换网络/换设备对比 + 联系 ISP |
| **Netflix** | **fast.com**（官方测速，页面自动开始）；App 内 **Get Help → Check your Network**；**Is Netflix Down?** 状态页 | **一键**（fast.com）+ 单点检查 | fast.com：**下载（主）+ Show more info 上传**；**Unloaded 与 Loaded 延迟**（差值即 **bufferbloat**）；FAQ 原文 "performs a series of downloads from and uploads to Netflix servers"；Settings 可调并行连接数、测试时长、loaded latency | 速度结果 + 建议（官方建议 720p 3 Mbps / 1080p 5 Mbps）；"Check your Network" 失败通常表示设备未联网；服务端问题走 Is Netflix Down? |

来源：[YouTube Send debug info](https://support.google.com/youtube/answer/7519898)、[Troubleshoot YouTube video errors](https://support.google.com/youtube/answer/3037019)、[Spotify is offline](https://support.spotify.com/us/article/spotify-is-offline/)、[Spotify not playing](https://support.spotify.com/us/article/spotify-not-playing/)、[Spotify internet and data usage](https://support.spotify.com/us/article/internet-and-data-usage/)、[fast.com](https://fast.com/)、[Netflix recommended internet speeds](https://help.netflix.com/en/node/306)、[Is Netflix Down?](https://help.netflix.com/en/is-netflix-down)。

> **【推断】可抄的两点**：(1) Netflix 把"带宽数字"翻译成"能看什么画质"，并以**服务端建议表**给出目标值——这正是 1.10 里"不要给裸 Mbps"的实证；(2) fast.com 把 **loaded latency（bufferbloat）** 作为一等公民展示——这解释了"测速很快但视频还是卡"，是自检里最容易被忽略、却最能解释真实体感的一项。
### 1.14 逐产品一手证据：测速 / 网络工具

| 产品 | 用户可见入口 | 一键/分步 | 测的层与技术 | 失败/呈现 |
|---|---|---|---|---|
| **Ookla Speedtest** | speedtest.net 网页/App，点击即测 | **一键** | 官方帮助原文："Speedtest.net operates mainly over **TCP testing** with an **HTTP fallback** for maximum compatibility. Speedtest.net measures **ping (latency), download speed and upload speed**."；组件为 **Latency/Jitter、Download、Upload、HTTP Legacy Fallback Testing**；"will use up to **four HTTP threads** during the download and upload portions" | 分项数值 + 历史记录；（经验评分作为新维度见官方文章） |
| **fast.com**（Netflix） | fast.com 页面自动开始；Settings 可调 | **一键** | **下载（主）** + Show more info 上传；**Unloaded 与 Loaded 延迟**，差值即 **bufferbloat**；FAQ 原文 "performs a series of downloads from and uploads to Netflix servers"；Settings 可调并行连接数、测试时长、loaded latency | 速度数值 + 画质建议；服务端问题走 **Is Netflix Down?** |
| **Cloudflare 1.1.1.1** | **`https://1.1.1.1/help`**：运行一系列测试，显示到 1.1.1.1 的连接是否正常，并**展示正在服务其请求的 Cloudflare 数据中心**；另有 **AIM（Aggregated Internet Measurement）** 把 **Latency / Packet Loss / Download / Upload / Loaded Latency / Jitter** 六项换算为 **streaming、gaming、webchat/RTC** 三类场景评分（五档 Bad/Poor/Average/Good/Great） | 一键（help 页）+ 场景化评分 | DNS 连通、PoP 归属；官方排障给出可复现命令：`dig example.com @1.1.1.1`、`@1.0.0.1`、与 `8.8.8.8` 对比，以及 `dig +short CHAOS TXT id.server @1.1.1.1` 识别是哪台服务器处理了请求 | 可视化"是否正常"+ 所连数据中心；场景评分 + 官方改善建议（改用有线、靠近路由器、升级路由器、联系 ISP） |
| **LibreSpeed** | 自托管页面（`stability.html` 独立稳定性页） | 一键 | Download / Upload / Ping / Jitter；**连接稳定性测试重复测量 ping 并给出 current / average / min / max / jitter / failed request 百分比 + 实时图表 + CSV 导出**；许可证 LGPL | 实时图表 + 阈值告警 + CSV |
| **网易 UU 加速器** | 官方帮助页定义"节点"：官方原文"你和游戏服务器之间的网络连接原本没有被优化，但在选择了UU的服务并确定节点（网络传输中间站）后…意味着节点和服务器位置应尽可能离得近"；关键词含"手动选择""评分高" | 手动选点 | 「客户端 → 中间站 → 目标服务器」**两段链路**模型 | **节点评分**作为 UI 抽象；**节点测速的具体算法/频率/样本口径厂商未公开**（未找到一手来源） |

来源：[Ookla: How does Speedtest measure my network speeds?](https://www.speedtest.net/help/guides/how-does-speedtest-measure-my-network-speeds)、[Ookla Speedtest Experience Ratings](https://www.ookla.com/articles/speedtest-experience-ratings)、[fast.com](https://fast.com/)、[Cloudflare 1.1.1.1 Verify connection](https://developers.cloudflare.com/1.1.1.1/check/)、[Cloudflare 1.1.1.1 Troubleshooting DNS Resolver](https://developers.cloudflare.com/1.1.1.1/troubleshooting/)、[Cloudflare AIM](https://developers.cloudflare.com/speed/aim/index.md)、[LibreSpeed](https://raw.githubusercontent.com/librespeed/speedtest/master/README.md)、[网易 UU 如何手动选择模式或节点](https://uu.baike.163.com/zhinan/60.html)、[网易 UU 高延迟/掉线](https://uu.baike.163.com/gonglue/331.html)。

> **【推断】可抄的两点**：(1) Cloudflare AIM 是"把六项指标翻译成三类场景评分"的完整公开范式——直接对应 1.10 里"不要给裸 Mbps"；(2) 1.1.1.1/help 会显示**服务你的数据中心**，这与本文 1.7"报告命中的边缘节点"完全一致。

### 1.15 逐产品一手证据：浏览器内置与操作系统内置

| 对象 | 用户可见入口 | 一键/分步 | 测的层与技术 | 失败呈现 |
|---|---|---|---|---|
| **Chrome** | **`chrome://net-export/`** → **Start Logging To Disk** → 在另一标签复现（该标签须保持打开，否则自动停止）→ **Stop Logging** → 提交**整份**日志；启动即抓 `--log-net-log=<path>.json`；粒度 `--net-log-capture-mode=IncludeSensitive\|Everything`（默认 Strip private information）；M117+ `--net-log-max-size-mb`；M137+ `--net-log-duration`；可选 **Include raw bytes**；查看器 **netlog_viewer** | **手动会话式**（官方页明确"提交整份日志，片段通常不足以定位问题"） | 浏览器 `net/` 栈的 **NetLog JSON 事件流**（main 分支 **645 个 `EVENT_TYPE`**），覆盖 DNS / Socket-TCP / 代理-PAC / TLS / 连接作业（含超时与 IPv6 回退）/ 连接池 / HTTP 事务 / QUIC-H3 / WebSocket | 导出 JSON + netlog_viewer；`chrome://net-internals` 的 Events 视图用**红/绿/白**标记 source（`is:error` / `is:active`），事件 begin/end 成对（`+`/`-`），时间 `t`/`st` 毫秒 |
| **Edge** | `edge://net-internals` / `edge://net-export`；Microsoft Learn 官方指引 **"Use NetLog to Capture Network Activity"** | 同 Chrome | **【推断】**Edge 基于 Chromium `net/` 栈，事件类型与 Chrome 同源；Microsoft **未**单独公布 `edge://` 事件类型清单 | 同 Chrome（**【推断】**） |
| **Windows** | 网络疑难解答 / Network Reset | 分步向导 + 自动修复（**【推断】**） | **未找到一手来源**（本轮未定位到可引用的具体官方文章 URL，故不写具体行为） | **未找到一手来源**（"发现的问题"列表为二手描述） |
| **Android** | 系统设置中的互联网/门户检查；开发者侧 API | API 回调驱动 | **`ConnectivityManager`**：`registerNetworkCallback`、`registerDefaultNetworkCallback`、`requestNetwork`、`getNetworkCapabilities`、`getLinkProperties`、`getAllNetworks`、`bindProcessToNetwork`、`isActiveNetworkMetered`；常量 **`NET_CAPABILITY_VALIDATED`**、**`NET_CAPABILITY_CAPTIVE_PORTAL`**、`TRANSPORT_VPN`；**`ConnectivityDiagnosticsManager`** 提供 `ConnectivityDiagnosticsCallback` + `registerConnectivityDiagnosticsCallback(NetworkRequest, Executor, Callback)` | **无面向用户的一键自检官方 UI**；系统侧联网校验/门户检测由 ConnectivityService 驱动，对应 VALIDATED / CAPTIVE_PORTAL 两个能力位（**【推断】**）；呈现由 App 自行负责 |
| **iOS / macOS** | macOS：官方帮助 **"Use Wireless Diagnostics on your Mac"**；iOS：**未找到**面向普通用户的公开"无线诊断"界面（注意 `support.apple.com/101965` 是**硬件**诊断，**不是**网络诊断） | 分步 | **`NWPathMonitor`** 官方摘要 "An observer that you use to monitor and react to network changes."：`init()` / `init(requiredInterfaceType:)` / `init(prohibitedInterfaceTypes:)` / `start(queue:)` / `currentPath` / `pathUpdateHandler` / `cancel()`；**`NWPath`**：`status` + `NWPath.Status`、`usesInterfaceType(_:)`、`availableInterfaces`、`gateways`、`supportsIPv4`、`supportsIPv6` | 无统一 UI；由 App 呈现；事件驱动（观察者模式） |

来源：[How to capture a NetLog dump（chromium.org）](https://new.chromium.org/for-testers/providing-network-details/)、[NetLog 事件类型源码](https://chromium.googlesource.com/chromium/src/+/main/net/log/net_log_event_type_list.h)、[NetLog 设计文档](https://chromium.googlesource.com/chromium/src/+/main/net/docs/net-log.md)、[crash-course-in-net-internals](https://chromium.googlesource.com/chromium/src/+/main/net/docs/crash-course-in-net-internals.md)、[netlog_viewer](https://netlog-viewer.appspot.com/)、[Microsoft Learn: Use NetLog to Capture Network Activity](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/use-netlog-capture-network-traffic)、[Android ConnectivityManager](https://developer.android.com/reference/android/net/ConnectivityManager)、[Android ConnectivityDiagnosticsManager](https://developer.android.com/reference/android/net/ConnectivityDiagnosticsManager)、[Android 连通性状态指南](https://developer.android.com/training/monitoring-device-state/connectivity-status-type)、[Apple NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor)、[Apple NWPath](https://developer.apple.com/documentation/network/nwpath)、[Apple：Use Wireless Diagnostics on your Mac](https://support.apple.com/guide/mac-help/mchlf4de377f/mac)。

> **【推断】三类对象的定位差异**："浏览器内置是**事件流录制器**（供离线分析），OS 内置是**路径/能力观察者**（零成本、判断有没有网/是否计费/是否门户），测速工具才是**吞吐测量器**"。做 App 自检时，前两者是"免费的 L0 层信息源"，不应重复造。

### 1.16 逐产品一手证据：云 / 开发者工具与游戏

#### 1.16.1 云厂商的共同结构（可直接映射到 App）

三家云的网络诊断都呈现**三分结构**，且结论强绑定"具体哪个组件/规则"：

| 类型 | 代表产品（官方一手） |
|---|---|
| **配置推演（静态）** | AWS **VPC Reachability Analyzer** 自述为 "a configuration analysis tool"，可达时产出**逐跳**虚拟网络路径（[官方](https://docs.aws.amazon.com/vpc/latest/reachability/what-is-reachability-analyzer.html)）；Azure **Connection troubleshoot / IP flow verify / Next hop** 检查 NSG/UDR/端口并给出根因、延迟、拓扑（[官方](https://learn.microsoft.com/en-us/azure/network-watcher/connection-troubleshoot-overview)、[IP flow verify](https://learn.microsoft.com/en-us/azure/network-watcher/ip-flow-verify-overview)）；GCP **Connectivity Tests** 原文 "analyzes your configuration and, **in some cases, performs live data plane analysis** between the endpoints"（[官方](https://docs.cloud.google.com/network-intelligence-center/docs/connectivity-tests/concepts/overview)） |
| **数据面探测（动态）** | AWS **Network Synthetic Monitor / Internet Monitor**（[官方](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/what-is-network-monitor.md)）；Azure **Connection monitor**（[官方](https://learn.microsoft.com/en-us/azure/network-watcher/connection-monitor-overview)）；GCP **Performance Dashboard**（[官方](https://docs.cloud.google.com/network-intelligence-center/docs/performance-dashboard/concepts/overview)） |
| **历史流日志** | AWS **VPC Flow Logs**；Azure **VNet flow logs**（NSG flow logs 将于 **2027-09-30 退役**，[官方](https://learn.microsoft.com/en-us/azure/network-watcher/vnet-flow-logs-overview)）；GCP **vpcFlowLogsConfigs**（[官方](https://docs.cloud.google.com/network-intelligence-center/docs/reference/networkmanagement/rest)） |

**外部互联网态势**（回答"是不是只有我连不上"）：Cloudflare **Radar** 的 **Outage Center** 给出 **Location、ASN、Type（国家级/次国家级/单运营商）、Scope、Cause（政府关停/极端天气/断缆/断电/过滤封锁）、Start time、End time**（[官方](https://developers.cloudflare.com/radar/investigate/outages/index.md)）；Radar API 基址 `https://api.cloudflare.com/client/v4/radar/`，认证为 **Cloudflare API Token（Account > Radar，Read）**，请求头 `Authorization: Bearer <API_TOKEN>`（[官方](https://developers.cloudflare.com/radar/get-started/first-request/)）。聚合粒度为 `15m / 1h / 1d / 1w`，并带 confidence/normalization 元数据（[官方](https://developers.cloudflare.com/radar/concepts/aggregation-intervals/index.md)）。另有 AWS CloudWatch **Internet Monitor**（按 client location / ASN 建基线）。

> **【推断】App 侧的三层映射**：① **本地配置自检**（代理/DNS/证书/权限，零网络请求）② **主动探测**（DNS/TCP/TLS/HTTP 分阶段，返回每阶段耗时与错误码）③ **滚动诊断快照**（最近 N 分钟请求样本，ring buffer 式）。这与云的"配置推演 / 数据面探测 / 历史日志"一一对应。
>
> **【推断】安全红线**：Radar 等外部态势 API 的 **token 绝不能进客户端**（会等于把全局凭证分发给所有用户），必须由 App 后端代理——这与本仓库"access_token 仅 Java 堆中、JS 零知"是同一条原则。此外，任何趋势展示都要带上**聚合粒度 + 置信度/样本量**，避免用 15 分钟粒度数据对一周趋势下结论。

#### 1.16.2 游戏网络诊断

| 对象 | 已核实内容 |
|---|---|
| **Xbox (GDK)** | 提供 `XNetworkingQueryStatistics`，官方描述原文 "Retrieves the specified networking statistics into a caller provided buffer."（[官方](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/networking/xnetworking/functions/xnetworkingquerystatistics)） |
| **Steam** | 官方 Steamworks 文档存在 **Steam Datagram Relay (SDR)** 页面（Valve 自建中继网络）（[官方](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay)） |
| **Riot / Blizzard** | Riot **Repair Tool (RRT)** 与 League of Legends 网络日志文章、Blizzard 支持文章 14595 的 URL 均可达，但正文为 JS 渲染，**未能逐字核验采集项**（[Riot RRT](https://support.riotgames.com/hc/en-us/articles/4411635282195)、[Riot 网络/系统/日志](https://support.riotgames.com/hc/en-us/articles/201752674)、[Blizzard 14595](https://us.support.blizzard.com/article/14595)） |
| **网易 UU 加速器** | 「客户端 → 中间站 → 目标服务器」两段链路模型 + 节点评分（见 1.14） |
| **指标框架** | 网络性能指标的标准定义见 [RFC 3148](https://www.rfc-editor.org/rfc/rfc3148.html)；M-Lab NDT 官方页原文 "NDT reports upload and download speeds and latency metrics" 并引用该 RFC（[官方](https://www.measurementlab.net/tests/ndt/)） |
| **未找到一手来源** | Riot/Blizzard/Valve 关于 tick rate / netcode / peekers advantage 的官方技术文档；PlayStation 官方连接测试页；Steam「下载区域」说明；加速器节点测速的具体算法/频率/样本口径；Blizzard **Looking Glass**（官方域名疑似下线，论坛讨论非一手来源） |

> **【推断】游戏诊断与通用 App 诊断的差异不在"测什么"（RTT / 抖动 / 丢包共通），而在"测到哪"**：游戏必须测"到目标游戏服务器 / 加速节点"的路径，而不是公共测速点。因此 **多目标 + 每目标独立 RTT/loss 采样** 是游戏型诊断的必备结构。
>
> **对应 Pictelio（【推断】）**：这正是本文 4.1 的结论——必须**按业务域分别探测**（Pixiv API 域 / pximg 图片域 / 镜像站 / OAuth），而不是只测一个公共端点。

### 1.17 最小可行清单（**【推断】**）

基于上述与产品证据，若只能做 5 项，优先级为：

1. 本机网络类型 + 是否 validated/captive（零成本，直接分流"不是你的网"）
2. DNS 解析（含"系统解析器 vs DoH"对照，识别污染）
3. TCP connect 443（识别"能解析、连不上"）
4. TLS 握手（识别 SNI 阻断 / 证书问题）
5. 一次带鉴权的真实 API 调用（识别 401/429/5xx 与"网络"的区别）

吞吐（1.10）应作为**可选、显式触发**的一项——它是唯一真正消耗用户流量的检查。


---

## 二、交互与呈现范式

拆成两条正交的轴：**触发模型**（一键 / 向导 / 后台自动）与**结果呈现**（实时进度 / 逐项状态 / 日志 / 报告）。业界产品基本都落在"一键触发 + 分层呈现"这个组合上。

### 2.1 一键式 vs 分步向导

| 范式 | 适用场景 | 一手证据 |
|---|---|---|
| **一键式** | 用户只想知道"能不能用"；系统级工具常用 | Apple 系统内置的 **Network Responsiveness**（Wi-Fi 响应性）测试即为一个系统级"跑一次给结论"的入口：[官方支持文档](https://support.apple.com/en-us/101942)。LibreSpeed 的主测速页也是一键触发下载/上传/延迟全套：[源码一手](https://github.com/librespeed/speedtest)。 |
| **序列化测量** | 需要控制"测什么、按什么顺序、各测多久" | `@cloudflare/speedtest` 用配置项 `measurements` 显式定义测量序列（README 的 Measurement Config），而不是把顺序写死在代码里；所以"分步"可以只是**引擎的配置**，UI 仍是一键：[源码一手](https://github.com/cloudflare/speedtest)。 |
| **按需捕获事件流** | 面向支持人员的深度排障 | Chrome 的 `chrome://net-export` 让用户手动开始/停止捕获，导出一段 NetLog 事件流：[How to capture a NetLog dump](https://new.chromium.org/for-testers/providing-network-details/)。 |

> **【推断】Pictelio 的推荐组合**：入口一键跑完最小 5 项（见 1.12），但**每一项都是独立的、可单独重跑的节点**。这样既不逼用户点 5 次，又能在改完代理/换 Wi-Fi 后只重测相关那层。

### 2.2 实时进度与逐项状态

- **实时曲线 + 聚合数值**是成熟做法：LibreSpeed 的 stability 测试 "repeatedly measures ping... with a live chart"，并同时给出 current / average / minimum / maximum / jitter / failed request percentage（[源码一手](https://github.com/librespeed/speedtest)）。
- 测速类产品普遍同时展示"瞬时值（实时进度）"与"最终值（结论）"，因为用户会盯着进度等待。
- **【推断】状态机建议**：每项固定五态 `pending → running → ok | warn | fail`，外加一等状态 `skipped`（例：系统无 VPN 时"代理可达性"应显示"不适用"而不是绿色——绿色的"不适用"是谎言）。

### 2.3 逐项红 / 黄 / 绿

- **产品实例**：Chrome `chrome://net-internals` 的 Events 视图用**红 / 绿 / 白**标记 source——红色=带负值 `net_error`（`is:error`）、白色=未结束（`is:active`）、其余绿色（[**源码一手** crash-course-in-net-internals](https://chromium.googlesource.com/chromium/src/+/main/net/docs/crash-course-in-net-internals.md)）；Discord 的**错误码表**本身即"分项状态"（每个码带成因与修复，见 1.12）；Netflix fast.com 用 Unloaded/Loaded 两个延迟值 + 画质建议表达"好/坏"（见 1.13）。Windows 疑难解答的"发现的问题"具体呈现**未找到一手来源**。
- **【推断】两条硬规则**：
  1. 颜色必须绑定**可操作阈值**，阈值要写在文案里（"延迟 850ms 偏高"而不是只变色）；
  2. **"慢"（warn）与"坏"（fail）必须分开**。把 200ms 延迟标红会训练用户忽略红色。

### 2.4 错误码与原始日志折叠

- **分层事件 + 整数错误码**是最值得抄的信息架构。Chromium 的 NetLog 事件清单头文件开头就写："In the event of a failure, many end events will have a `|net_error|` parameter with the integer error code associated with the failure. Most of these parameters are not individually documented."（[源码一手 net_log_event_type_list.h](https://chromium.googlesource.com/chromium/src/+/main/net/log/net_log_event_type_list.h)）——注意它同时承认"错误码并非逐个有文档"，所以**面向用户的层不能直接暴露错误码**。
- **折叠策略**：默认只给"人话结论 + 建议"，展开才给原始错误码/事件/时间线。Chrome 是"导出一个 JSON 文件交给支持人员"这条路线的范例（[官方文档](https://support.google.com/chrome/a/answer/6271171)）。
- **【推断】Pictelio 可复用**：`ApiErrorType`（`packages/app/src/api/types.ts:239`）做人话层，把原始 `error` 对象 / HTTP 状态 / `net_error` 放进折叠区；而 `ErrorDisplay.tsx` 已经在做"按类型渲染可操作提示"（`actionableHint`/`actionableLabel`）。

### 2.5 复制 / 导出诊断报告

- 一手范例：Chrome NetLog 导出（[官方](https://new.chromium.org/for-testers/providing-network-details/)）。
- **【推断】报告最小字段集**（同时满足"支持人员有用"与"不泄露隐私"）：时间戳、客户端引擎（webview/lynx）、App 版本、WebView/Lynx 版本、Android 版本与机型、网络类型（Wi-Fi/蜂窝/VPN）、各层结果与耗时、所选路由（SYSTEM vs PINNED(通道, IP)）、熔断器状态。**绝不含** access_token / refresh_token / Cookie / 完整 Authorization 头（Pictelio 的 token 仅存在于 Java 堆、JS 零知，见 ADR-0037，天然满足这条）。

### 2.6 分项重测

- **【推断】**：重测的价值场景几乎都是"用户刚改变了某个前提"（开了代理、换了 Wi-Fi、关了 VPN）。因此重测的最小单位应是**单层**或**从失败层往下重跑**，而不是全量重跑——全量重跑在弱网下会叠加流量与等待。

### 2.7 自动修复建议

- **产品实例**：Discord 每个错误码配"发生了什么 + 怎么修"（见 1.12）；Slack 分步修复 + 引导网络管理员放行 WS 域名（见 1.12）；Telegram 提供代理 **Check Status**（见 1.12）。云侧的做法更强：Azure **IP flow verify** 会给出**命中的具体 NSG / VNet Manager 规则名**（[官方](https://learn.microsoft.com/en-us/azure/network-watcher/ip-flow-verify-overview)），AWS Reachability Analyzer 给出**阻塞组件**（见 1.16）。Windows 网络疑难解答的自动修复**未找到一手来源**。
- **【推断】建议必须按"谁能修"分类**：
  1. **App 可自动**（清 DNS 缓存、重试另一条路由、切换直连开关）；
  2. **需用户操作**（打开代理软件、重连 Wi-Fi、跳系统设置页）——可用 Android 的 Settings Intent 直达；
  3. **谁都修不了**（服务端 5xx / CDN 回源失败）→ 只能诚实告知并给状态页/重试时间，**不要建议"检查你的网络"**。

### 2.8 "不打扰"原则

- **【推断】** 自检不应在启动或每次报错时自动全量运行。业界的退避语义可参照 [RFC 9110 `Retry-After`](https://www.rfc-editor.org/rfc/rfc9110.html) 与 [RFC 8305](https://www.rfc-editor.org/rfc/rfc8305.txt) 的"并行尝试但收敛"思想；Pictelio 侧已有可复用的失败收敛机制：`ChannelCircuitBreaker` 的"连续 3 次失败 → OPEN → 60s 冷却"（ADR-0144，[OpenWiki 直连文档](/openwiki/architecture/direct-access.md)）。

### 2.9 归因：把"你的问题 / 我们的问题"分开（产品证据）

这是"做得好"与"做得差"最显著的分水岭。有据可查的产品做法：

| 产品 | 归因做法 | 来源 |
|---|---|---|
| **Discord** | Voice Connection Errors 明确把错误分成 "something on your end" 与 "Errors from Our Side"；错误态 **Waiting for Voice Server** 直接让用户查 **discordstatus.com**；Troubleshooting Guide 写 "Check if Discord is down using our Status page" | [Voice Connection Errors](https://support.discord.com/hc/en-us/articles/115001310031-Voice-Connection-Errors)、[Discord Status](https://discordstatus.com/)、[Troubleshooting Guide](https://support.discord.com/hc/en-us/articles/31623498041623-Discord-Troubleshooting-Guide) |
| **Slack** | 四类故障中的 **Server error** 明确指向 Slack 状态页；状态页按功能维度（含 Connectivity）给出多维状态 | [Troubleshoot connection issues](https://slack.com/help/articles/205138367-Troubleshoot-connection-issues)、[Slack System Status](https://status.slack.com/) |
| **Netflix** | 独立的 **Is Netflix Down?** 页面 | [Is Netflix Down?](https://help.netflix.com/en/is-netflix-down) |

**未找到一手来源**：YouTube、Spotify、Telegram、微信（消费端）的官方状态页/归因文案。

> **【推断】** Discord/Slack 的做法说明：好的自检不是"告诉你网断了"，而是**先在本地层证伪，再把剩余可能性交给状态页**。Pictelio 若要达到同等水平，至少需要：(a) 分层结论（见第一节）；(b) 一个"服务端是否异常"的判定或入口（可用响应头/状态码 + 状态页链接近似实现，参考 1.7）。

### 2.10 一键 vs 分步：产品做法汇总

| 产品 | 触发模型 | 结果呈现 | 来源 |
|---|---|---|---|
| Discord | 分步向导（帮助文章）+ 单点工具（Mic Test / Reset / Debug Log 上传）；**未找到**一键全网自检 | 具名错误码 + 逐码修复 | [Voice/Video 排障指南](https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide)、[Audio/Video Error Codes](https://support.discord.com/hc/en-us/articles/30952914470807-Discord-Audio-and-Video-Error-Codes-Troubleshooting-Guide) |
| Slack | 分步向导（Step 1/2/3）+ **一键连接测试 `slack.com/help/test`** | 错误横幅 + **net log zip**（一次会话 start→复现→stop） | [Troubleshoot connection issues](https://slack.com/help/articles/205138367-Troubleshoot-connection-issues) |
| Telegram | 常驻状态指示（Waiting for network… / Connecting… / **Ping: %d ms**）+ 单点 Check Status | 状态文案 + 可发送日志 | [strings.xml](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/res/values/strings.xml) |
| YouTube | 分步（播放器面板 **Stats for nerds**） | 技术信息面板 + **Copy debug info** | [Send YouTube debug info](https://support.google.com/youtube/answer/7519898) |
| Netflix | **一键**（fast.com 自动开始）+ 单点 Check your Network | 速度结果 + 建议画质 + Is Netflix Down? | [fast.com](https://fast.com/)、[Netflix recommended speeds](https://help.netflix.com/en/node/306) |
| Chrome | 手动捕获（`chrome://net-export`） | 导出 NetLog JSON 交给支持人员 | [How to capture a NetLog dump](https://new.chromium.org/for-testers/providing-network-details/) |

> **【推断】结论**：成熟产品几乎都是**"一键给结论 + 分步给原因"的混合**——纯一键（不给证据）与纯向导（逼用户点 6 次）都少见。对应到 Pictelio：入口一键跑完最小集，但每个失败项都能展开到"证据 + 分步修复"，并提供一次会话式日志导出。


---

## 三、移动端特殊约束

### 3.1 Android 权限

- `INTERNET` 与 `ACCESS_NETWORK_STATE` 属于安装时自动授予的 **normal 权限**（无运行时弹窗）：[权限总览（protection levels）](https://developer.android.com/guide/topics/permissions/overview#protection-levels)、[Manifest.permission 参考](https://developer.android.com/reference/android/Manifest.permission#ACCESS_NETWORK_STATE)。
  - **易踩的坑**：只想"检测网络状态"而没声明 `ACCESS_NETWORK_STATE`，`ConnectivityManager` 的状态查询会直接失败——"网络类型"这一层从第一步就测不了。
- 要读 **Wi-Fi 名（SSID/BSSID）** 需要位置权限；Android 13+ 起为 Wi-Fi 相关 API 引入了 `NEARBY_WIFI_DEVICES`（[官方 Wi-Fi permissions 文档](https://developer.android.com/develop/connectivity/wifi/wifi-permissions)）。
  - **【推断】建议从设计上绕开**：诊断报告只报 `TRANSPORT_*` 与 `NET_CAPABILITY_*`（不需要任何敏感权限），**不显示 SSID/BSSID**。少一个权限弹窗，少一类隐私问题。
- Pictelio 现状：Android 清单已声明 `INTERNET`（图片/API 必需）；如需网络类型判定，须确认是否已声明 `ACCESS_NETWORK_STATE`（**待核对**，本文未逐字核对 `packages/app/android/app/src/main/AndroidManifest.xml`）。
- **Android「本地网络访问」权限是按 targetSdk 分档的（【有据可查】）**：[官方 Local network permission 页](https://developer.android.com/privacy-and-security/local-network-permission) 原文——**Android 16（targetSdk 36）为 opt-in**（用 `adb shell am compat enable RESTRICT_LOCAL_NETWORK <package>` 开启后生效，权限由 `NEARBY_WIFI_DEVICES` 承担）；**Android 17（targetSdk 37+）强制**（"Local network is blocked by default for all apps that update their target SDK"，新权限 `ACCESS_LOCAL_NETWORK` 属 `NEARBY_DEVICES` 组）；**targetSdk ≤ 36 时 "local network access is implicitly granted using the INTERNET permission"，不应声明该权限**。
  - 受影响操作：outgoing TCP **要**权限；accepting incoming TCP **不要**；sending UDP unicast/multicast/broadcast **都要**；connecting a UDP socket **要**；receiving incoming UDP unicast **不要**；receiving incoming UDP multicast/broadcast **要**（同页）。
  - **【推断】** 只打公网端点的网络自检**完全不该触碰**这条路径；一旦引入局域网/mDNS 探测，就要为 API 37 的两条路径（隐私保护选择器 `NsdManager` 的 `FLAG_SHOW_PICKER`，或运行时申请 `ACCESS_LOCAL_NETWORK`）做准备。
- 局域网组播的另一个坑：`CHANGE_WIFI_MULTICAST_STATE` 是 normal 权限，但**还必须在运行期持有 `WifiManager.MulticastLock`**，否则系统会过滤掉组播/广播包——漏掉会表现为"组播探测 0 结果"而非异常（[Manifest.permission](https://developer.android.com/reference/android/Manifest.permission)）。

### 3.2 iOS 权限（对姊妹客户端/未来平台有参考价值）

- `NWPathMonitor` 本身不需要额外权限（[Apple 文档](https://developer.apple.com/documentation/network/nwpathmonitor)）。
- 但只要诊断去探测**局域网**（网关、局域网设备、mDNS/Bonjour），iOS 14+ 需要 Local Network 权限，且必须在 Info.plist 提供 `NSLocalNetworkUsageDescription` 说明用途（[Apple 文档](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription)）；官方技术说明见 [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。
  - **【推断】**：Pictelio 的网络自检**不应**探局域网（它只关心广域网上的 Pixiv），这样可完全避免这个权限与弹窗。
- App Transport Security（ATS）默认阻止明文 HTTP（[NSAppTransportSecurity](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity)）——若诊断想探测明文端口，必须注意这一点；也不要为了"好测"而开 ATS 例外（审核与安全风险）。

### 3.3 隐私合规（"收集 IP / 网络信息"）

- **IP 地址在 GDPR 下被视为与可识别自然人有关的数据**：Article 29 Working Party（EDPB 前身）**Opinion 4/2007 on the concept of personal data（WP 136）Example No. 15: dynamic IP addresses** 原文："The Working Party has considered IP addresses as data relating to an identifiable person. It has stated that 'Internet access providers and managers of local area networks can, using reasonable means, identify Internet users to whom they have attributed IP addresses ... In these cases there is no doubt about the fact that one can talk about personal data...'"（[**官方一手** WP 136 PDF](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2007/wp136_en.pdf)）。
  - **核验限制**：[GDPR 正文（EUR-Lex）](https://eur-lex.europa.eu/eli/reg/2016/679/oj) 对自动化抓取返回 **HTTP 202 JS 挑战空壳**，EDPB 站点返回 **403**——GDPR 条文编号（Article 4(1) / Recital 30）本文**未逐字核验**；但上述 WP29 原文已足以支撑"IP 属个人数据"的工程结论。**本文不提供法律结论**，具体适用需法务确认。
- **CCPA/CPRA 明文点名 IP**：Cal. Civ. Code **§1798.140(v)(1)(A)** 把 "online identifier, **Internet Protocol address**" 列入 "Personal information"；**§1798.140(aj)** 的 "Unique identifier / unique personal identifier" 定义亦 "including, but not limited to, a device identifier; an **Internet Protocol address**"（[**官方一手** 加州立法信息库](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140)、[加州总检察长 CCPA 页](https://oag.ca.gov/privacy/ccpa)）。
- **商店披露义务（对"网络自检"几乎必然适用）**：
  - Google Play **Data safety**（[官方帮助](https://support.google.com/googleplay/android-developer/answer/10787469)）：官方定义 "**Collect** means transmitting data from your app off a user's device"，**包括第三方库/SDK 的传输**；类别中含有 **App info and performance > Diagnostics**（原文列举 "battery life, loading time, latency, framerate, or any technical diagnostics"）与 **Device or other IDs**。只有在内存中即用即删的 "**Ephemeral processing**" 才可不展示在 Data safety 区块（表单仍需填）。另有 [User Data policy](https://support.google.com/googleplay/android-developer/answer/9888076)：禁止把持久设备标识（IMEI/IMSI/SIM Serial）与个人/敏感数据或可重置标识关联。
  - Apple **App Privacy Details**（[官方](https://developer.apple.com/app-store/app-privacy-details/)）：类别含 **Diagnostics > Crash Data / Performance Data / Other Diagnostic Data**；官方对 IP 的原文是 "You collect and store **IP address** from your users. **Declare the relevant data types based on how you use IP address**, such as precise location, coarse location, device ID, or diagnostics."
  - **【推断】** 结论：**吞吐/延迟/丢包数据在两家商店都落在 Diagnostics 类，必须申报；若 IP 被用于推断位置，还会同时命中 Location / Device ID。** 最稳的做法是只上传聚合指标、不落原始 IP。
- **中国《个人信息保护法》** 的官方文本在 [npc.gov.cn](http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)；**【推断】** 具体适用条款应由法务确认，本文未下结论。CCPA/CPRA 的官方口径见 [加州总检察长站点](https://oag.ca.gov/privacy/ccpa) 与 [Cal. Civ. Code §1798.140](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140)。
- **反面教材警示**：`@cloudflare/speedtest` README 明确 "measurement results are collected by Cloudflare on completion"（[源码一手](https://github.com/cloudflare/speedtest)）——如果为了省事直接引入，等于把用户网络测量结果交给第三方；M-Lab NDT 也会把测量数据（含 IP）数据集化，使用其公共设施**必须链接其[隐私声明](https://www.measurementlab.net/privacy/)**。

### 3.4 后台执行

- Android 8.0（API 26）起施加强制性**后台执行限制**：[官方文档 Background Execution Limits](https://developer.android.com/about/versions/oreo/background)。
- Doze 与 App Standby 会在设备空闲时推迟/暂停后台网络与任务：[官方文档 Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)。
- Android 14+ 使用前台服务必须声明**类型**（`dataSync` / `shortService` 等）：[官方文档 Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)。
- iOS 的后台任务由 `BGTaskScheduler` 调度，**执行时机由系统决定**：[Apple BackgroundTasks](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler)。
- **【推断】结论**：**网络自检必须是前台行为**。后台最多做"轻量、可随时被打断、失败即放弃"的探测；不要设计后台长测速。
- **Doze 会整体挂起网络**（【有据可查】）：设备不充电、屏幕关闭且长时间静止时进入 Doze，官方限制清单含 **Suspends network access**、**Doesn't perform Wi-Fi scans**，且 **不让 JobScheduler 运行——官方注明 "WorkManager uses JobScheduler internally, so WorkManager tasks don't run"**；系统周期性进入 **maintenance window** 才恢复网络与挂起任务（频率随时间降低）（[官方](https://developer.android.com/training/monitoring-device-state/doze-standby)）。
  - **【推断】** 自检应把"设备处于 Doze / 等待维护窗口"作为一种**原因显示**，而不是当成失败。
- **App Standby Buckets**（Android 9+）：Active / Working set / Frequent / Rare / **Restricted**（Android 12+）；桶决定 job 与 alarm 的频率，**仅在电池供电时生效（充电不受限）**，且 Restricted 桶下系统还"limits the app's ability to connect to the internet"；可用 `UsageStatsManager.getAppStandbyBucket()` 查询（[官方](https://developer.android.com/topic/performance/appstandby)）。**【推断】** 诊断报告可附带 bucket，对"被分到 Rare/Restricted"给出提示。
- **前台服务有硬性时限**（Android 14+ 必须声明 `foregroundServiceType`）：`shortService` **约 3 分钟**上限、不支持 sticky、超时后 `Service.onTimeout()` 并很快 ANR；`dataSync` 无运行时前置条件，但 **Android 15（targetSdk 35+）起 24 小时内累计只允许 6 小时**，超时调用 `Service.onTimeout(int,int)`，须在几秒内 `stopSelf()`，否则抛 `RemoteServiceException`；6 小时额度对 `dataSync` 与 `mediaProcessing` **分别统计**，用户把 App 带回前台会重置计时（[前台服务类型](https://developer.android.com/about/versions/14/changes/fgs-types-required)、[超时行为](https://developer.android.com/develop/background-work/services/fgs/timeout)）。**注意：Doze 下连 `dataSync` 前台服务也不保证有网。**
- **iOS 后台**：`BGAppRefreshTask`（"a short task typically used to refresh content"）与 `BGProcessingTask`（长任务，可声明 external power / network connectivity）；identifier 必须写进 Info.plist 的 `BGTaskSchedulerPermittedIdentifiers`，实际执行时机由系统决定（[BackgroundTasks](https://developer.apple.com/documentation/backgroundtasks)、[BGProcessingTask](https://developer.apple.com/documentation/backgroundtasks/bgprocessingtask)）。**Apple 官方文档未给出 app refresh 的固定秒数**——常被引用的"约 30 秒"在官方文档中**未见明文**（**【推断】**），不要按固定秒数设计，用 `task.expirationHandler` 收尾。
- **iOS Low Power Mode**：`ProcessInfo.isLowPowerModeEnabled` 为只读；低电量模式会 "Pausing discretionary and background activities" 等（[官方](https://developer.apple.com/documentation/foundation/processinfo/islowpowermodeenabled)）。**【推断】** 进入低电量模式时应降低测速频率，并在结果上标注"设备处于低电量模式，结果可能偏低"。

### 3.5 耗电与流量

- **计费网络判定**：`NetworkCapabilities` 提供 `NET_CAPABILITY_NOT_METERED`（另有 `isActiveNetworkMetered`）；官方有 [Data Saver 指南](https://developer.android.com/develop/connectivity/network-ops/data-saver) 与 [省电指南](https://developer.android.com/develop/connectivity/preserving-battery)。**【推断】计费网络下默认不跑吞吐测速。**
- **【推断】** 吞吐测试是自检中唯一显著消耗流量的项；在蜂窝网络下应默认关闭或先询问，并给出"约消耗 XX MB / 持续 XX 秒"的预估。
- **【推断】** 不要用定时 ping 轮询网络状态——用事件式 API（Android `NetworkCallback`、Apple `NWPathMonitor`），否则诊断自己就是耗电源。

### 3.6 弱网下不要雪上加霜

- **退避的官方机制**：Android `WorkManager` 的重试退避策略（[BackoffPolicy](https://developer.android.com/reference/androidx/work/BackoffPolicy)：默认 **EXPONENTIAL**，初始延迟默认 **30 秒**）、`JobInfo.Builder#setBackoffCriteria`（[官方](https://developer.android.com/reference/android/app/job/JobInfo.Builder)）；HTTP 层的 `Retry-After`（[RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)）与 429（[RFC 6585 §4](https://www.rfc-editor.org/rfc/rfc6585.html)）。
  - **易错点**：**不要把业务层的 "ExoPlayer 退避" 当成指数退避**——Media3 默认是线性 1s 递增、5s 封顶（见 3.8）。诊断应显式选择退避策略并与业务共享同一状态机。
- **【推断】Pictelio 的关键点**：诊断与业务必须**共享同一套退避/熔断状态**，否则会出现"业务已在退避、诊断在猛打同一个域"的自相矛盾。Pictelio 已有现成机制：`ChannelCircuitBreaker` 的"连续 3 次失败 → OPEN → 60s 冷却 → 单探针半开"（ADR-0144，[OpenWiki 直连文档](/openwiki/architecture/direct-access.md)）。

### 3.7 移动端没有 ICMP（重申）

- 见 1.3 与 4.10：移动端以 DNS 查询 RTT / TCP connect RTT / HTTP RTT 替代 ICMP；任何"ping 一下"的需求都要重新表述为"connect 一下"。
- 一手来源：[OpenJDK `InetAddress.isReachable()` 源码](https://raw.githubusercontent.com/openjdk/jdk/jdk-11%2B28/src/java.base/share/classes/java/net/InetAddress.java)（"ICMP ECHO REQUESTs **if the privilege can be obtained**, otherwise it will try to establish a TCP connection on port 7 (Echo)"）。

### 3.8 易错点：ExoPlayer 默认不是指数退避

- **有据可查**：Media3/ExoPlayer 的默认 `DefaultLoadErrorHandlingPolicy` 源码为 `return isAnyCauseNonRetriable(loadErrorInfo.exception) ? C.TIME_UNSET : min((loadErrorInfo.errorCount - 1) * 1000, 5000);`——即**线性退避（每次 +1s）、上限 5 秒**，常量为 `DEFAULT_MIN_LOADABLE_RETRY_COUNT = 3`（[源码原文](https://raw.githubusercontent.com/androidx/media/main/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/upstream/DefaultLoadErrorHandlingPolicy.java)、[接口文档](https://developer.android.com/reference/androidx/media3/exoplayer/upstream/LoadErrorHandlingPolicy)）。
- 要指数退避必须自行实现。**别把"用了 ExoPlayer 的退避"当指数退避。**
- **【推断】弱网放大的机理**：超时变多 → 重试变多 → 拥塞加剧。正确做法是给诊断会话设定**总流量 + 总时长预算**，预算耗尽即出结论。
- **证据强度声明**：`developer.android.com` 与 `developer.apple.com/documentation` 正文为 JS 渲染，部分条目仅核实了 URL 可达与 API 名称存在，方法签名/行为**未逐字核验**。

---

## 四、常见失败模式 / 反模式

### 4.1 只测一个域名 / 一个 IP

**反模式**：诊断只 GET 一个 URL，成功即宣布"网络正常"，但用户其实打不开图片。

**一手依据**：[RFC 8305](https://www.rfc-editor.org/rfc/rfc8305.txt) 开篇即指出 "Since specific addresses or address families (IPv4 or IPv6) may be blocked, broken, or sub-optimal on a network, clients that attempt multiple connections in parallel have a chance of establishing a connection more quickly."——**"某个特定地址/协议族被阻断"是常态，不是异常**。

**Pictelio 的具体风险**：官方 API 与图片 CDN 是**不同主机、不同边缘 IP**——ADR-0144 明确 pin 了两个 vhost 专用边缘：`210.140.139.131`（pximg 图片）与 `210.140.139.155`（pixiv.net API+OAuth）。只测 API 域，会把"图片域被阻断"误报为"网络正常"。正确做法是**按业务域分别探测**（API / pximg / 镜像站 / OAuth）。

### 4.2 把服务端故障归因给用户

**反模式**：拿 502/503/回源失败当"网络连接异常，请检查网络"，让用户白折腾路由器。

**依据与做法**：只有**按层切分**才能区分。业界的"服务端是否在出事"参照是全局可用性数据（如 Cloudflare Radar，[官方一手](https://developers.cloudflare.com/radar/)）；Pictelio 直连文档里也把"路由到错误边缘"与"被阻断"分开处理，并把 **421 Misdirected Request** 归为传输失败而非用户网络问题（[OpenWiki 直连文档](/openwiki/architecture/direct-access.md)）。

**应做**：结论里显式区分"你的网络到边缘不通" vs "边缘可达但服务端返回 5xx"；后者应给状态页/重试建议（参考 2.9 的 Discord/Slack/Netflix 做法）。

### 4.3 过度技术化

**反模式**：把 `ERR_CONNECTION_TIMED_OUT` / `net_error -118` / `SSLHandshakeException` 直接甩给普通用户。

**一手依据**：Chromium 自己的事件清单头文件就承认 "Most of these parameters are not individually documented."（[源码一手](https://chromium.googlesource.com/chromium/src/+/main/net/log/net_log_event_type_list.h)）。连 Chrome 都不逐个文档化错误码，普通 App 更不该把它们当用户文案。

**应做**：人话层（`ApiErrorType` → `ErrorDisplay` 的 `actionableHint`）+ 折叠的原始层（见 2.4）。

### 4.4 缓存 / CDN 造成假阳性

**反模式一（客户端缓存）**：探测 URL 命中 HTTP/浏览器/CDN 边缘缓存，第二次自检"全绿"。**应做**：探测 URL 带随机查询串 + 响应 `Cache-Control: no-store`；测速使用专用端点（`@cloudflare/speedtest` 的 `__down`/`__up`、LibreSpeed 自建后端）。

**反模式二（解析/路由缓存）**：Pictelio 的直连 IP 表是**三层合并**（manual > remote > builtin，`IpTableMerger.java`）。若 remote 层拿到的是过期边缘 IP，诊断会"看起来可达"却实际路由到错误边缘（ADR-0144 指出错误边缘返回 421）。**应做**：诊断必须报告**当前实际使用的路由与 IP 及其来源**，而不是只报"通/不通"。

**反模式三（跨域计时缺失）**：浏览器 `PerformanceResourceTiming` 对跨域资源默认只暴露部分字段（需 `Timing-Allow-Origin`），把"字段缺失"当成"耗时为 0"会得出荒谬结论（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)）。

### 4.5 弱网下雪上加霜

**反模式**：自检本身做全量重试，与业务请求的重试叠加；或在弱网下默认跑吞吐测试，把一个"慢"变成"卡死 + 耗流量"。

**依据**：[`Retry-After`（RFC 9110）](https://www.rfc-editor.org/rfc/rfc9110.html) 定义服务端要求客户端等待多久；[RFC 8305](https://www.rfc-editor.org/rfc/rfc8305.txt) 的并行尝试目的是**更快收敛**，不是更多流量。

**应做**：诊断内部串行化 + 项级超时 + 总超时；吞吐项默认关闭、显式同意才跑；复用 `ChannelCircuitBreaker` 的"连续失败即停 + 冷却"思想（ADR-0144）。

### 4.6 把鉴权 / 限流当网络故障

**反模式**：401 → "网络不可用"；429 → "网络不稳定"（然后疯狂重试，触发更严厉限流）。

**Pictelio 已有正确范本**：`classifyError` 明确区分 `PROXY`（本地代理未运行）、`NETWORK`（`TypeError`）、`UNAUTHORIZED`(401)、`FORBIDDEN`(403)、429 等（`packages/app/src/api/client.ts:142`）。诊断应**复用同一枚举**，而不是另造一套词表。

### 4.7 诊断本身依赖单一外部服务

**反模式**：用"能不能访问某个公共网站"来判断"有没有网"。若该网站在用户所在网络恰好不可达（例如同一地区封锁），会误报"全面断网"。

**应做**：探测用户**真正要访问的域**（Pixiv 官方域 / 镜像站 / pximg 边缘），而不是通用公网；并且**诊断服务应尽量可自托管**——这是 LibreSpeed 相对厂商托管测速的优势（[源码一手](https://github.com/librespeed/speedtest)）。

### 4.8 只给结论不给证据

**反模式**：只显示"网络异常"/一个红叉。用户和支持人员都无法据此行动。

**应做**：每个失败项至少给：解析到的 IP、实际连接的 IP、路由（SYSTEM/直连 + 通道）、耗时、原始错误码（折叠）。Chrome NetLog 的信息架构就是这条原则的工业化版本。

### 4.9 隐私反模式

**反模式**：未明确告知就把含 IP / SSID / BSSID / 精确位置 / 完整请求头的诊断报告上传。

**依据**：`@cloudflare/speedtest` README 明确 "measurement results are collected by Cloudflare on completion..."（[源码一手](https://github.com/cloudflare/speedtest)）——**复用它就等于接受这条**。移动端权限与合规细节见第三节。

### 4.10 误判平台能力（做了根本做不到的事）

**反模式**：假设第三方 App 能发 ICMP，或假设能调用系统级诊断 API。

**依据**：ICMP 需要特权，否则退回 TCP:7（[OpenJDK 源码](https://raw.githubusercontent.com/openjdk/jdk/jdk-11%2B28/src/java.base/share/classes/java/net/InetAddress.java)）；AOSP 的 Connectivity Diagnostics API 是**系统级**能力（[AOSP 官方文档](https://source.android.com/docs/core/connect/connectivity-diagnostics-api)、[Android 参考](https://developer.android.com/reference/android/net/ConnectivityDiagnosticsManager)）——第三方 App 不应假设可直接调用（**推断**，权限细节本文未逐一核实）。

### 4.11 把逐跳丢包当"某个节点坏了"

**反模式**：traceroute/mtr 显示中间第 5 跳丢包 40%，就断定"运营商那个节点故障"。

**一手依据**：mtr 官方 README 明确警告——"some routers may be configured to never send these ICMP responses, or **may rate-limit them, so apparent loss at an intermediate hop does not always mean that forwarded traffic is being lost at that point**"（[源码一手](https://raw.githubusercontent.com/traviscross/mtr/master/README.md)）。

**应做**：把"到该跳探测无响应"与"端到端连通性"作为**两个独立事实**呈现；端到端指标（RTT/丢包/TTFB）才是结论依据。

### 4.12 双栈黑洞与门户劫持造成的误报

**反模式**：IPv6 已配置但实际黑洞 → 串行尝试会等满超时，被误判成"没网"；被强制门户劫持的 HTTP 200 → 被误判成"通"。

**一手依据**：[RFC 8305](https://www.rfc-editor.org/rfc/rfc8305.html) 规定 "Connection Attempt Delay"，**推荐默认值 250 毫秒**（更精细实现应对齐上一个尝试发出第二个 TCP SYN 的时刻，依据 [RFC 6298](https://www.rfc-editor.org/rfc/rfc6298) 的重传计时器）；captive portal 的标准化识别见 [RFC 8910](https://www.rfc-editor.org/rfc/rfc8910.html)（**DHCP code point 由 RFC 7710 的 160 改为 114**）与 [RFC 8908](https://www.rfc-editor.org/rfc/rfc8908.html)（Captive Portal API），整体架构见 [RFC 8952](https://www.rfc-editor.org/rfc/rfc8952.html)。

**应做**：结论先分五态——**无网络 / 有网但被门户劫持 / DNS 失败 / 到目标不可达 / 可达但慢**——再给处置建议；不要硬编码第三方门户探测 URL（隐私 + 外部依赖 + 可用性风险）。

---

## 五、可复用的开源方案 / 库 / 规格

### 5.1 测速 / 吞吐引擎

| 方案 | 一手来源 | 关键事实 |
|---|---|---|
| **`@cloudflare/speedtest`** | [**源码一手** github.com/cloudflare/speedtest](https://github.com/cloudflare/speedtest) | README 自述是 "the measurement engine that powers the Cloudflare speedtest measurement application available at https://speed.cloudflare.com"；"performs test requests against the Cloudflare edge network and relies on the PerformanceResourceTiming browser api to extract timing results"；刻画 **download/upload bandwidth、latency、packet loss**；默认端点 `https://speed.cloudflare.com/__down` / `__up`；丢包用 TURN（默认 `turn.cloudflare.com:3478`，README 警告该公开 TURN "is deprecated and will be discontinued soon"）；`getUnloadedJitter()` 定义为"相邻两次时延测量差值的平均"且**要求至少两次 latency 测量**；交互 API `play()/pause()/restart()` + `onRunningChange/onResultsChange/onFinish/onError`。**隐私注意**：结果会被 Cloudflare 收集用于聚合统计。 |
| **LibreSpeed** | [**源码一手** github.com/librespeed/speedtest](https://raw.githubusercontent.com/librespeed/speedtest/master/README.md) | "a very lightweight speed test implemented in Javascript, using XMLHttpRequest and Web Workers"；功能：Download / Upload / Ping / Jitter / IP·ISP·距离（可选）/ telemetry / 结果分享 / Multiple Points of Test；独立 stability 页"repeatedly measures ping... with a live chart"，给出 current / average / min / max / jitter / **failed request 百分比** + 阈值告警 + CSV 导出；许可 **LGPLv3**。配套 Android 模板 / CLI / Go / Rust / .NET 客户端（见 [README](https://github.com/librespeed/speedtest)）。 |
| **M-Lab NDT** | [**官方一手** measurementlab.net/tests/ndt](https://www.measurementlab.net/tests/ndt/) | 原文 "**NDT reports upload and download speeds and latency metrics**"，方法学引用 [RFC 3148](https://www.rfc-editor.org/rfc/rfc3148.html)；测量数据（含 IP）会被数据集化，使用公共设施**必须链接其[隐私声明](https://www.measurementlab.net/privacy/)**。 |
| **Ookla Speedtest** | [**官方一手** How does Speedtest measure my network speeds?](https://www.speedtest.net/help/guides/how-does-speedtest-measure-my-network-speeds) | "operates mainly over **TCP testing** with an **HTTP fallback** for maximum compatibility"；测 ping(latency) / download / upload；下载与上传最多用 **4 个 HTTP 线程**。另有"体验评分"维度（[Ookla 官方文章](https://www.ookla.com/articles/speedtest-experience-ratings)）。**协议规格未找到一手来源。** |
| **fast.com（Netflix）** | [fast.com](https://fast.com/) | HTTP 下载（主）/上传（Show more info）；**Unloaded 与 Loaded 延迟**（差值即 **bufferbloat**）；Settings 可调并行连接数、测试时长、loaded latency。 |
| **Cloudflare 1.1.1.1 / speed.cloudflare.com** | [1.1.1.1/help](https://developers.cloudflare.com/1.1.1.1/check/)、[AIM](https://developers.cloudflare.com/speed/aim/index.md)、[排障](https://developers.cloudflare.com/1.1.1.1/troubleshooting/) | `1.1.1.1/help` 显示到 1.1.1.1 的连接是否正常 + **服务你的 Cloudflare 数据中心**；排障给出 `dig @1.1.1.1` / `@1.0.0.1` / `@8.8.8.8` 对比与 `dig +short CHAOS TXT id.server @1.1.1.1`；**AIM** 把六项指标换算为 streaming / gaming / webchat-RTC 场景评分（五档）。 |
| **国内加速器（网易 UU）** | [**官方一手** 如何手动选择模式或节点](https://uu.baike.163.com/zhinan/60.html) | 「客户端 → 中间站 → 目标服务器」两段链路 + **节点评分**；**节点测速的具体算法/频率/样本口径厂商未公开**。腾讯加速器同样未找到一手技术说明。 |

> **Cloudflare 引擎的默认测量序列（【源码一手】** [README](https://raw.githubusercontent.com/cloudflare/speedtest/main/README.md)**）**：初始 latency 1 包 → 1e5 B 下载 ×1 → latency 20 包 → 下载 1e5×9 → 1e6×8 → 上传 1e5×8 → packetLoss 1000 包（TURN/UDP）→ 上传 1e6×6 → 下载 1e7×6 → 上传 1e7×4 → 下载 2.5e7×4 → 上传 2.5e7×4 → 下载 1e8×3 → 上传 5e7×3 → 下载 2.5e8×2。带宽按方向 **ramp-up**，达到 `bandwidthMinRequestDuration`（默认 1000ms）后忽略同方向更大尺寸组；默认 `latencyPercentile=0.5`、`bandwidthPercentile=0.9`；`loadedLatencyThrottle=400ms`；带宽用 `transferSize` 并扣除 `server-timing` 中的服务端处理时间；latency 用下载 API 的 `bytes=0` GET 取 `requestStart`→`responseStart` 的 **TTFB 往返**。
>
> **【推断】** 这套"尺寸阶梯 + ramp-up + 分位 + 扣服务端耗时"是可直接抄的工程细节——它解释了为什么简陋的测速（单次下载、取平均值、不扣服务端时间）会得出错误结论。

### 5.2 浏览器内置诊断与格式（"分层事件 + 可导出报告"）

| 方案 | 一手来源 | 关键事实 |
|---|---|---|
| **Chrome NetLog / `chrome://net-export`** | [**源码一手** `net/log/net_log_event_type_list.h`](https://chromium.googlesource.com/chromium/src/+/main/net/log/net_log_event_type_list.h)、[`net/docs/net-log.md`](https://chromium.googlesource.com/chromium/src/+/main/net/docs/net-log.md)、[crash-course-in-net-internals](https://chromium.googlesource.com/chromium/src/+/main/net/docs/crash-course-in-net-internals.md)、[How to capture a NetLog dump](https://new.chromium.org/for-testers/providing-network-details/)、[netlog_viewer](https://netlog-viewer.appspot.com/)、[Chrome 企业版帮助](https://support.google.com/chrome/a/answer/6271171) | 事件清单头文件开头即说明 "**In the event of a failure, many end events will have a `|net_error|` parameter with the integer error code associated with the failure**"；`kHeavilyRedacted` 模式可安全公开上传；事件与参数**无向后兼容承诺**。这是"逐层事件 + 整数错误码 + 可导出 JSON"的工业级范例。**值得抄结构与错误码归属，不是 UI。** |
| **PerformanceResourceTiming** | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)（原始内容源 [mdn/content](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/performanceresourcetiming/index.md)） | 浏览器逐阶段时间戳（redirect/domainLookup/connect/secureConnection/request/response/transferSize），把"一次请求"拆成"DNS 多久、TCP 多久、TLS 多久、首字节多久"。**跨域默认只暴露部分字段**（需 `Timing-Allow-Origin`）。 |

### 5.3 平台原生 API

| 平台 | API | 一手来源 | 用途 |
|---|---|---|---|
| Android | `ConnectivityManager` | [官方文档](https://developer.android.com/reference/android/net/ConnectivityManager) | 网络状态/回调、绑定网络、能力查询（`registerDefaultNetworkCallback`、`getNetworkCapabilities`、`bindProcessToNetwork`…） |
| Android | `NetworkCapabilities` | [官方文档](https://developer.android.com/reference/android/net/NetworkCapabilities) | `TRANSPORT_*`（Wi-Fi/蜂窝/VPN…）与 `NET_CAPABILITY_INTERNET / VALIDATED / CAPTIVE_PORTAL / NOT_METERED` |
| Android | `ConnectivityManager.NetworkCallback` | [官方文档](https://developer.android.com/reference/android/net/ConnectivityManager.NetworkCallback) | `onAvailable` / `onLost` / `onCapabilitiesChanged` 事件式监听（替代轮询） |
| Android | `ConnectivityDiagnosticsManager` | [Android 参考](https://developer.android.com/reference/android/net/ConnectivityDiagnosticsManager)、[AOSP Connectivity Diagnostics API](https://source.android.com/docs/core/connect/connectivity-diagnostics-api) | **系统级**连通性诊断。据本文调研组的 AOSP 源码核验：公开的**报告类型**为 `ConnectivityReport` / `DataStallReport`（公开 SDK 中**没有**名为 `NetworkDiagnostics` 的类型）；回调注册为 `registerConnectivityDiagnosticsCallback(NetworkRequest, Executor, Callback)`。**普通第三方 App 是否可调用本文未核实**，不要假设可直接用（**推断**） |
| Android | `CaptivePortal` | [官方文档](https://developer.android.com/reference/android/net/CaptivePortal) | 门户登录流程的显式 API |
| Android / Java | `InetAddress.isReachable()` | [**源码一手** OpenJDK](https://raw.githubusercontent.com/openjdk/jdk/jdk-11%2B28/src/java.base/share/classes/java/net/InetAddress.java) | 说明"ICMP 要有特权，否则退回 TCP:7" |
| Apple | `NWPathMonitor` / `NWPath` | [官方文档](https://developer.apple.com/documentation/network/nwpathmonitor)、[NWPath](https://developer.apple.com/documentation/network/nwpath)（[纯文本 .md](https://developer.apple.com/documentation/network/nwpathmonitor.md)） | 路径状态与变化（`status` / `NWPath.Status`）、接口与网关、`supportsIPv4/6` |
| Apple | Apple Network Responsiveness | [官方支持文档 101942](https://support.apple.com/en-us/101942) | 系统内置的 Wi-Fi 响应性测试（面向用户的一键式） |
| Apple (macOS) | Wireless Diagnostics | [官方支持文档：Use Wireless Diagnostics on your Mac](https://support.apple.com/guide/mac-help/mchlf4de377f/mac) | 系统级无线诊断（日志/扫描/性能）；**注意** `support.apple.com/101965` 是硬件诊断，不是网络诊断 |

### 5.4 协议与规范（写进实现才会"测得对"）

| 规范 | 链接 | 为什么网络自检需要它 |
|---|---|---|
| **RFC 8305** Happy Eyeballs v2 | [rfc-editor.org/rfc/rfc8305.txt](https://www.rfc-editor.org/rfc/rfc8305.txt) | 多地址/多协议族并行尝试与竞速（默认 Connection Attempt Delay **250ms**）；"只连一个 IP 就下结论"会误诊 |
| **RFC 8484** DNS over HTTPS | [rfc-editor.org/rfc/rfc8484.txt](https://www.rfc-editor.org/rfc/rfc8484.txt) | 作为 DNS 对照通道，检测本地解析器被污染/劫持（媒体类型 `application/dns-message`） |
| **RFC 7858** DNS over TLS | [rfc-editor.org/rfc/rfc7858.txt](https://www.rfc-editor.org/rfc/rfc7858.txt) | 同上；TLS "eliminates opportunities for eavesdropping and on-path tampering with DNS queries" |
| **RFC 8910** Captive-Portal Identification | [rfc-editor.org/rfc/rfc8910.txt](https://www.rfc-editor.org/rfc/rfc8910.txt) | 区分"网络真的坏了"与"需要先在门户登录"；**DHCP code point = 114**（取代 RFC 7710 的 160） |
| **RFC 9110** HTTP Semantics（含 `Retry-After`） | [rfc-editor.org/rfc/rfc9110.html](https://www.rfc-editor.org/rfc/rfc9110.html) | 弱网/429 下的重试与退避语义（避免自检与业务重试叠加放大流量） |

### 5.5 选型建议（**【推断】**）

- 要"能跑在移动端、可自托管、不上报数据"的吞吐测速：**LibreSpeed**。
- 想省事且接受数据被 Cloudflare 聚合：**`@cloudflare/speedtest`**（README 已明说结果会被回收，须评估合规）。
- 想要"分层事件 + 整数错误码 + 可导出报告"的**结构**：抄 **Chrome NetLog** 的信息架构，不要抄 UI。
- 想要"系统级网络类型/门户/VPN 判定"：用 **Android `NetworkCapabilities` / Apple `NWPathMonitor`**，不要自己猜。
- 使用任何**公共测量基础设施**（M-Lab 等）前，先读其隐私声明——测量数据会被数据集化。

### 5.6 Chrome NetLog 关键事件类型（"分层命名"可抄）

行号来自 main 分支 [`net_log_event_type_list.h`](https://chromium.googlesource.com/chromium/src/+/main/net/log/net_log_event_type_list.h)（全文 5458 行、645 个 `EVENT_TYPE`）：

| 诊断环节 | 事件类型（行号） |
|---|---|
| 请求生命周期 | `REQUEST_ALIVE` (37)、`URL_REQUEST_START_JOB` (1222)、`URL_REQUEST_REDIRECTED` (1229)、`URL_REQUEST_JOB_BYTES_READ` (1269) |
| DNS 解析 | `HOST_RESOLVER_MANAGER_REQUEST` (79)、`HOST_RESOLVER_MANAGER_JOB` (141)、`HOST_RESOLVER_MANAGER_ATTEMPT_STARTED` (160)、`HOST_RESOLVER_MANAGER_ATTEMPT_FINISHED` (175)、`HOST_RESOLVER_SYSTEM_TASK` (225)、`HOST_RESOLVER_DNS_TASK` (249)、`HOST_RESOLVER_DNS_TASK_TIMEOUT` (282) |
| Socket / TCP | `SOCKET_OPEN` (483)、`SOCKET_CONNECT` (490)、`TCP_CONNECT` (540)、`TCP_CONNECT_ATTEMPT` (566)、`SOCKET_BYTES_SENT` (798)、`SOCKET_BYTES_RECEIVED` (808)、`SOCKET_READ_ERROR` (817)、`SOCKET_WRITE_ERROR` (818) |
| 代理 / PAC / SOCKS | `PAC_FILE_DECIDER` (321)、`PROXY_RESOLUTION_SERVICE` (355)、`PROXY_CONFIG_CHANGED` (405)、`PROXY_LIST_FALLBACK` (427)、`SOCKS5_CONNECT` (636) |
| TLS / SSL | `SSL_CONNECT` (694)、`SSL_SERVER_HANDSHAKE` (720)、`SSL_HANDSHAKE_ERROR` (750)、`SSL_CERTIFICATES_RECEIVED` (830) |
| 连接作业（超时/回退） | `CONNECT_JOB` (946)、`CONNECT_JOB_TIMED_OUT` (957)、`TRANSPORT_CONNECT_JOB_IPV6_FALLBACK` (990) |
| HTTP 事务 | `HTTP_TRANSACTION_SEND_REQUEST` (1934)、`HTTP_TRANSACTION_READ_HEADERS` (1971)、**`HTTP_TRANSACTION_READ_RESPONSE_HEADERS` (1978)**、`HTTP_TRANSACTION_RESTART_AFTER_ERROR` (2001) |
| QUIC / HTTP3 | `QUIC_SESSION_CLOSE_ON_ERROR` (2711)、`QUIC_SESSION_PACKET_RETRANSMITTED` (2756)、`QUIC_SESSION_PACKET_LOST` (2764) |
| WebSocket | `WEBSOCKET_ALIVE` (43)、`WEBSOCKET_STATE_CHANGED` (51) |

> **版本澄清（重要）**：任务清单里常见的 `DNS_TRANSACTION` 与 `HOST_RESOLVER_IMPL_JOB` 在当前 main 分支**未匹配到**——该分支的 DNS 事件是 `HOST_RESOLVER_MANAGER_*` 与 `HOST_RESOLVER_DNS_TASK`（对 645 条 `EVENT_TYPE` 全量检索的结论）。引用旧名时必须注明版本。

### 5.7 规范 / 资料索引（补齐 5.4 之外）

| 规范 / 资料 | 链接 | 用途 |
|---|---|---|
| **RFC 3148** IP Performance Metrics 框架 | [rfc-editor.org/rfc/rfc3148.html](https://www.rfc-editor.org/rfc/rfc3148.html) | 延迟/吞吐指标的标准定义；M-Lab NDT 方法学引用它 |
| **RFC 792** ICMP | [rfc-editor.org/rfc/rfc792.html](https://www.rfc-editor.org/rfc/rfc792.html) | ping/traceroute 的协议基础（移动端受限，见 4.10） |
| **RFC 8908** Captive Portal API | [rfc-editor.org/rfc/rfc8908.html](https://www.rfc-editor.org/rfc/rfc8908.html) | 门户检测的标准化 API（含 JSON media type） |
| **RFC 8952** Captive Portal 架构 | [rfc-editor.org/rfc/rfc8952.html](https://www.rfc-editor.org/rfc/rfc8952.html) | 门户检测整体架构 |
| **RFC 9462** 解析器发现（DDR） | [rfc-editor.org/rfc/rfc9462.html](https://www.rfc-editor.org/rfc/rfc9462.html) | 发现可用加密解析器 |
| **RFC 8310** DoT 使用建议 | [rfc-editor.org/rfc/rfc8310.html](https://www.rfc-editor.org/rfc/rfc8310.html) | DoT 部署与隐私取舍 |
| **RFC 8499 / 7626** DNS 术语 / DNS 隐私 | [RFC 8499](https://www.rfc-editor.org/rfc/rfc8499.html)、[RFC 7626](https://www.rfc-editor.org/rfc/rfc7626.html) | 术语统一与隐私威胁模型 |
| **RFC 6298** TCP 重传计时器 | [rfc-editor.org/rfc/rfc6298.html](https://www.rfc-editor.org/rfc/rfc6298.html) | Happy Eyeballs 的延迟对齐依据 |
| **RFC 6555** Happy Eyeballs v1 | [rfc-editor.org/rfc/rfc6555.html](https://www.rfc-editor.org/rfc/rfc6555.html) | 被 RFC 8305 取代，保留作历史对照 |
| **RFC 6585 §4** 429 Too Many Requests | [rfc-editor.org/rfc/rfc6585.html](https://www.rfc-editor.org/rfc/rfc6585.html) | 限流语义 |
| **RFC 8085** UDP 使用与拥塞控制 | [rfc-editor.org/rfc/rfc8085.html](https://www.rfc-editor.org/rfc/rfc8085.html) | 自建 UDP 探测时需遵守的拥塞控制规范 |
| **mtr**（ICMP 限速陷阱） | [mtr README](https://raw.githubusercontent.com/traviscross/mtr/master/README.md) | 逐跳丢包 ≠ 转发丢包（见 4.11） |
| **M-Lab 隐私声明** | [measurementlab.net/privacy](https://www.measurementlab.net/privacy/) | 使用公共测量基础设施时**必须**链接（数据含 IP 且会数据集化） |

---

## 六、面向 Pictelio「一个壳、两套渲染引擎」的诊断架构建议
本节的方法与前五节不同：结论来自**本仓库源码 / OpenWiki / ADR**（这些是 Pictelio 的"一手来源"），业界做法在前五节单独陈述；两边的结合处明确标为**【推断】**。

### 6.1 先看清约束：两套引擎 + 一条 Java 网络出口

Pictelio 是**双引擎单 APK**（[OpenWiki 架构概览](/openwiki/architecture/overview.md)）：

- `pictelio-app`：WebView + SolidJS + Fluent Design 2（`packages/app/`）
- `pictelio-app-lynx`：Lynx + vue-lynx + Material Design 3（`packages/app-lynx/`）
- 引擎选择由 `pictelio_client_kind`（SharedPreferences `CapacitorStorage`）决定，切换后重启进程（`packages/app-lynx/src/stores/clientSwitchStore.ts`；`packages/app/src/utils/clientSwitch.ts`）

关键事实：**两个引擎的网络出口已经殊途同归到同一个 Java 层**。

| 引擎 | JS 侧调用点 | 到 Java 的通路 | Java 侧落地 |
|---|---|---|---|
| WebView | `PixivApi.request()`（`packages/app/src/native/PixivApi.ts`） | Capacitor bridge | `PixivApiPlugin.java` → `PixivApiCore.getClient()`（`packages/app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java:54`） |
| Lynx | `NativeModules.PictelioApi.request(method, path, body, cb)`（`packages/app-lynx/src/rspeedy-env.d.ts:99`） | Lynx Native Module | 同一 `PixivApiCore` 的 OkHttp 客户端（`packages/app-lynx/src/api/client.ts` 顶部注释："原生模式（LynxView）：T7 迁移到 Native Module（Java 堆隔离 access_token）"） |

旁证：`packages/app-lynx/src/utils/fetchWrapper.ts` 明确写了"原生 Lynx 环境（LynxView，T7）走 Lynx Http Service，此处预留 fallback 链"，且 Lynx 侧存在通用 HTTP 桥 `PictelioApp.httpGet(url, cb(status, body))`（`rspeedy-env.d.ts:90`，"原生 lynx 无 fetch 时的网络桥"）。也就是说：**Lynx 原生环境下 JS 侧并不保证有 `fetch`**。

> **【推断】** 任何"在 JS 里用 fetch/XHR 探测"的诊断实现，在 Lynx 原生环境要么不可用，要么只能用 `PictelioApp.httpGet` 这一条能力极弱（无自定义头、无超时、无 TLS/连接阶段信息）的通道。若两套引擎各自实现诊断，几乎必然出现"同一个网络、两套引擎给出不同结论"。

### 6.2 已存在的高价值诊断数据源：直连路由 + 双通道熔断

Pictelio 已有一套 **Direct Access（网络直连）** 路由层（ADR-0144，[OpenWiki 直连文档](/openwiki/architecture/direct-access.md)）：

- `DirectAccessPolicy.decide(host, switchState, breaker, ipTable)`：纯决策，门序契约固定（switch → 输入 → 官方域名白名单 → IP 表 → 通道分类 → 装配 → 熔断），**零 I/O**
- `ChannelCircuitBreaker`：**双通道**（IMAGE / API_REFRESH）独立计数；CLOSED →（连续 3 次失败）→ OPEN →（60s 冷却 + 单探针）→ HALF_OPEN → CLOSED；半开态用 CAS 只放行**一个**探针请求
- `DirectAccessTransport`：唯一接触 OkHttp 的类，装配 Dns / SSLSocketFactory / EventListener / 拦截器四件套
- "exactly-once failure attribution"（失败归属恰好一次）是 ADR-0144 的既定目标

> **【推断】** 诊断页最应该先做的不是"再写一套 ping"，而是**把已有的熔断器状态、当前路由决策（SYSTEM vs PINNED(通道, IP)）、IP 表层来源（manual > remote > builtin，见 `IpTableMerger`）暴露出来**。这正是业界"分层红黄绿"范式里最难伪造、最贴近真实故障的一层，而且**零额外网络成本**——对应 4.8"只给结论不给证据"的解药。

### 6.3 建议形态：Java 执行层 + 共享纯逻辑包 + 双引擎各自渲染

以 `@pictelio/update-check` 为架构先例（webview 与 lynx 共用的纯逻辑库，ADR-0089，`packages/update-check/`）：

```
packages/net-diagnostics/           新建共享包（纯逻辑，零平台依赖）
  ├─ checkPlan.ts      按成本排序的检查项清单（哪些可跳过、超时、顺序）
  ├─ judge.ts          逐层判定矩阵 → ok/warn/fail/skipped + 归因标签
  ├─ report.ts         诊断报告序列化（脱敏后的版本/机型/结果 JSON）
  └─ copy.ts           面向用户的中文归因文案（键值与 i18n 对齐）

packages/app/android/.../netdiag/   Java 执行层（唯一真正发包的地方）
  ├─ NetDiagProbe.*    DNS / TCP connect / TLS / HTTP RTT / 吞吐（复用 PixivApiCore 的 OkHttp）
  └─ NetDiagBridge.*   读 DirectAccessPolicy + ChannelCircuitBreaker 快照

packages/app/src/...                 WebView UI（Fluent Design 2）
packages/app-lynx/src/...            Lynx UI（Material Design 3）
```

分层理由（**【推断】**，但受 6.1/6.2 的硬约束支撑）：

1. **执行层必须在 Java**：只有 Java 侧同时满足（a）Lynx 原生环境可用（JS 不保证有 fetch）、（b）与真实生产请求走**同一个 OkHttp 客户端**（DNS/代理/直连/SNI 行为完全一致）、（c）拿得到熔断器与路由决策的内部状态。用 JS 另起一套 `fetch` 探测会测出"与真实流量不同的路径"，是典型误诊来源（4.7）。
2. **纯逻辑必须共享**：两套引擎各自实现判定矩阵必然漂移——本仓库已有双份同构实现的先例：`classifyError` 在 `packages/app/src/api/client.ts:142` 与 `packages/app-lynx/src/api/client.ts` 各有一份（注释写"与现有 app 的 classifyError 逻辑同构"），`ApiErrorType` 也是两份（`packages/app/src/api/types.ts:239`、`packages/app-lynx/src/api/types.ts:195`）。诊断若照此办理，会出现"同一个故障、两套引擎两句文案"。
3. **UI 必须分开**：`pictelio-app` 强制 Fluent Design 2（`src/styles/tokens.css` + `uno.config.ts`），`pictelio-app-lynx` 用 Material Design 3（Tailwind M3 语义色板）。共享的应是**数据契约与文案键**，不是组件。判定的呈现可复用 WebView 侧既有的 `ErrorDisplay.tsx`（它已按 `ApiErrorType` 渲染 `actionableHint`/`actionableLabel`，CodeGraph 显示 9 处调用点）。

### 6.4 反误导设计（结合本仓库已有机制）

| 设计要求 | Pictelio 里可直接复用的东西 | 出处 |
|---|---|---|
| 不让诊断在弱网下放大流量 | 熔断器"连续 N 次失败即停 + 冷却"的思路；诊断自身也应设总超时与项级超时（另见 3.8 的"总预算"） | `ChannelCircuitBreaker.java`；ADR-0144 |
| 报告不得泄露凭证 | access_token 仅存在于 Java 堆、JS 零知（ADR-0037）；诊断报告序列化必须显式白名单字段，禁止 dump header | `packages/app/src/native/PixivApi.ts`；`PixivApiCore.java` |
| 跨引擎共享"是否允许上传诊断"开关 | 复用 SharedPreferences `CapacitorStorage` 同键同步（ADR-0103）：`@capacitor/preferences`（webview）与 `PictelioPrefs`（lynx）读写同一文件 | `packages/app-lynx/src/stores/settingsStore.ts`；`rspeedy-env.d.ts:107` |
| 失败要"诚实归因" | `classifyError` 已区分 `PROXY`（本地代理未运行）、`NETWORK`（TypeError）、`UNAUTHORIZED`/`FORBIDDEN`/429；诊断应复用同一枚举而不是另造词表 | `packages/app/src/api/client.ts:142` |
| 逐项可重测 | 纯逻辑包的 `checkPlan` 让每项独立可重跑（无状态 probe），避免"重测=全量重跑" | 【推断】 |
| 只报"系统能力位"不碰 SSID | 用 `TRANSPORT_*` / `NET_CAPABILITY_*`，从设计上绕开位置权限与 SSID/BSSID 隐私问题（见 3.1 / 3.2） | Android/Apple 官方 API；【推断】 |

### 6.5 移动端硬差异（会直接决定检查项能否实现）

- **Android 上拿不到 ICMP**：普通应用无法发送 raw ICMP echo（需 `CAP_NET_ADMIN`/root），因此"ping"退化为 **TCP connect RTT** 或 **DNS 查询 RTT** 或 **HTTP(S) 首字节时间**。
  > 一手来源：[OpenJDK `InetAddress.isReachable()` 源码](https://raw.githubusercontent.com/openjdk/jdk/jdk-11%2B28/src/java.base/share/classes/java/net/InetAddress.java)（"ICMP ECHO REQUESTs if the privilege can be obtained, otherwise it will try to establish a TCP connection on port 7 (Echo)"）与 [Android 工具链同源副本](https://android.googlesource.com/toolchain/jdk/jdk17/+/b0059e1eefaefc4d4b86650ea21107eeb4282180/src/java.base/share/classes/java/net/InetAddress.java)。另见本文 1.3 / 3.7 / 4.10。
- **无 fetch 的 Lynx 原生环境**（见 6.1）→ 所有探测必须走 Native Module。
- **弱网/耗电**：吞吐是唯一真正吃流量的项，应默认关闭、显式同意后才跑，且时长上限要短。
  > 一手来源：Android [Data Saver](https://developer.android.com/develop/connectivity/network-ops/data-saver) 与 [省电指南](https://developer.android.com/develop/connectivity/preserving-battery)；`NetworkCapabilities` 的 `NET_CAPABILITY_NOT_METERED`；工程口径参考 `@cloudflare/speedtest` 的尺寸阶梯与 `bandwidthMinRequestDuration`（默认 1000ms，见 5.1），以及 Netflix fast.com 可调的测试时长（见 1.13）。
- **每个业务域都要单独探测**（见 4.1）：Pictelio 至少要覆盖 API 域（`app-api.pixiv.net`）、图片边缘（`i.pximg.net` / `210.140.139.131`）、OAuth 域（`210.140.139.155`），有自定义镜像时再镜像一层。
- **直连的双路径要分别报告**：带 SNI 路径与去 SNI 路径（ADR-0144）——否则无法解释"开了直连就好了"。

---

## 七、同类对照：第三方 Pixiv 客户端的做法（补充）

> 本节对象与 Pictelio **同类**（同是第三方 Pixiv 客户端），不满足"重点覆盖不同类 App"的证据要求，仅作"同赛道已有做法"补充。

- **Pixiv-Shaft（[CeuiLiSA/Pixiv-Shaft](https://github.com/CeuiLiSA/Pixiv-Shaft)，Kotlin / Android）**：已内置网络自检入口。据本仓库此前做过的一手复核（方法：浅克隆后直读源码与 strings，见 `docs/research/pictelio-feature-gap-vs-third-party-competitor-evidence.md` 第 54 行），其 strings 中存在 `nav_network_test_entry` 与 `network_test_*`，覆盖 **DNS / API / 图片 / 原始日志** 四块。
  - **值得注意的两点（【推断】）**：它按**业务域分层**（API 与图片分开），与本文 4.1 的结论一致；它保留**原始日志**，与 2.4 的"折叠原始层"一致。
  - **Pictelio 的现成增量**：Pictelio 架构里天然多出一层可直接纳入自检的信息——**直连路由决策 + 双通道熔断器状态**（ADR-0144，见本文 6.2）。
- 其余被复核的第三方客户端（PixEz、Pixeval、PBD、Pixiv Viewer Kai、Pix-EzViewer、PixivBiu）在既有复核记录中**未见**同等粒度的网络自检功能（"未见"指该次复核的 strings/源码检索未命中，不等价于绝对不存在）。

---

## 附录：核验说明与"未能核实"清单

**方法**：三路并行一手调研（社交/IM 与流媒体；测速工具、浏览器与 OS 内置；云与开发者工具、游戏、开源方案、移动端约束），全部来源经 HTTP 实测抓取，逐条标注 **【官方一手】/【源码一手】/【规范】/【推断】**；无法回溯到一手来源者一律写"未找到一手来源"，不臆造 URL 或参数。本仓库侧的架构结论来自 OpenWiki、ADR 与源码本身（即 Pictelio 的一手来源）。

**明确"未找到一手来源"，请勿当既定事实**：

- 微信**消费端 App 内**"网络检测"入口的官方出处（官方一手只找到微信支付侧与小程序的排查工具）。
- Spotify App 内的网络诊断工具。
- Windows 网络疑难解答 / Network Reset 的**具体官方文章 URL**（故文中未写其行为）。
- iOS **面向普通用户**的"无线诊断"界面（注意 `support.apple.com/101965` 是**硬件**诊断，不是网络诊断）。
- Ookla 测速协议的规格文档与其 CLI 的开源仓库；fast.com 的测量 API / 端点规格。
- 腾讯加速器的技术说明；网易 UU 节点测速的算法 / 频率 / 样本口径。
- Riot / Blizzard / Valve 关于 tick rate、netcode 的官方技术文档；PlayStation 连接测试页；Steam「下载区域」；Blizzard **Looking Glass**（官方域名疑似下线，论坛讨论非一手来源）。
- GDPR / EDPB / 中国《个人信息保护法》中"IP 地址是否构成个人信息"的**可静态核验**官方结论（EUR-Lex 对自动抓取返回 202 挑战页，EDPB 返回 403）。**本文不提供法律结论。**
- `developer.android.com` 与 `developer.apple.com/documentation` 的正文由 **JS 渲染**，部分 API 细节仅核实了 URL 可达与名称存在，方法签名/行为未逐字核验。

**版本澄清（防引用错误）**：任务清单中常见的 Chrome NetLog 事件名 `DNS_TRANSACTION` 与 `HOST_RESOLVER_IMPL_JOB` 在 main 分支**不存在**；该分支的 DNS 事件为 `HOST_RESOLVER_MANAGER_*` 与 `HOST_RESOLVER_DNS_TASK`（对 645 条 `EVENT_TYPE` 全量检索的结论）。

**本仓库内部依据**：[OpenWiki 架构概览](/openwiki/architecture/overview.md)、[API 层](/openwiki/architecture/api-layer.md)、[直连（Direct Access）](/openwiki/architecture/direct-access.md)；ADR-0037 / 0089 / 0103 / 0144；源码 `packages/app/src/api/client.ts`、`packages/app/src/api/types.ts`、`packages/app/src/native/PixivApi.ts`、`packages/app-lynx/src/api/client.ts`、`packages/app-lynx/src/utils/fetchWrapper.ts`、`packages/app-lynx/src/rspeedy-env.d.ts`、`packages/app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java`；以及本仓库既有的竞品一手复核记录 `docs/research/pictelio-feature-gap-vs-third-party-competitor-evidence.md`。
