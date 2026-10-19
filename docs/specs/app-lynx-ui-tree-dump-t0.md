# app-lynx 运行时 UI 树导出 · T0 最小验证（能否落地）

> 状态：implemented（2026-10-20，T0 验证通过并落地；依据 [ADR-0223](../adr/ADR-0223-runtime-ui-tree-observation-channel.md)）
> 前置决策：ADR-0223（上游 UI source map 的 React-only 边界 + 本仓选定形态）
> 术语：见 `packages/android-host/CONTEXT.md`「运行时 UI 树观测通道」（本票是**宿主侧**改动，零 app-lynx 改动）；引擎能力事实见本 spec「Solution」

## Problem Statement

本仓在模拟器/真机上**拿不到运行时 UI 节点树**，因此对「渲染出来到底是什么」这类问题只能做像素 diff。

已记录的既有限制（本仓此前实测，见 `docs/specs/qa-defense-lines.md` 与 `packages/app-lynx/CONTEXT.md`）：

- Lynx 4.0.1 **不暴露无障碍树节点**：全仓 `.vue` 源码 220 处 `accessibility-element` 标注也不出节点（口径：`grep -rn accessibility-element packages --include=*.vue | wc -l`）；
- `uiautomator dump` 在 `pictelio_ui` 上必被 SIGKILL（exit 137），拿不到快照；
- 三处 e2e spec（`transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags`）当年的应对是**整体退到截图 + 像素分析**，从未先区分「拿不到观测」与「观测里没有节点」。

结果：像素 diff 只能回答「画面变了没有」，回答不了「渲染树里多了/少了几棵树、某元素的实际几何是多少、事件绑在了谁身上」。

Lynx 4.0 官方提供的 `LynxView.getLynxElementRoot` + `LynxElement.toJSONString` 提供了一条**第三条观测通道**（绕开 a11y 树与 uiautomator），但本仓从未接线。

## Solution

**T0 最小验证**：只回答一个问题——**这条通道能否在本仓落地？** 落地判据 = 在模拟器上真实拿到一棵 UI 树 JSON，并看清引擎到底吐哪些字段。

最小链路（DEBUG 构建内）：

1. **触发**：向 `io.pictelio.app.LynxActivity` 发一个 intent extra（沿用 benchNav / 通知落点同款通道，`onNewIntent` 热启动同样生效）；
2. **抓树**：`LynxView.getLynxElementRoot` → `LynxElement.toJSONString`（SDK 4.0.1 已具备，`javap` 对 AAR 实测确认）；
3. **落盘**：写到应用专属外部目录 `ui-tree/`，`adb pull` 直接拉回（真机同样可用，不需 `run-as`）；
4. **连拍**：一次触发在 0 / 1.5 / 4s 三个时刻各抓一份——一次装机同时回答「引擎吐什么字段」与「什么时候抓得到完整树」两个未知，避免为调时机反复重编。

**不做源码反解**。官方 UI source map 的第 1 步（构建期给元素打 `nodeIndex`）是 **React-only**：`enableUiSourceMap` 只存在于 `@lynx-js/react-rsbuild-plugin`，打标端是 `@lynx-js/react` 的 React-JSX 专用 SWC 插件；vue-lynx 无等价实现，其 main-thread 变换不保留任何位置信息。⇒ 本仓拿到的树**没有源码位置**（`repo`/`source`/`line`/`column`）。

但这**不等于**「拿不到组件级信息」——见下节实测：引擎在 `attributes` 里保留了 Tailwind `class`、语义 `id`、`accessibility-label` 与 `vue-ref` 标记，**足以回答「这个节点是哪个组件/哪张作品卡」**。源码行号拿不到，组件身份拿得到。

## T0 实测结论（模拟器 `pictelio_ui`，推荐页，2026-10-20）

**结论：能落地。** 一条命令拿到完整 UI 树 JSON（55,895 字节 / 140 节点 / 最大深度 10 / 抓取往返耗时 4–10ms）。

**引擎实际吐出的节点字段**（登录后推荐页，140 节点实测计数）：

