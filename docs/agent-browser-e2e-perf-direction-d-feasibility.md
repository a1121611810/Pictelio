# 提速方向 D（进程 spawn 开销 → batch 合并）可行性实测报告

> 状态：实测完成。本报告回答 `docs/agent-browser-e2e-perf-analysis.md` 第 3 节「方向 D」的
> 可行性问题，并按 **高可维护性 / 高性能 / 高安全性 / 低内存占用** 四个维度给出量化结论。
> 配套一次性原型：`packages/app/tests/agent-browser/prototype-batch/bench.mjs`
> （PROTOTYPE，不进正式套件 include，验证后即弃）。
> 实测日期：2026-08-14；agent-browser **0.34.0**（项目本地依赖，pnpm store 解析），
> Chrome for Testing 147.0.7727.56（headless）。

## 0. 结论摘要（TL;DR）

1. **方向 D 可行，且比文档估计更值得做**：`agent-browser batch`（stdin JSON 模式）
   实测将 30 个纯 `eval` 命令从 1234.9ms（41.2ms/命令）压到 52.4ms（1.7ms/命令），
   **加速 23.6x**；混合真实序列（snapshot+eval+click，60 命令）加速 **6.8x**；
   150 命令全量模拟 902ms vs 独立约 7.1s，**加速 ~8x**。
2. **必须用 stdin JSON 模式，禁用参数模式**：实测 batch 参数模式会把命令字符串二次解析，
   带引号的 JS（`document.querySelector('h1')`）被破坏成 `document.querySelector(h1)`
   并抛 `ReferenceError`；stdin JSON 模式中文/换行/引号全部保真。这是方向 D 的**硬约束**。
3. **错误传播语义必须重写，不能复用现有 `ab()`**：batch 中任一命令失败 → CLI 整体
   exit code=1、stderr 为空、错误在 stdout JSON 的 `error` 字段。driver.ts 现有
   `if (result.status !== 0) throw` 会把"整批"误判为失败并丢失其余成功命令的结果。
4. **改造面 = driver.ts 单文件**，spec 文件零改动（保持方法签名不变）；
   最大收益点：`getState` 的 `snapshot + pageText` 合并、连续 eval 合并、
   `clickReliable` 改为"先 evaluate 探测后决策"。
5. **两个必须处理的工程约束**：① spawnSync 默认 maxBuffer=1MB，实测 10×snapshot
   batch 已达 657KB、150 命令 4.38MB → 必须提高 maxBuffer 并按输出体积分批；
   ② `batch` 是固定序列、**无法表达条件分支与轮询循环**，`clickReliable` 的 fallback 链
   和 `waitFor*` 轮询不能整体 batch 化，只能"探测→决策"两段式合并。
6. **对全量耗时的贡献（保守估计 0.5~1 min，占全套 20~35 min 的 2~5%）**：
   文档已正确评估 D 是六方向中收益最小的单项；但实现成本也最低（单文件、无 spec 改动、
   无会话隔离风险），适合作为 A/B/C 之后的增量落地项，且与其余方向完全独立。

---

## 1. 方向 D 是什么（原文引用 + 本报告的操作化定义）

> 原文（分析文档第 3 节 D）："每次 `ab()` 一次 spawnSync。agent-browser 0.34 提供
> **`batch` 命令**（'Execute multiple commands in a single invocation… avoids per-command
> process startup overhead'，支持参数或 stdin JSON 管道）和 `eval --stdin`。driver 可将
> 'snapshot + click + pageText' 等连续操作合并为一次进程调用；`clickReliable` 的 fallback
> 链（最多 7 次 spawn）可先 evaluate 探测再决定路径。"

本报告将其操作化为四个可验证子项：

| 子项 | 内容 | 验证方式 |
|---|---|---|
| D-1 存在性 | `batch` 命令在项目实际依赖的 0.34.0 中存在，参数/JSON 两模式可用 | CLI help + README + 实测 |
| D-2 保真度 | stdin JSON 传递的 JS（引号/中文/换行）与独立调用语义一致；参数模式对照 | 实测 eval 带引号/中文 |
| D-3 错误语义 | 命令失败时的 exit code / stderr / stdout 结构，driver 如何逐命令恢复 | 实测失败+成功混合 |
| D-4 收益 | 量化独立 spawn vs batch 的耗时差，含大输出（snapshot）场景 | bench.mjs 多轮实测 |

**不改变**：`createLoggedInDriver` 登录流程（方向 A）、SLEEP→条件等待（方向 B）、
LLM 断言（方向 C）、图片 mock（方向 E）、并行/重试（方向 F）。

