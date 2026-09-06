# GeckoView 作为 Pictelio 新客户端的可行性验证报告

> **性质**：throwaway 原型实证报告（分支 `prototype/geckoview-feasibility`，不合入 main）
> **验证日期**：2026-09-07
> **前置**：`docs/research/android-client-engines-landscape.md`（分支 `research/android-client-engines`，8d938b39）对 GeckoView 的裁决是「可行但无必要」，并明确留下「Referer 注入 / webRequest 拦截成熟度存疑，**需 PoC**」的缺口。本报告以模拟器实测闭合该缺口，并升级裁决为——
>
> ## 🔴 实证可行、实证无必要：端到端能跑通且性能同水位；包体压缩后 +44MB（110MB APK）、内存深度调参后仍 ×4.7~4.9（默认口径 −12% 封顶）、安全更新被发版节奏绑死、Capacitor 插件层全量重写——不建议迁移

---

## 1. TL;DR 裁决表

| 维度 | 裁决 | 实测依据 |
|------|------|----------|
| SPA 兼容性（SolidJS + Fluent + 虚拟滚动） | 🟢 完整运行 | 登录→/home→推荐 feed 172 图零失败，路由/交互全部正常（Gecko 155.0） |
| 图片管线（Referer 注入刚需） | 🟢 两条路都通 | ① 本地网关代理（现架构同构）200；② **扩展内 webRequest 注入引擎直连 200**（本次 PoC 闭合） |
| JS↔Java 桥（替代 Capacitor bridge） | 🟢 可用且快 | native messaging p50=1ms / p95=2ms（n=300）；Capacitor 桥 p50=0.6ms 同水位 |
| 性能（滚动/启动） | 🟢 同水位 | 滚动 59.9 vs 60.0 FPS（同手势同窗口）；冷启动 TotalTime 288 vs 589ms |
| 内存 | 🔴 **×4.7~4.9（深度调参后）** | 默认口径 6 进程 ~621MB → 深度调参 540~554MB（−12%）vs 基线 ~112-116MB 单进程；渲染进程工作集 ~240MB 结构性 |
| 包体 | 🔴 压缩后 +44MB（×2.7），未压缩 +135MB | 压缩 so（`useLegacyPackaging`）：201→**110MB** APK；AAR 86MB/ABI 压缩态 |
| 网络通道（GFW） | 🟡 有解但有约束 | DNS 污染下引擎带 SNI 直连被注入伪响应（实测 404）→ **必须走无 SNI 钉定 IP 网关或扩展通道**，与主工程直连结论一致 |
| 安全性 | 🟡 双刃 | TLS 校验不可绕过（实测）；e10s+Fission 多进程隔离；但 isolatedProcess 默认关、引擎更新被 App 发版绑死 |
| 工程成本 | 🔴 高 | Capacitor 6 插件全重写为 WebExtension messaging；compileSdk ≥37；API 形态与旧文档大量不一致（§8） |
| **总体** | **🔴 不建议迁移** | 「摆脱 WebView 碎片化」的唯一收益对本项目边际（minSdk 28 + WebView≥85 检查已兜底），代价三重起步 |

---

## 2. 验证方法与环境

- **设备**：Android 14（API 34）arm64 模拟器 `emulator-5554`（sdk_gphone64_arm64，Pixel 4 口径）
- **原型**：独立 Gradle 工程 `io.pictelio.geckoproto`（本分支 `prototype/geckoview-feasibility/android-proto/`）
  - GeckoView **155.0.20260903215306**（release 通道，2026-09-03 构建，per-ABI arm64 AAR）
  - 内嵌 HTTP 网关（127.0.0.1:18080）逐字对齐 Vite dev proxy 契约（`/pixiv-img` `/pixiv-api` `/pixiv-oauth` `/pixiv-www` `/pixiv-re` `/pixiv-nl` `/github-api`）→ **SPA 零改动运行**
  - 内置 WebExtension（MV2）：native messaging 桥、webRequest 头注入、生命周期打点、自动登录、ping/fps 探针
  - SPA bundle：`NODE_ENV=development vp build --mode development`（保留 web 登录链路 `_oauthFetch`，含 `__CREDENTIALS__`；实测仅 `--mode development` 不够，DEV 分支仍被消除）
