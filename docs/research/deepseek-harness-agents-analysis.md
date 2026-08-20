---
type: Research
title: DeepSeek Harness .agents 系统深度分析——对 Pictelio 规范执行分层模型的借鉴
status: 调研事实卡 · 供 Agent 规范架构决策引用
date: 2026-08
tags: [agents, skills, code-review, pre-push-checks, quality-gates, oracle-problem, test-quality, repository-governance]
---

# DeepSeek Harness .agents 系统深度分析

> 调研目标：评估 DSH 的 ".agents" 系统对 Pictelio "如何保证 AI 模型遵守仓库规范（尤其测试规范）"问题的借鉴价值。
> 调研范围：DSH 仓库 "/Users/lilianda/develop/deepseek-harness/.agents/" 的全部文件 + 源码中加载 .agents 的代码路径。
> 语言：中文为主，技术术语保留英文。

---

## 1. 摘要（TL;DR）

DeepSeek Harness（DSH）的 ".agents" 系统是一套**仓库内维护的 agent 规范 + 生命周期管理 + 分层执行**机制。对 Pictelio 当前讨论的 T0/T1/T2 分层模型和 Q3（oracle 检查放哪）决策，有以下 5 个最关键的发现：

1. **DSH 把 skill 放在仓库内 ".agents/skills/"（随版本控制），而非全局目录**。这直接支持 Pictelio 考虑"skill 仓库化"作为 Q3 的新选项（D），与全局 skill、仓库 AGENTS.md 包层、条件化激活并列。
2. **DSH 的 T0（机械门禁）极其精简**：pre-commit 只做 staged lint + whitespace + vendor manifest；pre-push 只做增量 typecheck。 exhaustive 检查全交给 CI。这与 Pictelio 的 T0 设计方向一致。
3. **DSH 的 code-review skill 是纯粹的"提示词约束"（T1 审阅）**，没有接入 hook/CI 机械执行。它检查的内容覆盖正确性、生命周期、并发、契约、测试强度，但**不包含测试质量/oracle/期望值溯源类检查**——这类检查在 DSH 中由"测试强度"（test strength）条款提示，但无专门 skill 或 gate。
4. **DSH 的 notes 生命周期系统（proposed → implemented → archived）是一套完整的决策记录管理机制**，有明确的流转规则、manifest 校验、格式 gate。Pictelio 可以借鉴其"决策随代码一起版本控制"的理念，但不需要照搬其三语（英/中/i18n.yaml）和 archive 冻结机制。
5. **DSH 的 skill 加载是运行时注入 agent 上下文**：通过 ".dsh/skills" 和 ".agents/skills" 目录发现，由 ".agents/skills/" 提供仓库级规范，运行时合并到 agent 的 system prompt。这是"规范怎么被保证执行"的关键证据——**规范通过"注入 agent 上下文"执行，而非 hook/CI 强制执行**。


---

## 2. notes 生命周期系统解剖

### 2.1 系统概述

DSH 的 ".agents/notes/" 是一套**Agent Note（代理笔记）**系统，本质上是"由 agent 编写的 RFC + 决策记录"。它的设计目标是：

- 记录影响代码库的决策（why + what we gave up）
- 保持决策记录与代码同步更新
- 通过生命周期管理避免决策记录腐烂

> 来源：".agents/notes/README.md" 第 1-3 行："One kind of design doc lives here. An Agent Note records a decision or proposal that affects this codebase — the why and what we gave up, the parts code and docs can't carry."

### 2.2 路径编码的生命周期

每个 Agent Note 的路径编码了它的生命周期和分类：

```
{lifecycle}/{class}/yyyy-mm-dd-topic-title.md
```

**Lifecycle（生命周期文件夹）：**

| 文件夹 | 含义 | 流转规则 |
|--------|------|---------|
| `proposed/` | 提案，尚未实现（或部分实现） | 不可 archive；若废弃则 reject |
| `implemented/` | 已交付的决策，**必须与 shipped 代码保持同步** | 当决策 unlikely to guide future work 时，通过 ".agents/skills/dsh-archive-agent-notes/SKILL.md" 流程 archive |
| `rejected/` | 被明确拒绝的提案 | 仅当 rationale 能防止"有诱惑力的错误"时保留；否则删除完整 triplet |
| `archived/` | 冻结的历史快照（单独树） | 永久只读，不可编辑、不可作为当前权威 |

