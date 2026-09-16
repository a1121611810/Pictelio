# ADR-0164: 默认引擎翻转为 Lynx 与双向引擎降级

- 状态：accepted
- 日期：2026-09-16
- 关联：ADR-0153（本决策将其「WebView 不可用 → Lynx」单向降级推广为双向，并翻转缺省语义）、ADR-0062（能力隐藏与 `CLIENT_KINDS`）、ADR-0064（Lynx 渲染错误兜底页）、ADR-0102（Lynx task 恢复）、ADR-0136（DEBUG 门控深链钩子范式）、ADR-0159（桥线程与落盘）、ADR-0163（QA 防线与转换矩阵门）、`docs/adr/glossary-client-switch.md`（新增词条：引擎决策模块 / 自动回退开关 / 失败记忆 / 生效状态快照 / 降级原因码 / 强制 WebView / 双失败 / 无障碍回退 / E2E 降级取证键）、`docs/specs/engine-default-lynx-bidirectional-fallback.md`

## 背景

full 包自 #116 三分包、ADR-0062 能力隐藏以来，缺省引擎一直是 `"webview"`——不是某处写死的配置，而是 `pictelio_client_kind` 键**缺省**时的回退值，散落在 Java（`MainActivity` / `PictelioApp` / `PictelioAppModule`）与 TS（`clientSwitch.ts`）共 5 处字面量。ADR-0153 补上了「WebView 不可用 → Lynx」的运行时降级，但「用户选了 Lynx 而 Lynx 不可用」的路径至今**从不预检**（`MainActivity` 盲跳 `LynxActivity`），反向降级不存在。

Lynx 客户端经 2026-08~09 多轮 effort（Pinia/Vue Query 迁移、i18n、排行榜、收藏标签、搜索筛选、转换矩阵门）已承载与 webview 对等的主干能力。用户拍板：**新装默认即 Lynx；不支持时自动回退 WebView；再不行给提示**。Grill 八问 + 深读侦察（2 轮共 6 个侦察面）确认了三个此前未识别的承重事实：

1. `LynxActivity.switchBackToWebview()` 以 `remove("pictelio_client_kind")` 实现「返回 WebView」——缺省翻转后删键 = 回 Lynx = **死循环**。
2. android-e2e 全套 spec 的隐式基线是「全新安装 = webview」（`setup.ts` 的 `pm clear` 后无键），翻转后约 10 个 spec 落错引擎。
3. Lynx 的 a11y 树只暴露表单元素且渲染成功不触发任何失败信号——翻转默认会把 TalkBack 用户**静默**换到无障碍退化的引擎，现有任何降级信号都捕获不了。

## 决策

