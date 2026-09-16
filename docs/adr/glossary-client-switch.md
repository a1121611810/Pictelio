# 客户端切换（引擎切换）— 术语表

> 范围：`pictelio-app`（webview 客户端）与 `app-lynx`（Lynx 客户端）双端共有的引擎切换机制、UI 入口与错误处理概念。配套 ADR：[ADR-0062-single-engine-client-switch-hiding.md](./ADR-0062-single-engine-client-switch-hiding.md)、[ADR-0064-engine-switch-experience-fix.md](./ADR-0064-engine-switch-experience-fix.md)、[ADR-0153-engine-availability-fallback.md](./ADR-0153-engine-availability-fallback.md)、[ADR-0159-bridge-thread-unblocking.md](./ADR-0159-bridge-thread-unblocking.md)、[ADR-0164-default-engine-lynx-bidirectional-fallback.md](./ADR-0164-default-engine-lynx-bidirectional-fallback.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **客户端（Client）** | 可独立运行的渲染客户端，二者之一：**WebView 客户端**（pictelio-app，Capacitor 桥）与 **Lynx 客户端**（app-lynx，原生 LynxView）。full 包同时包含两者；webview / lynx 独立包仅其一。 |
| **渲染引擎（Render engine）** | 客户端背后的渲染技术：Chromium WebView 或 Lynx 原生渲染。"切换引擎"即切换客户端。 |
| **切换渲染引擎入口（Switch entry）** | 设置页"切换渲染引擎"行（webview 侧）/ Lynx 客户端个人中心切换行（lynx 侧）。ADR-0062 起仅 full 包渲染该入口。 |
| **client 能力列表（Client kinds / `CLIENT_KINDS`）** | 当前包支持的客户端集合：full=`["webview","lynx"]`、webview=`["webview"]`、lynx=`["lynx"]`。Gradle 按 flavor 注入 `BuildConfig.CLIENT_KINDS`，运行时经 `ClientInfoPlugin.getClientKinds`（webview）/ `PictelioAppModule.getClientKinds`（lynx）暴露。是"包能力"的单一事实来源。 |
| **client kind 开关（Client kind switch）** | `SharedPreferences("CapacitorStorage")` 的键 `pictelio_client_kind`，取值 `"webview" \| "lynx"`。双端读写同一键同一文件，是**首选引擎**的单一事实来源；**缺省语义为 `"lynx"`**（ADR-0164 起翻转；键名等常量的唯一所有者是 Java 侧 `EnginePrefs`，JS 侧镜像常量经一致性测试钉住）。 |
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

## 引擎翻转与双向降级（ADR-0164 effort 新增）

| 术语 | 定义 |
|------|------|
| **引擎决策模块（Engine routing module）** | `io.pictelio.app.engine` 包（`src/main/java`，flavor 中立）：`EngineRouting.resolve/decide/onLynxFailure` + `EngineProbe` 探针接口 + `EnginePrefs`（键唯一所有者）+ `EngineRoute`（结果值对象）。12 格决策矩阵的唯一实现地；`PictelioApp`（预热）与 `MainActivity`（路由）必须共用同一 `resolve`，禁止各自读键决策。 |
| **自动回退开关（Auto-fallback switch）** | 设备级键 `pictelio_engine_auto_fallback`（`CapacitorStorage`），缺省 = 开启。**只管运行时硬错误是否自动跳回 WebView**，不管预检降级（关掉它不能让不可用的 Lynx 变成可用）。双端设置 UI 均渲染（webview 设置页「客户端」卡 + lynx 个人中心客户端卡）。 |
| **失败记忆（Failure memory）** | 设备级键 `pictelio_engine_lynx_failure_version`，值为 Lynx 上次**硬运行时失败**发生时的应用 `versionCode`。与当前 versionCode **精确相等**才命中；应用升级即自动遗忘。只在自动回退开关开启时写入与读取。目的：避免「每次冷启动都白屏一次再弹回」，不表达用户偏好。 |
| **显式选择（Explicit pick）** | 用户经设置页 / 错误页按钮主动选定引擎的动作。语义 = 写 `pictelio_client_kind` + **清失败记忆**（解除「本版本不试 Lynx」封印）。与降级（不改写首选）严格对立。 |
| **生效状态快照（Effective-engine snapshot）** | 设备级键 `pictelio_engine_state`，每次 `EngineRouting.resolve` 覆写一行 `preferred=<kind> effective=<kind\|none> reason=<code>`。双端 UI（「首选 X · 本次生效 Y」）与 android-e2e（adb 直读）消费同一份字符串。 |
| **降级原因码（Fallback reason code）** | 快照与跳转 extra 里携带的**稳定 ASCII 码**：`preferred` / `lynx_unavailable` / `lynx_known_bad` / `lynx_retry` / `webview_unavailable` / `a11y_webview` / `a11y_lynx_last_resort` / `no_engine` / `forced_webview` / `runtime_failure`。UI 用 `Record<code, I18nKey>` 映射文案；E2E 直接断言码值。禁止改成中文自然语言进持久层。 |
| **强制 WebView（Forced webview / 回环断路器）** | Intent extra `pictelio_engine_forced_webview`。S6 自动跳转落地 `MainActivity` 时携带：本次启动**不再重新决策引擎**，直接走 WebView 路径（仍过 WebView 版本门禁，可能落到升级页）。跨启动的回环由失败记忆承担。结构上保证「跳转 → 决策回 Lynx → 再跳」不可能发生。 |
| **双失败（Dual failure）** | 预检 Lynx 不可用 ∧ WebView 主版本 < 85（版本取不到 `-1` 是 fail-open，不算失败）。唯一无引擎可用的状态：落到静态升级页（`upgrade.html?reason=no_engine`，文案区分于普通 WebView 过低）。 |
| **无障碍回退（Accessibility fallback）** | 系统 无障碍服务（TalkBack 等）启用 ∧ 两引擎均可用时，首选 lynx 也以 WebView 生效（原因码 `a11y_webview`）；WebView 不可用时不因无障碍停在升级页，仍以 Lynx 兜底（`a11y_lynx_last_resort`，无障碍降级优于不可用）。理由：lynx 的 a11y 树只暴露表单元素，渲染成功也不触发任何失败信号，无此条则 TalkBack 用户被静默换到无障碍退化的引擎。 |
| **E2E 降级取证键（Debug force-unavailable key）** | 设备级键 `pictelio_debug_force_lynx_unavailable`，**仅 DEBUG 构建生效**（`BuildConfig.DEBUG` 恒 false 在 release 被 R8 死代码消除，发布包不含该分支）。置 `true` 强制 Lynx 可用性探针返回 false，使降级/双失败路径在普通 AVD 上可取证。验收断言：release APK 的 dex 中不得出现该键字符串。 |