| 字段 | 覆盖 | 内容 | 诊断价值 |
|---|---|---|---|
| `tag` | 140/140 | `page`/`view`/`image`/`text` | 元素类型 |
| `attributes.class` | 138/140 | Tailwind 类名数组（如 `["w-full","h-full","flex","flex-col","relative","bg-surface"]`） | **可反推是哪个组件**（⚠️ 树里**没有**组件名 / 文件名 / owner 字段 ⇒ 组件身份是**反推**出来的，不是直接给出的） |
| **顶层 `id`** | **140/140**（16 个非空） | 语义 id，含作品 id（`pictelio-hero-root` / `pictelio-hero-source-<illustId>`） | **定位到具体作品**。⚠️ 与 `attributes.id` 是**两个不同字段**：顶层 `id` 140/140 都有该键（16 个非空），`attributes.id` 只在 16 个节点上——**脱敏必须盖两处**（第 2 轮 review 实测：只盖 `attributes.id` 时顶层仍漏 15 处明文） |
| `attributes.id` | 16/140 | 同上语义 id 的另一处落点 | 同上 |
| `attributes.accessibility-label` | 2 | 如 `打开菜单`、作品标题 | a11y 标注**在树里**（a11y 树并不暴露给 uiautomator） |
| `attributes.accessibility-element` | 4（2 个为 true） | 树内 a11y 标记 | 哪些节点被标为 a11y 元素 |
| `attributes.vue-ref-N` | 132/140 | Vue 实例序号 | 区分同构实例（⚠️ 只是序号，**不含组件名**） |
| `attributes.style` | 51/140 | 已解析的内联样式（如 `height: 53px`） | 布局实况 |
| `attributes.text` | 12/140 | 文本节点内容 | 节点里写了什么 |
| `attributes.src` / `lazy-load` / `mode` | 各 20/140 | 图片资源 URL / 懒加载标记 / 图片模式 | 图片链路实况 |
| `position` | 140/140 | `frameInRoot` + `frameInScreen` **两套坐标系** | 命中测试几何 |
| `events[]` | 50 节点 | `{eventName, function:"vue:1", runtime:"BTS", type:"bindEvent"}` | **哪个节点可交互、绑的哪个 handler** |
| `nodeId` / `debugInfo.nodeIndex` | 140/140 | 节点身份（`debugInfo` **只有** `nodeIndex`，无源码位置） | **可做两棵树的节点级 diff** |

**事件名分布**（实测）：`tap` 29 / `load` 20 / `error` 20 / `touchstart` 5 / `touchmove` 5 / `touchend` 5。

**相对既有手段的增量**：本仓此前只能做像素 diff（a11y 树不暴露、`uiautomator dump` 被 SIGKILL）。UI 树给出的是**结构 + 语义 + 几何**三层，比像素 diff 精确得多，且可机器断言。

**相对官方 UI source map 的差距**：只有「源码位置」这一层拿不到（Vue 侧无 producer，见上）。**组件级信息不依赖它**。

**时机实测**：同一次触发的三份连拍体积为 8,168 / 8,961 / 61,013 字节 ⇒ **0ms 那份几乎是空树、4s 那份才是完整树**。「早拍拿到半棵树」是实测量，不是假设。
⚠️ **两个体积口径来自不同次抓取，别混用**：本 spec 表格里的 55,895 字节 / 140 节点是**热启动、页面已渲染完**那一次的产物（入库 fixture 即此份，脱敏后 55,945 字节）；而 8,168 / 8,961 / 61,013 是**冷启动**那一次的三档连拍。同一页面在不同启动时机下的树大小不同（冷启动首拍几乎是空树）。

**落地时踩到的真实缺陷（已修）**：诊断脚本原先用「连续两次轮询计数不变」判断「文件已落齐」——轮询窗口约 1.2s，而第 2→3 份间隔 2.5s ⇒ **必然在空档里提前收工**，丢掉的正是 4s 那份（唯一完整树），且 **exit 0 静默**。现判据改为**按已知档位等齐**（出现的采样点里至少有一轮三档齐），收不齐时**显式告警**而不是当作成功。回归由 `tests/unit/scripts/ui-tree-dump-core.test.ts` 钉住。

**真实样本已入库**：`packages/android-host/tests/fixtures/ui-tree/recommend-page.sample.json`（55,724 字节 / 140 节点 / 深度 10；脱敏：作品 id → `<illustId>`、p0 哈希 → `<p0hash>`、上传时间路径 → `<uploadDate>`、标题/作者文本 → `文本#N` / `标签#N`；**结构统计量与原始抓取逐项一致**）。
⚠️ **脱敏要盖多种形态**（第 2、3 轮 review 两次抓到）：① 作品 id 有**两个落点**——顶层 `node.id`（140/140 都有该键，16 个非空）与 `attributes.id`（只在 16 个节点上）⇒ 只盖后者会从顶层漏出 15 处明文；② 作品 id 还会以**路径形态**出现在 `attributes.src`；③ src 里还有**稳定作品指纹**——p0 的 32 位十六进制哈希与上传时间路径，两者都能反查作品。已补**五种形态**的断言 + 「还原成明文必须被抓到」的反向对照。

## User Stories

