# ADR-0223：运行时 UI 树观测通道——上游 UI source map 的 React-only 边界与本仓选定形态

- **状态**：已接受（Accepted，2026-10-20）｜**T0 最小验证已落地**（模拟器实跑，见 §4 证据）
- **日期**：2026-10-20
- **相关**：[ADR-0136（benchNav 深链验证通道，DEBUG 门禁范式）](./ADR-0136-app-lynx-bench-nav-hook.md)、[ADR-0220（通知送达通道探测，跨端载荷约定）](./ADR-0220-notification-delivery-channel-probe.md)、[ADR-0163（QA 防线三网）](./ADR-0163-qa-defense-lines.md)、[ADR-0203（WebView 客户端源码删除）](./ADR-0203-webview-client-source-removal.md)
- **术语文档**：`packages/android-host/CONTEXT.md`「运行时 UI 树观测通道（runtime UI tree dump）」
- **证据**：spec [docs/specs/app-lynx-ui-tree-dump-t0.md](../specs/app-lynx-ui-tree-dump-t0.md)｜issue [#1045](https://github.com/a1121611810/Pictelio/issues/1045)｜T0 实测样本见 §3.2

---

## 1. 背景

本仓在模拟器/真机上**拿不到运行时 UI 节点树**，对「页面到底渲染了什么」这类问题只能做像素 diff。既有实测限制：

- Lynx 4.0.1 **不暴露无障碍树节点**：全仓 `.vue` 源码 220 处 `accessibility-element` 标注也不出节点（口径：`grep -rn accessibility-element packages --include=*.vue | wc -l`）；
- `uiautomator dump` 在 `pictelio_ui` 上必被 SIGKILL（exit 137），取不到快照；
- 三处 e2e spec（`transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags`）当年的应对是**整体退到截图 + 像素分析**。

Lynx 4.0 官方新增了 `LynxView.getLynxElementRoot` + `LynxElement.toJSONString`（导出运行时 UI 树）与官方 UI source map（把节点反解回源码）。本 ADR 回答两个问题：**这条路在本仓能不能走？走哪一段？**

## 2. 决策

### 2.1 上游能力边界：官方 UI source map 是 **React-only**，Vue 侧无 producer

官方文档给出的三步链路是「构建期打 `nodeIndex` → 客户端导出 UI 树 → `remapUiTree` 反解回源码」。逐段核实结论：

| 段 | 框架相关性 | 结论 |
|---|---|---|
| ① 构建期打 `nodeIndex` | **React-only** | 开关 `enableUiSourceMap` 只在 `@lynx-js/react-rsbuild-plugin`（默认 false）——⚠️ **该包本仓未安装**（React 侧包）⇒ 安装态检索 `enableUiSourceMap` **0 命中**，这条归属依据来自上游文档与该包源码。**生产端**是 `@lynx-js/react` 的 React-JSX 专用 SWC 插件（`swc-plugin-reactlynx`）。**rspeedy 层无此选项**；**vue-lynx 无等价实现**——其 main-thread 变换不保留任何位置信息（包内 `lineNumber` / `columnNumber` / `uiSourceMap` 均 **0 命中**），且 `vue-lynx@0.5.1` 已是最新发布版 |
| ①′ 汇聚端（本仓在用，但**不产记录**） | **框架无关** | `@lynx-js/template-webpack-plugin@0.11.0`（本仓在用）的 `LynxDebugMetadataPlugin` 只**汇聚** `module.buildInfo.lynxUiSourceMapRecords` 并产出 `debug-metadata.json`（`sources`/`mappings`/`uiMaps`）——它是**汇聚端不是生产端**。Vue 侧无 producer ⇒ 汇聚到空记录 ⇒ `debug-metadata.json` 的 `uiSourceMap` 三数组全空（dev 模式实测） |
| ② 客户端导出 UI 树 | **框架无关** | Lynx Android SDK 4.x 已提供 `LynxView.getLynxElementRoot(Callback<LynxElement>)` + `LynxElement.toJSONString(Callback<String>)`（对 AAR `javap` 可证）。但 `LynxElement` **只有一个公开方法** ⇒ 只能整棵抓，无按 id 取子树 |
| ③ `remapUiTree` 反解 | 框架无关 | `@lynx-js/debug-metadata` 是独立 npm 包（含 CLI）。但**没有 ① 的 `nodeIndex` 就反解不出源码位置** |

**决策**：**不走官方 UI source map 的完整链路**，只取其第 ② 段作为本仓的观测通道。

**理由**：① 的 producer 在 React 侧，Vue 侧要实现得改 `vue-lynx` 本体（上游），不是本仓能决定的；且**升级 `@lynx-js/rspeedy` / `@lynx-js/template-webpack-plugin` 不解决这个问题**——producer 不在这两个包里。

**运行时佐证（比上游文档更硬的一条）**：官方第 ① 步的作用就是「构建期给元素打 `nodeIndex`」；而本仓抓到的树上 **`debugInfo.nodeIndex` 140/140 恒为 `0`**（真机原始树实测，2026-10-20）⇒ **打标这一步在本仓构建链上压根没生效**。这不是「反解工具找不到」，是「标记没打上」——比纯靠上游文档/源码的论证更直接，也解释了为什么 `remapUiTree` 无从下手。

**后果（必须写清，避免后续误期待）**：本通道**拿不到源码位置**（`repo` / `source` / `line` / `column`）。但**拿得到组件级信息**——见 §3.2 的实测字段清单。**「拿不到源码位置」不等于「拿不到组件身份」**，这两件事不可混为一谈。⚠️ 但组件身份是**反推**出来的（靠 `class` / 语义 `id` 人工推断）：**树里没有组件名 / 文件名 / owner 字段**，不是直接给出——措辞不得写成「直接看出是哪个组件」。

### 2.2 本仓选定的通道形态

| 决策 | 内容 | 理由 |
|---|---|---|
| 触发通道 | intent extra `uiTreeDump=1`，沿用 benchNav / 通知落点同款通道 | 零新增组件、零 `app-lynx` 改动；热启动（`onNewIntent`）同样生效 ⇒ 人可自行掌握拍树时机 |
| 采样点 | 冷启动 `onLoadSuccess`（`cold`）+ 热启动 `onNewIntent`（`hot`）两处 | 只接冷启动则「App 已在跑时补拍」不可用——那正是主要用法。⚠️ **命中几个采样点取决于进程怎么死的**（2026-10-20 模拟器三场景实测）：App 正在跑 ⇒ hot 3 份；进程死、任务记录还在 ⇒ cold + hot 共 6 份；`am force-stop` ⇒ cold 3 份 |
| 门禁 | `BuildConfig.DEBUG` 作为**判定函数的入参**（非埋在分支里） | release 变体该字段是字面量 `false`（常量表达式 → javac 内联）⇒ 整块成死代码被 R8 移除；入参化让「门禁」本身可被 JVM 单测证伪 |
| 采样时机 | **连拍三份**（0 / 1.5 / 4s）；**落齐判据 = 按已知档位等齐** | `onLoadSuccess` 时 JS 未必渲染完，早拍拿到半棵树。实测体积 8.2KB → 9.0KB → 61.0KB（⚠️ **单次抓取口径**：61.0KB = T0 首次实测那次；设备现存唯一冷启动 run 的末档是 **58.0KB** ⇒ 内容漂移，详见 §3.2 的字节漂移登记），**4s 那份才是完整树**。判据必须按**档位**而不是「计数连续两次不变」——后者窗口约 1.2s < 档位间隔 2.5s，必然在空档里 break，**丢掉的正是 4s 那份**且静默 exit 0。落齐后另加 ≤2.5s **静默期**（两个采样点都命中时，两轮 4s 档落盘时间可能差几百毫秒） |
| 落盘 | 应用专属外部目录 `ui-tree/`，文件名 `ui-tree-<采样点>-<档位>ms-<序号>-<时间戳>.json` | `adb pull` 直拉（真机可用，不需 `run-as`）；随卸载清理；序号+时间戳 ⇒ 多次触发不覆盖；**带采样点与档位** ⇒ 两个采样点都命中时能分清哪份属哪轮、哪份才是完整树（否则只能靠体积猜） |
| 写盘 | 临时文件 + rename 原子写；写盘 IO 移交后台线程 | 引擎两个回调都落 UI 线程，几 MB 写盘不能占 UI 线程；rename 前目标文件不完整 ⇒ `adb pull` 会拉到半截 JSON |
| 产物形态 | **引擎原始 JSON 原样落盘**，摘要由本地脚本现算 | 诊断场景常是「不知道缺什么」——预先裁字段就丢答案；加工逻辑不进 APK |
| 失败语义 | **五条分开告警**：① LynxView 未就绪 / ② 根元素为 null / ③ 序列化为 null / ④ 抓取异常 / ⑤ 写盘失败（目录拿不到 / 目录创建失败 / 写盘异常） | 合并成一句「失败」会让人无法定位；禁静默降级。⚠️ **机器防线只覆盖 ⑤ 的两个分支**（目录创建失败、外部目录拿不到）——⑤ 的第三条子分支「**写盘异常**」（`writeArtifact` 的 catch 分支：返回失败原因 + WARN）**无机器断言**（现有的 rename 失败用例直调 `writeAtomically`、**绕过**该 catch 分支）；①②③④ 需真实引擎回调 / 真实视图 ⇒ **无机器断言**（§3.3 已登记） |

### 2.3 明确不做

- **自动等「首载落定」**：落定是**逐页面**属性（各页面/组件各自持有 `settled`，仓库无全局汇聚点，共享的只有 `deriveFirstLoadView` 纯函数）⇒ 做成中央层需逐页改动，超出本票边界。连拍 + 人工选样本已能覆盖。
- **e2e 断言接入**：另开票 **#1047**。本票只交「人工诊断通道」，字段清单作为后续定契约的依据。
- **release 可用**：产物含作品标题/昵称等真实内容，且本能力是调试通道。
- **工具链升级**（`@lynx-js/rspeedy` 0.13.6→0.18.2 等）：与本能力无关，且**不解决** §2.1 的 producer 缺口。

## 3. 后果

### 3.1 相对既有手段的增量

本仓此前只能做像素 diff（a11y 树不暴露、`uiautomator dump` 被 SIGKILL）。UI 树给出**结构 + 语义 + 几何**三层，比像素 diff 精确得多，且可机器断言。其中 **`accessibility-label` 在 UI 树里**（a11y 树并不暴露给 uiautomator）——这是本通道相对既有手段的独有增量。

### 3.2 实测字段清单（T0，模拟器 `pictelio_ui`，推荐页，140 节点）

| 字段 | 覆盖 | 内容 | 诊断价值 |
|---|---|---|---|
| `tag` | 140/140 | `page` / `view` / `image` / `text` | 元素类型 |
| `attributes.class` | 138/140 | Tailwind 类名数组 | **可反推是哪个组件**（⚠️ 树里**没有**组件名 / 文件名 / owner 字段 ⇒ 组件身份是**反推**出来的） |
| **顶层 `id`** | **140/140**（16 个非空） | 语义 id，含作品 id（`pictelio-hero-root` / `pictelio-hero-source-<illustId>`） | **定位到具体作品**。⚠️ 与 `attributes.id` 是**两个不同字段**（后者只在 16 个节点上）⇒ **脱敏必须盖两处**。⚠️ **「16 个非空」是属性级覆盖数、随作品内容漂移**（第 10 轮 Spec 轴实测：同一页面活体抓取为 **19**、本表所记 fixture 为 **16**，而 140 节点 / 深度 10 / class 138 / a11y 2 / tag 分布 / 事件分布**逐项吻合** ⇒ **内容漂移、非口径错误**）⇒ **不可当跨次抓取的契约基线**（#1047 写 e2e 断言时须避开这条） |
| `attributes.id` | 16/140 | 同一语义 id 的另一处落点 | 同上（漂移登记见上一行） |
| `attributes.accessibility-label` | 2 | 如 `打开菜单`、作品标题 | a11y 标注在树里 |
| `attributes.accessibility-element` | 4（2 个为 true） | 树内 a11y 标记 | 哪些节点被标为 a11y 元素 |
| `attributes.vue-ref-N` | 132/140 | Vue 实例序号（⚠️ 只是序号，不含组件名） | 区分同构实例 |
| `attributes.style` | 51/140 | 已解析的内联样式 | 布局实况 |
| `attributes.text` | 12/140 | 文本节点内容 | 节点里写了什么 |
| `attributes.src` / `lazy-load` / `mode` | 各 20/140 | 图片资源 URL / 懒加载标记 / 图片模式 | 图片链路实况 |
| `position` | 140/140 | `frameInRoot` + `frameInScreen` **两套坐标系** | 命中测试几何 |
| `events[]` | 50 节点 | `{eventName, function, runtime, type}` | 哪个节点可交互、绑的哪个 handler |
| `nodeId` | 140/140（**140 个互不相同**） | 引擎分配的节点序号 | **节点级 diff 的键**（唯一性已实测） |
| `debugInfo.nodeIndex` | 140/140（**取值恒为 0**） | 官方 UI source map 的构建期打标位；`debugInfo` **只有** `nodeIndex` 这一个键，无源码位置 | ⚠️ **不能当身份用**（140 个节点取值全同 ⇒ 作 diff 键恒真）⇒ 它是「构建期打标**没生效**」的运行时佐证（见 §2.1） |

事件名分布（实测）：`tap` 29 / `load` 20 / `error` 20 / `touchstart` 5 / `touchmove` 5 / `touchend` 5。

抓取往返耗时 4–10ms（140 节点 / 55,895 字节；实测最坏样本往返 83ms）⇒ **UI 线程开销可忽略**（大树另计）。⚠️ **该区间同属「单次抓取口径」**：2026-10-20 另一次真机复跑为 55,806 字节 / **9–14ms** ⇒ 耗时与字节数一样会漂移，**稳定的是结构统计量**。日志字段名取「抓取往返耗时」而非「序列化耗时」——它覆盖的是「发起抓取 → 拿到 JSON」整段往返，序列化只是其中一段。

⚠️ **字节数会随内容漂移，别把某一次的字节数当成不变量**：本节出现的 55,895（原始抓取，**原始文件未入库、事后不可复算**）、55,724（入库 fixture，脱敏后，**可复算**）、55,806（2026-10-20 第 4 轮收敛时真机复跑一次「App 已在跑」⇒ hot 3 份，三档同为 55,806）——同一页面、不同次抓取的字节数不同（作品 id/标题/图片 URL 的内容与长度都变）。**冷启动那组同理**（第 11 轮 Standards 轴实测补登记）：T0 首次实测 8,168 / 8,961 / 61,013，设备现存唯一冷启动 run（2026-10-20 05:36）为 8,168 / 8,961 / **58,022** ⇒ 前两档**逐字节复现**、末档差 2,991 字节（4.9%）⇒ 该份 147 节点 / 深度 11（热启动与入库 fixture 是 140 节点）⇒ **内容漂移**。**稳定的断言是结构统计量**（140 节点 / 深度 10 / class 覆盖 / a11y 数 / 事件分布 / tag 分布），字节数只在「同一次抓取内部」比较才有意义。⚠️ **`id 数`（非空语义 id 计数）已从「稳定量」清单移出**（第 10 轮 Spec 轴实测：同一页面活体抓取非空 id = **19**、入库 fixture = **16**，而 140 节点 / 深度 10 / class 138 / a11y 2 / tag 分布 / 事件分布**逐项吻合** ⇒ 是**内容漂移**、不是口径错误）——它与 `attributes.style`（第 8 轮实测活体 48、第 11 轮实测活体 50 vs fixture 51）同属**属性级**覆盖数，只在「同一份抓取内部」可比。

宿主侧度量日志字段（logcat `UiTreeDump`）：`字节=` · `节点数=` · `抓取往返耗时=` · `采样点=` · `采样延迟=` · `路径=`。**节点数由宿主在落盘线程解析 JSON 得出**（不占 UI 线程；口径与脚本侧 `summarize` 一致：**只把对象算作节点，null 与数组元素两侧都不计** ⇒ 两边数字可互校，且有机器防线：JVM 侧对同一份真实 fixture 断言 140，与 Node 侧同一期望值互校）——现场只有 logcat 时也能判断树有多大。

**真实样本已入库**：`packages/android-host/tests/fixtures/ui-tree/recommend-page.sample.json`（55,724 字节 / 140 节点 / 深度 10）。脱敏只改**内容值**、不改结构（节点数 / 深度 / class 覆盖 / id 数 / a11y 数 / 事件分布 / tag 分布均与原始抓取逐项一致）。⚠️ 这里的「与原始抓取逐项一致」说的是**脱敏前后**（同一份抓取的脱敏副本），**不是**「跨不同次抓取不变」——`id 数` 跨次抓取会漂（16 → 19，见 §3.2 的漂移登记）。
⚠️ **脱敏要盖多种形态**（第 2、3 轮 review 两次抓到、第 4 轮补第三种落点）：① 作品 id 有**两个落点**——顶层 `node.id`（140/140 都有该键，16 个非空）与 `attributes.id`（只在 16 个节点上）⇒ 只盖后者会从顶层漏出 15 处明文；② 作品 id 还会以**路径形态**出现在 `attributes.src`（`/<数字>/`、`ci<数字>_`）⇒ 只认「语义 id 形态」的门禁会 0 命中静默放过；③ src 里还有**稳定作品指纹**——p0 的 32 位十六进制哈希与上传时间路径（`/<年>/<月>/<日>/<时>/<分>/<秒>/`），两者都能反查作品；④ 第 4 轮 review 另指出**裸形态**（`150995806` / `p0_150995806_…`）——前三种形态全靠上下文识别，id 单独出现在某个字段里时全部落空 ⇒ 门禁 0 命中静默放过。⇒ 门禁改为**六种形态**断言 + **两条**反向对照（一条「还原成明文必须被抓到」、一条点名「裸 id 形态这一条自己必须命中」）。

### 3.3 尚未覆盖

- **e2e 断言**：本票未做。三处基于树的断言见 follow-up **#1047**（`transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags`），契约以 §3.2 字段清单为准。
- **release 变体的实际行为 / dex 级「R8 确实移除了本类」**：JVM 单测只跑 debug 变体（`BuildConfig.DEBUG` 在 debug 侧是 `Boolean.parseBoolean("true")` 方法调用、**不是**常量表达式、javac 不内联）。既有 `verify:android-host:release-buildconfig` 门禁**只证取值**（release 变体的 `BuildConfig.DEBUG` 为 `false`），证不到「早退分支被绕开」（那一层由源级守卫覆盖），也证不到 R8 移除 ⇒ dex 级断言见 follow-up **#1048**。
- **「连拍三份」的调度时序**：由 Handler 驱动，单测只断言常量取值，不验证时序。
- **四条抓取侧失败语义没有机器断言**：§2.2 的失败语义共**五条**，其中 ① LynxView 未就绪 / ② 根元素为 null / ③ 序列化为 null / ④ 抓取异常 **四条无任何机器防线**——它们分别在 `getLynxElementRoot` / `toJSONString` 的回调里，需要**真实引擎回调与真实视图**才能触发，而 `LynxView` 是 SDK 的 final 类、无法在 JVM 单测里替身 ⇒ JVM 门禁只覆盖 ⑤ 写盘侧的两个分支（目录创建失败、外部目录拿不到）。⚠️ 「`writeAtomically` 抛错 + 清临时文件」这一层**有**断言（`writeAtomically_renameFails_throwsAndCleansTempFile`），但它**直调 `writeAtomically`、绕过 `writeArtifact` 的 catch 分支** ⇒ ⑤ 的第三条子分支「**写盘异常**」（返回失败原因 + WARN）**无机器断言**。**这四条靠代码审读与真机走查保证**（实现里确有对应 `Log.w`，不是静默降级）。
- **编排层 `scripts/dump-ui-tree.mjs` 的参数解析本身无门禁**：真正跑 adb 的部分需要真设备，无法在 CI 里单测；可测判据（落齐、退出码、产物名解析、摘要统计、清理范围、**输出目录安全校验**）**全部下沉到 `scripts/lib/ui-tree-dump-core.mjs` 并在那里单测**。⚠️ 仍留在编排层、**无机器防线**的只剩「参数解析」本身（未知参数、缺值、`--wait` 非正整数）；第 4 轮 review 的阻塞项（`--out ""` 会删掉整个工作目录）**当时**正是这样漏出去的——第 4 轮已把**目录安全校验**下沉到 lib 层并补上门禁（见 §3.4「逐门禁登记表」），但**参数解析那一层仍是人工复验** ⇒ 挂账 **#1049**。
- **源级守卫不覆盖「宿主侧新增的第二个导出出口」**：`uiTreeDumpReleaseGate.test.ts` 守住的是「`scheduleIfRequested` 的**每个调用点**都传了 `BuildConfig.DEBUG`」，但**不证「宿主侧没有别的出口导出 UI 树」**（未来新增另一个触发通道直接调 `UiTreeDump` / `getLynxElementRoot` 时该守卫不会红）⇒ 挂账 **#1049**。

### 3.4 本通道的机器防线（第 1 轮补齐；第 2、3、4 轮各补判别力缺口）

> **轮次约定**（本文通用，消除「第 N 轮」的歧义）：「第 N 轮」= **第 N 次 review 及其修复**为一轮，与前 4 轮的 commit 命名一致（如「第 2 轮双轴 review 的修复轮」）。本文正文一律用**明确轮次号**，不写「本轮」——文档会活得比那一轮久，「本轮」对读者是歧义源。

本通道横跨 **Java 宿主 / Node 脚本**两侧，两侧无共享代码；且「release 不导出」这条承诺原先只有约定、没有机器防线。第 1 轮 review 把这两处补成可执行门禁；此后三轮各用**反事实实测**又找出「门禁存在但没判别力」的缺口，逐条落在下表对应行里。

下表按仓库既有的**逐门禁登记表**范式记（`docs/adr/glossary-md3-alignment.md` §13.8.1：门禁 / 实际守住的契约 / 抓不到的情况（失效面）/ 该失效面是否已登记）——**失效面必须逐门禁登记**，不得只记它抓到了什么（`workflows/review-fix-loop.md` 门禁冻结线第 5 条）。

| 门禁（位置 · 行数） | 实际守住的契约 | 抓不到的情况（失效面） | 该失效面是否已登记 |
|---|---|---|---|
| `UiTreeDumpProtocolContractTest.java`（JVM · 266 行） | 协议常量逐字比对（6 要素：extra 键 / 目录名 / 文件名前后缀 / 采样档位 / 采样点标识）；**行为面**比对（宿主真实产出的产物名必须能被脚本侧正则解析）；抽取器须**恰好 1 条**（否则「两侧相等」变恒真断言） | ① 只比对**字面量**，不证「两侧都真的在消费这个常量」；② 行为面只验「产物名 ↔ 正则」，不验「脚本拿这个名字去读的东西存在」 | ① **已登记**（本表 + 协议门禁文件头「已知失效面」块第 1 条「只比对字面量，不比对行为」）；② **已登记**（本表；⚠️ **协议门禁文件头未登记此面**——该块三条均非本条） |
| `uiTreeDumpReleaseGate.test.ts`（393 行） | `UiTreeDump.scheduleIfRequested` 的**每个**调用点都必须传 `BuildConfig.DEBUG` 与采样点标识（源级守卫） | ① **只覆盖 Java 调用点**：不证「宿主侧没有**别的**出口导出 UI 树」（未来新增触发通道无人拦）；② 扫描根 = `src/lynx/java` + `src/main/java` **两个生产源集递归**（实测 57 文件：56 个 `io.pictelio.app` + 1 个 `io.pictelio.app.config`）⇒ **新增 source set / 新增 Gradle 模块**的调用点不在面内；「跨包调用点」这一条实际**不可达**（`UiTreeDump` 是 package-private，跨包无法合法调用）；③ 抽取实参前**先剥注释**（第 2 轮补）——裸 `includes` 会被注释骗过；④ **实参判定是子串匹配**（`args.includes("BuildConfig.DEBUG")`）⇒ `BuildConfig.DEBUG \|\| someFlag`（release 下 `false \|\| x` **不可**常量折叠 ⇒ 该调用点在 release 包里会**真的导出**）与 `MyBuildConfig.DEBUG` 这类子串同名**均判绿放行**（第 8 轮 Standards 轴实测抓出；本表此前连「`&&` 形态会判红」这个**失实**的旧说法都还写着）⇒ 守卫**不拦**这些形态，需人工复核；⑤ **采样点标识的判定同样是子串匹配**（`args.includes("UiTreeDump.POINT_")`）⇒ 只验「实参里出现了某个 `POINT_` 常量」、**不验传的是 `POINT_COLD` 还是 `POINT_HOT`** ⇒ 冷启动调用点误传 `POINT_HOT` 同样判绿（第 11 轮 Standards 轴实测抓出）——影响面**低于**④：只决定产物名里的冷/热标签，**不影响 release 是否导出**，落齐判据（按档位分组）也不受影响；但会让诊断者按「三场景 → cold/hot 份数」读错归属 | ① **已登记** + 挂账 **#1049**；② **已登记**（守卫文件头「扫描面」节）；③ **已登记**（本表，第 2 轮补）；④ **已登记**（门禁文件头 + 本表，第 8 轮补）——**收紧判据属强度变更 ⇒ 挂账 #1049**；⑤ **已登记**（门禁文件头 + 本表，第 11 轮补）——**收紧判据属强度变更 ⇒ 挂账 #1049** |
| `ui-tree-dump-core.test.ts`（362 行） | 落齐判据（缺 4s 档不得判落齐）/ 真实样本回放 / 退出码（未落齐·超时·拉回失败·非法 JSON ⇒ 非零）/ fixture 脱敏**六形态** + 两条反向对照 / 清理范围（只删本通道产物的**普通文件**）/ **节点身份**（`nodeId` 140/140 唯一、`nodeIndex` 恒 0） | ① 真实样本回放是 **characterization**（锁 2026-10-20 那一次抓取的结构分布），不是「实现正确」的证据；② 脱敏六形态靠**正则**，字面量形态再变一种就可能落空；②′ 脱敏形态**④⑤**（p0 的 32 位十六进制哈希 / 上传时间路径，即本 ADR 自认的两个「**稳定作品指纹**」）**无反向对照自证** ⇒ 它们的正则若被写错（如位数不对）会退化为**恒真断言**且**无任何测试转红**（现有两条反向对照**只还原 `<illustId>`**；`<p0hash>`（4 处）/ `<uploadDate>`（20 处）两个占位符的还原变体从未被任何对照覆盖——第 8 轮 Spec 轴实测：还原这两者后形态④命中 4、形态⑤命中 20，**门禁当前行为正确**，缺的只是「非恒定性」的自证）；③ spec 字段表里有一批覆盖数（`style` 51 / `text` 12 / `src`·`lazy-load`·`mode` 各 20 / `vue-ref-N` 132 / `accessibility-element` 4）**目前无断言**（换引擎版本漂移无人拦）；③′ 顶层 `id` 的**非空数**（16）与 `attributes.id` 的 16 只有**合并计数**（`node.id || attrs.id`）间接钉住，**无独立断言**（键存在 140/140 与脱敏 15 处已断言）；④ 节点级 diff 的键是 **`nodeId`**（140/140 唯一），**不是 `debugInfo.nodeIndex`**（140 个取值恒为 0 ⇒ 作 diff 键恒真） | ① **已登记**（文件头 + 本表）；② ②′ **已登记**（本表；②′ 第 8 轮补入，**补自证挂账 #1049**）；③③′ **已登记**（本表，第 5 轮补；第 7 轮补入 ③′ 合并计数口径）；④ **已登记**（本表，第 6 轮补） |
| `ui-tree-dump-outdir.test.ts`（166 行） | 输出目录**不得是工作目录本身或其祖先**（判据在 `lib/ui-tree-dump-core.mjs` 的 `assertSafeOutDir`，**按 inode 判定** ⇒ 大小写变体、符号链接别名都挡得住）；**取值 + 校验的单一出口** `resolveOutDir` ⇒ **默认输出目录与显式 `--out` 走同一条防线**（第 6 轮 Standards 轴实测抓到：此前默认值完全绕过判据） | ① **只管「输出目录」这一项**（默认值与显式 `--out` 现已同路）：编排层的**参数解析**（未知参数 / 缺值 / `--wait` 非法值）仍**无门禁**；② 只挡「落在 CWD / 祖先」这一类误伤，不挡「输出目录里的同名文件会被删」（那由清理范围收紧兜底）；③ `isArtifactName` **大小写敏感** ⇒ `UI-Tree-*.json` 不会被清理（fail-open 残留，**无破坏**）；④ `sameDirectory` 在 `stat` 失败时 **fail-open**（判不出「同一目录」⇒ 判成「不是」）——**当前不可造成破坏**：`stat` 失败与 `readdir` 成功不可能同时发生（目标不存在⇒同为 `ENOENT`；父目录 `mode 000`⇒同为 `EACCES`），而清理以 `readdir` 为前置 ⇒ 该分支下不会发生删除；⚠️ 残留风险是**将来把清理实现改成不列举目录**，那时这条 fail-open 会变为可利用 | ① **已登记** + 挂账 **#1049**；② **已登记**（本表）；③ **已登记**（本表，第 5 轮补）；④ **已登记**（本表，第 6 轮补） |
| `UiTreeDumpTest.java`（JVM · 431 行） | 触发真值表（extra 缺失 / 空串 / 非空串）/ 采样档位 / 落盘目录形态 / 文件名不互相覆盖 / 原子写**成功 + 失败双路径** / **写盘侧两条失败路径分别告警**（目录创建失败 / 外部目录拿不到）/ 节点数口径（与 Node 侧同一 fixture 互校 140） | ① 只跑 **debug 变体**（release 的 R8 移除层证不到 ⇒ **#1048**）；② 「连拍三份」的**调度时序**不验证（只断言常量）；③ 度量日志只断言**字段名**、不断言取值；④ 6 个度量字段里 **`路径=` 没有任何断言**（其余 5 个有）；⑤ §2.2 的失败语义共**五条**，本门禁只覆盖 ⑤ 写盘侧的两条——**① LynxView 未就绪 / ② 根 null / ③ 序列化 null / ④ 抓取异常四条无机器断言**（需真实引擎回调，`LynxView` 是 SDK final 类、无法替身）；**⑤ 的第三条子分支「写盘异常」（`writeArtifact` 的 catch 分支：返回失败原因 + WARN）同样无机器断言**——现有的 rename 失败用例直调 `writeAtomically`、**绕过**该 catch 分支 | ① **已登记**（§3.3；另挂账 **#1048**）；② **已登记**（§3.3）；③ **已登记**（`UiTreeDumpTest.java` 写盘成功路径用例的 javadoc「此处钉住**字段名**而非具体数值」）；④ **已登记**（本表，第 6 轮补）；⑤ **已登记**（§3.3 + 本表，第 6 轮补；第 9 轮补「写盘异常」这一条） |

**逐轮补的到底是什么**（上表只记「现在守什么/抓不到什么」，这里记「哪一轮补的、为什么补」）：
- **第 1 轮**：补齐跨端协议门禁、落齐判据回归、真实样本回放、DEBUG 接线守卫、退出码门禁。⇒ 退出码判据下沉成纯函数 `exitCodeFor`（第 1 轮只改了告警文案、退出码仍是 0 ⇒ 「静默 exit 0」缺陷**未闭环**）。
- **第 2 轮**：① fixture 脱敏声明**不实**（第 1 轮只脱敏了 `attributes.id`，**顶层 `node.id` 仍留 15 处明文**——摘要取 `node.id || attributes.id` ⇒ 明文从顶层漏出）；② DEBUG 守卫**只认一种形态**（把 id 写回 `attributes.src` 即可 0 命中静默放过）；③ DEBUG 守卫**可被注释绕过**（裸 `includes("BuildConfig.DEBUG")`，实参真值写成 `true`、同列表里留一句 `// TODO 改回 BuildConfig.DEBUG` 即 **7/7 全绿骗过**——Spec 轴 F2 阻塞项）；④ 守卫扫描面只覆盖单个 `.java`（第 1 版把第三个调用点放进别的文件即骗过守卫）。
- **第 3 轮**：① `adb pull` 报错但本地已有同名文件时只打告警、退出码仍是 0 ⇒ 「拉回失败」必须**无条件计入失败**且不拿它的内容当本次产物打印；② 宿主侧节点数口径与脚本侧分叉（数组元素算不算节点）⇒ 两侧对齐 + 跨端互校 140。
- **第 4 轮**：① `--out` 整目录递归删除 ⇒ `--out ""` **把用户的整个工作目录删掉**（实测复现）；② 「冷启动 6 份」失实 ⇒ 订正为「取决于进程怎么死的」三场景；③ 摘要按字典序 ⇒ **最空的那份排在最前** ⇒ 收工时点名最完整的一份；④ 门禁规模线基线停在旧快照。
- **第 5 轮**：① 第 4 轮的第一版目录守卫**只比字面路径** ⇒ macOS 的 `/tmp` → `/private/tmp` 符号链接让同一目录被看成两个、**没被拒**（外部锚点实测抓到）⇒ 改按 **inode** 判定；② 同轮 Standards 轴又抓到**大小写变体**绕过（macOS 默认 APFS 大小写不敏感、`realpathSync` 不归一化大小写 ⇒ 同一 inode 但字符串不等）⇒ 同样靠 inode 判定堵住；③ 清理遇到**名叫 `ui-tree-*.json` 的目录**会抛 EISDIR 让整跑批中止 ⇒ 判据只删**普通文件**；④ `assertSafeOutDir` 的 `target` 相对路径按**进程 CWD** 解析、与 `cwd` 参数基准不一致 ⇒ 统一按 `cwd` 解析。
- **第 6 轮**：① **默认 `--out` 完全绕过输出目录安全校验**（Standards 轴在真实文件系统上实测复现：工作目录恰是默认输出目录时，**CWD 里的通道产物被删**，而同一时刻显式 `--out <同一目录>` 被正确拒绝 ⇒ **两条路径行为分叉**）⇒ 修法**不是**「给默认值补一次校验」（那仍是两条路径，将来还会分叉），而是把**取值与校验合成 lib 层的单一出口** `resolveOutDir` ⇒ 默认与显式不可能分叉；配套门禁（`ui-tree-dump-outdir.test.ts` +3 条，变异验证：去掉校验即转红）+ 外部锚点（假 adb + 真实文件系统，**含修复前对照**：修复前同一场景 exit 0 且哨兵被删）；② `sameDirectory` 的 **stat 失败 fail-open** 未登记 ⇒ 补进 §3.4 登记表（并附「当前不可造成破坏」的实测依据：`stat` 失败与 `readdir` 成功不可能同时发生）；③ 三处口径订正——`BuildConfig.DEBUG` 的形态（「整段包裹」→「**判定函数入参**」，与 §2.2 / `CONTEXT.md` 对齐）、失败语义条数（「三条」→「**五条**」，并标明只有写盘侧两条有机器防线）、`nodeId` / `debugInfo.nodeIndex` 的身份表述（`nodeIndex` 140 个取值**恒为 0** ⇒ 不能作 diff 键，键是 `nodeId`）。
- **第 7 轮**（收敛确认轮，两轴合计 7 条，阻塞 0）：① **悬空指针**：Java 协议测试头注释指向 spec 的「接缝③」，而 spec 全文 **0 处**「接缝」（旧的编号体系已删、代码注释没跟上）⇒ 改指向 spec「Testing Decisions · 跨端协议门禁」；② **spec 括注与交付物自身事实不符**：原文写「`标签#4`（作品标题，与 `文本#4` 同一段原文）」，实测**该 a11y 标签节点自身的 `attributes.text` 是 `文本#8`**、`文本#4` 是另一个节点的 hashtag 串（fixture 解析 + 真机原始树「犬エマ」排第 8，两路互证）⇒ 订正，且改成**不依赖占位符序号**的表述（序号会随样本重排漂移）；③ ADR §3.4 登记表补失效面 ③′（顶层 `id` 的非空数与 `attributes.id` 的 16 只有**合并计数**间接钉住，**无独立断言**）；④ 编排层 4 处 `console.error` 补 `[ui-tree] ` 模块前缀（其余用户可见消息都有，这 4 处是 stderr 里唯一看不出出自哪个工具的行）；⑤ `--wait` 判据与文案对齐（文案承诺「正整数毫秒」，而 `Number.isFinite` 会放行 `1.5` ⇒ 改 `Number.isInteger`）；⑥ outdir 门禁文件头订正归因（`--out ""` **先**由编排层 `needValue` 拒，lib 层那条分支 CLI 不可达）；⑦ spec 与 §4 的**外部锚点复现清单**补「不传 `--out`、而工作目录恰是默认输出目录」这一条，并把**对照跑法钉死**在 `git show 3cd21afc:`（用 `HEAD:` 取到的是已修复版本 ⇒ 对照会变成假绿——该锚点就是这样自己报红一次才暴露的）；另订正 3 处「本轮」歧义措辞。
- **第 8 轮**（收敛确认轮，两轴合计 7 条，阻塞 0）：① **release 接线守卫的实参判定是子串匹配**（`args.includes("BuildConfig.DEBUG")`）⇒ 门禁文件头原写「`BuildConfig.DEBUG && someFlag` 会判红」是**失实**的（实测判绿），且真正危险的 **`||` 形态**（release 下 `false || x` **不可**常量折叠 ⇒ 该调用点在 release 包里会**真的导出**）与 `MyBuildConfig.DEBUG` 这类子串同名**均判绿放行**、此前**未登记** ⇒ 文件头改为如实描述、§3.4 登记表该行补失效面 ④，收紧判据属**判据强度变更** ⇒ 挂账 **#1049**；② **脱敏形态④⑤**（p0 哈希 / 上传时间路径 = 本 ADR 自认的两个「稳定作品指纹」）**无反向对照自证** ⇒ 正则写错会退化为**恒真断言**且无测试转红（实测当前行为正确：还原后形态④命中 4、形态⑤命中 20）⇒ 补进 §3.4 失效面 ②′，补自证挂账 **#1049**；③ 编排层 `main()` **105 行 → 66 行**（**总行数**口径；非空行 101 → 62）——抽出 `pullAndReportArtifact` / `printArtifactDetail`，**纯机械拆分、零行为变更**（⚠️ 第 9 轮 Spec 轴复算订正：本条原写的「**107 行 → 62 行**」两个数字**都对不上**——`107` 在**任何 commit 都不成立**（拆分前连续 5 个 commit 恒为 105 行），`62` 只在「非空行」口径下成立 ⇒ 行数必须**连口径一起写**）；④ §3.4 规模线台账的「比例」列曾**混用**百分数与裸比值（首行 `2.4%`、其余 `0.46` ⇒ 字面读会把 `0.46` 读成 0.46%，**方向与 ⚠️ 标注的「超 30%」正好相反**）⇒ 统一为百分数；⑤ spec 两处口径订正：「稳定统计量」里的「字段覆盖」明确为**节点级**（属性级覆盖数实测会随作品内容漂移：`attributes.style` 51 → 48）、外部锚点的 `--out` 情形清单补齐第 5 轮抓到的**物理路径**与**大小写变体**两种（共八种）。
- **第 9 轮**（收敛确认轮，两轴合计 5 条，阻塞 0）：Standards 轴 0 阻塞 / 1 次要 / 1 提示，Spec 轴 0 阻塞 / 1 次要 / 2 提示 ⇒ **五条全是「文档口径」层**，无产品缺陷。① **「⑤ 写盘失败」的机器防线覆盖口径三处矛盾**（§2.2 与 spec 说「只覆盖 ⑤ 的两个分支」，§3.3 却写成「+ 原子写失败」⇒ 读者会以为 `writeArtifact` 的 catch 分支有防线）——实测 `UiTreeDumpTest` 的 17 个 `@Test` **无一**把 `writeArtifact` 推进 catch 分支，rename 失败用例直调 `writeAtomically`、**绕过**该分支 ⇒ ⑤ 的第三条子分支「**写盘异常**」实为**无机器断言** ⇒ 三处统一措辞 + §3.4 row 5 失效面 ⑤ 补登记；② §3.4 第 3 行第 4 列的定位符「（文件头 + 本表）」把 ② / ②′ 一并裹了进去，而门禁文件头的「已知失效面」块**只有 4 条**、② 与 ②′ **都不在**其中 ⇒ 拆成逐条定位符（① 在文件头 + 本表；② ②′ 在本表）；③ **逐轮史里的行数同样会漂移**（第 8 轮条目写的「`main()` 107 行 → 62 行」两个数字都对不上：`107` 在**任何 commit 都不成立**、拆分前连续 5 个 commit 恒为 105 行；`62` 只在非空行口径下对）⇒ 订正为「**105 行 → 66 行**（总行数口径；非空行 101 → 62）」，并在「取法说明」补一句：**逐轮史的行数也要连口径一起写**（本 ADR 自己反复警告的「量完数字又改了代码」型漂移，这次落在历史叙述上）；④ **release 守卫的扫描面被写成「同包」是失实的**——实现扫的是 `src/lynx/java` + `src/main/java` 两个源集递归（57 文件），其中 **1 个在 `io.pictelio.app.config`** ⇒ 跨包文件**在**面内；真正成立的边界是「**新增 source set / 新增 Gradle 模块**不在面内」，而「跨包」这一条**不可达**（`UiTreeDump` 是 package-private，跨包无法合法调用）⇒ §3.4 失效面 ②、台账分母描述、取法说明、门禁文件头**四处**一并订正；⑤ `UiTreeDumpTest` 文件头把产物名跨端可解析性的机制说成「**共享 fixture**」——实际机制是「**两侧字面量逐字比对 + 行为面**（宿主真实产物名撞脚本侧正则）」，本票唯一的共享 fixture 是 `recommend-page.sample.json`（服务于**节点数**跨端互校，与产物名解析是两套不同机制）⇒ 订正措辞。
- **第 10 轮**（收敛确认轮，两轴合计 4 条，阻塞 0）：Standards 轴 0 阻塞 / 1 次要 / 0 提示，Spec 轴 0 阻塞 / 2 次要 / 1 提示 ⇒ **四条全是「文档登记 / 清单归类」层**，无产品缺陷、无行为变更。① **§3.4 登记表第 4 列的三处定位符指向 §3.3，而 §3.3 不含对应失效面**（§3.3 全文对 `消费`/`存在`/`扫描面`/`源集`/`模块`/`度量`/`字段名`/`路径` 的 grep 命中 **0**）——row 1 的 ①② 真正登记在**协议门禁文件头「已知失效面」块**、row 2 的 ② 真正登记在**守卫文件头「扫描面」节**、row 5 的 ③ 真正登记在 `UiTreeDumpTest.java` 写盘成功路径用例的 javadoc ⇒ 三处改为**逐条**定位符（并**用小节名而非行号**，避免制造新的行号漂移点）；② **spec 把「剩余盲区」记成两处，实际 ADR §3.4 与 #1049 已登记并挂账四处**（#1049 实有 4 个子节：参数解析 / 无第二出口 / 脱敏形态④⑤ 自证 / release 守卫实参判定是子串匹配）——漏掉的第 ④ 项恰是**安全相关**那条（`BuildConfig.DEBUG || someFlag` 判绿放行、release 下 `false || x` 不可常量折叠 ⇒ release 包会真的导出 UI 树）⇒ spec 改「四处」并补 ③④ 指向；③ **「稳定的断言是结构统计量」把 `id 数` 归入稳定量，但它实测随作品内容漂移**——同一页面活体抓取非空 id = **19**、入库 fixture = **16**（其余结构统计量 140 节点 / 深度 10 / class 138 / a11y 2 / tag 分布 / 事件分布**逐项吻合** ⇒ 内容漂移、非口径错误）⇒ `id 数` 与 `attributes.style` 同属**属性级**覆盖数，从 ADR §3.2 / spec 的稳定量清单**移出**、并在 §3.2 字段表登记漂移证据（#1047 若把它写成活体 e2e 断言会**假红**）；④ §3.2「脱敏只改内容值、不改结构」补限定：那句说的是**脱敏前后**一致，**不是**「跨不同次抓取不变」。
- **第 11 轮**（收敛确认轮，两轴合计 6 条、其中 1 条两轴重复 ⇒ **5 条独立**，阻塞 0）：Standards 轴 0 阻塞 / 2 次要 / 1 提示，Spec 轴 0 阻塞 / 2 次要 / 1 提示 ⇒ **五条全是「文档登记 / 口径」层**，无产品缺陷、无行为变更。① **§3.4 登记表 row 1 第 4 列的定位符失实**（Standards 轴与 Spec 轴各报一次，同一条）：原写「①② **已登记**（本表 + 协议门禁文件头「已知失效面」块）」，但该文件头的三条（只比对字面量 / 不覆盖产物名里的动态部分 / 不覆盖路径中的包名）**均非**失效面 ②（行为面只验「产物名 ↔ 正则」，不验「脚本拿这个名字去读的东西存在」）⇒ 改为**逐条**定位符（① 指向文件头第 1 条 + 本表；② 只指向本表，并如实注明「协议门禁文件头未登记此面」）；⚠️ **不往协议门禁文件加条目**——该文件 36.5% 已超 30% 且有停止加码承诺，而失效面**本身已在本表登记** ⇒ 门禁冻结线第 5 条（「已知失效面必须显式登记」）已满足。② **冷启动 61,013 字节未登记在字节漂移表内**（Standards 轴实测抓到）：设备现存**唯一**冷启动 run（2026-10-20 05:36）为 8,168 / 8,961 / **58,022** 字节（对应 25 / 27 / **147** 节点、深度 7 / 7 / 11）⇒ 原写的末档 61,013 属 T0 首次实测那次、**不在**字节漂移表内 ⇒ spec 与 §2.2 / §3.2 同步补「单次抓取口径 + 现存唯一冷启动 run 末档 58.0KB + 前两档逐字节复现 / 末档差 2,991 字节（4.9%）」的限定。③ **采样点标识的子串判定未登记**（Standards 轴提示）：`args.includes("UiTreeDump.POINT_")` 只验「实参里出现了某个 `POINT_` 常量」、**不验 cold/hot 取值** ⇒ 冷启动调用点误传 `POINT_HOT` 判绿 ⇒ 门禁文件头「已知失效面」块新增第 6 条 + §3.4 row 2 失效面 ⑤ + spec「五处盲区」⑤ + **#1049 第 ⑤ 项**（影响面**低于**失效面 ④：只决定产物名的冷/热标签，**不影响 release 是否导出**；收紧判据属**判据强度变更** ⇒ 挂账）。④ **spec 结论段的括号仍含「各类覆盖数」**（Spec 轴抓到）：该括注会把**属性级**覆盖数（`id 数`、`attributes.style`）误纳入「稳定量」⇒ 改为「**节点级**字段覆盖」并加显式排除句。⑤ **spec 两处未镜像「脱敏前后 vs 跨次抓取」限定**（Spec 轴提示）：ADR §3.2 已有该限定，spec 的样本段两处仍写「各类覆盖数不变 / 字节数不变」⇒ 补「这里的『不变』指**脱敏前后**（同一份抓取的脱敏副本），**属性级覆盖数跨次抓取会漂**」。

**门禁规模线基线**（`workflows/review-fix-loop.md`「门禁冻结线」第 1 条；**2026-10-20 第 11 轮 review 后按最终代码实测重算**，供下轮加码前对照）：

| 门禁（分子 = 真门禁文件行数） | 分母（**消费侧口径**，见下方取法说明） | 比例 |
|---|---|---|
| `uiTreeDumpReleaseGate.test.ts`（393 行） | 扫描面 = **两个生产源集的全部 Java 源文件**（`src/lynx/java` + `src/main/java` 递归，57 文件 / 15,921 行） | **2.5%** |
| `ui-tree-dump-core.test.ts`（362 行） | Node 侧通道（`ui-tree-dump-core.mjs` 364 + `dump-ui-tree.mjs` 444 = 808 行） | **44.8%** ⚠️ |
| `ui-tree-dump-outdir.test.ts`（166 行） | 同上（808 行） | **20.5%** |
| `UiTreeDumpTest.java`（431 行） | 宿主侧（`UiTreeDump.java` 364 + 消费方 `LynxActivity.java` 1,245 = 1,609 行） | **26.8%** |
| `UiTreeDumpProtocolContractTest.java`（266 行） | 协议两侧承载文件（364 + 364 = 728 行） | **36.5%** ⚠️ |
| **门禁机器总量 vs 本票新增生产代码量** | 1,618 / 1,195 | **1.35×** |

⚠️ **「比例」列一律是百分数**（第 8 轮 Standards 轴抓到此处曾**混用**百分数与裸比值：首行写 `2.4%`、其余写 `0.46` ⇒ 按字面读会把 `0.46` 读成 0.46%，**方向与该列 ⚠️ 标注的「超 30%」正好相反**）⇒ 现全部写成 `2.5% / 44.8% / 20.5% / 26.8% / 36.5%`。

⚠️ **取法说明**（避免下轮误判；下列每条都给了可复算命令）：
- **分母必须与扫描面一致**。release 守卫第 2 轮登记时用 `LynxActivity.java`（1,245 行）作分母得 0.12；第 3 轮把扫描面扩到**全部生产 Java**（`src/lynx/java` + `src/main/java` 两个源集递归，57 文件——**比「能合法调用 `UiTreeDump` 的同包文件」更宽**：实测 57 个里有 1 个在 `io.pictelio.app.config`；**扫描面 ⊇ 可合法调用者集合**，而后者才是调用点全集），分母随之变成 15,921 行 ⇒ 比例落到 **2% 量级**（⚠️ 此处 `2.4%` 是**第 3 轮那个时点**的值，属历史叙述——分子会随门禁增行而变，**现值见上方台账**）。**分母不跟扫描面走，登记值就是错的**（第 3 轮 review 实测抓到登记值停在第 2 轮快照；第 4 轮 review 抓到本表整体停在旧快照；第 5 轮 review 抓到本表 5 个绝对数与复算命令对不上；第 6 轮 review 又抓到本表停在第 5 轮快照；第 7 轮 review **第三次**抓到同一现象（本表停在第 6 轮快照）；⚠️ 第 8 轮 review 复核时本表**与当时 HEAD 吻合**（未复现漂移），但该轮修复又改了行数 ⇒ **又一次**按定稿代码重算——**根因每次都是「量完数字又改了代码」**，⇒ 纪律：**数字必须在代码定稿之后、提交之前最后量一次**，且**每一轮 review 都要重跑下面那段复算命令**；⚠️ 本表**第 9、10、11 轮各自按定稿代码重算过一次**——第 9 轮因 5 项口径失实整体重写、第 10 轮**零代码改动**故台账数值不变（仅指针改写）、第 11 轮因守卫文件头 +8 行 ⇒ 分子 1,610 → **1,618**、首行比例 2.4% → **2.5%**）。⚠️ 同一纪律**也适用于本节「逐轮史」里的行数**（第 9 轮 Spec 轴抓到：第 8 轮条目写的「`main()` 107 行 → 62 行」两个数字都对不上——`107` 在任何 commit 都不成立、`62` 只在非空行口径下对 ⇒ 逐轮史的行数**连口径一起写**，否则下一个读者按「总行数」复算会得到两个都对不上的数）。
- **本票新增生产代码量 = 1,195 行**，口径 = **相对基线 `main`（4f9da79b）的 diff 增量行**（`git diff 4f9da79b --numstat -- ...` ⇒ 444 + 364 + 364 + 23 = 1,195）。⚠️ 第 4 轮登记的 594 **漏了编排层 `dump-ui-tree.mjs`**——它与 `ui-tree-dump-core.mjs` 同为本票新增的生产代码。
- **分母取「消费侧口径」的理由**：`docs/specs/md3-continuity.md` §5.5 指出「规模线的口径陷阱」——被测对象是个小文件时，30% 上限小到装不下任何真实判据，**正确做法是把扫描面扩到消费侧**，而不是把门禁写小。故本表分母 = 被测模块 + 它的消费方（Node 侧 = core + CLI；宿主侧 = `UiTreeDump` + `LynxActivity`）。⚠️ 若改按「原文件口径」（分母只取被测文件本身），**两个**门禁超线：`ui-tree-dump-core.test.ts` 362/364 = **0.99**、`UiTreeDumpTest.java` 431/364 = **1.18**；协议门禁 266/728 = 0.37、目录门禁 166/364 = 0.46 在两种口径下都不超线。
- ⚠️ **上一版「这四个文件 60–70% 是中文理由注释，真实判据体量很小」的表述是失实的**，已按实测更正（口径：以 `//` / `*` / `/*` 开头的行计注释）：门禁侧 **15.7%**（`ui-tree-dump-core.test.ts`）/ **35.3%**（`UiTreeDumpTest.java`），被测对象侧 **51.1%** / **48.1%** ⇒ 换成**判据体量口径**（非空非注释行）后比值**更高**（**1.74 / 1.43**），不是更低。**不得再用「注释占大头」当挡箭牌。**
- ⚠️ **消费侧口径下仍有两个门禁超 30%**（44.8% / 36.5%），按冻结线第 1 条须「停止加码 + 自问」。自问答案：**防回归，不是给回归创造就业**——这两处判据组各自对应一个**已被外部 review 实测发现**的缺陷（Node 侧：拉回失败未计入退出码、脱敏形态不全；跨端协议侧：产物名与脚本正则的行为面不对齐），不是想象中的回归（冻结线 #3）。但**行数确实偏大** ⇒ 登记为**已知偏差**，并**承诺：本票此后不再往这两个文件加判据**；后续若必须再加，先按 #1009 先例拆分（真门禁 / 验收组 / 共享内核）再写（⚠️ 拆分本身会抬高「门禁机器总量」，与冻结线 #1 的附注冲突 ⇒ 拆分须同时登记总量变化）。第 5 轮已按该承诺把新增判据放进**独立文件**（`ui-tree-dump-outdir.test.ts`），第 6 轮的**新增判据仍进该文件**（默认 `--out` 与显式 `--out` 同路，+3 条）；⚠️ 例外如实登记：`ui-tree-dump-core.test.ts` 在第 6 轮加的 1 条属**产品承诺的钉桩**（`nodeId` 140/140 唯一、`nodeIndex` 恒 0 ⇒ 钉住「diff 的键是哪个」），**不是新门禁维度**，且该文件当时已在超线区间（见上一条）。
- **跨端契约那行**若改按「协议常量条数」算会得出 1250% 的误导性数字——该门禁还重放了「宿主产物名 ↔ 脚本正则」的**行为面**，其契约由 `fileName()` 格式函数 + `ARTIFACT_NAME_RE_SOURCE` 定义，不由常量条数定义。
- **总量比 1.35×** 看着高，但门禁里有一大块是「跨端协议 + 跨端节点数互校」——那类门禁天生需要**两侧各一份**断言，天然高于 1×。**这条比值不是「给回归创造就业」的指标**（那是「单条门禁 vs 它的被测对象」那一列的用途）。

复算命令（工作区根，本票分支 `feat/lynx-ui-tree-dump`）：

```bash
# 分子：五个门禁文件的行数
wc -l packages/android-host/tests/unit/uiTreeDumpReleaseGate.test.ts \
      packages/android-host/tests/unit/scripts/ui-tree-dump-core.test.ts \
      packages/android-host/tests/unit/scripts/ui-tree-dump-outdir.test.ts \
      packages/android-host/android/app/src/testLynx/java/io/pictelio/app/UiTreeDumpTest.java \
      packages/android-host/android/app/src/testLynx/java/io/pictelio/app/UiTreeDumpProtocolContractTest.java
# 分母：被测对象 / 扫描面
wc -l packages/android-host/scripts/lib/ui-tree-dump-core.mjs \
      packages/android-host/scripts/dump-ui-tree.mjs \
      packages/android-host/android/app/src/lynx/java/io/pictelio/app/UiTreeDump.java \
      packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java
find packages/android-host/android/app/src/lynx/java packages/android-host/android/app/src/main/java -name '*.java' | wc -l   # 57
find packages/android-host/android/app/src/lynx/java packages/android-host/android/app/src/main/java -name '*.java' -exec cat {} + | wc -l   # 15921
# 本票新增生产代码量（分母：含编排层 dump-ui-tree.mjs）
git diff 4f9da79b --numstat -- \
  'packages/android-host/scripts/**' \
  'packages/android-host/android/app/src/lynx/java/io/pictelio/app/UiTreeDump.java' \
  'packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java'   # 444 + 364 + 364 + 23 = 1195
# 注释行占比（口径：以 // 或 * 或 /* 开头的行）
grep -c -E '^[[:space:]]*(//|\*|/\*)' packages/android-host/tests/unit/scripts/ui-tree-dump-core.test.ts
```

## 4. 证据

- spec：[docs/specs/app-lynx-ui-tree-dump-t0.md](../specs/app-lynx-ui-tree-dump-t0.md)
- issue：[#1045](https://github.com/a1121611810/Pictelio/issues/1045)
- 实现：`packages/android-host/android/app/src/lynx/java/io/pictelio/app/UiTreeDump.java`（宿主侧抓取与落盘）、`packages/android-host/scripts/lib/ui-tree-dump-core.mjs`（脚本侧协议常量 + 可测纯逻辑）、`packages/android-host/scripts/dump-ui-tree.mjs`（诊断脚本编排层）、`packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java`（两个调用点）
- 门禁：
  - `packages/android-host/android/app/src/testLynx/java/io/pictelio/app/UiTreeDumpTest.java`（JVM/Robolectric：触发判定 / 文件名 / 采样档位 / 写盘成功与失败双路径 / 告警）
  - `packages/android-host/android/app/src/testLynx/java/io/pictelio/app/UiTreeDumpProtocolContractTest.java`（JVM：跨端协议逐字比对 + 行为面）
  - `packages/android-host/tests/unit/uiTreeDumpReleaseGate.test.ts`（源级守卫 + 阳性对照）
  - `packages/android-host/tests/unit/scripts/ui-tree-dump-core.test.ts`（落齐判据回归 + 真实样本回放 + 脱敏六形态 + 清理范围 + 退出码）
  - `packages/android-host/tests/unit/scripts/ui-tree-dump-outdir.test.ts`（输出目录安全校验：工作目录 / 祖先 / 根目录 / **符号链接别名** / **大小写变体** / 相对路径基准 / 正常子目录）
- 外部锚点（第 4、5 轮）：用**假 adb** 驱动 `dump-ui-tree.mjs` 跑真实文件系统，逐条断言 `--out` 的路径（空值 / CWD 字面 / CWD 物理路径 / CWD 的符号链接别名 / **CWD 的大小写变体** / 祖先 / 根目录 / 正常子目录）的退出码，且**工作目录、哨兵文件、用户文件、CWD 内的通道产物全部仍在**——第 4 轮 review 的第一版修复正是在「符号链接别名」这一条上被打回、第 5 轮 Standards 轴又在「大小写变体」这一条上打出第二个绕过（macOS 默认 APFS 大小写不敏感 ⇒ 同一 inode 但字符串不等）⇒ 判据最终改为**按 inode 判定**。另测**同名目录**（`ui-tree-*.json` 是目录）不再触发 EISDIR 中止。⚠️ **第 6 轮补一条**：**不传 `--out`、而工作目录恰是默认输出目录**（默认 out = `<tmpRoot>/pictelio-ui-tree`）⇒ 必须 exit 2 且 CWD 内的通道产物不被删——这条正是「默认路径绕过目录安全校验」的**复现配方**（修复前 exit 0 且产物被删 ⇒ 显式与默认**两条路径分叉**）；对照跑法：`git show 3cd21afc:packages/android-host/scripts/dump-ui-tree.mjs`（**钉死这个 commit，不要用 `HEAD:`**——修复提交后 `HEAD:` 取到的是已修复版本，对照会变成假绿）落到临时目录并 `ln -s` 真实 `lib` 目录（保住相对 import），同一场景重跑即可复现旧行为。
- 设备取证（模拟器 `pictelio_ui` / android-34，debug APK）：logcat `UiTreeDump` 逐份记录（受理 + 落盘 + 字节数 + 抓取往返耗时 + 采样点 + 采样延迟），产物落 `Android/data/io.pictelio.app/files/ui-tree/`
- 上游能力边界的核实手段（**实测结果**，第 5 轮 review F3 订正）：① `grep -rl "enableUiSourceMap" node_modules/.pnpm/` ⇒ **0 命中**（`@lynx-js/react-rsbuild-plugin` 本仓**未安装**）——该开关的归属依据来自上游文档与该包源码，不是本仓安装态可证；② `grep -rl "lynxUiSourceMapRecords" node_modules/.pnpm/` ⇒ 命中 `@lynx-js/template-webpack-plugin@0.11.0/lib/LynxDebugMetadataPlugin.js:74`，它是**汇聚端**（把 `module.buildInfo.lynxUiSourceMapRecords` 汇成 `debug-metadata.json`），**不是生产端**；③ 生产端在 React 侧 ⇒ `grep -r "nodeIndex\|lynxUiSourceMapRecords" node_modules/.pnpm/@lynx-js+react@*/` **0 命中**；④ `vue-lynx@0.5.1` 包内**分项**命中：`lineNumber` 0 / `columnNumber` 0 / **`sourceMap` 38**（全在 `plugin/dist/index.js` 与 `internal/dist/ops.js`，是 Vue/rspack 的 **JS sourcemap 机制**，与 Lynx UI source map 无关）/`uiSourceMap` 0 / `nodeIndex` 5（Vue `decodeTree` 的**分支索引**函数参数，同样无关）⇒ 判据必须用 **`uiSourceMap` / `lynxUiSourceMapRecords` 两个专名**，不能用泛词 `sourceMap`；⑤ 仓库（排除 `node_modules`）**无 `debug-metadata.json` 产出文件**（文本提及仅 1 处 = 本 ADR 自身）；⑥ AAR `javap` 查 SDK API 面；⑦ dev 模式构建查 `debug-metadata.json` 产出（`uiSourceMap` 三数组全空）；⑧ `npm view` 查上游最新版本