---

## 2. 环境与前置验证（重要：三个环境事实）

### 2.1 运行时解析的是 0.34.0，不是 PATH 里的 0.31.1

- 系统 PATH 的 `agent-browser` 是 bun 全局安装的 **0.31.1**（`/Users/lilianda/.bun/bin/agent-browser`）。
- 但测试经 pnpm 运行时会解析 `packages/app/node_modules/.bin/agent-browser`（pnpm 的
  `.bin` 包装脚本），实测 `PATH=.../node_modules/.bin:$PATH agent-browser --version`
  输出 **0.34.0**，与 `package.json` 声明的 `^0.34.0` 一致。
- `batch` 命令在 0.31.1 与 0.34.0 中均存在（0.31.1 help 已有 `Batch:` 段），0.34.0 README
  第 237~254 行给出参数模式与 stdin JSON 模式示例。**方向 D 不依赖版本升级**。

### 2.2 代理环境变量会劫持 daemon 的本地 CDP 连接（测试环境事项）

本项目开发环境设置 `http_proxy=http://127.0.0.1:10808`、`all_proxy=socks5://127.0.0.1:10808`。
实测在此环境下 agent-browser daemon 启动/连接 Chrome 全部失败（`CDP response channel closed`
/ `Connection reset without closing handshake`），**与 batch 无关，是 daemon 的本地 CDP
WebSocket 被代理拦截**。清除代理环境变量后 connect/eval/batch 全部正常。
结论：跑 agent-browser E2E 的环境应确保本地回环不被代理劫持（或配置 `NO_PROXY=127.0.0.1,localhost`）。

### 2.3 实测方法：Node spawnSync 复刻 driver.ts 的调用方式

原型 `bench.mjs` 用 `spawnSync("agent-browser", args, { encoding, timeout, shell: false })`
逐条复刻 driver.ts:19-33 的 `ab()`，保证测量的是同一进程模型。所有耗时在同一已连接会话内
测量（首调预热排除 daemon 冷启动），对照组与实验组交替在相同浏览器会话中执行。

---

## 3. 实测结果

### 3.1 D-1：`batch` 两种模式均可用（实测输出）

```
# 参数模式（输出 = 各命令 stdout 直接拼接，无分隔符）
agent-browser batch "eval document.title" "eval document.body.innerText" "snapshot -i"
# → 输出依次为 "" \n "batch-test\nbtn..." \n a11y 树，命令边界不可机器区分

# stdin JSON 模式（输出 = 结构化 JSON 数组）
echo '[["eval","document.title"],["eval","document.body.innerText"]]' | agent-browser batch --json
# → [{"command":["eval","document.title"],"error":null,
#     "result":{"result":"...","origin":"...","lifecycle":{...}},"success":true}, ...]
```

**stdin JSON 模式的关键结构**（driver 改造必须依赖）：

| 字段 | 含义 | 与独立命令 stdout 的差异 |
|---|---|---|
| `success` | 该命令是否成功 | 新增，可逐命令判断 |
| `error` | 失败时的错误消息（成功为 null） | 新增 |
| `result.result` | `eval` 的返回值（JSON 编码字符串） | 独立模式在 stdout 顶层 |
| `result.snapshot` | `snapshot` 的文本 a11y 树 | 与独立模式 stdout **一致** |
| `result.refs` | 结构化 ref 映射 `{e1:{name,role},...}` | 新增，可直接替代文本解析 |
| `result.origin` / `result.lifecycle` | 页面来源 / 会话生命周期信息 | 新增，可用于调试 |

### 3.2 D-2：保真度——参数模式有引号破坏 bug，stdin JSON 模式全保真

| 场景 | 独立 `eval` | batch 参数模式 | batch stdin JSON |
|---|---|---|---|
| `document.querySelector('h1').innerText` | `"page-b"` ✅ | `ReferenceError: h1 is not defined` ❌ | `"page-b"` ✅ |
| `JSON.stringify({a:1})` | `"{\"a\":1}"` ✅ | `"{\"a\":1}"` ✅（无引号嵌套时碰巧通过） | `"{\"a\":1}"` ✅ |
| 中文 + 换行 + 嵌套引号 | ✅ | 未测（已知脆弱） | `"{\"a\":\"中文测试\",\"b\":\"line1\\nline2\"}"` ✅ |

