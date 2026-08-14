# agent-browser E2E 全量运行耗时分析与提速实验清单

> 状态：分析完成，未改任何代码。本文档用于在独立会话中逐项实验提速方案。
> 分析日期：2026-02（agent-browser ^0.34.0，Vitest 4.1，specs 位于 `packages/app/tests/agent-browser/specs/`）

## 0. 先测基线（每个实验前必做）

```bash
cd packages/app
# 全量（需 PIXIV_REFRESH_TOKEN 已设置）
time pnpm test:agent-browser 2>&1 | tee /tmp/ab-baseline.log
# 单文件（针对性实验时用）
time pnpm vitest run -c vitest.agent-browser.config.ts tests/agent-browser/specs/sub-flows.test.ts
```

记录：总墙钟时间、每文件耗时、失败/重试次数。**所有实验以"同一机器、同一网络、同一 token"为对照**，避免 GFW/代理波动污染结论。

---

## 1. 执行模型：为什么天然慢（背景）

- **每操作一个新进程**：`tests/agent-browser/driver.ts:19-33` 的 `ab()` 是 `spawnSync("agent-browser", ...)`，每次点击/快照/求值都重新 spawn Rust CLI 进程再经 socket 连 daemon。全套 spec 级 driver 操作约 143 次，展开内部 fallback 链后估计 **500~1000+ 次进程 spawn**。
- **每文件独立浏览器**：`tests/agent-browser/setup.ts` 为每个测试文件生成唯一 namespace → 唯一 daemon → 唯一 Chrome。6 个文件在 Vitest 默认 forks 池下**并行**（`vitest.agent-browser.config.ts` 未配置 `pool`/`fileParallelism`），即 5~6 个 Chrome + 5~6 个 daemon 同时争抢 CPU/内存。
- **每 describe 重新登录**：`sub-flows.test.ts` 有 16 个 describe、17 处 `createLoggedInDriver()`（fixtures.ts:49-128），每个都完整走 launch → 年龄确认轮询 → 登录页轮询 → 填 token → 登录 → 等主界面（固定 2s sleep、轮询上限 15 轮 × 2s、最多 3 次 launch 重试）。
- **AI 断言是串行 LLM 调用**：64 次 `aiAssert`（sub-flows 50 + main-flow 14），每次 = `waitForPageContent` + `snapshot` + `pageText`（2~3 次 spawn）+ 1 次 DeepSeek 调用（默认重试 2 次、间隔 2s、30s 超时，见 `tests/ai-shared/assertion.ts:135-141`）。

---

## 2. 耗时画像（量化统计）

| 成本项 | 量化 | 估算耗时 |
|---|---|---|
| 完整登录会话 | ~21 次（sub-flows 17 + main-flow 2 + translation 2），每次 happy path 20~40s | **8~12 min** |
| 固定 SLEEP | sub-flows 238s + main-flow 45s + adaptive 51s + translation 18s + update 19s ≈ **370s** | **~6 min**（纯等待） |
| AI 断言 | 64 次 × (snapshot 0.5~2s + LLM 1~3s)，文件内串行 | **3~5 min** |
| 真实网络 + 图片 | feed/详情页加载几十张真实 Pixiv 图（GFW 环境走代理更慢） | **2~5 min** |
| spawn 进程开销 | 500~1000 次 × 30~150ms | **1~2 min** |
| 重试放大 | vitest `retry: 2` + aiAssert 重试 + login 3 次重试，任何 flake 即 ×2~3 | 浮动 |

**典型合计 20~35 分钟**。瓶颈排序：**登录 > 固定等待 > AI 断言 > 网络图片**。

### 各 spec 量化快照（供对照）

| 文件 | describe 数 | 登录次数 | 固定等待 | aiAssert | driver 操作 |
|---|---|---|---|---|---|
| sub-flows.test.ts | 16 | 17 | 238s | 50 | 82 |
| main-flow.test.ts | 1 | 2 | 45s | 14 | 21 |
| adaptive-tags-240.test.ts | 1 | 0（内联登录） | 51s | 0 | 15 |
| translation-flow.test.ts | 1 | 2 | 18s | 0 | 10 |
| update-flow.test.ts | 1 | 0（内联登录） | 19s | 0 | 15 |

> 附注：`route-switch-instant.spec.ts` 是 `.spec.ts` 后缀，**不在** include `tests/agent-browser/specs/**/*.test.ts` 匹配内，实际从未执行（覆盖缺口，不影响耗时）。

