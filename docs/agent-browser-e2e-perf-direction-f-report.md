# 提速方向 F（并行与重试调优）可行性实测报告

> 状态：实测完成。本报告回答 `docs/agent-browser-e2e-perf-analysis.md` 第 3 节「方向 F」的
> 可行性问题，并按 **高可维护性 / 高性能 / 高安全性 / 低内存占用** 四个维度给出结论。
> 配套一次性原型（throwaway，不进正式套件 include，标记为 PROTOTYPE）：
> - `packages/app/tests/unit/prototypes/direction-f/retry-semantics.test.ts`（重试语义实证）
> - `/tmp/ab-f-experiment.sh`（三次全量对比 + 采样）、`/tmp/ab-f-memprobe.sh`（内存探针）
> 实测日期：2026-08-14；**agent-browser 0.31.1**（本实验通过 `node_modules/.bin/vitest` 直接
> 运行，driver `spawnSync("agent-browser")` 按 PATH 解析到 `~/.bun/bin` 的全局 0.31.1；
> 项目本地依赖为 0.34.0，文档规范命令 `pnpm vitest run`（pnpm 前置 `node_modules/.bin`）
> 会解析到 0.34.0 —— 三次对比运行同版本，F1/F2 结论不受影响，但绝对耗时与 0.34.0
> 环境可能有小幅出入），Vitest 4.1.10；机器：macOS（Apple Silicon）10 核 / 25.7GB 内存；
> 代理 `127.0.0.1:10808`；dev server 5173（实验期间曾发生进程替换，见 3.1）。

## 0. 结论摘要（TL;DR）

1. **F1（降并行）在本机不可行，且文档前提有误**：Vitest 4.1.10 非 watch 模式默认
   worker 数 = `numCpus - 1` = **9**（文档称"5~6 个 Chrome 争抢"，实际 6 个文件全并行）。
   sub-flows 单一文件占墙钟 98%（628.7/639s），在任何 `maxWorkers ≥ 2` 下都独占一个
   fork；负载为 I/O 密集（网络/LLM/固定等待），CPU 争抢不是瓶颈。实测墙钟
   **默认 9 workers = 639s、3 workers = 708s、2 workers（复测）= 836s**，差异由
   **refresh_token 累积限流**（授权延迟 0.56s → 17.4s，见 3.1b）按运行顺序混杂主导，
   不构成降并行的提速证据；`--maxForks` 不是有效 CLI 选项（正确写法 `--maxWorkers`
   或 `poolOptions.forks.maxForks`）。
2. **F2（重试调优）可行，当前收益明确**：`retry: 2` 的重试放大实测
   **墙钟可见部分 ≈ 220s/run（约 -34%，639s → ~420s）**（sub-flows 重试放大
   ≈ 2 × 失败测试体 ≈ 220s；main-flow 另有 ~160s 但被 sub-flows 掩盖不进墙钟，
   跨文件合计 ~345~380s）。但 retry=0 会把 flake 变成失败（B4-B6、返回 Feed
   在探针中直接失败）。**正确落地形态**：全局 `retry: 0` + 已知 flake 用例
   单独 `it(name, { retry: 1 }, fn)`；`describe.retry` 在 Vitest 4.1.10 **不存在**
   （运行时抛错），文档建议的表述需修正。
3. **四维结论速览**：
   - 可维护性：F1 改动量极小（1~4 行配置）但无收益且硬编码并行度会过期；F2 需维护
     "已知 flake 清单"，机制已验证可用；
   - 高性能：F1 无提速证据（限流混杂下反显递增）；F2 当前墙钟 -220s（-34%）、
     跨文件合计 -345~380s，套件修复后降至 flake 保险价值（0~60s/run，仅 flake 触发时）；
   - 高安全性：F 本身不新增攻击面；**实验期间发现 token 明文泄漏进测试日志**
     （driver.ts:20 `console.log` 打印含 token 的 evaluate JS），刷新凭证可直接换取
     access_token（实测 200 OK / 0.56s）；
   - 低内存占用：单 agent-browser Chrome 实例实测 **1.38 GB**（6 实例 ~8.3GB、
     2 实例 ~2.8GB），降并行是 F1 唯一真实收益（省 3~5GB），但墙钟无补偿。