1. **缺省即 Lynx（全量翻转）**：`pictelio_client_kind` 缺省（从未选择）的语义翻转为 `"lynx"`，对全新安装与「从未进过引擎设置」的老用户一并生效。不引入安装标记——「从未选择」不是偏好。显式写入的键值语义不变；仅 full 包可感知（webview 包编译期无 LynxActivity，lynx 包以 `LynxActivity` 为 LAUNCHER 不读键）。Java 侧默认值的单一事实来源是 `build.gradle` 中 full flavor `CLIENT_KINDS` 的首元素（翻序为 `{"lynx","webview"}`）。
2. **「不支持」两级判据**：① **预检**——`LynxRuntimeInitializer.isAvailable()`（初始化不抛 ∧ native 已加载；并补上 ADR-0153 决策 1 声明过但实现缺失的「`CLIENT_KINDS` 含 lynx」合取项）；② **运行时硬错误**——bundle 加载失败、致命渲染错误（9902 / 990200 / InstantiationException / `isFatal`）。**10s 加载超时不自动跳**（慢设备 ≠ 不支持，自动弹走会让一台能跑的机器每次冷启动受罚），仍走 ADR-0064 手动错误页。
3. **单一引擎决策模块**：新建 `io.pictelio.app.engine`（`src/main/java`，flavor 中立，不引用任何 flavor 类）：`EngineRouting` 门面（`resolve` 读+决策+落快照+日志 / `decide` 纯函数 12 格矩阵 / `onLynxFailure`）+ `EngineProbe` 探针接口（`clientKinds` / `lynxAvailable` / `webviewOk` / `a11yActive`，由 flavor 适配器实现）+ `EnginePrefs`（全部引擎键的唯一所有者，收编现存 5 份键字面量、4 份文件名字面量）+ `EngineRoute` 值对象（含稳定 ASCII 原因码）。`PictelioApp`（预热）与 `MainActivity`（路由）**必须**共用同一 `resolve`——消灭「预热与路由各读一次键」的漂移面；探针惰性求值保证两条启动路径成本不变（首选 webview 的用户依旧不加载 Lynx）。顺带以 `WebViewAvailability`（framework API，可入 main）收编 `MainActivity` / `MainActivityWebview` 逐字重复的两份 WebView 版本探测。
4. **降级不落盘首选 + 失败记忆**：沿用 ADR-0153 决策 2（不可用是设备事实，不是偏好变化）。新增失败记忆键 `pictelio_engine_lynx_failure_version`（值 = 失败时的 versionCode，与当前版本**精确相等**才命中，应用升级自动遗忘），只在自动回退开关开启时读写，只在运行时硬错误自动跳时写入。若因失败记忆跳过 Lynx 而 WebView 又不可用 → **重试 Lynx**（失败记忆只为免重复白屏；WebView 走不通时 Lynx 是唯一生路）。
5. **自动回退开关（用户可控，缺省开）**：设备级键 `pictelio_engine_auto_fallback`（缺省 = 开）。只管运行时硬错误是否自动跳；**不管预检降级**（关掉它不能让不可用的 Lynx 变可用，管了反而制造「关开关 = 应用不可用」死局）。webview 设置页「客户端」卡与 lynx 个人中心客户端卡**双端**渲染该开关（只放 webview 侧则开关在其唯一有意义的场景下不可达——默认引擎已是 lynx）。
6. **告知经生效状态快照 + 提示条 + 不再提示**：每次决策覆写 `pictelio_engine_state`（`preferred=<kind> effective=<kind|none> reason=<code>`，稳定 ASCII 原因码）。webview 侧渲染可关提示条（含「知道了」与「不再提示」两个动作；「不再提示」写 `pictelio_engine_fallback_optout`）。不镜像 ADR-0153 的「消费即清一次性键」——默认翻转后「本机不支持 Lynx」会每次冷启动触发，一次性键模式会变成关不掉的每次弹窗。双向通知机制（lynx 侧一次性键 vs webview 侧快照+开关）暂不统一，记为债务。
7. **双失败提示改造既有升级页**：`res/raw/upgrade.html` 经 `loadUrl` query（`?reason=no_engine`）区分「WebView 版本过低」与「两引擎均不可用」两套文案，不新增静态资源。webview 单引擎包行为不变。
8. **无障碍回退**：系统无障碍服务启用 ∧ 两引擎均可用 → 即使首选 lynx 也以 WebView 生效（`a11y_webview`）；WebView 不可用时不因无障碍停在升级页，仍以 Lynx 兜底（`a11y_lynx_last_resort`——无障碍降级优于应用不可用）。这是唯一能防住 TalkBack 用户被静默降级的机制，成本为一个探针输入 + 一格矩阵。
9. **「返回 WebView」按钮改为显式选择**：`LynxActivity` 错误页按钮从「删键」改为「写 `pictelio_client_kind = "webview"` + 清失败记忆」——既修复决策背景 1 的死循环，也使该按钮进入 S12 显式选择语义。`PictelioAppModule.setClientKind` 与 `ClientInfoPlugin.restart`（两端显式切换路径）同样清失败记忆。
10. **防回环双保险**：① 同一次启动——S6 跳转落地 `MainActivity` 携带 `pictelio_engine_forced_webview` extra，该次启动不重新决策（仍过 WebView 版本门禁，可落升级页）；② 跨启动——失败记忆。结构上「跳转 → 决策回 Lynx → 再跳」不可能。`fallbackEntry` 判据泛化为「生效 Lynx ∧ WebView 不可用」，吸收 ADR-0153 E7 的「单次弹跳后终止」为「不弹跳」。
11. **可测性：DEBUG 门控取证键**：`pictelio_debug_force_lynx_unavailable`（仅 `BuildConfig.DEBUG` 分支读取，release 下 R8 死代码消除、分支不存在），置 true 强制 Lynx 探针返回 false。发布验收含一条硬断言：release APK dex 中不得出现该键字符串。/android-e2e 基线播种：`setup.ts` 在 `pm clear` 后显式写 `pictelio_client_kind=webview`，维持既有 spec 的隐式前提；翻转后的「无键 → Lynx」契约由 `client-kind-contract` 自带的二次 `pm clear` 用例显式断言。

