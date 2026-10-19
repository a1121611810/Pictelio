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
| ① 构建期打 `nodeIndex` | **React-only** | `enableUiSourceMap` 开关**只存在于** `@lynx-js/react-rsbuild-plugin`（默认 false）；打标端是 `@lynx-js/react` 的 React-JSX 专用 SWC 插件（`swc-plugin-reactlynx`）。**rspeedy 层无此选项**；**vue-lynx 无等价实现**——其 main-thread 变换不保留任何位置信息（无 `lineNumber` / `columnNumber` / `sourceMap`），且 `vue-lynx@0.5.1` 已是最新发布版 |
| ② 客户端导出 UI 树 | **框架无关** | Lynx Android SDK 4.x 已提供 `LynxView.getLynxElementRoot(Callback<LynxElement>)` + `LynxElement.toJSONString(Callback<String>)`（对 AAR `javap` 可证）。但 `LynxElement` **只有一个公开方法** ⇒ 只能整棵抓，无按 id 取子树 |
| ③ `remapUiTree` 反解 | 框架无关 | `@lynx-js/debug-metadata` 是独立 npm 包（含 CLI）。但**没有 ① 的 `nodeIndex` 就反解不出源码位置** |

**决策**：**不走官方 UI source map 的完整链路**，只取其第 ② 段作为本仓的观测通道。

**理由**：① 的 producer 在 React 侧，Vue 侧要实现得改 `vue-lynx` 本体（上游），不是本仓能决定的；且**升级 `@lynx-js/rspeedy` / `@lynx-js/template-webpack-plugin` 不解决这个问题**——producer 不在这两个包里。

**后果（必须写清，避免后续误期待）**：本通道**拿不到源码位置**（`repo` / `source` / `line` / `column`）。但**拿得到组件级信息**——见 §3.2 的实测字段清单。**「拿不到源码位置」不等于「拿不到组件身份」**，这两件事不可混为一谈。

### 2.2 本仓选定的通道形态

| 决策 | 内容 | 理由 |
|---|---|---|
| 触发通道 | intent extra `uiTreeDump=1`，沿用 benchNav / 通知落点同款通道 | 零新增组件、零 `app-lynx` 改动；热启动（`onNewIntent`）同样生效 ⇒ 人可自行掌握拍树时机 |
| 采样点 | 冷启动 `onLoadSuccess`（`cold`）+ 热启动 `onNewIntent`（`hot`）两处 | 只接冷启动则「App 已在跑时补拍」不可用——那正是主要用法。⚠️ **命中几个采样点取决于进程怎么死的**（2026-10-20 模拟器三场景实测）：App 正在跑 ⇒ hot 3 份；进程死、任务记录还在 ⇒ cold + hot 共 6 份；`am force-stop` ⇒ cold 3 份 |
| 门禁 | `BuildConfig.DEBUG` 作为**判定函数的入参**（非埋在分支里） | release 变体该字段是字面量 `false`（常量表达式 → javac 内联）⇒ 整块成死代码被 R8 移除；入参化让「门禁」本身可被 JVM 单测证伪 |
| 采样时机 | **连拍三份**（0 / 1.5 / 4s）；**落齐判据 = 按已知档位等齐** | `onLoadSuccess` 时 JS 未必渲染完，早拍拿到半棵树。实测体积 8.2KB → 9.0KB → 61.0KB，**4s 那份才是完整树**。判据必须按**档位**而不是「计数连续两次不变」——后者窗口约 1.2s < 档位间隔 2.5s，必然在空档里 break，**丢掉的正是 4s 那份**且静默 exit 0。落齐后另加 ≤2.5s **静默期**（两个采样点都命中时，两轮 4s 档落盘时间可能差几百毫秒） |
| 落盘 | 应用专属外部目录 `ui-tree/`，文件名 `ui-tree-<采样点>-<档位>ms-<序号>-<时间戳>.json` | `adb pull` 直拉（真机可用，不需 `run-as`）；随卸载清理；序号+时间戳 ⇒ 多次触发不覆盖；**带采样点与档位** ⇒ 两个采样点都命中时能分清哪份属哪轮、哪份才是完整树（否则只能靠体积猜） |
| 写盘 | 临时文件 + rename 原子写；写盘 IO 移交后台线程 | 引擎两个回调都落 UI 线程，几 MB 写盘不能占 UI 线程；rename 前目标文件不完整 ⇒ `adb pull` 会拉到半截 JSON |
| 产物形态 | **引擎原始 JSON 原样落盘**，摘要由本地脚本现算 | 诊断场景常是「不知道缺什么」——预先裁字段就丢答案；加工逻辑不进 APK |
| 失败语义 | 根元素为 null / 序列化为 null / 写盘失败**三条分开告警** | 合并成一句「失败」会让人无法定位；禁静默降级 |