> 来源：".agents/notes/README.md" "Layout and naming" 和 "Archiving and deletion" 章节。

**Class（分类，closed set）：**

- `feature` — 新能力
- `bug-fix` — 缺陷修复
- `simplification` — 移除代码/行为/表面积
- `architecture` — 已交付源码的结构决策
- `process` — 工具、策略、工作流（围绕代码，非运行时行为）
- `testing` — 测试基础设施和策略

> 来源：".agents/notes/README.md" "Classification" 章节。添加 class 需要更新 ".agents/notes/scripts/agent-note-tree.ts" 中的 canonical set。

### 2.3 流转规则详解

**proposed → implemented：**
- 必须同时更新 `Status:` 行
- 必须重写 `## Proposal` 为现在时态的 `## Decision`
- 必须删除 `## Acceptance criteria` 和 `## Risks`，折叠进 `## Consequences`
- 格式 gate（`verify-agent-note-format`）会校验这些结构

> 来源：".agents/notes/README.md" "Moving between lifecycles" 章节。

**implemented → archived：**
- 仅当 shipped decision 完成且 rationale 不太可能指导未来工作时
- 移动完整 triplet（英文 + 中文 + sidecar i18n.yaml）
- 保留 `Status: implemented`，插入 `Archived: YYYY-MM-DD`
- 修复或删除 inbound links
- 使用 ".agents/skills/dsh-archive-agent-notes/SKILL.md" 流程，而非按字数/年龄/配额

> 来源：".agents/notes/README.md" "Archiving and deletion" 章节；".agents/notes/archived/AGENTS.md"。

**rejected → delete：**
- 当 rejected idea 已过时、被取代、不再可信或 unlikely to prevent re-litigation 时
- 删除完整 triplet（英文 + 中文 + sidecar）
- 修复或删除 inbound links

### 2.4 manifest.json 记录什么

`archived/manifest.json` 是一个 append-only 的冻结内容清单：

```json
{
  "version": 1,
  "files": {
    "architecture/2026-06-11-custom-schema-dsl.i18n.yaml": "sha256:f05d94c...",
    "architecture/2026-06-11-custom-schema-dsl.md": "sha256:71286f2...",
    ...
  }
}
```

每个 archived triplet 的三个文件都有 SHA256 哈希。`verify-archived-agent-notes` gate 校验：
- closed class tree
- complete triplets
- archive metadata
- sidecar hashes
- 内容不可变

> 来源：".agents/notes/archived/manifest.json"；".agents/notes/archived/AGENTS.md"。

### 2.5 i18n 组织方式

每个 Agent Note 是一个**双语对（bilingual pair）**：
- 英文源文件：`foo.md`
- 中文镜像：`foo.zh.md`
- 一致性记录：`foo.i18n.yaml`（记录 git blob hash）

编辑任一侧后，必须同步更新另一侧，并重新记录 hash：

```bash
pnpm run verify-translation-pairing --write .agents/notes/README.md
```

机器校验的 header token（`# Agent Note: ` 和 `Status:` 行）保持英文原文。

> 来源：".agents/notes/README.md" "Chinese counterparts" 章节；".agents/notes/README.i18n.yaml"。

### 2.6 是不是"仓库内维护 agent 规范 + 生命周期管理"机制？

**是。** 但需要注意：
- Agent Notes 是**决策记录**（RFC + ADR），不是 agent 执行规范
- Agent 执行规范在 **AGENTS.md**（根目录、packages/、docs/ 等子树）
- Agent Notes 通过 cross-reference 链接到 AGENTS.md 和代码，形成"决策 → 规范 → 代码"的追溯链


---

## 3. dsh-code-review / dsh-pre-push-checks 解剖

### 3.1 dsh-code-review

#### (a) 触发时机和流程

- **触发**：由 agent 在 PR review 时**显式调用**（通过 skill 名称匹配）
- **不是 hook/CI 触发**，也不是自动触发
- Skill 的 `agents/openai.yaml` 没有定义（dsh-code-review 目录下没有 agents/ 子目录），说明它可能是**纯提示词 skill**，不注册到 Codex/Claude Code 的自动 skill 系统