1. 作为 app-lynx 维护者，我希望在模拟器上**一条命令**拿到当前页面的运行时 UI 树 JSON，以便回答「这个页面到底渲染了什么」。
2. 作为 app-lynx 维护者，我希望树 JSON **原样落盘**（引擎吐什么存什么），以便诊断时不会因为预先裁剪字段而丢掉答案。
3. 作为 app-lynx 维护者，我希望一次触发能拿到**多个时刻**的快照，以便在弱网/慢渲染下不必猜「什么时候抓才完整」。
4. 作为 app-lynx 维护者，我希望每次抓取在 logcat 里留下**体积 / 耗时 / 节点数**，以便判断这条通道在真机上是否可用（UI 线程序列化 ⇒ 大页面可能有卡顿）。
5. 作为 app-lynx 维护者，我希望抓取失败（根节点为空 / 序列化为 null / 写盘失败）时**有显式告警**而非静默无文件，以便区分「没触发」与「触发了但失败」。
6. 作为 app-lynx 维护者，我希望该能力**在 release 构建里完全不存在**（R8 移除），以便生产 APK 不携带任何导出能力。
7. 作为 app-lynx 维护者，我希望产物落在应用专属外部目录，以便 `adb pull` 直接拉回（真机可用），且随应用卸载自动清理。
8. 作为 app-lynx 维护者，我希望有一个**摘要视图**（节点数 / tag 分布 / 最大深度 / 体积），以便不打开几 MB JSON 也能判断「这棵树是不是我预期的那个」。
9. 作为 app-lynx 维护者，我希望这条结论以**可复核的证据**落档（真实 JSON 样本 + 字段清单），以便后续决定是否做成正式门禁、以及能否接替像素 diff。

## Implementation Decisions

- **宿主侧新增一个独立类**承载抓取与落盘，不把逻辑塞进 `LynxActivity`（后者已 1200+ 行）。职责：判定是否该抓 → 调引擎 API → 落盘 → 告警与度量。
- **触发协议**：intent extra 键 `uiTreeDump`，值为非空字符串即触发（与 benchNav 的 extra 风格一致）。冷启动在 `onLoadSuccess` 抓、热启动在 `onNewIntent` 抓——两处都要接，否则「App 已在跑时补拍」不可用（这正是 T0 要验证的主要用法）。
- **门禁**：整段以 `BuildConfig.DEBUG` 包裹（与既有 `pictelio_dev_*` / benchNav 通道同范式）⇒ release 编译下为恒 false 死代码、被 R8 移除。
- **连拍**：一次触发在 0 / 1.5 / 4s 三个时刻各抓一份，每份独立文件。间隔取自仓库既有的「四次投递 1.5/3/4.5/6s」防挂载竞态思路（ADR-0136 / ADR-0220）。
- **产物名带采样点与档位**：`ui-tree-<cold|hot>-<0|1500|4000>ms-<序号>-<时间戳>.json`。理由：命中几个采样点**取决于进程怎么死的**（2026-10-20 模拟器三场景实测）——App 正在跑 ⇒ 只走 `onNewIntent` ⇒ **hot 3 份**；进程死、**任务记录还在**（覆盖安装 / 进程被系统回收后重开）⇒ `onCreate` 与 `onNewIntent` 都走 ⇒ **cold + hot 共 6 份**；`am force-stop`（任务记录也清）⇒ 只走 `onCreate` ⇒ **cold 3 份**。没有标识就分不清哪份属哪轮；而「哪份才是完整树」实测只能靠体积猜 ⇒ 把档位写进文件名。
- **落齐判据按已知档位**：判据 =「出现的采样点里至少有一轮三档齐」，**不是**「计数连续两次不变」（见「T0 实测结论」里的缺陷复盘）。落齐后再等一段**静默期**（≤2.5s），把另一采样点迟到的产物也捞回来。收不齐 ⇒ 显式告警 **+ 非零退出码**（退出码判据是纯函数 `exitCodeFor`，在 `scripts/lib/ui-tree-dump-core.mjs` 里，有单测）。
- **落盘位置**：应用专属外部目录下的 `ui-tree/` 子目录。文件名带序号 + 时间戳 ⇒ 多次触发不覆盖。
- **写盘时机**：引擎两个回调都落在 **UI 线程** ⇒ 落盘 I/O 移交后台线程，UI 线程只做「拿到字符串就转交」。
- **写盘方式**：临时文件 + 原子 rename ⇒ `adb pull` 不会读到半截 JSON。
- **失败路径一律显式告警**（logcat WARN）：根元素为 null / 序列化结果为 null / 写盘失败，三者分开报错，不合并成一句「失败」。
- **产物不加工**：引擎原始 JSON 原样落盘。摘要由**本地诊断脚本**现算，加工逻辑不进 APK。
- **摘要脚本**：宿主包开发脚本目录（`packages/android-host/scripts/`），职责 = 触发 → 轮询等文件出现 → `adb pull` → 打印摘要（节点数 / tag 分布 / 最大深度 / 体积 / 顶层结构）。**不写进 e2e 断言**（本票边界见 Out of Scope）。
- **零 app-lynx 改动**：T0 不引入任何 JS↔宿主协议。

