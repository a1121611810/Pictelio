# 翻译 store 取消窗口（provider 启动前）—— 确定性复现报告（issue #760）

- 日期：2026-10-23
- 关联票：[#760](https://github.com/a1121611810/Pictelio/issues/760)（T4 挂账：翻译 store 生产竞态候选）
- 上游诊断：[`flaky-novel-translate-store-diagnosis.md`](./flaky-novel-translate-store-diagnosis.md) §5（**仅路径分析，未复现**）
- 复现实验：`packages/app-lynx/tests/unit/stores/novelTranslateStoreCancelWindow.test.ts`
- ADR 草案：[`../adr/ADR-0226-translate-store-cancel-window.md`](../adr/ADR-0226-translate-store-cancel-window.md)
- 规格出处：`docs/specs/app-lynx-novel-translation.md` §7.2（转移表 + generation-gate 守门）、§9.5

---

## 1. 结论

**成立。** 取消落在「provider 启动前最后一个 await → 创建 AbortController 并 `++gen`」这个窗口内时，
被取消的 invocation 会**继续外发一次全新的 provider 请求**（正文外发、白烧 token），
并且它醒来后 `++gen` 抢到的**是最新的** generation ⇒ 它的结果照常落地；
若此时已有更新的 invocation，新章节的 generation 反而被反转成旧的 ⇒ **新章节的落地被丢弃**。

> **状态（2026-10-23）**：本结论已由确定性复现坐实，ADR-0226 已接受并**实施落地**
> （实施记录见 §8）。下文的「现状」描述指**修法落地前**的行为。

最硬的证据：4 个确定性用例（3 个复现 + 1 个对照），**零墙钟等待**，连续 10 跑全绿：

```
$ cd packages/app-lynx && pnpm exec vitest run tests/unit/stores/novelTranslateStoreCancelWindow.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

| # | 用例 | 结论 | 关键断言 |
|---|------|------|----------|
| 1 | **对照**：取消落在窗口**之外**（provider 已启动） | 请求被真 abort，结果不落地 | `signal.aborted === true`；`status === 'aborted'`；渲染源 = 原文 |
| 2 | 取消落在窗口内（章节切换 `reset()`） | **仍外发请求 + 结果照常落地** | provider 被调用 1 次且载荷含正文；`status === 'completed'`；`displayParagraphs === ['第一章译文']` |
| 3 | 取消落在窗口内（译文按钮 `abort()`） | **仍外发请求；用户的「停止」被无视** | provider 被调用 1 次；最终 `status === 'completed'` |
| 4 | 窗口内取消 + 新章节先恢复 | **gen 被反转：新章节落地被丢弃、旧章节结果照写** | 旧 invocation 把新章节的 signal abort 掉；`currentChapter === 2` 但 `displayParagraphs === ['第一章译文']` |

用例 1 是**对照组**：同一个取消动作、同一个 store，只是**位置不同**，结局相反
（窗口外 = 请求被 abort、结果不落地；窗口内 = 请求照发、结果照落）。
⇒ 「窗口位置」是唯一变量 ⇒ 缺陷成立，且断言不是恒真。

## 2. 源码坐标与被测机制

`packages/app-lynx/src/stores/novelTranslateStore.ts`：

> ⚠️ **本节坐标 = 改前（缺陷态，HEAD `0dfcc8e9`）实现**，用于复现原始缺陷；
> **改后**（实施完成）的对应坐标见 [§8.1 改了什么](#81-改了什么)（闸门 1 `:708` / 闸门 2 `:726` / 取号 `:683` …）。
> 实施使该文件**净增 51 行**（1271 → 1322）⇒ 按本节坐标去**当前**文件定位会落空，这是口径差异、不是文档错误。
> ⚠️ **位移逐条不同**：本节表内各坐标的实际位移**不是同一个数**（如 `:674→:704` = +30、
> `:686→:723` = +37），须**按坐标逐条重取**，不可套用统一偏移量。
> （2026-10-23 订正：原表未标版本口径；原此处写「整体偏移 +41 行」，该数只对
> `runWithProvider` 那 7 个坐标成立，非全表通则。）

| 坐标 | 内容 |
|------|------|
| `:674` | `const endpointMeta = await loadEndpointMetadataForCache()` —— **窗口内的第一个 await**（真机上唯一的那个：原生 prefs 往返） |
| `:686` | `const cached = isTranslationCacheAvailable() ? await getTranslation(...) : null` —— 窗口内的第二个 await（web 预览 = IndexedDB 读；真机 = 原生 FS 读或直接跳过） |
| `:690-709` | 缓存命中分支（同步落地 `completed`）—— 窗口内被取消时也会走到 |
| `:715-718` | `const controller = new AbortController()` / `activeController?.abort()` / `activeController = controller` / **`const genNow = ++gen`** |
| `:375-389` | `refreshDisplay()`：`showTranslation && translatedParagraphs.length > 0` → 渲染源取译文，否则取 `sourceParagraphs` |
| `:397-418` | `reset()`：`activeController?.abort()` + **`gen += 1`**（:407）+ 全量清状态（`status='idle'`、`currentChapter=null`、清空译文） |
| `:1236-1242` | `abort()`：`activeController?.abort()` + `status='aborted'`（**不 bump gen**） |
| `:739 / :870 / :889 / :898 / :913 / :953 / :979` | 既有 generation-gate（`gen !== genNow` → return） |

**缺陷点**：`:674`/`:686` 的 await 之后到 `:715` 之间**没有任何 `gen` / `aborted` 闸门**。
JS 单线程 ⇒ await 恢复后到 `:715` 之间没有可让出点 ⇒ 真正的窗口是
**「invocation 挂起在 await 上时，取消动作插进来」**：

1. 取消时 `activeController` 仍是 `null`（还没建 controller）⇒ `abort()` 够不着它 ⇒
   醒来后照常建 controller、照常 `++gen`、照常发请求；
2. `++gen` 发生在取消**之后** ⇒ 被取消的 invocation 抢到**最新**的 generation ⇒
   它的落地不被 `gen !== genNow` 拦下；
3. 若取消方是 `reset()`（`gen += 1`），而另一个更新的 invocation 先恢复并拿走了 `gen=N`，
   则旧 invocation 醒来后 `++gen` 拿到 `N+1` ⇒ **新章节的 gen 被反转成旧的** ⇒
   新章节落地被丢弃；同时旧 invocation 的 `activeController?.abort()`（`:716`）
   反过来把**新**章节的请求 abort 掉。

## 3. 复现方法（确定性）

文件：`packages/app-lynx/tests/unit/stores/novelTranslateStoreCancelWindow.test.ts`

- **接缝**（沿用仓内既有 mock 接缝，不新增生产接口）：
  `src/utils/idbKV`（endpoint 元数据 KV = 窗口内的第一个 await）、
  `src/utils/translationCache`（缓存读写）、`src/api/translate`（provider 桩）、
  `src/api/nativeTranslate`、`src/stores/settingsStore`。
- **可控延迟**：`idbGet` 返回**手动放行**的 promise ⇒ 取消可被精确投进窗口，
  且可**控制两个 invocation 的恢复顺序**（用例 4 需要反序恢复）。
- **零墙钟等待**：所有等待都是「等被观测事实发生」（provider 被调用 / 迭代器被消费），
  用同步队列 + 等待者实现 ⇒ 结论只取决于行为是否发生，与机器快慢无关。
- **不 mock 被测逻辑**：store 的取消 / generation / 落地逻辑全部走真实实现；
  被 mock 的只有 IO 边界与 provider（与 `novelTranslateStore.test.ts` 同一形态）。
- **期望值溯源**：断言取自 spec §7.2 转移表与「generation-gate 守门」条文，
  不是「实现正好等于断言」。

### 复现命令

```bash
cd packages/app-lynx
pnpm exec vitest run tests/unit/stores/novelTranslateStoreCancelWindow.test.ts
```

### 关键输出

```
 ❯ tests/unit/stores/novelTranslateStoreCancelWindow.test.ts (4 tests) 377ms
   ✓ 对照：取消落在窗口**之外**（provider 已启动）→ 请求被 abort，结果不落地
   ✓ 现状：章节切换（reset）落在窗口内 → 仍然外发 provider 请求，且结果照常落地
   ✓ 现状：译文按钮停止（abort）落在窗口内 → 请求照发，用户的「停止」被无视
   ✓ 现状：新章节先恢复 → 旧 invocation 反转 gen，新章节落地被丢弃、旧章节结果照写
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

连续 10 跑（`for i in $(seq 10); do pnpm exec vitest run <file>; done`）→ 10/10 `4 passed`，
零 flake。与既有 `novelTranslateStore.test.ts` 同跑 → 91 passed（无交叉污染）。

## 4. 窗口可达性（真机 / web 预览）

| 运行时 | 窗口内的 await | 宽度 |
|--------|----------------|------|
| 真机（native） | `:674` 原生 `PictelioPrefs.prefsGet` × 4 并发往返（`Promise.all`） | 桥往返延迟**无上界**（桥队列繁忙 / 正文并发加载时可显著拉长） |
| 真机（原生 FS 缓存可用时） | `:674` + `:686` 原生 FS 读 | 同上 |
| web-core 预览 | `:674` IndexedDB 读 + `:686` IndexedDB 读 | 上游诊断记录：这段 I/O 在负载下**曾击穿 10/20ms 的墙钟预算** |

⇒ 窗口**窄但真实**：它由一次跨线程（真机）/ 跨事件循环（web）的真实 I/O 张成，
用户动作（切章节 / 点停止 / 返回）与它的相对时序不可控。
概率低，但后果是**扣费 + 跨章节污染**（spec §7.2 明令禁止的那一类）。

## 5. 影响面（取消入口 → 用户可见后果）

取消入口（全仓 `translateStore.reset()` / `translateStore.abort()` 调用点）：

| 入口 | 位置 | 语义 |
|------|------|------|
| 章节切换 | `packages/app-lynx/src/pages/NovelDetail.vue:331`（`watch(novelId)` → `translateStore.reset()`） | spec §7.2 转移表末行「任何 \| chapter switch \| idle \| abort() if in-flight; reset state」 |
| 详情页返回 / 卸载 | `packages/app-lynx/src/pages/NovelDetail.vue:586-587`（`abort()` + `reset()`） | spec §7.2「用户切章节 / 关闭详情页 → 流断开 → aborted」 |
| 译文按钮「停止」 | `packages/app-lynx/src/components/TranslateButton.vue:125`（`store.abort()`） | spec §6.2「翻译中点击 = 停止」；按钮在 `pending` 态即可点（`isTranslatingThis` 含 `pending`） |

用户可见后果：

1. **切章节落在窗口内** → 旧章节请求仍然外发（**正文白发给第三方 LLM、扣 token**），
   且旧章节译文落进 store 的渲染源 ⇒ **新章节页面显示旧章节的译文**
   （`NovelDetail.vue:318-322` 的渲染源单点：`displayParagraphs.length > 0` 即用 store 的）
   —— 正是 spec §7.2「generation-gate 防跨章节污染」要禁止的形态。
2. **「停止」落在窗口内** → 请求照发、翻译照跑完、最终 `status='completed'`
   ⇒ **用户以为停了，其实没停，还照扣了费**。
3. **窗口内取消 + 新章节先恢复** → 新章节的落地被反转的 `gen` 丢弃，
   旧章节结果照写；若旧章节请求也失败，状态可能**卡在 `translating`**（新章节永远译不出来）。

## 6. 修法提案（→ 已按 ADR-0226 实施，见 §8）

引入**取消纪元**（cancel epoch）：`reset()` 与 `abort()` 各自 bump 一个模块级计数器；
`translateChapter` 在**入口同步取号**，在每个 await 之后、**创建 controller 之前**核对纪元，
不匹配即静默退出（不建 controller、不 `++gen`、不发请求）。

- 为什么不用「让 `abort()` 也 bump `gen`」：那会把 `gen` 的语义从「谁是最新 invocation」
  改成「取消计数」，并连带改变 `runWithProvider` 里既有的 `gen !== genNow` 早退路径
  与「先写缓存后 gate」的顺序（`:1019-1020`）—— 属于更大的语义变更，需另立 ADR。
  （⚠️ 订正 2026-10-23：此处原为**改前**坐标 `:978-979`，实施后整体偏移 +41 行；
  本文 §6/§8/§9 的坐标口径统一为**改后**（当前文件），与
  [ADR-0226 §2.3](../adr/ADR-0226-translate-store-cancel-window.md) 保持一致。）
- 为什么不改「provider 已启动后」的路径：那条路径已被 `signal.aborted` 正确覆盖（对照组用例 1）。

落地时另补了 `retranslate` 的前置 await（ADR-0226 §2.5）——同一缺陷类、同一文件内的相邻路径。

## 7. 残留与风险

- ~~本报告**只做取证**，**未改任何生产行为**；修法需 ADR 评审后再实施。~~
  → **已落地**（2026-10-23）：ADR-0226 已接受并实施，实施记录见 §8。
- 复现实验的断言**已**从「缺陷现状」翻成「规格期望值」（改前必红 → 改后必绿，实测输出见 §8.2）。
- 窗口宽度依赖运行时 I/O 延迟，真机上无法在单测里精确复现「多窄」；
  本报告的结论是「机制确定可达 + 概率低」，不是「高频发生」。
- 真机原生 FS 缓存通道（ADR-0172）是否在 `:686` 也构成 await，取决于
  `isFilesystemTranslationCacheAvailable()` 的真机取值 —— 未上真机核实（不影响结论：
  `:674` 那个 await 已足够）。
- **闸门 1（`:708`）经变异实测并非正确性必需**（fail-fast，见 §8.2c）；真正的承重闸门是
  闸门 2（`:726`）与 `retranslate` 核对（`:1250`）。

## 8. 修法实施记录（2026-10-23，ADR-0226 已接受并落地）

### 8.1 改了什么

生产改动**仅** `packages/app-lynx/src/stores/novelTranslateStore.ts`（外部语义未变）：

| 位置 | 改动 |
|------|------|
| `:173` | 新增模块级 `let cancelEpoch = 0` —— **与 `gen` 正交**的「取消纪元」，只表达「这次调用是否已被取消」；作用域 = 模块级（与 `activeController` 同域：`abort()`/`reset()` 取消的是模块级在飞请求，纪元必须同域） |
| `:180` | `resetNovelTranslateStoreForTest()` 一并清零（测试钩子，防用例间串扰） |
| `:425` | `reset()`：`cancelEpoch += 1` |
| `:683` | `translateChapter`：**入口同步取号** `const epochEntry = cancelEpoch`（必须早于任何 await，否则「取号时已被取消」会漏判） |
| `:690` | 抽出 `releasePlaceholder()`（缓存命中 / 取消早退共用；正常路径仍由 `finally` 兜底） |
| `:708` | **闸门 1**（metadata 读取之后）：`cancelEpoch !== epochEntry` ⇒ 释放占位 + 静默退出 |
| `:726` | **闸门 2**（缓存读取之后）：同上。位置在缓存命中分支**之前** ⇒ 被取消时连缓存命中态都不会写 |
| `:748` | 缓存命中分支改用 `releasePlaceholder()` |
| `:1229 / :1250` | `retranslate`：入口取号 + 调 `translateChapter` **之前**核对（它若不核对，翻译会在取消后重新发起） |
| `:1288` | `abort()`：`cancelEpoch += 1`（**不** bump `gen` —— ADR-0226 §2.3 的取舍：改 `gen` 会连带改写既有早退路径与「先写缓存后 gate」的顺序） |

**取消纪元怎么取号 / 核对**：
取号 = 调用入口处同步读一次 `cancelEpoch`（早于任何 await）；
核对 = 每个 await 之后、**创建 AbortController 之前**比对 `cancelEpoch !== epochEntry`；
不匹配 ⇒ 释放 `inFlightByChapter` 占位 + **静默退出**（不建 controller、不 `++gen`、不外发请求、**不写状态**——
状态由取消方负责：`reset()` → `idle`，`abort()` → `aborted`）。

### 8.2 红→绿实测

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

> ⚠️ **订正（2026-10-23，Standards 轴第 6 轮）**：上块输出是**只有 4 例时的旧形态**。
> 以**现行 7 例**套件跑**缺陷态**（= 回到 HEAD `0dfcc8e9` 的实现）实测为
> **`6 failed | 1 passed (7)`**（已复跑核实）；同口径见
> [ADR-0226 §5.3](../adr/ADR-0226-translate-store-cancel-window.md)——该处已带同一订正。
> 本块保留原样作**改前历史留痕**。

**（b）实施后必绿**：`Tests 7 passed (7)`。

**（c）变异矩阵**（逐个禁用闸门 ⇒ 必须有对应用例转红）：

| 变异 | 实跑 | 判定 |
|------|------|------|
| 禁用闸门 1（`:708`） | `7 passed` | 非必需（fail-fast：省掉取消后的无谓缓存读） |
| 禁用闸门 2（`:726`） | `1 failed` | **必需** ✔ |
| 禁用 `retranslate` 核对（`:1250`） | `1 failed` | **必需** ✔ |
| 同时禁用闸门 1+2（= 缺陷态） | `5 failed \| 2 passed (7)` | 缺陷态可复现 ✔ |

> ⚠️ **订正（2026-10-23，Standards 轴第 6 轮）**：上表末行原写 `3 failed`，与
> [ADR-0226 §5.3](../adr/ADR-0226-translate-store-cancel-window.md) 的
> `5 failed | 2 passed (7)` 矛盾——`3 failed` 是**只有 4 例时的旧形态**数字。
> 以**现行 7 例**套件实跑「同时禁用闸门 1+2」= **`5 failed | 2 passed (7)`**（已复跑核实）。

### 8.3 修后用例数与清单

`packages/app-lynx/tests/unit/stores/novelTranslateStoreCancelWindow.test.ts`：**7 例**（原 4 例 → 拆细 + 补 3 例）：

1. 对照：取消落在窗口**之外** → 请求被 abort、结果不落地（护栏：闸门不误伤正常取消路径）。
2. 章节切换 `reset()` 落在窗口内 → 不外发请求、结果不落地、状态留 `idle`。
3. 译文按钮 `abort()` 落在窗口内 → 不外发请求、状态留 `aborted`。
4. **缓存不可用（真机形态）** → 窗口内只有 metadata 读取一个 await，取消仍不外发请求。
5. **取消落在缓存读取**（窗口内第二个 await）→ 不外发请求（钉住闸门 2）。
6. **重译期间取消** → 不得发起 provider 请求（钉住 `retranslate` 核对）。
7. 窗口内取消 + 新章节先恢复 → 旧 invocation 静默退出；**新章节落地不被丢弃**、渲染源与 `currentChapter` 一致。

### 8.4 定向验证

```bash
cd packages/app-lynx
pnpm exec vitest run tests/unit/stores/novelTranslateStore.test.ts \
  tests/unit/stores/novelTranslateStoreCancelWindow.test.ts \
  tests/integration/translationNativeFlow.test.ts
# → Test Files 3 passed (3) / Tests 97 passed (97)

pnpm --filter pictelio-app-lynx check
# → vue-tsc + tsc 均无输出（通过）
```

### 8.5 调用点复查（`NovelDetail.vue` / `TranslateButton.vue`）：**无需改动**

| 调用点 | 外部语义是否变化 |
|--------|-----------------|
| `NovelDetail.vue:331`（章节切换 → `reset()`） | 否：仍 abort 在飞 controller + 清状态；差别仅在「窗口内的 invocation 改为静默退出」 |
| `NovelDetail.vue:586-587`（返回/卸载 → `abort()` + `reset()`） | 否：同上（两次 bump 纪元互不干扰） |
| `TranslateButton.vue:125`（停止 → `abort()`） | 否：仍 abort + 置 `aborted`；差别仅在「窗口内的 invocation 改为静默退出」 |

⇒ **两个文件均未改动**（且不在本次授权范围内）。

## 9. 证据出处

- 复现实验：`packages/app-lynx/tests/unit/stores/novelTranslateStoreCancelWindow.test.ts`（**7 例**；改前 4 例 → 改后 7 例，清单见 §8.3）
- 源码坐标（**改后**）：`packages/app-lynx/src/stores/novelTranslateStore.ts` 取号 `:683` / 闸门 1 `:708` / 闸门 2 `:726` / `AbortController` `:756` / `++gen` `:759` / `reset()` `:413`（`cancelEpoch += 1` 在 `:425`）/ `abort()` `:1283`（bump 在 `:1288`）/ `refreshDisplay()` `:391`；**改前**坐标见 §2 表（版本口径见 §2 抬头）
- 取消入口：`packages/app-lynx/src/pages/NovelDetail.vue:331 / 586-587`、`packages/app-lynx/src/components/TranslateButton.vue:125`
- 规格条文：`docs/specs/app-lynx-novel-translation.md:570`（转移表末行）、`:583`（generation-gate 守门）、`:760`（切章节/关详情页）、`:764`（chunk 落地须比对 chapterId）
- 上游诊断：`docs/research/flaky-novel-translate-store-diagnosis.md` §5（路径分析）、§7 D3（恶意时序守卫的做法先例）