**根因**：参数模式把每个参数当作"完整命令行字符串"再内部二次分词，`'h1'` 的引号在
第二次解析中丢失。本项目 driver 大量注入含引号/换行的 JS（`mockFetch`、`clickReliable`
的 evaluate、`getAttribute` 等），**参数模式不可用于本项目，方向 D 必须且只能走
stdin JSON 模式**。

**额外验证**：`mockFetch` 的长 JS 注入在 batch eval 中工作正常（返回 `"ok"`，且后续
`fetch("https://api.test/x")` 返回注入的 mock body）；batch 内 `open` 导航后接 `eval`
顺序正确（先导航后求值命中新页面）。**driver 现有注入类方法可在 batch 中原样复用**。

### 3.3 D-3：错误语义——必须逐命令恢复，不能整体 throw

| 场景 | CLI exit code | stderr | stdout |
|---|---|---|---|
| 全成功 | **0** | 空 | 全部 JSON 结果 |
| 混合（成功+失败，无 `--bail`） | **1** | **空** | 全部命令执行完，每个命令独立 `success`/`error` |
| 混合 + `--bail` | **1** | 空 | 失败命令处停止（后续命令不执行） |
| 全失败（无 `--bail`） | **1** | 空 | 全部执行完，全部 `success:false` |

**对 driver.ts 的强制要求**：
1. `ab()` 的 `if (result.status !== 0) throw` 逻辑**不能**直接用于 batch——一个命令失败
   会使整批 exit 1，但其余命令成功且结果完整。必须解析 stdout JSON，按 `success` 逐命令
   处理，仅在调用方期望的语义下抛出等价错误（例如无 `--bail` 时收集所有失败，或按
   文档建议"默认 continue all"）。
2. `--bail` 语义与 driver 现有 fallback 链的"逐个尝试"不兼容：fallback 需要"失败后
   执行下一个候选"，而 `--bail` 是"失败即停"。**clickReliable 的 fallback 链不能直接
   塞进单个 batch**，需按 4.2 的方案改造。

### 3.4 D-4：性能量化（本机实测，同一已连接会话）

**场景 1：30 个纯 `eval`**（最理想合并场景）

| 方式 | 总耗时 | 每命令 | 加速比 |
|---|---|---|---|
| 独立 spawnSync ×30 | 1234.9ms | 41.2ms | 1x |
| batch 参数模式 ×1 | 51.2ms | 1.7ms | **24.1x** |
| batch stdin JSON ×1 | 52.4ms | 1.7ms | **23.6x** |

**场景 2：60 命令混合序列（20× snapshot + 20× eval + 20× click）**（接近真实 driver 使用模式）

| 方式 | 总耗时 | 每命令 | 加速比 |
|---|---|---|---|
| 独立 spawnSync ×60 | 2572.4ms | 42.9ms | 1x |
| batch stdin JSON ×1 | 377.5ms | 6.3ms | **6.8x** |

**场景 3：100× snapshot**（大输出极限）

| 方式 | 总耗时 | 每命令 | stdout 体积 |
|---|---|---|---|
| 独立 spawnSync ×100 | 4229.9ms | 42.3ms | 每次 ~580B |
| batch stdin JSON ×1 | 108.1ms | 1.08ms | 57.9KB |

**场景 4：150 命令全量模拟（80 eval + 40 snapshot + 30 click）**（≈文档"全套 spec 级
driver 操作约 143 次"的量级）

| 方式 | 总耗时 | stdout 体积 | 说明 |
|---|---|---|---|
| 独立（实测前 50 命令外推） | ~7118ms | — | 前 50 命令实测 2372.7ms |
| batch stdin JSON ×1 | 902.2ms | **4.38MB** | 已超 spawnSync 默认 1MB maxBuffer |

**读数**：加速比随 batch 中 snapshot 类大输出命令占比上升而下降（输出体积成为传输瓶颈），
纯 eval 场景最高（~24x），混合场景 ~7x，全量混合 ~8x。每命令 spawn 开销本机稳定
~41ms（文档估计 30~150ms 的区间下沿），**batch 后降到 1.7~6.3ms/命令**。

### 3.5 大输出与 maxBuffer 边界（工程硬约束）

- 单大页面（500 按钮）`snapshot` = 16.3KB；10×snapshot batch = 657.6KB；
  150 命令混合 batch = 4.38MB。
- spawnSync 默认 `maxBuffer` = **1MB**：10 个 snapshot 已逼近上限，150 命令必超。
- **结论**：driver 改造必须提高 maxBuffer（建议 ≥ 16MB），且 batch 需按输出体积预算
  分批（不能无脑一次塞全部），否则 `spawnSync` 抛 `maxBuffer exceeded` 前功尽弃。
  分批粒度建议按"预计 stdout ≤ 1MB / 批"控制（约 ≤15 个 snapshot 或 ≤100 个 eval）。

