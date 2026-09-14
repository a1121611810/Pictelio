# ADR-0153: 引擎可用性判定与降级（WebView 不可用时优先 Lynx）

- 状态：accepted
- 日期：2026-09-11
- 关联：ADR-0061（Android 模拟器 E2E 门禁——本决策推翻其记录的 pictelio_low「切回停升级页」行为）、ADR-0062（单引擎包隐藏切换 UI）、ADR-0064（Lynx 渲染错误兜底页）、ADR-0102（Lynx task 恢复）、`docs/specs/engine-availability-fallback.md`、`packages/app/CONTEXT.md`（新增词条：首选引擎 / 生效引擎 / 引擎可用性 / 引擎降级）

## 背景

`full` 包在系统 WebView 主版本 < 85 的设备上，`MainActivity.onCreate` 的 `isWebViewVersionOk()` 判定失败即 `showWebViewUpgradeError()`，停在静态升级页（`docs/platform-compatibility.md`）。同一安装包内的 Lynx 引擎是自绘渲染，不依赖系统 WebView：实测 `pictelio_low`（android-28 / WebView 66）上 Lynx 方向可达并可渲染（ADR-0061 记录）。现有 gate 让用户为一个本可绕过的环境限制付出「完全无法使用应用」的代价——升级页没有切引擎出口，webview 首选时用户根本进不了设置页。

## 决策

1. **引擎可用性（Engine availability）**：引擎能否在当前设备与安装包上运行，两引擎判据不同。
   - **WebView**：`getCurrentWebViewPackage()` 主版本 ≥ `OAuthConfig.MIN_WEBVIEW_VERSION`（85）。**检测不到（-1）仍放行**（fail-open 维持现状，避免误杀非标准 WebView）。
   - **Lynx**：**三条件合取**——包能力（`BuildConfig.CLIENT_KINDS` 含 `lynx`）∧ `LynxRuntimeInitializer.ensureInitialized()` 不抛异常 ∧ `LynxEnv.inst().isNativeLibraryLoaded()` 为真。
   - **不采用 `hasInited()` 单独判定**：`init()` 在 `liblynx.so` / `liblynxtrace.so` 加载失败时吞掉 `UnsatisfiedLinkError` 并正常返回，`hasInited()==true` 而 native 未加载，且后续 `init()` 短路、进程内不可恢复。`getLynxVersion()` 是硬编码 `"0.0.1"`，不可用于版本/能力门禁。仅有 `liblynxbase.so` 缺失会让 `init()` 抛 `UnsatisfiedLinkError`（其 catch 只接 `Exception`，`Error` 逃逸）。
2. **降级只在运行时生效，不改写首选引擎**：WebView 不可用 → 本次以 Lynx 生效，但**不写** `pictelio_client_kind`。用户首选（`webview`）保留；设备 WebView 升级后下次启动自动回到 webview。首选引擎不可用是设备事实，不是偏好变化。
3. **只作用于 full 包**：`webview` 包编译期无 `LynxActivity`（保持升级页）；`lynx` 包无 WebView 检查；OS 层 `minSdkVersion = 28` 安装拦截不变。
4. **降级入口用 Intent extra 标记，错误兜底页不提供切回**：`MainActivity` 以 `EXTRA_ENGINE_FALLBACK` 启动 `LynxActivity`；带该 extra 的实例在渲染失败兜底页只提供「退出应用」，不带 extra 的实例（用户主动切换进入）保留「返回 WebView」。防环由两点承担：Lynx 不可用时**不着陆**（直接走升级页）；降级入口的兜底页没有回到 `MainActivity` 的路径。
5. **不引入额外 static 会话标记**：Grill 中「本会话只降级一次」的标记会与「用户显式切回 webview 时再次降级」冲突——`ClientInfo.restart` 保留进程，static 标记存活会抑制再次降级。真正需要的是「无自动回环」，由决策 4 达成。
6. **告知经一次性通知标志**：降级入口在 `LynxActivity.onCreate` 写 `SharedPreferences("CapacitorStorage")` 的 `pictelio_engine_fallback_notice = "true"`；app-lynx 首帧读取并展示可关闭说明、**消费即清**。这是**通知标志**、不是首选引擎，不违反决策 2。每次降级入口写一次，保证「用户切回 webview 又被弹回 Lynx」时说明立即可见。

## 被考虑的方案

- **降级时落盘 `pictelio_client_kind = "lynx"`**：复用现有切换语义，但把设备环境固化为用户选择，WebView 升级后回不去；否决。
- **探针渲染**（临时 LynxView 渲染最小 bundle 等 `onLoadSuccess`）：异步、可能等满 10s，与「先渲染后加载」硬约束冲突；且 R8 `$$PropsSetter` 裁剪导致的 `990200` 白屏对任何 LynxView 之前的 API 都不可见，探针并不能消除对错误兜底页的依赖；否决。
- **`hasInited()` 单条件**：会把 native 未加载的静默降级误判为可用；否决。
- **无条件删「返回 WebView」按钮**：误伤用户主动切换到 Lynx 后的正常回退路径；否决。
- **`webview` 包也降级**：编译期无 Lynx 类，且 `CLIENT_KINDS` 不含 lynx；否决。
- **静默降级不告知**：用户会认为引擎切换设置失效；否决。

## 后果

**正面**：WebView 过低的设备不再被升级页挡死，可直接使用 Lynx 引擎；用户首选不被改写，WebView 升级后自动恢复；判定口径只依赖公开 API，无探针时序代价。

**负面 / 代价**：`full` 包在 webview 首选 + WebView 过低时会先由 `PictelioApp.warmUpWebView` 预热 WebView、再在 `MainActivity` 初始化 Lynx，单次启动两份引擎初始化开销（一次性，随后 MainActivity finish）；app-lynx 新增一条通知消费路径；`LynxRuntimeInitializer` 的幂等状态机须先修复（否则探测失败后进程内不可重试）；`switch-client-roundtrip-low` 既有断言被翻转，ADR-0061 记录的降级行为作废。
