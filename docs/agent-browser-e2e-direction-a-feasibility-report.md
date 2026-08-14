# agent-browser E2E 提速方向 A（消除重复登录）可行性验证报告

> 验证对象：`docs/agent-browser-e2e-perf-analysis.md` 第 3 节「方向 A —— 消除重复登录」
> 验证方式：可复现原型实验（脚本与原始记录见 `docs/prototypes/direction-a-feasibility/`）
> 验证日期：2026-08-14；agent-browser 实测版本 **0.31.1**（分析文档假设 ^0.34.0）
> 结论先行：**方向 A 可行，但三个子方案可行性不同** —— A-1 可行（有条件）、A-3 可行（收益有限）、A-2 只有 `--state` 变体可行且附带明文落盘安全代价，`--profile` 共享与 `--restore` 跨文件变体不可行（并行冲突/作用域隔离）。

---

## 1. 验证方法与边界（先声明，避免结论被误用）

| 项目 | 说明 |
|---|---|
| 实验环境 | macOS aarch64、Chrome for Testing 147、Vite dev server（`http://localhost:5173`，pictelio-app）、agent-browser 0.31.1 |
| 可实测的范围 | 登录态持久化机制（`--profile` / `--restore` / `--state`）、launch / snapshot / evaluate / SPA 导航的单次耗时、单会话内存占用、并发共用 profile 行为、应用对持久化 token 的启动恢复路径 |
| **不可实测的范围** | 真实登录链路（本次会话 `PIXIV_REFRESH_TOKEN` 未设置）：无法端到端验证「有效 token → 主界面」的完整时长，也无法测量重 Feed 页上 snapshot 的真实成本（无 token 进不了 Feed）。这两处均以代码路径分析 + 既有文档数据补充，并在文中显式标注「未实测」 |
| 复现方式 | `bash docs/prototypes/direction-a-feasibility/run-prototype.sh`（单命令，约 2~3 分钟，需完整文件系统权限） |

---

## 2. 各子方案可行性结论（含实测数据）

### 2.1 A-1 文件内共享会话 —— 可行（有条件）

**机制验证（实测）**：一次 `open`（含 daemon spawn + Chrome launch）实测 629ms~1019ms；SPA 导航（`navigateSpa` 等价：pushState + popstate）实测 66~177ms；`open` → 登录页就绪实测 **11225ms**。即：把「每个 describe 独立 launch」换成「一次 launch + 多次 SPA 导航」，单次 describe 免去的会话初始化成本实测 ≥ 11.2 秒（不含登录与 Feed 加载的网络等待）。

**收益量化**：`sub-flows.test.ts` 共 16 个 describe、17 次 `createLoggedInDriver()`（grep 实证，含 3 次 describe 内多次调用）。其中 14 个非登录 describe 的约 16 次登录可合并为 1 次；2 个登录流 describe 必须保留独立会话（见约束）。按每次登录 20~40s（分析文档第 2 节实测区间，含登录与 Feed 等待）：
- 保守：16 × 20s ≈ **5.3 min/次全量**
- 乐观：16 × 40s ≈ **10.7 min/次全量**
与分析文档「A 项可省 8~12 min」一致（差异来自网络与 Feed 等待的浮动）。

**约束（结构性事实，不是推测）**：
1. `sub-flows.test.ts:286` 的「无效 token」describe 会执行 localStorage 清理（删除 `/^capacitor-storage_/`、`/^_cap_/`、`refresh_token` 键，见 308-323 行），**必须保留独立会话**，否则共享会话的登录态被清空，后续 describe 全部失效。
2. 「有效 token」describe（223 行）从空白状态测试完整登录流程，也须保留独立会话（与 A-2 的免登录状态冲突）。
3. **状态污染为真实风险**（逐 describe 审计结果）：
   - 持久化污染源：主题切换（`sub-flows.test.ts:684`）、布局模式切换（716 行）会写入 Preferences（Web 模式 = localStorage，键前缀 `CapacitorStorage.`，实测确认），污染后续 describe 的默认视图；
   - 自恢复型（不污染）：图床 toggle 取消确认（445 行）、toggle 确认自动复原（485 行）；
   - 内存态污染：阅读链路切换内容类型（144 行，`setContentType` 内存态，SPA 导航后保留）；
   - 网络副作用：收藏/取消收藏（91 行）改变账号真实收藏状态（用例自复原，但依赖网络时序）。
   结论：需要新增「回到已知状态」helper（如 navigateSpa 回 `/home` + 等待 + 必要时 UI 复位）并逐 describe 审计，**复杂度高于分析文档所述「最轻的嵌套改造」**，但无技术障碍。

**涉及文件**：`specs/sub-flows.test.ts`（单文件改动）+ 可选在 `fixtures.ts` 增加共享会话工厂。不触碰 `driver.ts` 公共层。