---

## 1. 方向 F 是什么（原文引用 + 操作化定义）

> 原文（分析文档第 3 节 F）："当前 5~6 个 Chrome 并行争抢 CPU，重型文件 sub-flows 决定
> 墙钟时间。实验 `--maxForks 2~3`（命令行或 poolOptions）对比墙钟时间，找 CPU 争抢 vs
> 并行收益的平衡点。`retry: 2` 是全局的（vitest.agent-browser.config.ts:65）：对稳定文件
> 降为 0、只对已知 flake（如 sub-flows 卡片点击）保留重试，避免一次抖动放大 3 倍。"

操作化定义（本报告验证范围）：

| 子项 | 内容 | 验证方式 |
|---|---|---|
| F1-1 | 确认当前默认并行度与进程拓扑（fork 数 / Chrome 实例数） | 配置静态分析 + Vitest 源码 + 运行期采样 |
| F1-2 | `--maxWorkers` 3 与 2 对比默认的全量墙钟与分文件耗时 | 全量运行 A/B/C'（同一机器/网络/token） |
| F2-1 | 量化 `retry: 2` 的放大代价 | retry=0 对照运行（sub-flows+main-flow） |
| F2-2 | 验证 per-test retry 机制可用性 | throwaway 探针（Vitest 4.1.10 实测） |

**不改变**：测试代码、driver/fixtures 结构、spec 断言（分别属方向 B/C/A/D/E 范畴）。

---

## 2. 静态分析

### 2.1 F1：当前并行度与进程拓扑（修正文档前提）

- `packages/app/vitest.agent-browser.config.ts` 第 58~69 行无 `pool` / `poolOptions` /
  `fileParallelism` / `maxWorkers` 配置，全部走 Vitest 默认。
- Vitest 4.1.10 源码（`dist/chunks/cli-api.*.js` `getDefaultThreadsCount`）：
  **非 watch 模式默认 worker 数 = `max(numCpus - 1, 1)`**。本机 10 核 → 默认 **9 forks**；
  5 个被 include 的 `.test.ts` 文件（`route-switch-instant.spec.ts` 为 `.spec.ts` 后缀
  从未执行，与文档附注一致）→ **5 个 fork 全并行，即 5 个 Chrome + 5 个 daemon**。
- CLI：Vitest 4 提供 `--maxWorkers`（`vitest --help` 实测），**没有 `--maxForks` 命令行
  选项**（仅存在于 `poolOptions.forks.maxForks` 配置内）；文档建议的"`--maxForks 2~3`
  （命令行或 poolOptions）"应改为 `--maxWorkers`。

### 2.2 F2：retry 现状与落地机制（含 Vitest 4 签名变更实证）

- `retry: 2` 全局配置于 vitest.agent-browser.config.ts:65；spec 内无任何 per-test
  `{ retry }` 覆盖。
- **落地机制实证**（探针 `tests/unit/prototypes/direction-f/retry-semantics.test.ts`，
  Vitest 4.1.10）：
  - `describe.retry(2)(...)` **不存在**（运行时抛 `describe.retry is not a function`）；
  - 三参签名 `it(name, fn, options)` 已在 Vitest 4 **移除**（抛 "Signature ... was
    deprecated in Vitest 3 and removed in Vitest 4"）；
  - 可用形式：**`it(name, { retry: n }, fn)`**（实测通过，失败重跑 n 次后第 n+1 次通过）；
  - **retry 只重跑测试体（it），不重跑 beforeAll/afterAll**：探针实测
    `suiteHookRuns=1, testBodyRuns=3` → 放大代价 = `2 × 测试体耗时`，
    与登录/导航（beforeAll，通常占用例时间大头）无关。
