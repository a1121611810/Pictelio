# ADR-0226：翻译 store 取消窗口——用「取消纪元」闸门禁止 provider 启动前被取消的 invocation 外发请求

- **状态**：**已接受（Accepted，2026-10-23）｜已实施**（本轮落地）
- **日期**：2026-10-23
- **依据**：[issue #760](https://github.com/a1121611810/Pictelio/issues/760) 授权 —— 父 agent 依用户在 goal 中交回的决策权批准本 ADR（决策权范围＝非测试 / 门禁 / 品审类票）；用户已验收。
- **相关**：[ADR-0171（翻译缓存策略）](./ADR-0171-translation-cache-strategy.md)、[ADR-0178（翻译重试与 partial UI）](./ADR-0178-app-lynx-translation-retry-and-partial-ui.md)、[ADR-0097（agent skill 仓内化治理记录）](./ADR-0097-agent-skill-repo-localization.md)、[ADR-0169（翻译 provider 接口）](./ADR-0169-translation-provider-interface.md)
- **规格**：`docs/specs/app-lynx-novel-translation.md` §7.2（转移表 + generation-gate 守门）、§9.5
- **取证报告**：[`docs/research/translate-store-cancel-window-2026-10.md`](../research/translate-store-cancel-window-2026-10.md)（确定性复现 + 对照组 + 实施记录）
- **回归防线**：`packages/app-lynx/tests/unit/stores/novelTranslateStoreCancelWindow.test.ts`（7 用例，零墙钟等待）

---

## 1. 背景

`translateChapter` 从「provider 启动前最后一个 await」到「创建 AbortController 并 `++gen`」
之间**没有任何 `gen` / `aborted` 闸门**（⚠️ **改前**坐标：`packages/app-lynx/src/stores/novelTranslateStore.ts:674` → `:715`；**改后**同两处为 `:704` → `:756`，其间已补闸门 `:708` / `:726`）。

取消（`reset()` / `abort()`）落在该窗口内时，被取消的 invocation：

1. **仍然外发一次全新的 provider 请求**（正文外发，白烧 token）——取消时 `activeController`
   还是 `null`，`abort()` 够不着它；
2. 醒来后 `++gen` 抢到**最新**的 generation ⇒ 它的结果**照常落地**
   （`gen !== genNow` 拦不住它）；若此时已有更新的 invocation，新章节的 generation
   反而被反转成旧的 ⇒ **新章节的落地被丢弃**，而旧章节结果照写。

三条取消入口都可达该窗口：章节切换（`NovelDetail.vue:331`）、详情页返回/卸载
（`NovelDetail.vue:586-587`）、译文按钮「停止」（`TranslateButton.vue:125`）。

**这已不是路径分析，而是确定性复现**（取证报告 §1）：3 个复现用例 + 1 个对照组，
对照组证明「窗口位置」是唯一变量 ⇒ 缺陷成立。用户可见后果：**扣费 + 跨章节污染 +
「点了停止却没停」**——正是 spec §7.2「generation-gate 防跨章节污染」与「chapter switch → idle」
要禁止的形态。

> ⚠️ 窗口**窄但真实**：真机上它由原生 prefs 桥往返张成（延迟无上界），web 预览上由
> IndexedDB 读张成（上游诊断记录：这段 I/O 在负载下曾击穿 10/20ms 的墙钟预算）。概率低，后果重
> ⇒ 值得修，但**修法要小**。

## 2. 决策

采用 **「取消纪元」（cancel epoch）**：一个与 `gen` 正交、只表达「这次调用是否已被取消」的计数器。
`reset()` 与 `abort()` 各自 bump 它；调用侧在**入口同步取号**，在每个 await 之后、
**创建 controller 之前**核对，不匹配即静默退出。

### 2.1 闸门位置：只补「没有 controller」的那一段

```ts
// 模块级（与 activeController 同域）
let cancelEpoch = 0

// translateChapter 入口（同步，早于任何 await）
const epochEntry = cancelEpoch
...
const endpointMeta = await loadEndpointMetadataForCache()   // :704
if (cancelEpoch !== epochEntry) { releasePlaceholder(); return }   // 闸门 1
const cached = ... await getTranslation(...)                  // :723
if (cancelEpoch !== epochEntry) { releasePlaceholder(); return }   // 闸门 2
const controller = new AbortController()                      // :756
```

**为什么不需要更多闸门**：await 恢复后到 `:756` 之间没有可让出点（JS 单线程），
⇒ 「建 controller」与「核对纪元」之间是原子的；一旦 controller 建好，
既有的 `signal.aborted` 路径就完整覆盖（对照组用例：窗口外取消 → 请求被真 abort、结果不落地）。

### 2.2 退出路径的状态语义（必须显式定）

静默退出时**不得**写状态：状态由取消方负责（`reset()` → `idle`；`abort()` → `aborted`），
这与 spec §7.2 转移表一致（「chapter switch → idle」「user abort() → aborted」）。

退出前**必须**释放 `inFlightByChapter` 里 `:723` 前后放的 placeholder
（否则同章后续调用会撞上残留的 in-flight 标记）——为此抽出 `releasePlaceholder()`，
由「缓存命中」「取消早退」两条早退路径共用（正常路径仍由 `finally` 兜底）。

### 2.3 为什么不改 `gen` 的语义

更小的改法看起来是「让 `abort()` 也 `gen += 1`」。**否决**，理由：

- `gen` 的既有语义是「**哪个 invocation 是最新的**」（generation-gate 用来挡陈旧响应）；
  让 `abort()` 去 bump 它，会把它变成「取消计数」，两种语义混在一个变量里。
- `abort()` 现在**不** bump `gen`，是有依赖的：`runWithProvider` 的既有早退路径
  （`:780 / :930 / :939 / :954 / :994 / :1020 / :1047`）与「先写缓存后 gate」的顺序
  （`:1019` 写缓存 → `:1020` gate）都建立在「`gen` 只在 `reset()` 与新 invocation 启动时变」之上。
  （⚠️ 订正 2026-10-23：此处原为**改前**坐标 `:739 / :870 / :889 / :898 / :913 / :953 / :979`
  与 `:978-979`，实施后这 7 个坐标**逐条 +41 行**（文件本身净增 51 行：1271 → 1322，故 +41 只对这 7 个坐标成立，
  不是全文件通则）；本文 §2/§5.2 的坐标口径统一为**改后**（当前文件）。）
  改它会连带改变「abort 后是否写缓存」「abort 后状态由谁收敛」等既有行为 —— 那是更大的
  语义变更，应当另立 ADR，而不是搭车。
- 取消纪元是**纯增量**：只影响「还没建 controller 的那一次调用」，
  对已在飞的 invocation 零影响 ⇒ 回归面最小。

### 2.4 与既有闸门的关系

| 闸门 | 回答的问题 | 覆盖区间 |
|------|-----------|---------|
| `signal.aborted` | provider 请求要不要断 | controller 建好之后 |
| `gen !== genNow` | 这个响应是不是陈旧的 | 响应落地时 |
| **取消纪元（新增）** | **这次调用是不是已经被取消了** | **controller 建好之前（本 ADR 补的缺口）** |

三者互补，不重叠。

### 2.5 覆盖面：`retranslate` 的前置 await（同源缺口，一并纳入）

`retranslate` 在调 `translateChapter` 之前还有两个 await（`loadEndpointMetadataForCache`、
`removeTranslation`）。若取消落在那里，它随后调用的 `translateChapter` 会取到**新的**纪元号
⇒ 等于「取消后重新发起」⇒ 被取消章节的正文仍会外发。

⇒ `retranslate` 同样在**入口取号**，并在调 `translateChapter` **之前**再核对一次
（一次核对即可同时覆盖正常路径与缓存失效异常路径）。

> 这条是对本 ADR 草案 §2 的**范围扩展**（草案只写了 `translateChapter`）：它是同一机制、
> 同一缺陷类、同一文件内的相邻路径；若将来认为多余，删掉这一处闸门即可，
> 不影响 `translateChapter` 主路径的闸门（变异矩阵见 §5.3：两者互相独立）。

## 3. 不做什么

- **不改** provider 已启动后的取消语义（`signal.aborted` 已正确覆盖，对照组用例为证）。
- **不改** `gen` 的语义与 bump 时机（见 §2.3）。
- **不改** spec §7.2 状态机表、不新增状态、不改 8 状态集合。
- **不引入**「取消纪元」到别的 store（本次只有翻译 store 有这个窗口）。
- **不改** `NovelDetail.vue` / `TranslateButton.vue` 的调用点（见 §5.4：外部语义未变）。
- **不**引入 `it.fails` 等仓内无先例的测试写法（断言一律用规格期望值）。

## 4. 后果与遗留

**消除的风险**：窗口内取消不再外发请求（不扣费）、不再反转 `gen`
（新章节的落地不再被丢弃）、不再让旧章节的译文落进渲染源（跨章节污染）。

**新增的代价**：翻译 store 多一个模块级计数器（与 `gen` 并列）；
`translateChapter` 多 2 处早退检查 + 1 处 placeholder 释放；`retranslate` 多 1 处核对。

**遗留（明确记录，不假装清零）**：

- ⚠️ **窗口宽度依赖运行时 I/O 延迟**：真机上它由原生桥往返决定，本 ADR 无法收窄它，
  只能保证「落进窗口的取消被正确接住」。若将来要进一步压缩窗口（例如把 endpoint 元数据
  预取到 store 初始化），那是独立的性能议题。
- ⚠️ **闸门 1 不是正确性必需**（变异矩阵 §5.3 实证）：它只是 fail-fast
  ——取消后不再做一次无谓的缓存读（web 预览下那是一次 IndexedDB open+read）。
  真正的正确性闸门是**闸门 2**（缓存读之后）与 `retranslate` 的核对。
  保留闸门 1 是为了贴合「每个 await 之后核对」的口径并省掉那次 I/O；
  **将来删掉它不会破坏正确性**（这一点已用变异实测钉住，避免后人误当它是承重结构）。
- ⚠️ **门禁规模（规模线登记，Standards 轴 2026-10-23 复核）**：新增门禁
  `tests/unit/stores/novelTranslateStoreCancelWindow.test.ts` = **568 行**，被测对象
  `src/stores/novelTranslateStore.ts` = **1322 行** ⇒ **43.0% > 30% 规模线**（568/1322 = 42.97%）。
  **决策来源（「先问」检查点由谁做）**：用户在 goal 中把**非测试 / 门禁 / 品审类**票的决策权交回 agent；
  #760 是**生产竞态票**（不是门禁票）⇒ 本条「先问」由 agent 依该授权自裁，理由逐条如下。
  处置：① 比例虽超线，但该门禁**逐条对应一个真实缺陷类**
  （取消纪元 / 两处闸门 / retranslate 核对 / 缓存命中早退 / 取消早退释放 placeholder），
  删任何一条都会留一个无人钉的分支；② 变异矩阵证明**闸门 2 与 retranslate 核对承重**、
  闸门 1 非承重（§5.3），故冗余面已被实证裁掉而非靠猜；
  ③ **后续若再扩测点，须先拆文件**（真门禁 / 验收组分离），不得继续加码；
  ④ 已登记的已知失效面：门禁用 `deferred()` + `createChannel()` 同步队列控制时序，
  **不测真实 IndexedDB / 真实 provider 往返**⇒ 窗口宽度本身仍依赖运行时 I/O 延迟（见上条）。
- ⚠️ **取消纪元只表达「被取消」，不表达「被谁取消」**：退出路径无法区分
  `reset()`（idle）与 `abort()`（aborted）。这是有意的——状态由取消方负责（§2.2），
  区分它们需要额外状态机，收益不足。

## 5. 证据与实施记录

### 5.1 取证（缺陷态，已实跑）

```bash
cd packages/app-lynx
pnpm exec vitest run tests/unit/stores/novelTranslateStoreCancelWindow.test.ts
```

缺陷态实测：3 个复现用例 + 1 个对照组全部按「缺陷现状断言」通过（对照组始终通过）。
缺陷态的关键事实：取消落在窗口内时 provider **确实**被调用（旧章节那次）、
`gen` **确实**被反转（新章节落地被丢弃、旧章节结果照写）。

### 5.2 实施记录（2026-10-23 落地）

改动文件**仅** `packages/app-lynx/src/stores/novelTranslateStore.ts`：

| 位置 | 改动 |
|------|------|
| `:173` | 新增模块级 `let cancelEpoch = 0`（与 `gen` 正交；作用域 = 模块级，与 `activeController` 同域） |
| `:180` | `resetNovelTranslateStoreForTest()` 一并清零（测试钩子，防用例间串扰） |
| `:425` | `reset()`：`cancelEpoch += 1` |
| `:683` | `translateChapter`：入口同步取号 `const epochEntry = cancelEpoch` |
| `:690` | 抽出 `releasePlaceholder()`（缓存命中 / 取消早退共用） |
| `:708` | 闸门 1：metadata 读取之后核对 → 不匹配则释放占位并静默退出 |
| `:726` | 闸门 2：缓存读取之后核对 → 同上（缓存命中分支也在其后 ⇒ 被取消时不会写缓存命中态） |
| `:748` | 缓存命中分支改用 `releasePlaceholder()` |
| `:1229 / :1250` | `retranslate`：入口取号 + 调 `translateChapter` 之前核对（§2.5） |
| `:1288` | `abort()`：`cancelEpoch += 1`（**不** bump `gen`，见 §2.3） |

外部语义**未变**：`reset()` 仍 abort 在飞 controller + 清状态；`abort()` 仍 abort + 置 `aborted`。
调用点（`NovelDetail.vue:331 / 586-587`、`TranslateButton.vue:125`）**无需改动**。

### 5.3 红→绿自证 + 变异矩阵（均为实跑输出）

**（a）断言先翻成规格期望值 → 改实现前必红**（缺陷态，0.235s，无超时）：

```
 × 章节切换（reset）落在窗口内 → 不外发 provider 请求，结果不落地
   AssertionError: expected [ { chapterId: '1', …(3) } ] to have a length of +0 but got 1
 × 译文按钮停止（abort）落在窗口内 → 不外发 provider 请求，「停止」生效
   AssertionError: expected [ { chapterId: '1', …(3) } ] to have a length of +0 but got 1
 × 窗口内取消 + 新章节先恢复 → 旧 invocation 静默退出，新章节落地不被丢弃
   AssertionError: expected [ { chapterId: '2', …(3) }, …(1) ] to have a length of 1 but got 2
 Tests  3 failed | 1 passed (4)
```

（⚠️ 订正 2026-10-23：上块是**当时只有 4 例**的旧形态输出，作为「改前必红」的历史留痕。
以**现行 7 例**套件跑**缺陷态**（HEAD 实现）实测为 `6 failed | 1 passed (7)`——数字不同是套件规模不同，
不是矛盾。）

**（b）实施后必绿**：`Tests 7 passed (7)`。

**（c）变异矩阵**（逐个禁用闸门 ⇒ 必须有对应用例转红，否则该闸门是摆设）：

| 变异 | 实跑结果 | 判定 |
|------|----------|------|
| 禁用**闸门 1**（`:708`） | `7 passed` | 非必需（fail-fast，见 §4 遗留） |
| 禁用**闸门 2**（`:726`） | `1 failed`（取消落在缓存读取 ⇒ provider 被调用） | **必需** ✔ |
| 禁用 **`retranslate` 核对**（`:1250`） | `1 failed`（重译期间取消 ⇒ provider 被调用） | **必需** ✔ |
| 同时禁用闸门 1+2（= 回滚到缺陷态） | `5 failed \| 2 passed (7)` | 缺陷态可复现 ✔（2026-10-23 复跑实测；原写的 `3 failed` 是 4 例旧形态下数字，不可复现） |

### 5.4 落地后的用例清单（`novelTranslateStoreCancelWindow.test.ts`，7 例）

1. 对照：取消落在窗口**之外**（provider 已启动）→ 请求被 abort、结果不落地（回归护栏：闸门不误伤正常取消路径）。
2. 章节切换（`reset()`）落在窗口内 → 不外发 provider 请求、结果不落地、状态留在 `idle`。
3. 译文按钮停止（`abort()`）落在窗口内 → 不外发 provider 请求、状态留在 `aborted`。
4. 缓存不可用（**真机形态**：窗口内只有 metadata 读取一个 await）→ 取消仍不外发请求。
5. 取消落在**缓存读取**（窗口内第二个 await）→ 不外发 provider 请求。
6. 重译（`retranslate`）在缓存失效期间被取消 → 不得发起 provider 请求。
7. 窗口内取消 + 新章节先恢复 → 旧 invocation 静默退出；**新章节落地不被丢弃**、渲染源与 `currentChapter` 一致（不跨章节污染）。

> 📌 **取证史（可追溯性）**：这批用例 2026-10-23 曾以「**缺陷现状断言**」形态存在过——
> 当时它们断言的是缺陷行为（取消后仍外发请求、`gen` 被反转），在未修实现上**红过**；
> 修法落地后翻成规格期望值 ⇒ 本文件即「改前必红 → 改后必绿」的证据。
> 缺陷态的实测输出与对照说明见 `docs/research/translate-store-cancel-window-2026-10.md`。

### 5.5 定向验证（实跑）

```bash
cd packages/app-lynx
pnpm exec vitest run tests/unit/stores/novelTranslateStore.test.ts \
  tests/unit/stores/novelTranslateStoreCancelWindow.test.ts \
  tests/integration/translationNativeFlow.test.ts
# → Test Files 3 passed (3) / Tests 97 passed (97)

pnpm --filter pictelio-app-lynx check
# → vue-tsc --noEmit -p src/tsconfig.json && tsc --noEmit -p tsconfig.node.json（无输出 = 通过）
```