### 2.2 A-2 持久登录态复用 —— 仅 `--state` 变体可行

对三种机制逐一实测（agent-browser 0.31.1 均原生支持，无需升级）：

| 机制 | 跨 daemon 恢复 | 并行兼容 | 实测证据 | 判定 |
|---|---|---|---|---|
| `--profile <dir>`（A-2a） | ✅ 恢复成功（token 与年龄标志均保留） | ❌ **不兼容**：两个 daemon 并发打开同一 profile 目录，第二个 Chrome 因 `SingletonLock: File exists` 退出（exit 1，Chrome 主动中止防 profile 损坏） | 实验 1/4 | **不可行**（除非 `--maxForks 1` 串行化，见 3.2） |
| `--restore <key>`（A-2b） | 同 namespace ✅；**不同 namespace ❌（返回 null）** | ❌ 状态文件按 namespace 隔离（`~/.agent-browser/namespaces/<ns>/state/sessions/<key>.json`），而 `setup.ts:14` 每文件随机 namespace | 实验 2 | **不可行**（跨文件/跨 run 复用需固定 namespace = 串行化） |
| `--state <json>`（A-2c） | ✅ `state save <path>` 导出后，全新 daemon 以 `--state <path>` 打开即恢复（实测 `STATE_TOKEN_4` 读回） | ✅ 每文件独立 daemon/独立 profile，仅从同一 JSON 播种，无目录锁冲突 | 实验 3 | **可行**（附带安全代价） |

**应用侧衔接（代码路径实证）**：
- Web 模式 refresh_token 落点 = localStorage 键 `capacitor-storage_refresh_token`（`@aparajita/capacitor-secure-storage` Web 回退实现，`web.js:16` 实证 `localStorage.setItem(options.prefixedKey, ...)`）；
- 年龄确认/设置落点 = `CapacitorStorage.age_confirmed` / `is_adult`（Preferences group 前缀，restore 状态文件内容实证）；
- 注入假 token + 正确年龄键后 reload：应用执行了 token 恢复 → API 401 → 清除 token → 跳 `/login`（实测）。证明**恢复链路真实执行**；有效 token 时走 `fixtures.ts:93-98` 已实现的「检测到已登录（token 自动恢复）→ 跳过登录」分支。**有效 token 的真实免登录路径未实测**（本会话无 token），此为验证边界。

**收益量化**：run 1 无收益（仍需登录）；run 2+ 17 次 `createLoggedInDriver` 登录归零（「有效 token」「无效 token」两个登录流用例按原流程独立执行，不计入），全量省 17 × 20~40s ≈ **5.7~11.3 min/次**。与 A-1 组合后 run 1 也可降到每文件 1 次登录。

**约束**：
1. **明文落盘（安全代价）**：`--state` JSON（实测 453 bytes）、`--restore` 状态文件、`--profile` 目录 Local Storage（32MB）内均以明文包含 refresh_token（grep 实证各 1 处）。当前基线是临时 profile（用完即删），token 不落盘；A-2 任何变体都会引入**持久明文 token**。
2. 状态文件生命周期：需在 run 结束时重新 `state save`（401 静默刷新会轮换 refresh_token 并写回 localStorage，实测键存在）；「无效 token」describe 会清 token，若由它所在文件导出状态会污染下一次 run（须排除或改用固定文件导出）。
3. 与登录流用例的冲突：「有效 token」describe 从空白状态断言年龄确认弹窗（`sub-flows.test.ts:242-283`），加载 `--state` 后应用直接进主界面、该断言必失败 —— 该用例的 driver 必须跳过 `--state`（或启动时先清 storage）；「无效 token」describe 同理。
4. 校验兜底：token 被外部撤销/轮换时应用会清 token 回 `/login`，现有 fixture 已能兜底（自动检测登录页 → 重新登录），无需新增逻辑。

### 2.3 A-3 轮询瘦身 —— 可行（收益有限，且随 A-1/A-2 落地递减）

**实测数据**：登录页上 `snapshot -i` 单次 35~58ms，`evaluate` DOM 探测单次 34~40ms —— **两者无实质差异**。分析文档「snapshot 换 evaluate」的收益在登录页实测为 0；在重 Feed 页 snapshot 成本 1~2s 的说法**未实测**（无 token 进不了 Feed，验证边界）。

**收益量化**：真正的收益来自轮询间隔 2s → 500ms。fixture 登录流程每阶段 1~4 轮（`MAX_ATTEMPTS=15`，`fixtures.ts:17`），每轮最多省 1.5s → 每登录省 3~6s → 21 次登录合计约 **1~2 min/次全量**（估算；若网络等待占主导则收益进一步缩小）。**与 A-1/A-2 存在收益重叠**：登录次数减少后，轮询瘦身的总收益同步缩小。