## 被考虑的方案

- **仅全新安装翻转**（老用户保持 webview）：需永久维护安装标记区分「新装」与「老装从未选择」，分叉永久存在；否决。
- **翻转 + 首启播种首选键**：把「键 = 用户显式选择」稀释为「键 = 当前偏好」，与 ADR-0153「降级不落盘」边界冲突；否决。
- **改写首选键为 webview（降级落盘）**：ADR-0153 已否决的对称形式，环境恢复后回不去；否决（失败记忆 + 版本失效达成同样的免重复白屏收益而不固化偏好）。
- **全部运行时失败（含 10s 超时）自动跳**：慢设备/瞬时卡顿被当「不支持」，每次冷启动两跳惩罚；否决。
- **严格镜像 ADR-0153 一次性通知键**：默认翻转后变成每次冷启动弹一次且关不掉；否决。
- **不加无障碍探针**：TalkBack 用户被静默换到无障碍退化引擎，五层缓解链（预检/失败记忆/自动跳/开关/手动出口）无一覆盖该类；否决。
- **单一 `EnginePolicy` 三静态入口形**（design-it-twice 落选形状）：更少文件，但原因码无序列化形态，UI 拿不到「为什么降级」，探针接线在 3 个调用点重复；否决。

## 后果

**正面**：新装与存量「从未选择」用户直接使用 Lynx（其成熟度已由转换矩阵门背书）；双向降级闭环且结构防回环；重复白屏被失败记忆消除且应用升级自动恢复重试；TalkBack 用户不再被静默降级；引擎键/默认值/探测逻辑收敛单一所有者，两处逐字重复的 WebView 探测顺带收编。

**负面 / 代价**：偏好 webview 但从未进设置页的老用户被静默切到 Lynx（缓解：预检 → 失败记忆 → 自动跳 → 开关 → 手动出口五层 + 提示条）；双向通知机制两套并存（债务）；lynx 为缺省后 `warmUpWebView` 不再在缺省路径运行，显式切回 webview 的首次启动少一份预热（一次性、可接受）；新手机型上 Lynx 若现新的 R8/渲染类缺陷，爆炸半径从「主动切换的实验用户」扩至全体新装（缓解：转换矩阵发版门 + 失败记忆自动止损）；无障碍探针在每次决策多一次 `AccessibilityManager` 查询（微秒级，惰性短路）。

## 关联

- Tickets：本决策经 `/to-tickets` 拆分为 5 张依赖有序的工单（模块骨架 → 翻转+防回环原子票 → 运行时降级+开关 → 告知+i18n → E2E 取证+文档）。
- 行为变更点：`switch-client-roundtrip-low` 断言不变（S10 保持）；`client-kind-contract` 初始基线断言需增补「无键 → LynxActivity」；`webview-only-upgrade` 升级页断言收紧为精确文案。