---

## 4. driver.ts 改造方案（单文件、spec 零改动）

### 4.1 新增底层：`abBatch(commands: string[][]): BatchResult[]`

```ts
// 伪代码：spawnSync + stdin JSON + maxBuffer 调高 + 逐命令错误恢复
function abBatch(commands: string[][]): BatchResult[] {
  const result = spawnSync("agent-browser", ["batch", "--json"], {
    encoding: "utf-8", timeout: SPAWN_TIMEOUT, shell: false,
    input: JSON.stringify(commands), maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const parsed = JSON.parse(result.stdout ?? "[]") as BatchResult[];
  // 不整体 throw：由调用方按 success 字段逐命令处理
  return parsed;
}
```

### 4.2 三个受益点的具体合并策略

| 调用点 | 现状 spawn 次数 | batch 化后 | 说明 |
|---|---|---|---|
| `getState`（`snapshot` + `pageText`） | 2 次 | **1 次** | 一次 batch：`[["snapshot","-i"],["eval","document.body.innerText"]]`；snapshot 取 `result.snapshot`，pageText 取 `result.result` |
| 连续 `evaluate`（断言前多属性探测） | N 次 | **1 次** | 如 `getAttribute`/`getComputedStyle` 多属性同批求值（可合并为一个 eval 返回对象） |
| `clickReliable` fallback 链 | ≤7 次 | **探测 1 次 + 执行 1 次** | 先一个 evaluate 返回"是否存在可点元素 + 其 ref/selector"（一次 spawn 拿到全部决策信息），再 batch 执行确定路径；**保留独立 fallback 路径作兜底** |

**不可 batch 化（保持现状）**：`waitForPageContent`/`waitForSelector` 的轮询循环
（循环依赖每次探测结果决定是否继续，batch 是固定序列无法表达）；`launch`/`open`/`close`
（单次命令无合并价值）。

### 4.3 对 spec 文件的影响

全部方法签名不变（`snapshot()`、`pageText()`、`clickReliable()`、`waitFor*()` 对外接口
一致），spec 文件**零改动**。唯一可见变化是 driver 层实现细节。

---

## 5. 四维度分析

### 5.1 高可维护性（结论：**优**，但有一个语义风险要钉死）

- **改造面最小**：`docs/agent-browser-e2e-perf-analysis.md` 第 6 节明确"涉及文件：
  `tests/agent-browser/driver.ts`（单文件改动全局生效）"，与实测一致——spec/fixtures/
  ai-shared 均无需改动。
- **对外接口不变**：4.2 的合并全部收敛在 driver 内部，测试代码无需感知 batch 的存在，
  后续新增 spec 继续用 `driver.xxx()` 即可，不增加使用方心智负担。
- **语义风险（必须处理）**：现有 `ab()` 是"失败即 throw"的强语义，batch 默认"continue
  all"。若 driver 层不显式恢复"失败即抛"语义（逐命令检查 `success`，为 false 时抛等价
  Error），会让失败的点击/导航静默继续，产生"假通过"。改造时必须保留原有错误可见性
  （AGENTS.md「禁止静默降级」硬约束）。
- **依赖锁定**：batch 的 JSON 结构（`command/error/result/success`）是 0.34.0 的稳定输出
  契约，README 有文档；但升级 agent-browser 时需回归验证该结构（建议在 driver 层做一次
  结构校验 + `console.warn` 兜底，符合"契约破坏必须可见"）。

### 5.2 高性能（结论：**优**，实测 6.8x~24x）

- 纯 eval 场景 23.6x、混合真实序列 6.8x、全量模拟 ~8x，与文档"避免 per-command process
  startup overhead"的预期一致，且**实测收益高于文档保守估计**（文档按 30~150ms/次估算，
  本机实测 41ms/次、batch 后 1.7~6.3ms/次）。
- 对全套耗时的贡献：按文档 500~1000 次 spawn 估计，独立 spawn 开销约 20~40s（本机
  41ms/次），batch 化后降到 ~1.7s；叠加"可合并比例"（getState/连续 eval/探测类，估
  **约 50~70% 的 spawn 可合并**），**实际可省约 0.5~1 min**。与文档"0.5~1.5 min"一致，
  但需要说明：方向 D 是六方向中**最小收益项**（占全套 20~35 min 的 2~5%），不应作为
  首要优化。