> 来源：".agents/skills/dsh-code-review/SKILL.md" 全文；目录结构确认无 agents/openai.yaml。

#### (b) 检查内容

dsh-code-review 的检查分为 **Blocking requirements**（阻塞项）和 **Manual checks**（人工检查）：

**Blocking requirements：**
1. **New prose receives semantic review** — 所有新增/修改的 Markdown、JSDoc、comment、prompt、description、visible string 必须用 dsh-prose-standard 审查
2. **Docs match the code** — 配置、默认值、错误、wire fields、events、public behavior 必须在同个 diff 中更新 package README 和 JSDoc
3. **Core type docs match** — spine 或 seam vocabulary 变更必须更新 subsystems 页面和 type-equiv 条目
4. **Registrations clean up** — 新 registry contribution 必须通过 disposal tests
5. **Invariant companions are semantic** — 每个 `./invariant` 必须有 owner event-stream 或 mutable-data relationship
6. **Required evidence exists** — 验证作者运行了相关本地检查，且 CI 覆盖 exhaustive matrix

**Manual checks（重点摘录与测试相关的）：**
- **Test strength** — assertions 必须在 intended regression 上失败，验证 external state/logs/events/disposal，而非 restate implementation 或 trust agent's report。Coverage 必要但不充分。
- **Real entry path** — tests 必须 exercise shipped Loader/bin/worker/ACP bridge/subprocess，hand-mounted plugin 不够
- **Invariant lifecycle and negative controls** — verify candidate observations are rejected before publication where possible
- **Implemented Agent Notes match shipped reality** — PR 实现 proposed Agent Note 时，必须在同个 diff 中移动并重写为现在时态

**有没有测试质量/oracle/期望值溯源类检查？**

**没有专门的 oracle 或"期望值溯源"检查。** dsh-code-review 的 "Test strength" 条款要求 assertions 验证 external state 而非 restate implementation，这触及了 conformance 问题（测试配合实现），但没有明确要求逐测试问"期望值来自哪"。

> 来源：".agents/skills/dsh-code-review/SKILL.md" "Blocking requirements" 和 "Manual checks" 章节。

#### (c) 机械执行 vs 提示词约束

**纯提示词约束（T1 审阅）。** dsh-code-review 是 skill 形式的 review guide，没有接入任何 hook 或 CI gate。它的 enforcement 完全依赖：
- Agent 在 review 时加载该 skill
- Skill 中的 blocking requirements 被 agent 遵守
- Reviewer（agent 或人类）在 PR 中提出 blocker

### 3.2 dsh-pre-push-checks

#### (a) 触发时机和流程

- **触发**：由 agent 在 push 前**显式调用**（通过 skill 名称匹配）
- **不是 Git hook** — DSH 的 pre-push hook 只做 `pnpm run typecheck`（增量类型检查）
- Skill 指导 agent 选择"最窄的测试和检查"来覆盖 outgoing diff，而非 reflexively 运行完整仓库 suite

> 来源：".agents/skills/dsh-pre-push-checks/SKILL.md" 第 1 段；"lefthook.yml" pre-push 配置。

#### (b) 检查内容

Skill 的核心是 **"Select relevant evidence"**（选择相关证据）：

| 变更类型 | 建议检查 |
|---------|---------|
| Package or script behavior | 运行 owning Vitest file 或 focused test |
| Documentation, Agent Notes, catalogs | 运行 `pnpm run doc-sync`；需要时运行 full lint |
| Model-/editor-/CLI-/terminal-visible output | 运行 focused keyless snapshot 或 real runnable-example |
| Package manifests, public exports, build config | 运行 `pnpm run build` + hygiene checks + built-artifact smoke |
| Real provider or agent behavior | 运行 `pnpm run test:e2e`（有 credentials 时）|

**Coverage 选择原则：**
- Test selection 和 coverage selection 是分开的
- Vitest file filter 选测试，仓库配置 otherwise 测量每文件
- 不要用 `--passWithNoTests`、降低 coverage threshold、或 narrow `--coverage.include` 来隐藏 uncovered file

