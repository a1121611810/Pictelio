# 客户端切换（引擎切换）— 术语表

> 范围：`pictelio-app`（webview 客户端）与 `app-lynx`（Lynx 客户端）双端共有的引擎切换机制、UI 入口与错误处理概念。配套 ADR：[ADR-0062-single-engine-client-switch-hiding.md](./ADR-0062-single-engine-client-switch-hiding.md)、[ADR-0064-engine-switch-experience-fix.md](./ADR-0064-engine-switch-experience-fix.md)、[ADR-0153-engine-availability-fallback.md](./ADR-0153-engine-availability-fallback.md)、[ADR-0159-bridge-thread-unblocking.md](./ADR-0159-bridge-thread-unblocking.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **客户端（Client）** | 可独立运行的渲染客户端，二者之一：**WebView 客户端**（pictelio-app，Capacitor 桥）与 **Lynx 客户端**（app-lynx，原生 LynxView）。full 包同时包含两者；webview / lynx 独立包仅其一。 |
| **渲染引擎（Render engine）** | 客户端背后的渲染技术：Chromium WebView 或 Lynx 原生渲染。"切换引擎"即切换客户端。 |
| **切换渲染引擎入口（Switch entry）** | 设置页"切换渲染引擎"行（webview 侧）/ Lynx 客户端个人中心切换行（lynx 侧）。ADR-0062 起仅 full 包渲染该入口。 |
| **client 能力列表（Client kinds / `CLIENT_KINDS`）** | 当前包支持的客户端集合：full=`["webview","lynx"]`、webview=`["webview"]`、lynx=`["lynx"]`。Gradle 按 flavor 注入 `BuildConfig.CLIENT_KINDS`，运行时经 `ClientInfoPlugin.getClientKinds`（webview）/ `PictelioAppModule.getClientKinds`（lynx）暴露。是"包能力"的单一事实来源。 |
| **client kind 开关（Client kind switch）** | `SharedPreferences("CapacitorStorage")` 的键 `pictelio_client_kind`，取值 `"webview" \| "lynx"`。双端读写同一键同一文件，是引擎切换的单一事实来源；缺省为 `"webview"`。 |
| **切换深模块（clientSwitch 深模块）** | webview 侧 `clientSwitch` 模块：小接口（`readClientKind` / `switchClient` / `supportsClientSwitch`）+ 内部编排（in-flight 锁、5s 写入超时、原生 restart、Web `exitApp` fallback），错误模式经 `SwitchOutcome` 显式声明。lynx 侧对称实现为 `clientSwitchStore`（`PictelioAppModule.setClientKind` + restart）。 |
| **说明页（Client switch page）** | 切换确认从弹窗改为独立页面（webview 侧路由 `/client-switch`）：展示当前引擎、能力列表、引擎差异、实验性警告、切回路径与"确认切换"操作。 |
| **即时反馈（Immediate feedback）** | 点击"确认切换"后**同步**（先于任何 await）渲染的全屏加载遮罩（spinner + "正在切换引擎…"）；切换失败时关闭遮罩并按 reason 映射错误提示。 |
| **错误兜底页（Error fallback）** | LynxActivity 在渲染错误时展示的错误页（错误信息 + "返回 WebView"按钮，仅 full 包显示按钮），替代白屏。已有原子防重（首次错误才展示）。 |
| **入口路由分发（Entry routing）** | `MainActivity.onCreate` 读 client kind 开关分发：`"lynx"` → 跳转 `LynxActivity`（双 Activity 架构，issue #51）；否则走 Capacitor WebView 路径。 |

## 双端对称契约速查

| 能力 | webview 侧（pictelio-app） | lynx 侧（app-lynx） |
|------|---------------------------|---------------------|
| 读能力列表 | `ClientInfoPlugin.getClientKinds()` | `PictelioAppModule.getClientKinds(cb)` |
| 读当前开关 | `readClientKind()`（`@capacitor/preferences` 直读） | `PictelioAppModule.getClientKind(cb)` |
| 写开关 + 重启 | `switchClient(kind)`（写 + `ClientInfoPlugin.restart()`，进程保留） | `clientSwitchStore.switchClient(kind)`（`setClientKind` + `restart`） |
| 入口路由 | `MainActivity`（full）/ `MainActivityWebview`（webview 包无分发） | `LynxActivity` |
| 持久化键 | `pictelio_client_kind` @ `SharedPreferences("CapacitorStorage")` | 同左（Java 侧 `PictelioAppModule` 落盘同键） |

## 易混淆概念辨析

- **"切换引擎"与"切换客户端"同义**：客户端=渲染引擎承载者，切换动作是写 `pictelio_client_kind` 开关后重启 Activity 分发。不涉及运行时热切换——切换总是重启后生效。
- **能力列表 ≠ 开关值**：能力列表描述"当前包能切到什么"（`CLIENT_KINDS`，构建期决定）；开关值描述"当前生效的客户端"（运行时持久化）。独立包能力列表不含目标引擎 → 前端隐藏入口（ADR-0062）。
- **深模块与 UI 层职责分离**：`switchClient` 深模块不触碰 UI（错误经 `SwitchOutcome` 返回）；说明页（UI adapter）负责即时反馈与错误呈现。即时反馈是 UI 层职责，不泄漏进深模块。

## 切换链路与验证术语（ADR-0159 effort 新增）

| 术语 | 定义 |
|------|------|
| **插件桥线程（Bridge taskHandler）** | Capacitor Android `Bridge` 内**单个** `HandlerThread`（`taskHandler`），**所有** `@PluginMethod` 调用在其上**串行**执行。任何一个插件方法阻塞该线程，全部后续插件调用（含 `Preferences`、`ClientInfo`）排队挂起。 |
| **桥线程阻塞（Bridge starvation）** | 桥线程被同步 I/O 长时间占用的状态。ADR-0159 修复前，`PixivApiPlugin.request`/`prefetchImage` 在桥线程上同步跑网络 I/O（OkHttp `execute()`，超时上限 15s+30s），Feed 高频调用时 `switchClient` 的开关写入被排队 → 5s 超时误报、永不落盘。 |
| **契约层（Contract layer）** | E2E 用 adb `run-as` 直写/直读真实 `CapacitorStorage.xml`（`tests/android-e2e/prefs.ts`），绕过 WebView→桥→插件链路，秒级区分「写入问题」与「分发问题」。契约层通过 ≠ UI 路径通过。 |
| **UI 路径（UI path）** | 真实用户操作链：设置页入口行 → `/client-switch` 说明页 →「确认切换」。与契约层相对；只有 UI 路径能暴露桥线程阻塞、选择器腐化等集成问题。 |
| **E2E 钩子（`pictelioE2e`）** | 仅 `--mode e2e` 构建注册的全局对象（`__E2E__` define 门控，生产构建整体消除）。`confirmSwitchClient` 触发与确认按钮同一处理函数；ADR-0159 起调用后经 `document.title` 回传结果（`E2E-HOOK-CALLED` → `E2E-SWITCH-OK` / `E2E-SWITCH-<REASON>`）。 |
| **落盘（Persistence）** | 开关值经 `@capacitor/preferences`（webview）/ `PictelioPrefsModule`（lynx）写入 SharedPreferences 文件 `CapacitorStorage.xml`。写入经桥 + `editor.apply()`，**异步**；测试断言必须轮询而非单次直读。 |
| **迁移播种（Settings migration seeding）** | 登录成功后把设备级老键（`show_r18` 等）迁移为账号级键（`show_r18_<uid>`）并删除老键（ADR-0103，`settingsStore.loadAccountR18` → registry `loadInto` 的 `persistNow` 绕过写门槛）。 |
| **写门槛（Write gate）** | settings registry 仅在 `hydrateAll` 完成（`phase === "warm"`）后落盘，冷态写入只更新内存。ADR-0159 起冷态丢弃必须 `console.warn`（测试硬约束 3：禁止静默降级）。 |
| **自动降级（Engine fallback）** | ADR-0153：WebView 主版本 < 85 且 Lynx 可用时，启动以 Lynx 生效（`EXTRA_ENGINE_FALLBACK` 标记），不改写首选引擎。只在 `pictelio_low` 类设备可验证——用例必须 pin AVD。 |
| **DOM 契约（DOM contract）** | E2E 用例对页面元素形态的隐式依赖（选择器、aria-label）。UI 重构（如 `a5e2c27c` 删除首页可点击 h1）会静默作废 DOM 契约——用例应优先绑定语义化 aria-label 而非位置/标签结构。 |
| **渲染就绪信号（Render-ready signal）** | Lynx 侧以 logcat `onPageChanged` / `OnPatchFinishForFiber` 判定页面可交互；禁止裸 sleep 后盲操作（fab-hit-testing 教训）。 |