### 2.3 明确不做

- **自动等「首载落定」**：落定是**逐页面**属性（各页面/组件各自持有 `settled`，仓库无全局汇聚点，共享的只有 `deriveFirstLoadView` 纯函数）⇒ 做成中央层需逐页改动，超出本票边界。连拍 + 人工选样本已能覆盖。
- **e2e 断言接入**：另开票。本票只交「人工诊断通道」，字段清单作为后续定契约的依据。
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
| **顶层 `id`** | **140/140**（16 个非空） | 语义 id，含作品 id（`pictelio-hero-root` / `pictelio-hero-source-<illustId>`） | **定位到具体作品**。⚠️ 与 `attributes.id` 是**两个不同字段**（后者只在 16 个节点上）⇒ **脱敏必须盖两处** |
| `attributes.id` | 16/140 | 同一语义 id 的另一处落点 | 同上 |
| `attributes.accessibility-label` | 2 | 如 `打开菜单`、作品标题 | a11y 标注在树里 |
| `attributes.accessibility-element` | 4（2 个为 true） | 树内 a11y 标记 | 哪些节点被标为 a11y 元素 |
| `attributes.vue-ref-N` | 132/140 | Vue 实例序号（⚠️ 只是序号，不含组件名） | 区分同构实例 |
| `attributes.style` | 51/140 | 已解析的内联样式 | 布局实况 |
| `attributes.text` | 12/140 | 文本节点内容 | 节点里写了什么 |
| `attributes.src` / `lazy-load` / `mode` | 各 20/140 | 图片资源 URL / 懒加载标记 / 图片模式 | 图片链路实况 |
| `position` | 140/140 | `frameInRoot` + `frameInScreen` **两套坐标系** | 命中测试几何 |
| `events[]` | 50 节点 | `{eventName, function, runtime, type}` | 哪个节点可交互、绑的哪个 handler |
| `nodeId` / `debugInfo.nodeIndex` | 140/140 | 节点身份（`debugInfo` **只有** `nodeIndex`，无源码位置） | **可做两棵树的节点级 diff** |

事件名分布（实测）：`tap` 29 / `load` 20 / `error` 20 / `touchstart` 5 / `touchmove` 5 / `touchend` 5。

抓取往返耗时 4–10ms（140 节点 / 55,895 字节；实测最坏样本往返 83ms）⇒ **UI 线程开销可忽略**（大树另计）。日志字段名取「抓取往返耗时」而非「序列化耗时」——它覆盖的是「发起抓取 → 拿到 JSON」整段往返，序列化只是其中一段。

宿主侧度量日志字段（logcat `UiTreeDump`）：`字节=` · `节点数=` · `抓取往返耗时=` · `采样点=` · `采样延迟=` · `路径=`。**节点数由宿主在落盘线程解析 JSON 得出**（不占 UI 线程；口径与脚本侧 `summarize` 一致 ⇒ 两边数字可互校）——现场只有 logcat 时也能判断树有多大。

**真实样本已入库**：`packages/android-host/tests/fixtures/ui-tree/recommend-page.sample.json`（55,724 字节 / 140 节点 / 深度 10）。脱敏只改**内容值**、不改结构（节点数 / 深度 / class 覆盖 / id 数 / a11y 数 / 事件分布 / tag 分布均与原始抓取逐项一致）。
⚠️ **脱敏要盖多种形态**（第 2、3 轮 review 两次抓到）：① 作品 id 有**两个落点**——顶层 `node.id`（140/140 都有该键，16 个非空）与 `attributes.id`（只在 16 个节点上）⇒ 只盖后者会从顶层漏出 15 处明文；② 作品 id 还会以**路径形态**出现在 `attributes.src`（`/<数字>/`、`ci<数字>_`）⇒ 只认「语义 id 形态」的门禁会 0 命中静默放过；③ src 里还有**稳定作品指纹**——p0 的 32 位十六进制哈希与上传时间路径（`/<年>/<月>/<日>/<时>/<分>/<秒>/`），两者都能反查作品。⇒ 门禁改为**五种形态**断言 + 一条「还原成明文必须被抓到」的反向对照。

### 3.3 尚未覆盖