- CI 影响面：`.github/workflows/ci.yml` 的 `pnpm test:all` 含 `test:agent-browser`，
  但 CI 无 `PIXIV_REFRESH_TOKEN`，43 用例中 42 个被 `skipIf` 跳过且不 spawn 浏览器，
  → **retry 调优对 CI 无影响，纯本地事项**。

### 2.3 关联事实：套件相对当前 UI 已过期（影响 F 测量解释）

实验期间实测 E2E 套件未随 ADR-0075（C-shell 首页框架，8/8 提交）同步，以下用例在
**当前代码**下确定性失败（每次失败都触发 retry ×2 放大）：

| 位置 | 过期假设 | 当前代码事实 |
|---|---|---|
| sub-flows:195 / main-flow:195 | `querySelector("h1")` 点击用户名进 /me | /home 的 h1 是 Tab 标签（`SideNavShell.tsx:181`），点击无导航 |
| sub-flows:651/686/718 | `[class*="surface-appbar"] h1` 打开设置抽屉 | `surface-appbar` 类已不存在 |
| main-flow:133 | scope `nav[aria-label="主导航"]` | 主导航已改为 SideNavShell 侧边栏 |
| update-flow:90 | `clickButtonByText("设置")`（textContent 匹配） | 侧边栏「设置」为纯图标（仅 aria-label，textContent 为空） |
| sub-flows 导航栏标签 | 断言"底部导航栏（推荐/关注/收藏）" | 已改为侧边栏 |

**结论**：全量墙钟包含这些确定性失败 × retry 的放大；三次实验失败模式一致，F1 的
**横向对比（增量）仍然有效**，但绝对值不代表健康套件。

---

## 3. 实测数据

### 3.1 全量对比（同一机器 / 同一网络 / 同一 token / 同一 dev server 5173）

| 运行 | 配置 | 墙钟 | 分文件耗时（translation / update / adaptive / main / sub-flows） | 通过/失败/跳过 |
|---|---|---|---|---|
| **A（基线）** | 默认（9 workers），retry=2 | **639s** | 29.8 / 32.4 / 38.9 / 300.7 / 628.7（合计 1030.5s） | 33 / 7 / 4 |
| **B** | `--maxWorkers=3`，retry=2 | **708s** | 25.7 / 30.6 / 35.2 / 245.2 / 696.9（合计 1033.6s） | 36 / 8 / 0 |
| **C** | `--maxWorkers=2`，retry=2 | **2487s** ⚠️ | 25.5 / 29.4 / 34.5 / 268.0 / 2477.2（合计 2834.6s） | 29 / 10 / 5 |
| **C'** | `--maxWorkers=2`，retry=2（复测） | **836s** | 32.3 / 29.6 / 7.2 / 275.5 / 825.1（合计 1169.6s） | 35 / 9 / 0 |

要点：
- 基线墙钟 **639s（10.7 min）**，远低于文档估算的 20~35 min（文档基于 2026-02 套件
  状态；5aef5a7 套件修复 + 8/8 C-shell 重构已改变耗时结构）。
- **sub-flows 单一文件决定墙钟**（A: 628.7/639 = 98.4%；B: 98.4%；C': 98.7%），
  与文档判断一致。
- **Run C（2487s）判定为污染数据，已排除**：运行期间 daemon 连接反复失败（5×
  `Could not configure browser`）、8+ 次"页面文本为空/白屏"断言失败、2 次 hook 超时；
  且**原 dev server（PID 92255，运行 19h）在 Run B 启动前（09:06:45）死亡**，新 server
  （PID 12026）接管 5173。C'（复测，环境恢复后）836s，证明 2487s 是环境异常。