> 来源：".agents/skills/dsh-pre-push-checks/SKILL.md" "Select relevant evidence" 章节。

#### (c) 是不是 pre-push 钩子？

**不是。** DSH 的 Git hooks（lefthook）配置如下：

- **pre-commit**：staged Oxlint fix + whitespace check + vendor manifest guard + translation pairing
- **pre-push**：仅 `pnpm run typecheck`（增量类型检查）
- **pre-merge-commit**：translation pairing + archived agent notes

> 来源："lefthook.yml" 全文。

dsh-pre-push-checks **skill** 是在 hook 之外的** agent 层指导**，告诉 agent 在 push 前应该运行哪些检查。这与 Pictelio 的 T1（独立审阅）概念一致——不是机械执行，而是 agent 的自觉行为。

### 3.3 对应 Pictelio 的 T0/T1/T2 分层

| DSH 机制 | Pictelio 分层 | 说明 |
|---------|-------------|------|
| pre-commit (Oxlint + whitespace + vendor manifest) | **T0 机械门禁** | 确定性，agent 自觉无关 |
| pre-push (typecheck) | **T0 机械门禁** | 增量类型检查，fast local checkpoint |
| CI gates (test:coverage, lint, duplication, doc-sync, hygiene, etc.) | **T0 机械门禁** | exhaustive coverage，平台矩阵 |
| dsh-pre-push-checks skill | **T1 独立审阅** | agent 选择相关证据，非强制 |
| dsh-code-review skill | **T1 独立审阅** | review 时的规范指导，非强制 |
| "Test strength" / "Required evidence exists" | **T1 的提示词约束** | 要求 external state 验证，但无 oracle 溯源 |
| 100% coverage + mutation testing (planned) | **T2 明说不保证** | coverage 必要但不充分；mutation testing 是 planned counterweight |


---

## 4. .agents 的接线方式（源码证据）

### 4.1 谁在加载 .agents

DSH 通过 ".agents/skills/" 目录**运行时加载 skill**，核心代码在：

**`packages/skill/skill-filesystem/src/index.ts`**

这是 `ctx.skills` provider registry 的一个实现（FileSystemSkillProvider）。它发现、解析、加载本地文件系统上的 skill。

### 4.2 加载路径和优先级

```typescript
// 来自 packages/skill/skill-filesystem/src/index.ts
private async roots(cwd: string | undefined): Promise<SkillRoot[]> {
  const roots: SkillRoot[] = []
  if (this.includeDefaultRoots && cwd !== undefined) {
    const projectRoot = await findProjectRoot(resolve(cwd), optionalFileSystem(this.ctx))
    roots.push(
      { path: join(projectRoot, '.dsh/skills'), source: 'project-dsh', rank: PROJECT_DSH_RANK, projectRoot },      // rank 100
      { path: join(projectRoot, '.agents/skills'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, projectRoot },  // rank 200
    )
  }
  roots.push(...this.customSkillDirs.map(path => ({ path, source: 'custom' as const, rank: CUSTOM_RANK })))  // rank 300
  if (this.includeDefaultRoots) {
    roots.push(
      { path: join(this.dshHome, 'skills'), source: 'user-dsh', rank: USER_DSH_RANK, skipSystem: true },     // rank 400
      { path: join(this.agentsHome, 'skills'), source: 'user-agents', rank: USER_AGENTS_RANK },              // rank 500
    )
  }
  if (this.bundledSkillDir !== undefined) {
    roots.push({ path: this.bundledSkillDir, source: 'bundled', rank: BUNDLED_SKILL_RANK, trustedHost: true })  // rank 600
  }
  return roots
}
```

**关键发现：**

1. **`.agents/skills/` 是项目级 skill 根目录**，rank = 200，优先级高于用户级（~/.agents/skills, rank 500）和 bundled（rank 600）
2. **项目级 skill 会覆盖用户级 skill**（相同 name 时，rank 低的优先）
3. **`.agents/skills/` 随仓库版本控制**——因为它在 projectRoot 下

> 来源："packages/skill/skill-filesystem/src/index.ts" `roots()` 方法。

### 4.3 Skill 的发现和加载流程

