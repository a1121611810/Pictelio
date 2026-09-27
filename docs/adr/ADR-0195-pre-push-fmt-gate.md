# ADR-0195：pre-push 增加 fmt 门禁（范围=被推文件）

- 状态：Accepted（已采纳）
- 日期：2026-09-27
- 关联：
  - [ADR-0142](./ADR-0142-pre-push-fetch-fallback-and-release-preflight.md)（pre-push 编排器 / fail 语义分层——本 ADR 在其编排器上追加第 3 步门禁）
  - [ADR-0185](./ADR-0185-vite-plus-1rc-toolchain.md)（lint/fmt 唯一配置源=根 `vite.config.ts`）
  - 事故证据：CI run 36026257725（2026-09-24 `chore(proxy)`）、CI run 36279932016（2026-09-26 `Merge branch 'feat/lynx-four-features'`）

## 背景

两次 main 上的 CI 红同因：**oxfmt 格式漂移通过了本地 pre-push，被 CI 的 check job 拦下**。

- run 36026257725（`chore(proxy)`）、run 36279932016（four-features batch 合并）：`pnpm check:all` 的 `vp fmt --check` 报 `Format issues found in above 1 files`，随后的补丁提交才转绿（后者连带一次真实桥契约缺陷，总计 red 窗口约 20 分钟）。
- 本地 pre-push（ADR-0142 编排器）只覆盖三域：`packages/app/(src|tests/agent-browser)` → E2E 锚点、`packages/app-lynx/(src|tests)` → 单测、`.agents/` → skill 校验。**格式门禁完全缺席本地**。
- 更隐蔽的一点：事故文件 `packages/app/tests/unit/native/novelExportBridgeContract.test.ts` **不在任何域 pattern 内**——即使域校验全部通过，格式漂移也不会被本地任何检查看见。漂移面与目录无关，任何被推文件都可能带进来。

## 决策

### D1：fmt 门禁纳入编排器，路径无关

作为第 3 步（分叉拦截之后、三域校验之前）无条件执行（只要存在被推文件），**不并入按目录分流的 `DOMAINS`**——格式漂移与目录无关（见背景中点名的 `app/tests/unit` 反例）。

置于域校验之前：单进程成本最低、命中率最高，失败即短路返回（与既有「首域失败即返回」一致）。

### D2：检查范围为「被推文件」，不是全仓

对本次 push 涉及的 ref 取 diff 名集合并集（跨 ref 去重），过滤掉工作区已不存在的路径（删除项）后作为 oxfmt 目标。

理由：CI 的 `vp fmt --check` 是全仓命令，但本地全仓检查会把**未提交的 WIP**（后台 agent 的半成品、甚至语法未完成的文件）算进来，误伤与之无关的 push。被推文件集恰是「本次 push 可能让 CI 变红」的最小充分面。

### D3：退出码契约显式分层（含 skip 语义）

`vp fmt --check <paths>` 实测（vp 1.0.0-rc.0，2026-09-27）：

| 情形 | 输出 | 裁决 |
| ---- | ---- | ---- |
| 全部已格式化 | exit 0 | pass |
| 有格式问题（stdout 列文件） | exit 1 | **fail（拦截）** |
| 传入路径全被 `fmt.ignorePatterns` 排除（`.md`/`docs`/`app-lynx`/`website`/`android` 等） | exit 2 + stderr `Expected at least one target file. …` | skip（放行，log 一行说明） |
| exit 2 但无该 marker（工具链/调用错误） | — | fail（**不静默放行**，遵守「禁止静默降级」） |
| spawn 失败（ENOENT 等） | — | fail（err.code 归一为非零） |

skip 分支必须存在：只推文档的 push 若被 exit 2 拦下，就是纯粹的假阳性。该契约由单测的真实调用用例钉住（`defaultRunFmtCheck` + `classifyFmtResult` 对真实输出断言），避免桩与工具行为脱节。

### D4：失败信息可操作

原样透出 oxfmt 的失败清单（stdout + stderr 合并，截尾 20 行防刷屏）+ 修复命令 `pnpm fmt` + 逃生口 `git push --no-verify`（与三域门禁的指引一致）。

## 被否备选

| 备选 | 否决理由 |
| ---- | -------- |
| 全仓 `pnpm fmt:check`（CI 同款命令，实现最简） | 把工作区未提交的 WIP 算进来：后台 agent 半成品/未解析文件会误伤无关 push，门禁可信度被假阳性侵蚀 |
| 按 `fmt.ignorePatterns` 预过滤目标（避免 exit 2） | 复制一份 ignore 清单 = 双源漂移，违反 ADR-0185「唯一配置源」；改由 oxfmt 自己判覆盖面 |
| 把 fmt 挂进按目录的 `DOMAINS` | 漂移面与目录无关（事故文件不在任何域 pattern 内），挂域 = 结构性漏检 |
| fail 降级为 warn（不拦截） | CI 仍会红，等于没修；ADR-0142 已确立本编排器的门禁语义是 fail-closed |
| 检查提交内容（`git show <sha>:<path>`）而非工作区文件 | oxfmt 的 ignore 规则按仓库根解析，临时目录导出后配置失效；且实现复杂度远超收益。残留缺口已在「后果」记录 |

## 后果

- **成本**：每次 push 多一次 oxfmt 进程（实测被推 1 文件 68ms 内部耗时、整仓 686 文件 234ms；含 pnpm/vp 启动约 0.4–1s）。被推文件全在忽略面时同样一次进程（exit 2 → skip 并 log）。
- **已知残留缺口**：「提交未格式化 + 工作区已（格式化但未 amend）」可漏——检查的是工作区内容。方向安全（漏检由 CI 的 check job 在 push 后兜底），不引入假阴性到发布路径。
- **域校验行为不变**：三域调度、分叉 fail-closed、fetch fail-open 全部保持原样；fmt 门禁在分叉拦截之后（分叉时同样不跑，rebase 后下次 push 再校验）。
- **回归防线**：单测新增 5 例——退出码→裁决映射（fail / skip / exit 2 无 marker）、被推变更只有删除时无目标、多 ref 并集去重且只跑一次、分叉早于 fmt、真实 oxfmt 契约（已格式化文件 → pass；ignore 面路径 → skip）。
- **端到端实证**（2026-09-27，临时分支真实 CLI 路径）：未格式化文件 → exit 1 且清单点名该文件；格式化后 → exit 0 且三域校验照常执行。