---

## 3. 提速方向清单（每项可独立实验）

### A. 消除重复登录（最大单项，可省 8~12 min）

**现状**：sub-flows 16 个 describe 各自 `createLoggedInDriver()`，共 17 次完整登录。

**改法（由轻到重，可叠加）**：
1. **文件内共享会话**：把 sub-flows 的 16 个 describe 嵌套进一个父 describe，父级 `beforeAll` 只登录一次，子 describe 通过 `driver.navigateSpa()` 跳转页面。需逐个确认 describe 间无状态污染（localStorage 清理类用例——无效 token 登录用例必须保留独立会话，见 sub-flows.test.ts:286 附近）。
2. **持久 profile 复用登录态**：agent-browser 0.34 支持 `--profile <path>` / `AGENT_BROWSER_PROFILE`（README：「Full browser state (cookies, IndexedDB, service workers, cache) across restarts」）。登录一次写入持久 profile，后续 run 免登录。可在 `setup.ts` / `driver.ts` 的 `launch()` 处加 profile 参数。
3. **轮询瘦身**：fixtures 里 2s 固定间隔 + `snapshot` 轮询（snapshot 对重 feed 页成本 1~2s），改为 500ms 间隔 + `evaluate` DOM 探测（`isOnLoginPage` 已是该模式，`snapshotHas` 还在用 snapshot）。

**涉及文件**：`tests/agent-browser/fixtures.ts`、`tests/agent-browser/setup.ts`、`tests/agent-browser/specs/sub-flows.test.ts`、`tests/agent-browser/driver.ts`

**风险**：会话隔离变弱。验证：改造后跑全量，确认 42~43 个用例全部照常通过（含无效 token 用例）。

### B. 固定 SLEEP → 条件等待（~6 min）

**现状**：已有轮询式 `waitForPageContent` / `waitForSelector`（1s 间隔，driver.ts:87-116），但大量代码仍用裸 `SLEEP(2000~8000)`（adaptive 里甚至有 6s/7s/8s）。

**改法**：
1. 把"等数据/等组件"的 `SLEEP` 替换为 `waitForSelector` / `waitForPageContent`（可带超时上限兜底），坏路径从固定上限变为数据就绪即返回。
2. `waitFor*` 内部轮询间隔 1s 改为可配置（300~500ms）。

**涉及文件**：`tests/agent-browser/driver.ts`、全部 6 个 spec

**风险**：低。验证：逐文件替换后跑单文件，对比耗时 + 用例通过率；注意空状态分支（如"关注 Tab 空状态"）的等待条件要覆盖。

### C. 削减 AI 断言（3~5 min）

**现状**：64 次 `aiAssert`（sub-flows 50 + main-flow 14），每次一次 LLM 调用。translation/update/adaptive 三个 spec 已证明 **0 次 aiAssert 可行**（全部用 `evaluate` + `expect` 断言 DOM）。

**改法（由轻到重）**：
1. **确定性断言替换**：sub-flows 里大量"页面正常显示、无错误提示"类断言本质是 DOM 状态检查（`waitForSelector` + `getAttribute` + innerText），只有"瀑布流布局合理""正文渲染正确"这类语义判断才保留 LLM。保守估计可砍 50~70% 的 LLM 调用。
2. **状态复用**：`getState`（sub-flows.test.ts:15-21）每次断言前重取 snapshot + pageText，连续断言间页面未变时可复用同一份状态（减少 snapshot spawn）。
3. **合并批量断言**：同一 describe 内相邻 aiAssert 合并为一次 LLM 查询（多问题单次返回），代价是失败定位粒度变粗。

**涉及文件**：`tests/agent-browser/specs/sub-flows.test.ts`、`tests/agent-browser/specs/main-flow.test.ts`、`tests/ai-shared/assertion.ts`（可选）

**风险**：断言强度下降，需在真正的语义验证点保留 LLM。验证：逐用例替换，确认原用例目的仍被覆盖（用例名即验收点）。

### D. 进程 spawn 开销（1~2 min）

**现状**：每次 `ab()` 一次 spawnSync。

**改法**：agent-browser 0.34 提供 **`batch` 命令**（README：「Execute multiple commands in a single invocation… avoids per-command process startup overhead」，支持参数或 stdin JSON 管道）和 `eval --stdin`。driver 可将"snapshot + click + pageText"等连续操作合并为一次进程调用；`clickReliable` 的 fallback 链（最多 7 次 spawn）可先 evaluate 探测再决定路径。