- **e2e 断言**：本票未做。三处基于树的断言见 follow-up **#1047**（`transition-matrix` / `fab-hit-testing-regression` / `lynx-bookmark-tags`），契约以 §3.2 字段清单为准。
- **release 变体的实际行为**：JVM 单测只跑 debug 变体（`BuildConfig.DEBUG` 在 debug 侧是 `Boolean.parseBoolean("true")` 方法调用、**不是**常量表达式、javac 不内联），「release 下整块被 R8 移除」那一半由 release 变体的可执行门禁承担。⚠️ 该门禁**只证取值**、证不到 R8 移除 ⇒ dex 级断言见 follow-up **#1048**。
- **「连拍三份」的调度时序**：由 Handler 驱动，单测只断言常量取值，不验证时序。
- **dex 级「R8 确实移除了本类」**：无 dex 级断言。既有 `verify:android-host:release-buildconfig` 门禁**只证取值**（release 变体的 `BuildConfig.DEBUG` 为 `false`），证不到「早退分支被绕开」（那一层由源级守卫覆盖），也证不到 R8 移除 ⇒ follow-up **#1048**。

### 3.4 本通道的机器防线（第 1 轮 review 后补齐，第 2 轮又补了两处判别力缺口）

本通道横跨 **Java 宿主 / Node 脚本**两侧，两侧无共享代码；且「release 不导出」这条承诺原先只有约定、没有机器防线。第 1 轮 review 把这两处补成可执行门禁；**第 2 轮 review 又用反事实实测出三处「门禁存在但没判别力」的缺口**（见下表末三行的说明）：

| 防线 | 位置 | 守住什么 |
|---|---|---|
| 协议常量逐字比对（6 个要素）+ **行为面**比对 | `UiTreeDumpProtocolContractTest`（JVM） | extra 键 / 目录名 / 文件名前后缀 / 采样档位 / 采样点标识两侧一致；且**宿主真实产出的产物名必须能被脚本侧正则解析**（只比常量不够——产物名是宿主造、脚本解） |
| 协议抽取器有效性 | 同上 | 抽取到**恰好 1 条**才算数（正则失配 ⇒ 抽取为空 ⇒「两侧相等」变恒真断言） |
| DEBUG 门禁**调用点接线**源级守卫 | `tests/unit/uiTreeDumpReleaseGate.test.ts` | `UiTreeDump.scheduleIfRequested` 的**每个**调用点都必须传 `BuildConfig.DEBUG` 与采样点标识 |
| 落齐判据回归 | `tests/unit/scripts/ui-tree-dump-core.test.ts` | 缺 4s 档时**不得**判落齐（守住「最完整那份被静默丢弃」这个已发生的缺陷） |
| 真实样本回放 | 同上 | 摘要统计量对着**真实抓取样本**断言（节点数 / 深度 / 字段覆盖 / 事件分布 / tag 分布） |
| **退出码门禁** | 同上（`exitCodeFor`） | 未落齐 / 超时 / 拉回失败 / 非法 JSON ⇒ **非零退出码**。第 1 轮只改了告警文案、退出码仍是 0 ⇒ 「静默 exit 0」缺陷**未闭环**；退出码是判据里唯一能被机器读到的那一半，故下沉成纯函数并单测。⚠️ 第 3 轮 review 又抓到**拉回失败的洞**：`adb pull` 报错但本地已有同名文件时只打了一行告警、退出码仍是 0 ⇒ 「拉回失败」必须**无条件计入失败且不拿它的内容当本次产物打印**（本地文件可能是上一轮残留或半截） |
| **DEBUG 守卫的判别力**（第 2 轮补） | `uiTreeDumpReleaseGate.test.ts` | ① 扫描根从「写死 `LynxActivity.java`」扩到**同包全部生产 Java 源集**——第 1 版把第三个调用点放进别的 `.java` 即**骗过守卫**（外部复核变异体实测 GREEN）；② 实参**先剥注释再判定**——第 1 版裸 `includes("BuildConfig.DEBUG")`，实参真值写成 `true`、同实参列表里留一句 `// TODO 改回 BuildConfig.DEBUG` 即**7/7 全绿骗过**（Spec 轴 F2 阻塞项） |
| **fixture 脱敏门禁**（第 2、3 轮补） | `tests/unit/scripts/ui-tree-dump-core.test.ts` | 断言 fixture 不含**五种形态**的明文：语义 id 形态 / 路径里的裸 id 段 / novel 封面 id 形态 / p0 的 32 位十六进制哈希 / 上传时间路径。第 1 轮只脱敏了 `attributes.id`、**顶层 `node.id` 仍留 15 处明文**（摘要取 `node.id \|\| attributes.id` ⇒ 明文从顶层漏出）——脱敏声明当时是**不实**的（Spec 轴 F1 阻塞项）；第 2 轮门禁**只认一种形态** ⇒ 把 id 写回 `attributes.src` 即可 0 命中静默放过（Spec 轴 F4） |
| **跨端节点数互校**（第 3 轮补） | `UiTreeDumpTest.java` | 宿主侧 `countNodes` 与 Node 侧 `summarize` 对**同一份真实 fixture** 必须数出同一个值（140）——「两边口径一致 ⇒ 可互校」若无机器防线就只是断言 |