- **无副作用加速**：batch 合并后总 spawn 次数从 500~1000 降到 ~50~100，daemon socket
  连接握手次数同步下降，对每次操作的端到端延迟均有正收益（不只是省 spawn 本身）。

### 5.3 高安全性（结论：**优**，且 batch stdin 模式比现状更安全）

- **注入面**：现有 `spawnSync(..., { shell: false })` 已无 shell 注入；batch 参数经
  stdin JSON 传递，**不经过任何 shell 分词**，不存在参数模式的"二次解析导致参数漂移"
  问题——即 3.2 的引号 bug 在安全视角下正是"参数被意外改写"的实例，stdin 模式消除了
  这一类歧义。
- **错误可见性**：batch 失败时 stderr 为空、错误在 stdout JSON 的 `error` 字段——若
  driver 层按 4.1 正确解析，错误消息与独立模式**逐字节等价**（实测 `Element not found:
  #nope. Verify the selector...` 完整保留），不丢失诊断信息。
- **新增风险点**：无 `--bail` 时后续命令在"前序失败"后仍继续执行——若序列存在强依赖
  （如导航后点击），可能产生错误状态。缓解：driver 层对强依赖序列显式传 `--bail` 或
  在解析后检查 `success` 链。**该风险是 driver 实现层的选择，不是 batch 固有缺陷**。
- 不变项：无新增网络出口、无新增文件写入（除 maxBuffer 内存）、无凭据/密钥相关改动。

### 5.4 低内存占用（结论：**中**，需显式分批控制）

- **收益**：spawn 进程从 500~1000 次降到 ~50~100 次，进程创建/销毁、二进制加载、
  V8 运行时初始化的瞬时内存峰值与 GC 压力显著下降（每次 spawn 一个 Rust CLI 进程 +
  Node 包装的开销是纯浪费）。
- **成本**：batch 把多次 stdout 合并为一次进 JS 堆——150 命令 4.38MB、10×snapshot
  657KB。相比独立模式"每次 ~600B 即取即弃"，batch 的**峰值堆占用更高**（一次性持有
  整批结果）。
- **结论**：必须按输出体积预算分批（建议单批 ≤1MB，约 15 个 snapshot 或 100 个 eval），
  并提高 maxBuffer ≥16MB 兜底。在"分批 + 合理 batch 大小"约束下，净内存占用**优于**
  现状（进程开销减少的收益 > 结果暂存的成本）。若不加约束一次塞 150+ 命令，内存占用
  反而劣化——这是落地时必须写入 driver 注释的硬约束。

---

## 6. 风险与边界

| 风险 | 等级 | 缓解 |
|---|---|---|
| batch 参数模式引号破坏（若误用参数模式） | 高 | **强制走 stdin JSON**，driver 层不暴露参数模式入口 |
| maxBuffer 超限（大输出 batch） | 中 | 提高 maxBuffer + 按输出体积分批 |
| 错误语义漂移（整体 throw → continue all） | 中 | driver 层逐命令检查 `success`，恢复"失败即抛" |
| batch 无法表达条件分支/轮询 | 低 | 仅合并"探测→决策"两段式；fallback 链与 waitFor 保持独立 spawn |
| agent-browser 升级后 JSON 结构漂移 | 低 | driver 层结构校验 + `console.warn` 兜底（契约破坏可见） |
| 强依赖序列在无 `--bail` 下继续执行 | 低 | 依赖序列显式 `--bail` 或检查 success 链 |

**验证方式**（落地后）：跑 `pnpm test:agent-browser` 单文件 + 全量，对比耗时与通过率；
driver 改造不改变任何断言语义，42/43 用例应全部照常通过。

## 7. 结论

1. **方向 D 可行，实测加速 6.8x~24x（视场景）**，全量可省约 0.5~1 min，与文档估计一致；
   实现成本最低（driver.ts 单文件、spec 零改动），与 A/B/C/E/F 完全独立，可随时增量落地。
2. **硬约束**：只用 stdin JSON 模式（参数模式有引号破坏 bug）；提高 maxBuffer 并按
   输出体积分批；driver 层逐命令恢复错误语义，禁止静默降级。
3. **收益定位**：D 是六方向中最小单项，建议在 A（登录去重）、B（条件等待）之后落地；
   但因其低风险低耦合，也可作为首个练手项验证 batch 输出契约。
4. **不建议跳过**：即使最终全量收益只有 1 min，driver 层"探测合并"的改造同时降低了
   spawn 次数与 daemon socket 握手次数，对 flake 率（重试放大）有间接正收益。