**约束**：`snapshotHas`（`fixtures.ts:22-29`）改 evaluate 需保留"页面未就绪时 snapshot 抛错 → 返回 false 继续轮询"的容错语义；轮询间隔改短后若页面渲染慢于 500ms，需保证超时上限不变（`MAX_ATTEMPTS × 间隔` 的总等待上限会从 30s 降到 7.5s，需同步调大 ATTEMPTS 或调低期望）。

---

## 3. 四维度分析（可维护性 / 性能 / 安全性 / 内存）

### 3.1 高可维护性

| 子方案 | 结论 | 依据（不可模糊） |
|---|---|---|
| A-1 | **中风险，可维护** | 改动集中在 `sub-flows.test.ts` 单文件；`driver.ts`/`fixtures.ts` 公共层不变（仅可选新增共享会话工厂）。代价：需新增「回到已知状态」helper + 16 个 describe 的起始状态审计（第 2.1 节污染清单），后续新增用例必须遵守"共享会话不改持久化设置或自复原"的约定 —— 这是一条新的**团队约定**，违反会引入难排查的用例间耦合。 |
| A-2（--state） | **高风险，谨慎维护** | 引入"状态文件生命周期"：生成（run 结束导出）、校验（token 失效回退）、清理（gitignore/chmod）、并发写冲突（多文件并行导出同一文件）四类新状态；任何一环出错会导致"静默免登录失败 → 用例在登录页卡死"或"污染下一次 run"。收益跨 run 才显现，调试成本前置。`--profile`/`--restore` 变体因并行冲突直接不可行，无需评估维护性。 |
| A-3 | **低风险，可维护** | 改 `fixtures.ts` 的 3 个常量/1 个函数 + 轮询间隔，公共层单点，语义不变（仍是"阶段化等待"设计，`fixtures.ts:6-10` 注释明确该设计是 Issue #19 T1 的修复成果，改动需保持其"循环检测而非盲 SLEEP"语义）。 |

### 3.2 高性能（本维度收益需按"每次全量 run"量化）

| 子方案 | 单次全量收益（实测/推算） | 生效时机 | 并行性影响 |
|---|---|---|---|
| A-1 | −5.3~10.7 min（约 16 次登录 → 1 次） | 首次改造即生效 | 无影响（文件内 describe 本就串行） |
| A-2（--state） | −5.7~11.3 min（run 2+ 的 17 次登录归零） | 第二次 run 起 | 无影响（并行兼容） |
| A-3 | −1~2 min（21 次登录的轮询间隔） | 首次改造即生效 | 无影响 |
| A-1+A-2+A-3 叠加 | run 1：约 −6~11 min（A-1+A-3）；run 2+：约 −5~10 min（A-2 再省共享登录，仅剩 2 个登录流用例必须真实登录） | 见各子方案 | 无影响 |

**反面数据（不可模糊）**：`--profile` 共享若改用 `--maxForks 1` 串行化换取免登录，代价是 6 个文件失去并行 —— 网络等待占主导时墙钟反而恶化（分析文档第 4 节 F 项已指出"网络是瓶颈时并行有利"），且本机实测 6 文件并行峰值内存约 3~5 GB（见 3.4），串行化只换内存不换时间，**不推荐**。

### 3.3 高安全性（本维度是 A-2 的决定性否决项）

| 子方案 | token 暴露面变化 | 结论 |
|---|---|---|
| A-1 | 无变化：仍为临时 profile，token 仅存在于环境变量与浏览器内存/临时 localStorage，会话结束即销毁 | 安全 |
| A-3 | 无变化 | 安全 |
| A-2（--profile / --restore / --state 任一） | **从"不落盘"变为"持久明文落盘"**：实测 profile 目录 Local Storage、`--restore` 状态文件、`--state` JSON 均明文包含 refresh_token；profile 目录实测 32MB 会常驻磁盘 | **安全回归**。refresh_token 具备账号级访问能力，明文落盘意味着任何能读取该路径的用户/进程/备份即可窃取登录态 |
| A-2 缓解措施（若启用） | ① 状态文件路径加入 `.gitignore` 且 `chmod 600`；② 使用仅限测试的专用 Pixiv 账号 token；③ run 结束删除状态文件（但删除后下次 run 失效，与收益矛盾）；④ 接受"测试机本地明文"作为已知风险 | 缓解后为"有条件安全" |

**结论**：A-2 的采用必须由项目所有者显式接受"测试机本地明文 token"风险；在 CI（共享 Runner）环境中**不可接受**。

### 3.4 低内存占用