```
1. FileSystemSkillProvider.list(options) 
   → 发现 roots（含 .agents/skills/）
   → discoverRoot() 扫描每个 root 下的目录/文件
   → 解析 SKILL.md 的 YAML frontmatter（name, description, whenToUse, invocation policy）
   → 返回 SkillCandidate[]

2. SkillRegistry 合并所有 provider 的 candidates
   → 按 rank 排序（低 rank 优先）
   → 同名 skill 由低 rank 的覆盖

3. Agent 会话开始时，skill 被注入 system prompt
   → 通过 ctx.skills.get(candidate) 加载完整 body
   → 内容来自 SKILL.md 的 body（frontmatter 之后）
```

> 来源："packages/skill/skill-filesystem/src/index.ts" `discoverRoot()`, `parseSkillFile()`, `list()`, `get()` 方法；"packages/skill/skill/src/index.ts" `SkillRegistry` 类。

### 4.4 强制执行到什么程度

**.agents/skills/ 的规范执行是"提示词注入"级别，而非 hook/CI 级别：**

- Skill 内容被加载到 agent 的上下文（system prompt）
- Agent 遵守 skill 中的指导是**概率性的**（T2 明说不保证）
- 但 skill 的**存在和格式**被机械 gate 校验：
  - `verify-skill-invocation-metadata`：校验 skill 的 YAML frontmatter 和 agents/openai.yaml 的 policy 一致性
  - `verify-agent-note-format`：校验 Agent Note 格式
  - `verify-translation-pairing`：校验双语对一致性

> 来源："scripts/verify-skill-invocation-metadata.ts"；"package.json" scripts 列表。

### 4.5 与 hook/CI 的关系

| 层级 | 机制 | 强制性 |
|-----|------|-------|
| Hook | lefthook pre-commit/pre-push | 机械强制（exit non-zero = block） |
| CI gates | run-gates.ts 调度器 | 机械强制（PR 合并前必须绿） |
| Skill 注入 | skill-filesystem 运行时加载 | **提示词约束**（agent 自觉遵守） |
| Skill 格式校验 | verify-skill-invocation-metadata | 机械强制（CI 中运行） |


---

## 5. 其余 skills 简述

| Skill | 用途 | 与规范执行/审查/生命周期的关系 |
|-------|------|------------------------------|
| **dsh-archive-agent-notes** | 审计、archive、删除 Agent Notes | 生命周期管理的核心工具；有 agents/openai.yaml，可被 agent 调用 |
| **dsh-find-simplifications** | 发现简化候选（死代码、重复、过度设计） | 与 code-review 互补，关注"减"而非"审"；产出 proposed Agent Note |
| **dsh-prose-standard** | 审查 prose 的 required coverage、editorial quality | code-review 的依赖 skill；处理 comments/docs/prompts/strings |
| **dsh-doc-standards** | 文档 placement、hierarchy、budgets、validation | 与 doc-sync gate 配合；处理 docs/ 和 website/ |
| **dsh-doc-site-sync** | 文档网站同步（VitePress 投影） | 与 doc-sync 流程配合 |
| **dsh-translate-docs** | 双语文档翻译工作流 | 仅用户显式调用；routine translation 走 one-shot 规则 |
| **dsh-trim-cot-leakage** | 修剪 CoT（Chain-of-Thought）泄露 | 与 dsh-prose-standard 配合；处理 reasoning transcript 泄露 |
| **dsh-merging-stacked-prs** | GitHub 原生 stacked PR 合并 | 流程 skill，与 review 生命周期相关 |
| **record-browser-gif** | 录制浏览器 GIF 作为 PR 证据 | 每个 GUI PR 必须包含 GIF；evidence-chain 的一部分 |


---

## 6. 对 Pictelio 分层模型与 Q3 决策的帮助评估

### 6.1 对 T0/T1/T2 分层模型的验证/修正

**验证：**

1. **T0 机械门禁应极度精简** — DSH 的 pre-commit 只做 staged lint + whitespace + vendor manifest；pre-push 只做 typecheck。exhaustive 检查留给 CI。这与 Pictelio 的 T0 设计方向完全一致。