- **基线**：现网 `io.pictelio.app` v4.35.0（debug，full flavor，65.6MB）同模拟器同手势
- **测量工具**：`am start -W`、logcat 打点（GVPROTO tag / FCP 委托）、rAF 计数（CDP 注入基线 / 扩展注入原型）、`dumpsys meminfo`（分进程求和）、CDP（python websocket-client，`suppress_origin=True`）
- **API 事实基线**：GeckoView AAR `classes.jar` javap 逐字核对（版本 155.0.20260903215306）+ 官方文档/源码调研（firefox-source-docs、mozilla-firefox/firefox 镜像、maven.mozilla.org metadata）

---

## 3. 功能验证（模拟器实测，全部通过）

| # | 项目 | 结果 |
|---|------|------|
| F1 | SPA 启动渲染 | `FIRST_CONTENTFUL_PAINT t+772~989ms`，`title=Pictelio`，路由到 `/login` |
| F2 | 自动登录（桥取 token → 填 fluent-textarea → 提交） | OAuth 经网关无 SNI 通道 200 → 自动跳 `/home` |
| F3 | Feed 数据 | `/v1/novel/follow`、`/v1/illust/recommended` 等 200（25KB~192KB 响应体） |
| F4 | 图片管线 | `/pixiv-img/*` → 网关 → 无 SNI 钉定边缘 → 200（176~490ms/张，40KB 级缩略图，并发 5 线程） |
| F5 | webRequest 注入 PoC（**本次核心闭合项**） | 扩展背景页 fetch `https://i.pximg.net/` → webRequest 注入 Referer → **HTTP 200**（`injectedBefore:1` 证明注入生效）；无注入时 pximg 一律 403 |
| F6 | TLS 证书校验 | 自签名端点 fetch 32ms 失败（`NS_ERROR_NET_RESET`）→ **NSS 校验不可从 web 层绕过** |
| F7 | 登录态持久化 | web 模式下 token 落 localStorage（secure-storage web 回退），二次启动直达 `/home` |
| F8 | 图片零失败率 | feed 峰值 172 `<img>`，broken=0 |

**架构含义**：GeckoView 客户端存在两条可行的图片通路——(a) 本地 Java 网关代理（与现有 `shouldInterceptRequest`/`PixivImageLoader` 架构完全同构，迁移面最小）；(b) 内置扩展 webRequest 注入 + 引擎直连（免本地中转，但受 GFW SNI 约束，见 §6）。

---

## 4. 性能对比（同模拟器、同手势、同窗口）

| 指标 | GeckoView 原型 | WebView 基线 | 备注 |
|------|---------------|--------------|------|
| 冷启动 `am start -W` TotalTime（pm clear 后 ×5） | **257 / 270 / 288 / 302 / 347 ms**（中位 288） | **513 / 540 / 589 / 606 / 612 ms**（中位 589） | 原型更快：无 WebView provider 协商；均为登录页口径 |
| Activity onCreate → FCP | 683~989ms | 无同口径 logcat 标记（需 CDP，未测） | 原型含引擎首init |
| 滚动帧率（rAF 计数，14 次 swipe / 15s 窗口） | **59.9 FPS，长帧>32ms = 3** | **60.0 FPS，长帧 = 0** | 完全同水位 |
| `dumpsys gfxinfo` | **Total frames rendered: 0** | Janky 2.37%，p50 17ms / p95 21ms | **方法学发现：Android 帧统计看不到 Gecko 自绘合成器**（帧不经 HWUI），跨引擎 jank 对比必须用 rAF/内容侧指标 |
| JS↔Java 桥 RTT | avg 1.0ms / p50 1ms / p95 2ms（sendNativeMessage ×300） | avg 0.57ms / p50 0.6ms / p95 0.8ms（Preferences.get ×200） | 同数量级，均远低于感知阈值 |
| API 全链路 RTT | 网关内部 ms：`/v1/novel/follow` 244~247ms；`/v1/illust/recommended` 1020~1135ms | `PixivApi.request` JS→Java→pixiv→JS：novel/follow p50 **189ms** / p95 195ms | 口径差一截本地 HTTP hop（原型另 +5~15ms JS 侧）；差异主因是响应体大小与边缘选择，非引擎 |
| 冷启动到可交互（feed 首图） | loadUri 后 ~1.7s（含登录恢复+API+首批图） | 未单独测（Splash 生命周期口径不同） | — |