## Testing Decisions

- **测外部行为，不测实现细节**。T0 的机器防线聚焦「IO 边界」——写盘是外部 IO，按测试硬约束 #1 必须有成功 + 失败双路径。
- **可单测部分**（宿主 JVM 单测，门禁 `gradlew testDebugUnitTest`）：
  - 触发判定：extra 缺失 / 空串 / 非空串 → 各自是否触发；
  - release 门禁：非 debug 构建下恒不触发；
  - 落盘：目录路径形态、文件名不互相覆盖、原子写（写临时 + rename）、写盘失败显式告警且不吞。
- **不可单测部分**（只能真机/模拟器实测，正是 T0 的交付物）：引擎是否真的回调、根元素是否非空、JSON 的实际字段集、实际体积与耗时。
- **跨端协议门禁**（第 1 轮 review 补齐）：触发协议的名字、目录名、产物名前后缀、采样档位、采样点标识**同时存在于 Java 宿主与 Node 脚本两侧**，而两侧是不同语言、不同运行时、无共享代码 ⇒ 只能各写各的字面量。故由 `UiTreeDumpProtocolContractTest` 做**逐字比对**，并额外比**行为面**（宿主真实产出的产物名必须能被脚本侧正则解析）。抽取器须断言**恰好 1 条**——正则失配导致抽取为空时，「两侧相等」会变成恒真断言。
- **DEBUG 门禁接线门禁**（第 1 轮 review 补齐）：宿主单测只直接调判定函数、**不碰调用点** ⇒ 把 `LynxActivity` 两处的 `BuildConfig.DEBUG` 改成 `true`，单测仍全绿而 release 包会真的导出 UI 树。故补**源级守卫**（`tests/unit/uiTreeDumpReleaseGate.test.ts`）：逐个调用点检查传的是 `BuildConfig.DEBUG` 与采样点标识，并带**阳性对照**（反事实源码必须打红）。
- **真实样本回放**（第 1 轮 review 补齐）：Node 侧单测用入库的真实脱敏样本断言摘要统计量（节点数 / 深度 / 字段覆盖 / 事件分布 / tag 分布），守住「摘要口径变了」这件事不被无声改掉。
- **先例**：`PictelioAppModuleDebugBuildTest`（BuildConfig.DEBUG 门禁的机器防线）、`ImageHostConfigTest`（「接口即测试面」）、`TranslateEventContractTest`（协议两侧逐字比对）、`firstLoadViewWireup.test.ts`（源级守卫）、`webviewRemovalInvariants.test.ts`（源级守卫 + 阳性对照）。
- **不做**：本票不新增 e2e spec；不把 UI 树接进任何既有门禁。

## Out of Scope

- **UI source map / 源码反解**：`enableUiSourceMap` 是 React-only，vue-lynx 侧无 producer ⇒ 本仓拿不到源码位置。此路已由上游能力边界判死，不在本票尝试。
- **e2e 断言接入**：`transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags` 三处基于树的断言见 follow-up **#1047**（依赖本票产出的真实字段清单来定契约）。
- **release 变体的 dex 级移除断言**：见 follow-up **#1048**（既有门禁只证 `BuildConfig.DEBUG` 取值为 false，证不到 R8 移除）。
- **自动等「首载落定」**：「首载落定」是逐页面属性（各页面/组件各自持有 `settled`，共享的只有 `deriveFirstLoadView` 纯函数），仓库无全局落定概念 ⇒ 做成中央层需逐页改动。T0 用「连拍 + 人工选样本」绕开。
- **子树 / 按 id 取元素**：`LynxElement` 在 SDK 4.0.1 里**只有一个公开方法** `toJSONString` ⇒ 只能整棵抓。
- **release 构建可用**、**生产问题定位**、**导出到宿主可读路径之外**、**导出给非调试用户**。
- **工具链升级**（rspeedy 0.13.6→0.18.2 等）：与本能力无关，不在本票。

## Further Notes

- **为什么不做自动等落定**：原设想是「等 JS 侧首载落定后再 dump」。核查发现落定是逐页面属性、无全局汇聚点，「改一处」的前提不成立（详见 Out of Scope）。T0 改为「连拍多份 + 人工选样本」；若后续证明时机是核心问题，再单独立项做中央落定层。
- **ADR-0223 已落档**：[ADR-0223](../adr/ADR-0223-runtime-ui-tree-observation-channel.md) 记录「UI source map 在 Vue 侧不可用」这一上游能力边界、本票选定的抓取协议/落点/门禁形态，以及本通道的机器防线清单。
- **若 T0 证伪**（引擎不回调 / 树为空 / 字段无诊断价值），本 spec 作废、ADR 记录证伪结论与后续方向，不留半成品能力。