### 3.1b 顺序混杂因素：refresh_token 累积限流（F1 对比可信度边界）

连续三次全量运行共触发 ~63 次 `refresh_token` 授权。实测同一 token 的授权延迟：

| 时机 | 授权延迟 |
|---|---|
| 实验前（首测） | 0.56s |
| 实验后（连续 5 次） | 0.38s → 0.54s → 4.87s → **17.39s** → 7.79s |

**即"同一 token"对照本身存在累积限流混杂**：A→B→C' 的 sub-flows 耗时递增
（628.7 → 696.9 → 825.1s）与该限流时间线一致。sub-flows 在任何 `maxWorkers ≥ 2`
下独占一个 fork，其耗时增量只能来自跨 fork 争抢（实测 I/O 密集负载下极小）或外部
限流（实测存在）。**因此 F1 的可靠结论是：maxWorkers ∈ {2, 3, 9} 的墙钟差异
（639/708/836s）不构成降并行的提速证据**；若要严格证明，需在不同 token/不同日
交错重复运行，本报告受限流约束无法给出"差异显著"的判定。

### 3.2 retry 放大代价（F2 实测）

| 指标 | 数据 |
|---|---|
| 探针：`sub-flows + main-flow` 全量，retry=0 | 墙钟 **608s**；main-flow **141.0s**、sub-flows **597.5s** |
| 对照（Run A，retry=2，token 新鲜） | main-flow 300.7s（**-159.7s，-53%**）、sub-flows 628.7s |
| sub-flows 重试放大（失败测试体 ×2） | 109.9s × 2 ≈ **220s**（B4-B6 14.1 + 点卡片 17.5 + 个人中心 46.2 + 进入小说详情 14.9 + 导航栏 17.2） |
| main-flow 重试放大（失败测试体 ×2） | 62.5s × 2 = **125s**（C1-C2 26.5 + D1-D4 14.5 + F1-F4 21.5） |
| **跨文件合计 retry 放大（当前套件）** | **≈ 345~380s**；其中**墙钟可见部分 ≈ 220s（sub-flows 决定墙钟，其重试放大直接进墙钟；main-flow 的 125~160s 被 sub-flows 掩盖）** → 墙钟 639s → ~420s（**-34%**） |
| retry=0 的代价 | B4-B6、返回 Feed 两个 flake 在 retry=0 下直接失败（9 失败 vs A 的 7）；无效 refresh_token 在探针中首试通过（A 中 retry 后通过） |

> 说明：retry=0 探针运行时 token 已限流（登录更慢），因此 sub-flows 597.5s 是在
> **更差**登录条件下取得的，实际重试省时为 220s 以上；限流污染只会低估 F2 收益。

### 3.3 内存实测（低内存占用维度）

- **单实例成本（隔离探针，差值法）**：基线（用户 Chromium 应用）1.24 GB →
  launch 1 个 agent-browser Chrome + daemon 后 2.74 GB → **单实例 ≈ 1.38 GB RSS**
  （headless Chrome + daemon + renderer；本负载加载真实 Pixiv 图片流，非空页面）。
- **按并行度推算**：默认 6 实例 ≈ **8.3 GB**；`maxWorkers=3` ≈ 4.1 GB；
  `maxWorkers=2` ≈ 2.8 GB（不含用户自身应用 ~1.24 GB 与 dev server）。
- 采样器（10s 间隔，含用户应用的系统级）：Run A 峰值 7.88 GB / 44 进程（均值 3.65 GB）；
  Run C' 稳态 28 进程 / 2.4 GB —— 与单实例推算方向一致（窗口边界有噪声，仅作佐证）。

---

## 4. 四维结论

### 4.1 高可维护性