2. **T1 独立审阅是提示词约束** — DSH 的 dsh-code-review 和 dsh-pre-push-checks 都是 skill 形式的审阅指导，没有 hook/CI 强制执行。这验证了"T1 是独立审阅层"的定位。

3. **T2 明说不保证是正确心态** — DSH 的 skill 注入是概率性的，即使 100% coverage 也不证明场景正确（"Coverage is necessary but not evidence that the scenario is correct"）。DSH 计划用 mutation testing 作为 counterweight。

**修正/补充：**

4. **DSH 有一个"T0.5"层：skill 格式校验** — `verify-skill-invocation-metadata` 等 gate 校验 skill 的格式和元数据，但不校验 skill 的内容质量。Pictelio 可以考虑在 T0 和 T1 之间增加一个"格式/结构门禁"层。

5. **DSH 的 code-review 没有 oracle 检查** — 这说明"测试期望值溯源"是一个**尚未被主流方案覆盖**的问题，Pictelio 如果做这件事，是在探索一个空白领域。

### 6.2 对 Q3（oracle 检查放哪）的借鉴——"skill 仓库化"新选项

DSH 的关键架构决策是：**把 skill 放在仓库内 `.agents/skills/`（随版本控制），而非全局目录。**

这对 Pictelio 的 Q3 决策有直接启示：

| 选项 | DSH 的做法 | 对 Pictelio 的启示 |
|-----|-----------|-------------------|
| A) 改全局 skill | DSH 的**用户级** skill 在 `~/.agents/skills/`（rank 500），优先级**低于**项目级 | 全局 skill 影响所有项目，但会被项目级覆盖 |
| B) 仓库 AGENTS.md 包一层 | DSH 的 AGENTS.md 是 standing orders，skill 是 reusable workflows，两者**分离但互补** | AGENTS.md 适合规则声明，skill 适合复杂工作流 |
| C) skill 条件化定义 + 仓库声明激活 | DSH 的 skill 通过 `invocation` policy（modelInvocable/userInvocable）控制激活，但**不是条件化定义** | 可以考虑更细粒度的激活条件 |
| **D) skill 仓库化（新选项）** | **DSH 的核心做法**：`.agents/skills/` 在仓库内，rank 200（高优先级），随版本控制 | **这是最值得 Pictelio 借鉴的做法** |

**"skill 仓库化"的优势：**

1. **版本控制** — skill 随代码一起演进，不会出现"全局 skill 已更新但仓库规范未更新"的漂移
2. **项目特异性** — 不同项目可以有不同的 code-review skill（如 Pictelio 可以有自己的 oracle 检查）
3. **优先级覆盖** — 项目级 skill（rank 200）自动覆盖用户级（rank 500），确保仓库规范优先
4. **可审计** — skill 的变更通过 PR 审查，有完整的变更历史

**"skill 仓库化"的实现方式（对 Pictelio）：**

```
pixivizer/
├── .agents/
│   └── skills/
│       └── pictelio-code-review/
│           ├── SKILL.md          # 包含 oracle 检查指导
│           └── agents/
│               └── openai.yaml   # 可选：Codex/Claude Code 元数据
```

SKILL.md 的 frontmatter：
```yaml
---
name: pictelio-code-review
description: Pictelio 专属 code review — 包含测试期望值溯源检查
---
```

### 6.3 值得照搬/借鉴的具体机制

**值得借鉴：**

1. **Skill 仓库化** — 把 code-review skill 放在仓库内 `.agents/skills/`，随版本控制
2. **T0 极度精简** — pre-commit 只做 lint + whitespace；pre-push 只做 typecheck；exhaustive 留给 CI
3. **Agent Note 生命周期** — proposed → implemented → archived 的流转规则，特别是"implemented 必须与 shipped 代码保持同步"
4. **Skill 格式校验 gate** — `verify-skill-invocation-metadata` 确保 skill 的元数据一致性
5. **"Test strength" 条款** — 要求 assertions 验证 external state 而非 restate implementation

**不值得照搬：**