**涉及文件**：`tests/agent-browser/driver.ts`（单文件改动全局生效）

**风险**：低，但需先验证 `agent-browser batch` 的 JSON 输入格式与错误处理（spawnSync 的错误传播逻辑要保留）。

### E. 图片/网络降载（2~5 min，视网络）

**改法**：
1. 对**不依赖图片像素的 UI 结构断言**，用 `mockFetch` 把 `/pixiv-img/` 拦截为固定尺寸占位图（translation-flow 已证明 mock 链路可行），避免每次导航下载几十张真实图片。**注意**：瀑布流布局由图片尺寸驱动（`createImageSizeWorker`），mock 需返回固定尺寸占位图或仅对非布局关键路径启用，否则引入假阳性。
2. 或改用 `--profile` 持久缓存（同 A-2），第二次运行起图片命中磁盘缓存。

**涉及文件**：spec 层 mock（`driver.mockFetch`）+ `driver.ts`

**风险**：布局 mock 需谨慎，建议先做小范围验证（如仅对 main-flow 的一个 it 启用）。

### F. 并行与重试调优（视 flake 情况）

**改法**：
1. 当前 5~6 个 Chrome 并行争抢 CPU，重型文件 sub-flows 决定墙钟时间。实验 `--maxForks 2~3`（命令行或 `poolOptions`）对比墙钟时间，找 CPU 争抢 vs 并行收益的平衡点。
2. `retry: 2` 是全局的（vitest.agent-browser.config.ts:65）：对稳定文件降为 0、只对已知 flake（如 sub-flows 卡片点击）保留重试，避免一次抖动放大 3 倍。

**涉及文件**：`vitest.agent-browser.config.ts`、spec 文件（`describe.retry`）

**风险**：需要实测，且降并发可能因网络等待而更慢（网络是瓶颈时并行有利）。

---

## 4. 预期效果汇总

| 方向 | 保守收益 | 风险 | 独立性 |
|---|---|---|---|
| A 登录去重 | -8~12 min | 中（会话隔离） | 独立 |
| B SLEEP → 条件等待 | -3~5 min | 低 | 独立 |
| C AI 断言降级 | -2~3 min | 中（断言强度） | 独立 |
| D batch/进程复用 | -0.5~1.5 min | 低 | 独立 |
| E 图片 mock/缓存 | -1~3 min | 中（布局 mock） | 独立 |
| F 并行/重试调优 | -1~3 min | 需实测 | 独立 |

**组合后全量有望从 20~35 min 降到 8~12 min（约 2~3 倍提速）**，A+B+C 三项占 80% 收益，互不冲突、可增量落地。

## 5. 建议实验顺序（每个会话做一项）

1. **会话 1 — 测基线 + F 并行调优**（零代码风险，先量化争抢影响）
2. **会话 2 — B SLEEP → 条件等待**（低风险，收益直接）
3. **会话 3 — A-1 文件内共享登录**（最大单项，先做最轻的嵌套改造）
4. **会话 4 — C AI 断言降级**（先替换明显是 DOM 检查的用例）
5. **会话 5 — A-2 持久 profile**（跨 run 免登录，需验证登录态注入）
6. **会话 6 — D batch 合并 + E 图片降载**（driver 层与 mock 层）

每项完成后：跑对应单文件 + 全量，记录耗时与通过率，更新本文档的耗时画像（第 2 节表格）。

## 6. 关键文件索引

| 路径 | 作用 |
|---|---|
| `packages/app/tests/agent-browser/driver.ts` | CLI 封装（spawnSync）、clickReliable/clickFirst、waitFor* |
| `packages/app/tests/agent-browser/fixtures.ts` | `createLoggedInDriver` 4 阶段登录 |
| `packages/app/tests/agent-browser/setup.ts` | 每文件 namespace/daemon 隔离与清理 |
| `packages/app/tests/agent-browser/specs/sub-flows.test.ts` | 16 describe、50 aiAssert、17 登录 |
| `packages/app/tests/ai-shared/assertion.ts` | `aiAssert` LLM 断言（重试/超时参数） |
| `packages/app/tests/ai-shared/globalSetup.ts` | Vite dev server（5173）启动/复用、daemon socket 清理 |
| `packages/app/vitest.agent-browser.config.ts` | include/retry/timeout 配置 |