| 子项 | 结论（无模糊表述） |
|---|---|
| F1 配置改动量 | 极小：npm script 加 `--maxWorkers=N`（1 行）或 `poolOptions.forks.maxForks`（2~4 行） |
| F1 可维护性风险 | **硬编码并行度会过期**：2~3 是"本机当前"的经验值，换机器/改套件后需重新标定；且 F1 无收益（见 4.2），引入配置等于引入无价值的状态 |
| F2 机制可用性 | 已验证：`it(name, { retry: n }, fn)` 在 Vitest 4.1.10 可用；`describe.retry` 不存在（文档表述必须修正） |
| F2 维护负担 | 需要维护"已知 flake 清单"（哪些 it 加了 retry）；清单漂移风险：新 flake 未加 retry → 整次运行失败；已修好的用例留着 retry → 掩盖回归（retry 过后标记 flaky，难以察觉） |
| 与 B/C/D/E 独立性 | F 是 runner 层配置，与 spec 层（B/C）、driver 层（D）、mock 层（E）完全正交，可独立落地/回滚 |
| **套件过期问题（本实验最大维护性发现）** | 7 个用例因 ADR-0075（8/8）未同步而确定性失败，6 天无人发现（CI 无 token 全跳过、本地无门禁）。**任何方向提速的前提是先修套件**，否则 F2 的"重试省时"实际是给过期测试省时 |

### 4.2 高性能

| 子项 | 结论 |
|---|---|
| F1 墙钟收益 | **无**：639s（9w）/ 708s（3w）/ 836s（2w 复测），差异由 token 限流按顺序混杂主导；sub-flows 独占 fork，墙钟 ≈ sub-flows 耗时，maxWorkers ≥ 2 时并行度对墙钟几乎无杠杆 |
| F1 前提 | 文档"5~6 个 Chrome 争抢 CPU 决定墙钟"不成立：争抢仅存在于启动首分钟（轻文件 30~40s 即完成），且负载 I/O 密集、采样器显示 CPU 占用低；墙钟由 sub-flows 的**串行执行**决定 |
| F2 当前收益 | **墙钟 -34%（~220s，639s → ~420s）**：sub-flows 重试放大 ~220s 直接进墙钟；main-flow -53%（300.7 → 141.0s）但被 sub-flows 掩盖 |
| F2 套件修复后收益 | 降至 flake 保险价值：0~60s/run（仅当 flake 触发时 retry 有成本；不触发时 retry:2 与 retry:0 无差） |
| 单次运行不确定性 | 同一配置单次运行差异可达 ±10%（LLM 延迟、daemon 抖动、限流），A/B/C' 的墙钟差异全部落在该区间内 → **任何"并行度优化"收益 < 10% 都不可判定** |

### 4.3 高安全性

| 子项 | 结论 |
|---|---|
| F 本身攻击面 | 无新增：仅改 Vitest 配置/测试选项，不触碰浏览器进程权限、凭证流、网络面 |
| **关联发现 1（高严重度）**：token 明文泄漏进测试日志 | `driver.ts:20` `console.log` 打印每个 `agent-browser` 调用参数；`fixtures.ts:110` 与 `update-flow.test.ts:69` 把 `PIXIV_REFRESH_TOKEN` 内联进 evaluate JS → **每次登录都会把刷新凭证完整写入 stdout/日志文件**（实测 `/tmp/ab-update-full.log` 可见明文）。该凭证可直接换取 access_token（实测 200 OK / 0.56s）。`.env` 已 gitignore（无入库风险），但日志被分享（按文档惯例 `tee /tmp/ab-*.log`、贴 issue）即泄漏。**修复**：driver 的 `ab()` 对日志做脱敏（`token.replace(/[A-Za-z0-9_\-]{16,}/, "***")` 或匹配 `.env` 值），改动 1~3 行 |
| **关联发现 2（中严重度）**：dev server 生命周期缺陷 | `globalTeardown.ts` 只对 `pnpm dev` 包装进程 SIGTERM，Vite 子进程存活 → 每次运行泄漏一个 dev server（实测 5174~5178 累积 5 个）；端口复用判断在 IPv4/IPv6 绑定错位时会误判并可能误杀健康 server（原 92255 在 Run B 前异常死亡）。属资源管理缺陷，非凭证类风险 |
| retry 与安全交互 | retry=0 减少 token 相关执行次数（每个失败用例少 2 次登录/请求），边际降低限流触发，但不改变泄漏本身 |