1. **三语系统（英/中/i18n.yaml）** — Pictelio 当前是中文为主，不需要双语对和 i18n.yaml 的 overhead
2. **Archive 冻结机制** — Pictelio 项目规模较小，archive 的复杂度和收益不成正比
3. **Agent Note 的 closed class 分类** — Pictelio 可以简化分类，不需要 6 个 class 的严格 gate
4. **DSH 的 skill 加载运行时（Cordis 插件系统）** — Pictelio 不需要自己实现 skill registry，可以依赖 Claude Code/Codex 的 skill 系统

### 6.4 对 Pictelio 的具体建议

1. **创建 `.agents/skills/pictelio-code-review/SKILL.md`**，包含：
   - Pictelio 的 code-review 标准（基于现有 AGENTS.md）
   - **新增的 oracle 检查指导**：逐测试问"期望值来自哪：规格样例/字面量/真实数据？"
   - 与 dsh-code-review 类似的 "Test strength" 条款

2. **保持 T0 精简**：
   - pre-commit：oxlint/oxfmt（已有）+ whitespace
   - pre-push：typecheck（增量）
   - CI：exhaustive（test:coverage, lint, etc.）

3. **T1 审阅层**：
   - code-review skill 的 Spec 轴增加"测试期望值溯源"检查
   - 审阅者输入是 spec + 测试（而非实现推导）

4. **T2 明说不保证**：
   - 接受概率 + 审计
   - 考虑引入 mutation testing 作为 counterweight（长期）


---

## 7. 来源清单

### 一手来源（文件路径）

| 文件 | 用途 |
|------|------|
| `.agents/notes/README.md` | Agent Note 系统总览、生命周期规则、格式规范 |
| `.agents/notes/AGENTS.md` | notes 目录的 AGENTS.md |
| `.agents/notes/implemented/AGENTS.md` | implemented 生命周期规则 |
| `.agents/notes/archived/AGENTS.md` | archived 生命周期规则 |
| `.agents/notes/archived/manifest.json` | archived 文件清单和 SHA256 |
| `.agents/notes/README.i18n.yaml` | i18n 一致性记录示例 |
| `.agents/skills/dsh-code-review/SKILL.md` | code-review skill 内容 |
| `.agents/skills/dsh-pre-push-checks/SKILL.md` | pre-push-checks skill 内容 |
| `.agents/skills/dsh-archive-agent-notes/SKILL.md` | archive skill 内容 |
| `.agents/skills/dsh-find-simplifications/SKILL.md` | simplification skill 内容 |
| `.agents/skills/dsh-prose-standard/SKILL.md` | prose standard skill 内容 |
| `.agents/skills/dsh-doc-standards/SKILL.md` | doc standards skill 内容 |
| `.agents/skills/dsh-translate-docs/SKILL.md` | translate skill 内容 |
| `.agents/skills/dsh-trim-cot-leakage/SKILL.md` | trim CoT skill 内容 |
| `.agents/skills/dsh-merging-stacked-prs/SKILL.md` | stacked PR skill 内容 |
| `.agents/skills/record-browser-gif/SKILL.md` | browser GIF skill 内容 |
| `.agents/skills/dsh-archive-agent-notes/agents/openai.yaml` | skill 元数据示例 |
| `.agents/skills/dsh-pre-push-checks/agents/openai.yaml` | skill 元数据示例 |
| `AGENTS.md`（根目录） | 根目录 AGENTS.md（standing orders） |
| `docs/AGENTS.md` | 文档标准 AGENTS.md |
| `docs/testing.md` | 测试策略文档 |
| `lefthook.yml` | Git hooks 配置 |
| `package.json` | package scripts（含 gates） |
| `scripts/run-gates.ts` | CI gate 调度器 |
| `scripts/verify-skill-invocation-metadata.ts` | skill 元数据校验脚本 |
| `packages/skill/skill-filesystem/src/index.ts` | skill 文件系统加载器 |
| `packages/skill/skill/src/index.ts` | SkillRegistry 实现 |
| `.agents/notes/implemented/process/2026-06-11-quality-gates.md` | quality-gates Agent Note |
| `.agents/notes/implemented/process/2026-07-06-parallel-pre-push-gates.md` | parallel pre-push gates Agent Note |
| `.agents/notes/implemented/process/2026-07-22-fast-local-git-hooks.md` | fast local git hooks Agent Note |

> 以上路径均相对于 `/Users/lilianda/develop/deepseek-harness/`。
