# ADR 0099：禁用本地 openwiki:update，文档同步完全移交 CI 定时任务

**状态**：已批准
**日期**：2026-08
**决策者**：团队成员 + grill-with-docs 会话
**背景**：承接现有 openwiki 维护规则（AGENTS.md）中"AI Agent 应主动执行 pnpm openwiki:update"的约束暴露出的问题。

---

## 背景

仓库用 OpenWiki 管理生成式文档（`openwiki/` 目录）。此前 AGENTS.md 要求 AI Agent 在修改 `src/`/`packages/` 后**主动执行** `pnpm openwiki:update` 本地同步文档。

该流程有两个实际缺陷：

1. **权限/环境问题**：本地 `openwiki --update` 需写 `~/.openwiki`，在受限工作环境（如沙箱 workspace-write）下抛 `EPERM: operation not permitted, chmod ~/.openwiki`，同步失败。更重要的是会重建根目录 `CLAUDE.md`（已废弃文件），产生工作区污染干扰 commit。
2. **与已有 CI 兜底重叠**：仓库已有 `openwiki-update.yml` GitHub Actions 定时任务，**每日自动**执行 `openwiki --update` 并生成 PR。本地手动同步既非必要、又引入环境差异与噪音。

结论：本地执行 openwiki:update 是**重复且脆弱**的路径，应禁用，完全依赖 CI 定时任务。

## 决策

1. **禁止** AI Agent 本地执行 `pnpm openwiki:update`（含修改 `src/`/`packages/` 之后）。openwiki/ 是生成文档，由 GitHub Actions 定时任务（`.github/workflows/openwiki-update.yml`）每日自动重生成并提交 PR，本地无需也不应触发。
2. **禁止手动编辑** `openwiki/` 目录下的任何生成文件（既有约束不变）。如需更新 OpenWiki 内容，只改源码/`CONTEXT.md`，交给 CI 定时重生成。
3. openwiki 更新失败/未及时同步**不影响本地开发或 commit**，无需提示或干预，CI 定时任务会收敛。
4. 保留根 `package.json` 的 `openwiki:update` 脚本（供人工确需立即同步时显式调用，非默认路径）；但从 agent 工作流中移除对其的依赖与引导。
5. `openwiki/quickstart.md` 是生成文件，其过时的 pre-commit/openwiki:update 描述由 CI 定时重生成修复，不手改。

## 替代方案评估

| 方案 | 评估 |
|------|------|
| 保留"agent 主动执行" | 权限脆弱（EPERM）、重建 CLAUDE.md 污染工作区、与 CI 每日同步重复；否决 |
| 禁用本地 + 完全依赖 CI（**选定**） | 单一确定性来源；CI 每日收敛；零本地环境依赖；维护者无认知负担 |
| 禁用本地 + 删 package.json 脚本 | 连人工应急同步也关闭；脚本保留成本极低（一行）且不进入 agent 工作流，收益不显著；暂不删 |

## 影响范围

| 文件 | 改动 |
|------|------|
| `AGENTS.md` | 「任务完成前自检」OpenWiki 文档同步项 +「OpenWiki 维护规则·更新维护」小节：改为禁止本地执行、依赖 CI |
| `.husky/pre-commit` | 移除"需要立即同步时手动运行 pnpm openwiki:update"提示行 |
| `README.md` | 命令表移除 `pnpm openwiki:update` 行 |
| `docs/adr/glossary-dead-code-cleanup.md`、`ADR-0083`、`ADR-0098` | 提及 openwiki:update 的描述改写为"CI 定时重生成" |
| `openwiki/quickstart.md` | **不手改**（生成文件），由 CI 重生成修复 |
| `package.json` | 保留 `openwiki:update` 脚本（决策 4） |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| openwiki 文档在某 commit 后不能立即反映 | 可接受——CI 每日重生成；OpenWiki 定性为"方向性概览"，非精确时序文档 |
| 未来 agent 误以为需本地同步 | AGENTS.md 改为**禁止**语义 + 自检项强化；本 ADR 记录决策 |
| quickstart.md 过时引用长期残留 | CI 定时重生成会以新 AGENTS.md 覆盖；不构成功能影响 |

## 后果

- agent 工作流确定性：不再有因 openwiki 权限/重建 CLAUDE.md 导致的本地干扰。
- 单一文档同步来源：CI 定时任务，all-env 可复现。
- AGENTS.md 自检清单与维护规则同步为"禁止 + 依赖 CI"，与后续 agent 行为对齐。