### 4.4 低内存占用

| 子项 | 结论 |
|---|---|
| 单实例成本 | **1.38 GB / agent-browser Chrome 实例**（实测差值，含 daemon） |
| 并行度 × 内存 | 默认 6 实例 ≈ 8.3 GB；3 实例 ≈ 4.1 GB；2 实例 ≈ 2.8 GB；**降并行是 F1 唯一真实的收益：省 3~5 GB（-34%~-66%）** |
| 与本机关系 | 25.7 GB 内存下单独运行无压力；但与 Android Studio + 模拟器（项目含 android-e2e）等重型工具并存时，8.3 GB 可能成为实际约束 |
| 关联泄漏 | globalTeardown 泄漏的 dev server 每个额外占 ~60~200 MB RSS，会随运行次数累积（实测 5 个） |

---

## 5. 落地建议（按优先级）

1. **（前置，阻塞一切）修复套件过期**：按 2.3 的表更新 7 个失败用例的导航假设
   （h1→侧边栏按钮、`clickButtonByText`→`clickReliable`、底部导航→侧边栏断言、
   删除 `surface-appbar` 引用），并建立"UI 结构变更必须同步 E2E"的门禁
   （或在 CI 配 token 跑全量，让过期立即暴露）。**这是方向 F 乃至 B/C/D/E 的共同前置**。
2. **F2 落地（推荐）**：`vitest.agent-browser.config.ts:65` `retry: 2` → `retry: 0`；
   对已知 flake（`无效 refresh_token 显示错误提示`、`[B4-B6] 子 Tab 切换`、
   `返回 Feed`、卡片点击类）用 `it(name, { retry: 1 }, fn)` 单独兜底。
   当前收益墙钟 -220s（-34%）；套件修复后收益收缩（flake 保险价值）但保留防抖。
   **注意**：vitest 4 的
   正确写法是 `it(name, { retry }, fn)`（`describe.retry` 与三参签名均不可用）。
3. **F1 不落地**：本机默认（9 workers）即为合理点；如后续与重型工具并存时内存吃紧，
   可用 `--maxWorkers=4` 折中（省 ~2.8 GB，墙钟无显著变化），但**不应期望提速**。
4. **安全修复（建议同步做）**：driver.ts `ab()` 日志脱敏 token（1~3 行）；
   `globalTeardown` 改为杀进程组/按端口回收 Vite 子进程（防 dev server 泄漏）。

---

## 6. 关键文件索引

| 路径 | 作用 |
|---|---|
| `packages/app/vitest.agent-browser.config.ts` | `retry: 2`（:65）、include、setup/globalSetup |
| `packages/app/tests/agent-browser/driver.ts` | `ab()` spawnSync 封装（:19-33），`console.log` 泄漏 token 的源头 |
| `packages/app/tests/agent-browser/fixtures.ts` | `createLoggedInDriver`（:49-128），token 注入 evaluate（:110） |
| `packages/app/tests/agent-browser/specs/sub-flows.test.ts` | 31 it / 15+ skipIf describe，过期导航（:195/:651/:686/:718） |
| `packages/app/tests/ai-shared/globalSetup.ts` | dev server 启动/复用、.env 加载、端口误判风险 |
| `packages/app/tests/ai-shared/globalTeardown.ts` | 只 SIGTERM pnpm 包装进程 → Vite 子进程泄漏 |
| `packages/app/tests/unit/prototypes/direction-f/retry-semantics.test.ts` | 重试语义实证探针（throwaway） |