**结论**：GeckoView 155 在滚动流畅度与桥延迟上与 System WebView 无用户可感差异；冷启动 Activity 帧甚至更快；页面首绘因引擎初始化慢 ~200-400ms（无同口径基线，定性）。

---

## 5. 内存对比（`dumpsys meminfo`，feed 滚动后）

> **复核补充（第二轮 A/B 实测）**：针对「能不能压缩/调参」的质询补测了两件事——
> ① **包体压缩**：`packagingOptions.jniLibs.useLegacyPackaging = true`（so 压缩存入 APK，安装时解压）后 APK **201MB → 110MB**，即对基线的增量从 +135MB 收窄到 **+44MB**（代价：安装后磁盘占用升高 + 首启动解压开销；Firefox Play 包 ~110-120MB 同量级）。
> ② **运行时调参（两档）**：
> - **Builder 档**：`fissionEnabled(false)` + `glMsaaLevel(0)` + 关 console/debugLogging → 进程 6→5，**587 vs 621MB，−5%**；
> - **深度档（官方任意 pref 注入通道）**：`GeckoRuntimeSettings.Builder#configFilePath` 指向 YAML 配置（`automation` 文档通道，63+），注入 `dom.ipc.processCount:1`、`browser.cache.memory.capacity:16MB`、`browser.cache.disk.enable:false`、`image.cache.size:4MB`、`browser.sessionhistory.max_total_viewers:0`、`image.mem.animated.discardable:true` → **540~554MB（累计 −11~13%）**，滚动 FPS 59.4 无回归（见 `android-proto/app/src/main/assets/gv-config.yaml`）。
> 结论修正：调参通道真实存在且有效（默认口径 → 深度档 −12%），压缩 −45% 包体；但**两档叠加仍 ×4.7~4.9**——内存大头是渲染进程工作集（~240MB：WebRender 缓冲 + 图片解码 + JS 堆），结构性，pref 层无法数量级改善；且 image/内存缓存下调是有代价的（回滚/解码重算）。
>
> **③ 页面承载裁剪（第三轮实测，回应「不需要的功能能否关闭/删除」）**：把 SPA 用不到的功能面整组关闭——WebRTC（`media.peerconnection.enabled=false`）、语音合成/识别、`geo.enabled=false`、`dom.webgpu.enabled=false`、`pdfjs.disabled=true`、遥测上报 + Builder 级 `remoteDebuggingEnabled/extensionsWebAPIEnabled/loginAutofillEnabled/webManifest/translationsOfferPopup` 全关 → **4 进程、537~581MB，与深度档在方差内持平（追加收益 ≈ 0）**，SPA 登录/图片/桥完好。两个硬边界随之确认：
> - **e10s 多进程在 GeckoView 强制**：无单进程模式（[GeckoRuntime 源码](https://github.com/mozilla/gecko-dev/blob/master/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/GeckoRuntime.java) 明注 e10s required；`browser.tabs.remote.autostart` 等关闭开关已从 Firefox 移除）——4 进程地板 = 主 + 内容 + GPU + crashhelper；
> - **构建期删除 = 自维护 fork**：mozconfig 理论可 `--disable-webrtc` 等裁模块（Tor Browser 即自建 GeckoView 先例），但代价是自建构建设施 + 4 周列车 rebase + 无 maven 预编译 + 自担安全补丁；且可删模块（WebRTC/媒体栈）在 libxul 中仅几 MB~十几 MB——**页面承载真正需要的 SpiderMonkey/WebRender/Necko/DOM 恰好是体积与内存主体**，「删掉不需要的」动不了大头，Gecko 也没有官方 slim 分发。

| 进程（untuned 配对轮） | PSS |
|------|-----|
| **原型合计（6 进程，同 workload 配对轮）** | **~621MB** |
| ├ 主进程（GeckoView 宿主 + 网关 + 扩展宿主） | 194MB |
| ├ `:tab_disable_art_image_17`（渲染 tab） | **224MB** |
| ├ `:gpu_disable_art_image_` | 82MB |
| ├ `:tab_disable_art_image_26/38`（Fission 分裂） | 61 / 56MB |
| ├ `:crashhelper_disable_art_image_` | 18MB |
| **tuned 轮（fission off）** | **~587MB（5 进程）** |
| **基线（单进程）** | **~112-116MB** |

- 配对口径（默认/Builder/深度三档）：621 / 587 / 540~554MB，对基线 **×4.7~5.5**；深度档为最优口径 ×4.7~4.9（运行间方差 ±10%）。
- **口径 caveat**：原型 bundle 为 `NODE_ENV=development` 语义（DEV 分支保留，Solid DEV 开销 + 未裁剪告警路径），基线为 production bundle；模拟器为软件渲染路径。内存差异**方向性结论稳固**（引擎多进程结构决定下限），精确数字需 production bundle + 真机复测。

---

## 6. 网络通道与 GFW（重要实证，修正了实验中的一个假设）

1. **DNS 污染实证**：模拟器/宿主系统 DNS 对 `app-api.pixiv.net` 返回污染 IP（199.96.58.15，Twitter 段）。
2. **带 SNI 直连被拦截**：OkHttp/浏览器栈按域名直连 pixiv 域 → 收到**注入的伪 404 响应**（`{"has_error":true,...,"error":"invalid_request"}` 由伪边缘返回）。Gecko 的 Necko 属于此类——**引擎网络栈在本网络不可直连 pixiv**。
3. **无 SNI 钉定 IP 通道可用**（与主工程 DirectAccessTransport/`DirectIpTableDefaults` 一致）：
   - 图片边缘 `210.140.139.131`（i.pximg.net）：HTTP 200 ✓（原型全部图片走此通道）
   - API+OAuth 边缘 `210.140.139.155`：结构化响应 ✓（登录 200）
4. **实验教训（方法论）**：宿主机 curl 测得「SNI 直连 200」实为环境变量 CONNECT 代理的假象（`HTTP/1.1 200 Connection established`）——直连类结论必须在**绕开代理的进程内**验证。
5. **架构推论**：GeckoView 客户端必须保留 Java 侧无 SNI 网关承载全部 pixiv 流量（API 必须走网关；图片可选扩展直连通道——但该通道同样带 SNI，在此网络会被拦，**扩展直连仅适用于无 GFW 约束的市场**）。即：**现架构「引擎零直连、Java 全权代理」的形态在 GeckoView 下必须原样保留**，迁移不减少任何网关代码。

---

## 7. 安全性

### 实测（模拟器）
| 项 | 结果 |
|----|------|
| TLS 证书校验 | 自签名端点 32ms 被拒（`NS_ERROR_NET_RESET`），web 层不可绕过 |
| 进程模型 | e10s 默认开：实测 5 进程（main / gpu / tab×2-3 / crashhelper）；进程名带 `_disable_art_image_` tag（防加载 app image） |
| Fission 站点隔离 | Firefox Android 138（2025-04）起默认启用，GV 嵌入跟随引擎默认（实测 tab 按 Fission 分裂） |
| SELinux | 内容进程均为 `u:r:untrusted_app`（非 isolated_app） |
| isolatedProcess | **默认关**（`Builder.isolatedProcessEnabled` 可开，API 29+，配 App Zygote） |
| 桥攻击面 | token 经 intent extra 注入原型（throwaway 简化）；生产应走 Keystore（SecureStorageCompat 可直接复用） |

### 研究事实（附来源，详见调研代理清单）
- **沙箱架构**：内容进程 seccomp-bpf（桌面级代码）；Android 上**不用** isolatedProcess 双层（默认），社区公认弱于 Chromium WebView 的 isolatedProcess+seccomp 双层。Fission 是 Web 内容侧隔离，不等于 Android 进程隔离。
- **更新模型（核心安全权衡）**：WebView 是 Play 独立更新的系统组件（CVE 月度随 Android 公告推送）；GeckoView **引擎打进 APK，只随 App 发版更新**——Mozilla 4 周列车 + MFSA 公告，但用户侧生效取决于 App 更新。对 Pictelio（GitHub Releases 分发、无强制更新）意味着**安全补丁滞后期显著拉长**。
- **内容拦截/追踪防护**：`ContentBlocking.Settings` 内建（tracking/cookie/SafeBrowsing 策略），强于 WebView 的裸配置。
- **Play 政策**：捆绑引擎无政策禁止（Tor Browser 自 2019 上架先例）；审核对纯 wrapper 有最低功能性门槛。

---

## 8. 工程集成成本（实测踩坑与 API 形态清单）

### 8.1 硬约束
| 项 | 事实 | 对主工程 |
|----|------|----------|
| compileSdk | **155 与 154 的 AAR metadata 均要求 minCompileSdk=37**（本机 sdkmanager 拉不到 android-37 平台，原型打了 metadata 补丁 37→36 仅解构建期门槛） | 需升 compileSdk 37 + AGP 兼容性验证；每次引擎升级可能继续抬门槛 |
| minSdk | 26（主工程 28 ✓） | 无 |
| Java | 17 编译项（主工程 JDK 21 ✓） | 无 |
| 体积 | per-ABI AAR：arm64 86MB / x86_64 90.8MB / armeabi-v7a 83.4MB（压缩态）；**fat 包 `geckoview` 已停发（止于 133）**，x86（32位）止于 144 | 三 flavor × 多 ABI 的包体矩阵膨胀 |
| **app 侧 webRequest** | **GV 从未提供过 `GeckoSession.WebRequestDelegate` / `WebExtension.WebRequestDelegate`**（65→157 全 CHANGELOG + 全历史 javadoc 零条目；本次 javap 全字节码确认）。Java 原生只有导航级 `onLoadRequest`/`onLoadError` | per-resource 拦截/改 header **只有内置扩展 webRequest 一条路**；调研档「需 PoC」项就此定案：可行，但只能经扩展 |

### 8.2 API 形态与文档差异（155 实测，迁移必查）
- `ConsoleDelegate` 已不存在 → `GeckoRuntimeSettings.Builder.consoleOutput(true)`（默认 false）
- `onPageStop(GeckoSession, boolean)`（无 url 参数）；`onLocationChange` 四参；`onLoadError` 返回 `GeckoResult<String>`
- 无同步 `canGoBack()` → `NavigationDelegate.onCanGoBack` 回调缓存
- `onFirstContentfulPaint` / `onKill` / `onTitleChange` 可用作打点（本次已用）
- 官方 quick-start 的 `geckoview-${channel}` 坐标写法已失效（`geckoview-release` artifact 不存在），须用 per-ABI 精确名
- `installBuiltIn("resource://android/assets/<dir>/")` + **必须等 install 完成再 loadUri**（否则内容脚本错过 document_start，整页丢失注入——实测首启全丢）
- MV2 内置扩展 permissions 必须含 `nativeMessaging` + `nativeMessagingFromContent` + `geckoViewAddons`（后者是 GV 专属 API 门槛）
- 内容脚本 match pattern 对 `127.0.0.1` 回环敏感：`http://127.0.0.1:18080/*` 单条不注入，补 `http://127.0.0.1/*` 与 `localhost` 后正常（原型规避，根因未深究）

### 8.3 消息桥三坑（实测钉死）
1. `sendNativeMessage` 第一参 nativeApp 标识符正则 `^\w+(\.\w+)*$`——**禁连字符**（`pictelio-proto` 直接 TypeError）
2. 内容脚本消息只路由到 **session 级** `session.getWebExtensionController().setMessageDelegate(ext, delegate, name)`；全局级只收 background 页消息——双注册才全通
3. 回包 `GeckoResult.fromValue(JSONObject)` 序列化失败（JS 侧 15s 后报 "An unexpected error occurred"）→ **回 JSON 字符串**、JS 侧自行 parse

### 8.4 UI 自动化坑（fluent-web-components 通用，非 Gecko 特有）
- 填 `fluent-textarea` 必须同时驱动 **shadow DOM 内层原生 textarea** 并派发 composed input，否则 Solid 信号不动、提交按钮保持 disabled
- Android `getLoopbackAddress()` 返回 `::1`（IPv6）→ 本地服务器绑 IPv4 字面量 `127.0.0.1`，否则引擎按 IPv4 连接被拒

### 8.5 迁移工作量定性（若强行采纳）
- 6 个 Capacitor 插件（Auth/ImageCache/OAuth/PixivApi/ClientInfo/Ota）→ WebExtension messaging + Java 桥重写；桥协议、401 单飞、token 轮换事件全部重做
- Splash 生命周期（`AuthPlugin.hideSplash`）、client-switch（`CapacitorStorage` 契约）、OTA `setServerBasePath` 机制在 GV 下**全部无等价物**（OTA 的 web bundle 热切换依赖 Capacitor 服务器原语，GV 需重造——原型已示范本地服务器承载，可作为 OTA 底座雏形）
- Lynx 双引擎架构：full flavor 的 WebView 侧壳被 GeckoView 替换后，引擎切换、`CLIENT_KINDS` 隐藏逻辑、secure storage 共享（Keystore alias 契约不变可复用）需逐一重验

---

## 9. 对调研档（8d938b39）结论的增量修正

| 调研档存疑点 | 本次定案 |
|--------------|----------|
| 「Referer 注入/webRequest 拦截成熟度存疑，需 PoC」 | **定案：可行**——内置扩展 webRequest blocking 注入在 GV 155 嵌入式场景实测 200（Fenix+uBlock 同路径）；但 **app 侧 Java webRequest API 从不存在**，且该通道带 SNI 受 GFW 约束（中国网络下图片仍需网关兜底） |
| 「APK +60~100MB」 | 实测 debug APK：未压缩 +135MB（201 vs 65.6）；**压缩 so 后 +44MB（110MB）**；AAR 压缩态 86MB/ABI |
| 「内存高于系统 WebView」 | 定量：**默认 ×5.2~5.5 → 深度调参（configFilePath 注入 processCount/缓存上限等）后 ×4.7~4.9**（540~554 vs 112-116MB PSS；渲染进程工作集 ~240MB 结构性） |
| 「可行但无必要」 | 升级为「**实证可行、实证无必要**」：性能无收益（同水位）、包体/内存/安全更新三重确定成本、插件层全量重写 |

---

## 10. 局限性

1. 原型 SPA bundle 为 DEV 语义构建（web 登录链路所需）——内存/启动数字与 production bundle 有偏差，方向性结论不受影响。
2. 模拟器（软件渲染路径，Mozilla CI 同款口径）——真机 GPU/WebRender 硬件路径未测；滚动 FPS 真机预计更好，内存预计相近。
3. API RTT 口径：原型取网关内部 ms（缺本地 HTTP hop，约 +5~15ms），基线为 CDP 全链路；样本量小（n≈10）。
4. 基线 cold start 在登录页口径（pm clear 后），原型同口径；两 App 均为 debug 构建。
5. webRequest 注入 PoC 验证了 `onBeforeSendHeaders`；`onBeforeRequest` 重定向（`/pixiv-img/*` → pximg）未单独验证（同一 API 族，风险低）。

---

## 11. 结论与建议

1. **不迁移**。GeckoView 客户端「能做出来」（本原型即证明：登录、feed、图片、桥、探针全通，性能无劣势），但相对现状没有用户可感收益，且有包体（压缩后仍 +44MB / ×2.7）、内存（深度调参 −12% 后仍 ×4.7~4.9）、安全更新滞后（引擎绑发版）、工程（Capacitor 层全量重写 + compileSdk 37 门槛）四重确定成本。
2. **本次实测资产的可复用价值**：
   - 扩展 webRequest 注入机制 = 摆脱 `shouldInterceptRequest` 单点依赖的备用图片通路知识；
   - 本地网关 + SPA 零改动模式 = 任何「自研壳」路线（含 Tauri/裸 WebView）的通用验证底座；
   - GFW 通道实证（§6）= 引擎直连不可行、Java 网关必须保留的又一独立证据链。
3. **触发重评估的条件**（存档备用）：系统 WebView 在目标用户群出现严重碎片化/供应商停更；或出现「引擎自主可控」的硬需求（如合规、防审查加固场景——届时 GeckoView 的内置 ContentBlocking + 扩展生态反而成为资产）。
4. 原型与数据留档于本分支，可按 README 复跑；不阻塞任何进行中 effort。

---

## 附录 A：复跑

```bash
# 1) 拉引擎（含 metadata 补丁）→ 2) 构建 SPA → 3) 装机
bash scripts/fetch-geckoview.sh
bash scripts/build-web-bundle.sh
cd android-proto && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.pictelio.geckoproto/.MainActivity --es refresh_token '<PIXIV_REFRESH_TOKEN>'
# 探针：url extra 加 ?__ping=1（桥RTT）/ ?__fps=1（滚动FPS）/ ?__probe=<url>（引擎直连+注入）/ ?__tls=1（TLS校验）
```

原始数据：`/tmp/gvbench/`（coldstart/fps/ping/mem/gfx/rtt，本次会话产物，未入库）。

## 附录 B：工具路由自检

OpenWiki（architecture/overview、integrations/android-native）→ CodeGraph（client.ts 双模式 URL 构造、PixivImageLoader、DirectAccessTransport、auth 链）→ GeckoView 文档查询（环境无 Context7，按允许降级走官方 docs/源码镜像/maven metadata 研究子代理 + AAR javap 逐字核对）。