| 事实 | 数据（实测） |
|---|---|
| 单 agent-browser 会话（daemon + Chrome 进程树）RSS | 498MB（4 进程，登录页）~ 765MB（7 进程，加载后） |
| 当前 6 文件并行峰值 | 6 × 0.5~0.8GB ≈ **3~5 GB** |
| A-1 对峰值影响 | **无**：文件内 describe 本就串行（前一 describe 的 driver 在 afterAll close 后才启动下一个），共享会话只是减少 launch 次数，同时存活浏览器数不变 |
| A-2（--state）对峰值影响 | **无**：每文件仍一个 daemon/浏览器，只是播种来源变为 JSON |
| A-2（--profile 串行化）对峰值影响 | 峰值降至 ~1 个浏览器（≈0.5~0.8GB），但以牺牲并行墙钟为代价（见 3.2），且需 `--maxForks 1` |
| A-3 对内存影响 | 无 |

**结论**：方向 A 的所有可行变体**均不降低内存峰值**；内存峰值由 Vitest 文件并行度决定（属方向 F 的优化范围，非本方向）。

---

## 4. 综合判定与建议实施路径

| 子方案 | 可行性 | 可维护性 | 性能收益 | 安全性 | 内存 | 建议 |
|---|---|---|---|---|---|---|
| A-1 共享会话 | 可行（有条件） | 中 | −5.3~10.7 min | 无影响 | 无影响 | **推荐，优先实施**（需先完成 describe 状态审计 + 保留 2 个登录流独立会话） |
| A-2 --state | 可行（有条件） | 低（状态生命周期复杂） | −5.7~11.3 min（run 2+） | **明文 token 落盘** | 无影响 | **有条件实施**：仅限本地开发机 + 专用测试账号 + gitignore/chmod 600；CI 禁用 |
| A-2 --profile / --restore | **不可行** | — | — | — | — | 放弃（SingletonLock 并行冲突 / namespace 作用域隔离） |
| A-3 轮询瘦身 | 可行 | 低 | −1~2 min（与 A-1/A-2 重叠递减） | 无影响 | 无影响 | 推荐作为 A-1 的伴随改动；收益低于文档预期（登录页 snapshot/evaluate 实测无差异） |

**推荐落地顺序**（与文档第 5 节会话 3 对齐，但修正其"最轻"判断）：
1. **先做 A-1**：产出物为 16 个 describe 的状态污染审计表 + 共享会话改造 + 「回到已知状态」helper；改造后全量回归 42~43 用例（含无效 token 用例），记录耗时对比。
2. **伴随做 A-3**：轮询间隔 2s→500ms、`snapshotHas`→evaluate（保留容错语义），单文件先验证。
3. **A-2 仅当**项目所有者接受本地明文 token 风险后，以 `--state` 变体实施（run 结束导出、启动导入、gitignore、专用账号），并在 CI 配置中关闭。

**本报告与既有文档的差异点（修正/补充）**：
- 分析文档假设 agent-browser ^0.34.0 才有 `--profile`；实测 **0.31.1 已支持** `--profile`/`--restore`/`--state`/`batch`，机制验证无需升级。
- 分析文档未提及的**否决性事实**：共享 `--profile` 目录的 Chrome SingletonLock 冲突（并行场景直接不可行）；`--restore` 状态按 namespace 隔离（跨文件无效）。
- 分析文档未提及的**安全事实**：三种持久化机制均明文落盘 refresh_token。
- 分析文档"A-3 snapshot 换 evaluate"的收益在登录页**实测为 0**，真实收益在轮询间隔，且随 A-1/A-2 递减。

## 5. 验证边界清单（哪些结论仍未实测）

1. 有效 token 的完整免登录路径（A-2 的应用侧最终验证）：需在 `PIXIV_REFRESH_TOKEN` 环境下跑一次「导出状态 → 清空 → --state 导入 → 断言直接进入主界面」。
2. 重 Feed 页 snapshot 单次成本（1~2s 说法）：需登录态下测量。
3. A-1 改造后 42~43 用例全量通过率：需实施后回归。
4. `--state` 多文件并行同时导出的写冲突行为：未构造该场景（当前设计下每文件独立 daemon，仅 run 结束统一导出一次，冲突概率低但未实测）。

---

## 附录：原型实验产物

- 实验脚本：`docs/prototypes/direction-a-feasibility/run-prototype.sh`（单命令复现全部实验）
- 原始记录：`docs/prototypes/direction-a-feasibility/results.md`（2026-08-14 实测）
- 相关源码位置：`packages/app/tests/agent-browser/{driver,fixtures,setup}.ts`、`packages/app/tests/agent-browser/specs/sub-flows.test.ts`、`packages/app/vitest.agent-browser.config.ts`、`packages/app/src/utils/secureStorage.ts`