**门禁规模线基线**（`workflows/review-fix-loop.md`「门禁冻结线」第 1 条；2026-10-20 第 3 轮 review 后按 HEAD 重测，**供下轮加码前对照**）：

| 门禁 | 被测对象（分母与**扫描面**一致） | 比例 |
|---|---|---|
| `uiTreeDumpReleaseGate.test.ts`（376 行） | 扫描面 = **同包全部生产 Java 源集**（57 文件 / 15,918 行） | **0.024** |
| `ui-tree-dump-core.test.ts`（267 行） | `ui-tree-dump-core.mjs`（210 行） | 1.27 |
| `UiTreeDumpTest.java`（418 行） | `UiTreeDump.java`（361 行） | 1.16 |
| `UiTreeDumpProtocolContractTest.java`（265 行） | 协议两侧承载文件（361 + 210 = 571 行） | 0.46 |
| **门禁机器总量 vs 本票新增生产代码量** | 1,326 / 594 | **2.23×** |

⚠️ **取法说明**（避免下轮误判）：
- **分母必须与扫描面一致**。release 守卫第 2 轮登记时用 `LynxActivity.java`（1242 行）作分母得 0.12；第 3 轮把扫描面扩到**同包全部生产 Java**（因为 `UiTreeDump` 是 package-private，只有 `io.pictelio.app` 包内的类能合法调用它 ⇒ 那批文件就是调用点全集），分母随之变成 15,918 行 ⇒ 比例 0.024。**分母不跟扫描面走，登记值就是错的**（第 3 轮 review 实测抓到登记值停在第 2 轮快照）。
- **单测 ↔ 单文件镜像的字面比例看着过半**（1.27 / 1.16），但这四个文件 60–70% 是中文理由注释（AGENTS.md「中文注释为主」），真实判据体量很小。
- **跨端契约那行**若改按「协议常量条数」算会得出 1250% 的误导性数字——该门禁还重放了「宿主产物名 ↔ 脚本正则」的**行为面**，其契约由 `fileName()` 格式函数 + `ARTIFACT_NAME_RE_SOURCE` 定义，不由常量条数定义。
- **总量比 2.23×** 看着高，但分母只算**本票新增**的生产代码（594 行），而门禁里有一大块是「跨端协议 + 跨端节点数互校」——那类门禁天生需要**两侧各一份**断言，天然高于 1×。**这条比值不是「给回归创造就业」的指标**（那是「单条门禁 vs 它的被测对象」那一列的用途）。

## 4. 证据

- spec：[docs/specs/app-lynx-ui-tree-dump-t0.md](../specs/app-lynx-ui-tree-dump-t0.md)
- issue：[#1045](https://github.com/a1121611810/Pictelio/issues/1045)
- 实现：`packages/android-host/android/app/src/lynx/java/io/pictelio/app/UiTreeDump.java`（宿主侧抓取与落盘）、`packages/android-host/scripts/lib/ui-tree-dump-core.mjs`（脚本侧协议常量 + 可测纯逻辑）、`packages/android-host/scripts/dump-ui-tree.mjs`（诊断脚本编排层）、`packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java`（两个调用点）
- 门禁：
  - `packages/android-host/android/app/src/testLynx/java/io/pictelio/app/UiTreeDumpTest.java`（JVM/Robolectric：触发判定 / 文件名 / 采样档位 / 写盘成功与失败双路径 / 告警）
  - `packages/android-host/android/app/src/testLynx/java/io/pictelio/app/UiTreeDumpProtocolContractTest.java`（JVM：跨端协议逐字比对 + 行为面）
  - `packages/android-host/tests/unit/uiTreeDumpReleaseGate.test.ts`（源级守卫 + 阳性对照）
  - `packages/android-host/tests/unit/scripts/ui-tree-dump-core.test.ts`（落齐判据回归 + 真实样本回放）
- 设备取证（模拟器 `pictelio_ui` / android-34，debug APK）：logcat `UiTreeDump` 逐份记录（受理 + 落盘 + 字节数 + 抓取往返耗时 + 采样点 + 采样延迟），产物落 `Android/data/io.pictelio.app/files/ui-tree/`
- 上游能力边界的核实手段：安装态包内检索（`enableUiSourceMap` / `lynxUiSourceMapRecords`）、`npm view` 查上游最新版本、AAR `javap` 查 SDK API 面、dev 模式构建查 `debug-metadata.json` 产出
