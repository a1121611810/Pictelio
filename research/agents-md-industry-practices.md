# 业界对 AGENTS.md 的推荐做法调研（wayfinder #602）

**日期**：2026-09-18
**分支**：`research/agents-md-industry-practices`（基于 origin/main，工作区 `.scratch/research-industry`）
**范围**：为 wayfinder 裁 AGENTS.md 决策（#599 目标体积 / #600 裁出内容去向 / #601 回归验证）提供外部一手证据。只调研、未改动根 AGENTS.md（当前 729 行 / 60,584 字节 ≈ 59.2 KiB）。所有断言均附一手 URL；"**未找到**"本身也是调研结论。规范强制（硬上限/默认行为）与官方建议（best practice）在文中分开标注。

---

## TL;DR

1. **"32KB"唯一的一手出处是 OpenAI Codex 的 `project_doc_max_bytes` 默认值（32 KiB）**，且它是**组合指令链的截断上限**（根→当前目录所有 AGENTS.md 拼接后的总字节），**不是**"单文件建议体积"，也不是推荐值；Codex 官方给出的应对方式是"调大上限或拆分到嵌套目录"。**任何一方都没有"AGENTS.md 建议 ≤32KB"的一手规范**。(<https://developers.openai.com/codex/agent-configuration/agents-md>)
2. 真正以"建议"口吻给数字的只有三家：**Claude Code「每个 CLAUDE.md 目标 200 行以内，过长消耗上下文并降低遵从度」**、**Cursor「规则保持 500 行以内」**、**GitHub copilot-instructions.md 生成提示词「不超过 2 页」**。按 Claude 的行数口径，本仓库 729 行约超标 3.6 倍。(<https://code.claude.com/docs/en/memory>、<https://cursor.com/docs/rules>、<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>)
3. **结构共识高度一致**：根文件保持"通用 + 指针"，细节下沉到嵌套 AGENTS.md（按目录就近生效）或 `@path` 导入；agents.md 规范站、Codex、Amp、Cursor、GitHub Copilot、Gemini CLI 均支持嵌套/分层，但**合并语义分两派**——拼接派（近者覆盖/靠后生效：Codex、Cursor、Amp、Gemini、Claude）与就近唯一派（只取最近一份：OpenCode、GitHub Copilot coding agent）。拆分时必须意识到两派差异。(<https://agents.md/>、<https://opencode.ai/docs/rules/>、<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>)
4. **防 rot 的一手做法**：Cursor「引用文件而非复制内容——防止规则随代码变更而过期」、Claude Code「定期审查移除过时/冲突指令 + `/doctor` 自动提出裁剪（砍掉可从代码推导的内容，保留陷阱/ rationale / 与工具默认不同的约定）」、Codex「命中上限就拆分」、Jules「保持 AGENTS.md 最新」。**未找到任何一方提供"CI 里校验 AGENTS.md"的官方机制**——这意味着 #601 的门禁需要自建。(<https://cursor.com/docs/rules>、<https://code.claude.com/docs/en/memory>、<https://jules.google/docs>)
5. **Claude Code 不原生读 AGENTS.md**（只读 CLAUDE.md），官方推荐用 `@AGENTS.md` 导入或符号链接双挂；本仓库现行"AGENTS.md 单文件 + CLAUDE.md 已删除"的形态对 Claude Code 系工具链并非最优，裁切方案应一并考虑双挂问题。(<https://code.claude.com/docs/en/memory>)

---

## 1. 逐来源摘要

### 1.1 agents.md 规范站（跨厂商开放格式）

- **维护方**：站点自称由 OpenAI Codex、Amp、Google Jules、Cursor、Factory 等协作发起，**现由 Linux Foundation 旗下的 Agentic AI Foundation 托管（steward）**；GitHub 官方文档也把 `agentsmd/agents.md` 仓库指为规范出处。(<https://agents.md/>、<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>、<https://github.com/agentsmd/agents.md>)
- **立场**：AGENTS.md 是"给 agent 的 README"，与给人看的 README 互补；**无必填字段**（"just standard Markdown"）；定位为开放格式而非强制标准——FAQ 通篇是建议口吻。
- **结构要点**：推荐章节 = 项目概览 / 构建与测试命令 / 代码风格 / 测试指令 / 安全考量；"monorepo 大仓用嵌套 AGENTS.md，**离得最近的文件优先**（the closest one takes precedence），用户显式 prompt 凌驾一切"；写冲突时近者胜。(<https://agents.md/>)
- **维护要点**："Treat AGENTS.md as living documentation"，可随时更新；迁移旧文件用重命名 + 符号链接。(<https://agents.md/>)
- **体积**：**未找到任何数字**（无字节/行数上限或建议）。
- 其它工具接入指引（FAQ）：Aider 用 `.aider.conf.yml` 的 `read: AGENTS.md`；Gemini CLI 用 `"contextFileName": "AGENTS.md"`。(<https://agents.md/>)

### 1.2 OpenAI Codex（CLI / coding agent）

- **维护方**：OpenAI。文档页 "Custom instructions with AGENTS.md" + 配置参考（config reference）。(<https://developers.openai.com/codex/agent-configuration/agents-md>、<https://developers.openai.com/codex/config-reference>)
- **体积（规范强制/默认行为）**：「Codex skips empty files and **stops adding files once the combined size reaches the limit defined by `project_doc_max_bytes` (32 KiB by default)** … Raise the limit or split instructions across nested directories when you hit the cap.」配置参考中 `project_doc_max_bytes` = "Maximum bytes read from AGENTS.md when building project instructions"，默认 32 KiB；`project_doc_fallback_filenames` 可补认 `TEAM_GUIDE.md` 等替代文件名，示例中演示 `project_doc_max_bytes = 65536`。(<https://developers.openai.com/codex/agent-configuration/agents-md>、<https://developers.openai.com/codex/config-reference>)
  - **关键辨析**：32 KiB 是"全局+项目链**合计**"的读取截断阈值，超限后是**静默停止追加文件**（尾部指令丢失），不是警告、不是单文件建议值。
- **结构（分层规则）**：发现顺序 = ① 全局 `~/.codex/AGENTS.override.md`（存在则顶替 `AGENTS.md`）；② 项目根→当前工作目录逐级，每目录至多取一份（`AGENTS.override.md` > `AGENTS.md` > fallback 文件名）；③ **根到当前目录拼接（concat），近者因排在更后而覆盖前者**。空文件跳过。码 review 规则放 `## Code Review Rules` 段，仓库级检查放根、服务级检查放嵌套文件。(<https://developers.openai.com/codex/agent-configuration/agents-md>)
- **维护/验证**：命中上限 → 调大 `project_doc_max_bytes` 或拆到嵌套目录；用 `codex --ask-for-approval never "Summarize the current instructions."` 验证加载链；指令链每次运行重建、无缓存；TUI 日志可审计实际加载了哪些文件。(<https://developers.openai.com/codex/agent-configuration/agents-md>)

### 1.3 Anthropic Claude Code（CLAUDE.md 系）

- **维护方**：Anthropic。Memory 官方文档（2026-09 在线版）。(<https://code.claude.com/docs/en/memory>)
- **体积（官方建议 + 硬上限）**：
  - 「**Size: target under 200 lines per CLAUDE.md file.** Longer files consume more context and reduce adherence.」→ 这是所有厂商里唯一把"体积↔遵从度"因果关系写明的一手表述。
  - 硬上限：「Claude Code loads a CLAUDE.md file of up to **4 MiB** in full and **skips a larger file**.」
  - 相邻机制的口径：auto memory 的 `MEMORY.md` 索引只读前 **200 行或 25 KB**（先到为准，超限写入会报错提示重写索引）——注意这是 auto memory 而非 CLAUDE.md，但说明 Anthropic 体系里"25 KB 级"是可接受的常驻上下文预算。
  - 「My CLAUDE.md is too large」排障段重申 200 行口径，并给两条减压路径：path-scoped rules（按需加载）、裁掉非每会话必需内容；同时明确「Splitting into `@path` imports helps organization but **doesn't reduce context**, since imported files load at launch.」(均见 <https://code.claude.com/docs/en/memory>)
- **结构（分层规则）**：加载序 = managed policy → `~/.claude/CLAUDE.md`（user）→ `./CLAUDE.md` 或 `./.claude/CLAUDE.md`（project）→ `./CLAUDE.local.md`（gitignore）；**沿目录树向上全部拼接（concat），根→叶顺序，近者后读**；子目录 CLAUDE.md 不随启动加载、在 Claude 读到该目录文件时按需注入；`.claude/rules/` 支持 `paths:` frontmatter 的按需规则；monorepo 可用 `claudeMdExcludes` 排除别家的文件；块级 HTML 注释在注入前剥离（可留人类批注不占上下文）。(<https://code.claude.com/docs/en/memory>)
- **与 AGENTS.md 的关系**：「Claude Code reads CLAUDE.md, not AGENTS.md.」官方解法：CLAUDE.md 里写 `@AGENTS.md` 导入（或 `ln -s AGENTS.md CLAUDE.md`）；`/init`（`CLAUDE_CODE_NEW_INIT=1`）与 `/import`（v2.1.213+）可收编 AGENTS.md / Cursor rules / copilot-instructions.md。(<https://code.claude.com/docs/en/memory>)
- **维护（防 rot，最成体系的一方）**：「Review your CLAUDE.md files … **periodically to remove outdated or conflicting instructions**」；**`/doctor` 检查会为已入库的 CLAUDE.md 提出裁剪**：砍掉可从代码推导的内容（目录布局、依赖清单、架构概览），保留陷阱、rationale、与工具默认不同的约定；import 语法 `@path` 支持相对/绝对路径、递归深度上限 4 跳、代码块内的 `@` 不解析。(<https://code.claude.com/docs/en/memory>)

### 1.4 GitHub Copilot（coding agent / code review / 自定义指令）

- **维护方**：GitHub。(<https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/>、<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>)
- **立场/结构**：2025-08-28 changelog：Copilot coding agent 支持根目录单个 `AGENTS.md`，**也支持嵌套 AGENTS.md**（"nested AGENTS.md files which apply to specific parts of your project"）；同时继续支持 `.github/copilot-instructions.md`、`.github/instructions/**.instructions.md`、`CLAUDE.md`、`GEMINI.md`。2026-06-18 changelog：Copilot code review 自动读取**仓库根**的 AGENTS.md。(<https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/>、<https://github.blog/changelog/2026-06-18-copilot-code-review-agents-md-support-and-ui-improvements/>)
- **分层语义（就近唯一派）**：docs.github.com：「You can create one or more `AGENTS.md` files, stored anywhere within the repository. When Copilot is working, **the nearest `AGENTS.md` file in the directory tree will take precedence**. For more information, see the agentsmd/agents.md repository.」——注意是 nearest **wins**（非拼接），与 Codex/Cursor 的拼接语义不同。(<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>)
- **体积（官方建议，藏在生成提示词里）**：官方给出的 cloud agent 生成 copilot-instructions.md 提示词中含硬限制：「**Instructions must be no longer than 2 pages. Instructions must not be task specific.**」——这是 GitHub 官方口吻下最接近"体积规范"的表述（针对 copilot-instructions.md，非 AGENTS.md，但同属自定义指令体系）。同页另有路径级 `.instructions.md`（`applyTo` glob、可 `excludeAgent`）、优先级 personal > repository > organization（各组都给到模型）。(<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>)
- **官方博客经验**：「How to write a great agents.md: Lessons from over 2,500 repositories」（2025-11-19）：命令前置、代码示例胜于解释、"always / ask first / never"三级边界、技术栈写到版本、覆盖六大区（commands/testing/structure/style/git/boundaries）、「The best agent files grow through iteration, not upfront planning」。**注意口径**：该文面向 `.github/agents/*.md` 自定义 agent 人设文件（带 frontmatter 的 persona），不是 AGENTS.md 开放格式本身，经验可迁移但不可直接当规范引用。(<https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/>)

### 1.5 Cursor（rules 体系 + AGENTS.md）

- **维护方**：Anysphere。Rules 文档（cursor.com/docs/rules，即 docs.cursor.com/context/rules）。(<https://cursor.com/docs/rules>)
- **立场/结构**：四类规则：Project Rules（`.cursor/rules/*.mdc`，frontmatter 驱动 `alwaysApply/description/globs`）、User Rules、Team Rules、**AGENTS.md（"Simple alternative to `.cursor/rules`"，纯 markdown 无元数据）**；「Cursor supports AGENTS.md in the project root **and subdirectories** … Instructions from nested AGENTS.md files are **combined** with parent directories, with more specific instructions taking precedence」（拼接派）；规则应用顺序 Team → Project → User，冲突时靠前者优先；`.cursor/rules` 下裸 `.md` 被忽略（无 frontmatter），想要纯 markdown 就用 AGENTS.md。(<https://cursor.com/docs/rules>)
- **体积（官方建议）**：Best practices 首条「**Keep rules under 500 lines**」，其次「Split large rules into multiple, composable rules」。(<https://cursor.com/docs/rules>)
- **维护（防 rot，原文最直白）**：「**Reference files instead of copying their contents—this keeps rules short and prevents them from becoming stale as code changes**」；避免整本风格指南、避免罗列每个命令、避免罕用边界 case、避免复制代码库已有内容；「Check your rules into git … When you see Agent make a mistake, update the rule. You can even tag `@cursor` on a GitHub issue or PR to have Agent update the rule for you.」(<https://cursor.com/docs/rules>)

### 1.6 Gemini CLI（GEMINI.md）

- **维护方**：Google（github.com/google-gemini/gemini-cli，Apache-2.0）。配置文档 `docs/cli/configuration.md`。(<https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/configuration.md>)
- **立场/结构**：上下文文件默认文件名 `GEMINI.md`，`contextFileName` 可改为 `"AGENTS.md"` 或一组文件名（settings.json 层级的官方配置项）；**分层加载 = 全局 `~/.gemini/` → 当前目录向上至项目根（.git）/home → 当前目录以下子目录**（子目录扫描默认限 200 目录，`memoryDiscoveryMaxDirs` 可调），全部拼接进系统提示词；支持 `@path` 导入（memport，代码块内忽略）；`/memory show` 查看合并结果、`/memory refresh` 强制重扫——即官方给了"审计实际加载内容"的命令。(<https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/configuration.md>)
- **体积**：**未找到字节/行数上限或建议**（仅有子目录扫描广度 200 的目录数限制，与体积无关）。"The more relevant and precise your context files are, the better the AI can assist you" 是唯一近似建议。(同上 URL)

### 1.7 Amp（Sourcegraph）

- **维护方**：Sourcegraph。AGENTS.md 专页 + Chronicle（版本志）。(<https://ampcode.com/docs/customize/agents-md>、<https://ampcode.com/chronicle>)
- **立场/结构**：AGENTS.md 为原生指令文件（2025-08-20 由 AGENT.md 改名而来）；加载 = cwd 及父目录（至 $HOME）始终包含 + 子树文件在读文件时按需包含 + 个人级 `$HOME/.config/amp/AGENTS.md`（或 `$HOME/.config/AGENTS.md`）+ 系统级 `/etc/ampcode/` 等；目录无 AGENTS.md 时回退 `AGENT.md`/`CLAUDE.md`；**官方建议：「In a large repository with multiple subprojects, we recommend keeping the top-level AGENTS.md general and creating more specific AGENTS.md files in subtrees」**；`@path` 导入支持 glob 与被引用文件的 `globs:` frontmatter（按需加载）；命令面板 `agents-md list` 审计实际生效文件。(<https://ampcode.com/docs/customize/agents-md>)
- **体积**：**未找到数字**。

### 1.8 OpenCode（SST）

- **维护方**：SST 团队。Rules 文档。(<https://opencode.ai/docs/rules/>)
- **立场/结构**：AGENTS.md 为项目规则文件（`/init` 可生成，"concise project-specific guidance"）；`~/.config/opencode/AGENTS.md` 为全局；**就近唯一派**：「Local files by traversing up from the current directory (AGENTS.md, CLAUDE.md) … **The first matching file wins**」（AGENTS.md 与 CLAUDE.md 同目录只取 AGENTS.md）；兼容回退 `~/.claude/CLAUDE.md`；可用 `opencode.json` 的 `instructions` 字段挂任意文件/glob/远程 URL（5 秒超时）并与 AGENTS.md 合并。
- **体积/维护**：无数字；但明示「Keep AGENTS.md concise while referencing detailed guidelines」，并给出 lazy-loading 范式（AGENTS.md 里教 agent 按需 Read 被引用文件，"Do NOT preemptively load all references"）。注意：**opencode 不自动解析 AGENTS.md 内的 `@引用`**（官方明说 "opencode doesn't automatically parse file references in AGENTS.md"）。(<https://opencode.ai/docs/rules/>)

### 1.9 Google Jules

- **维护方**：Google。官方快速上手文档。(<https://jules.google/docs>)
- **立场/结构**：「Jules now automatically looks for a file named **AGENTS.md in the root** of your repository … Jules uses this file to better understand your code and generate more relevant plans and completions.」**仅根目录，无嵌套支持的一手表述**。
- **维护**：「Tip: **Keep AGENTS.md up to date**. It helps Jules and your teammates work with your repo more effectively.」(<https://jules.google/docs>)
- **体积**：**未找到数字**。

### 1.10 Zed

- **维护方**：Zed Industries。(<https://zed.dev/docs/ai/instructions>)
- **立场/结构**：「Zed supports `AGENTS.md` as the **primary instruction file**」；个人级 `~/.config/zed/AGENTS.md`；项目级**文件名候选列表按序取第一个命中**：`.rules` > `.cursorrules` > `.windsurfrules` > `.clinerules` > `.github/copilot-instructions.md` > `AGENT.md` > `AGENTS.md` > `CLAUDE.md` > `GEMINI.md`（⚠️ 本项目根若同时存在 AGENTS.md 与 CLAUDE.md，Zed 只读 AGENTS.md——双挂时需留意此类 first-match 工具）；「Project instructions override personal AGENTS.md」。(<https://zed.dev/docs/ai/instructions>)
- **体积**：**未找到数字**。

### 1.11 Aider

- **维护方**：Aider 项目。(<https://aider.chat/docs/usage/conventions.html>)
- **立场**：无原生 AGENTS.md 概念；惯例文件（示例名 `CONVENTIONS.md`）经 `--read` / `read:` 配置进上下文，官方形容为 "**a small markdown file**"（定性、无数字）；按 agents.md 站点 FAQ，Aider 可配置 `read: AGENTS.md` 复用同一份文件。(<https://aider.chat/docs/usage/conventions.html>、<https://agents.md/>)

---

## 2. 体积建议对照表

| 来源 | 数字/说法 | 性质 | URL |
| --- | --- | --- | --- |
| OpenAI Codex | `project_doc_max_bytes` 默认 **32 KiB**；超则**停止追加**指令文件（截断，非警告）；可调大或拆嵌套目录 | **默认行为上限（可配置）**，针对"全局+项目链合计"而非单文件 | <https://developers.openai.com/codex/agent-configuration/agents-md>、<https://developers.openai.com/codex/config-reference> |
| Anthropic Claude Code | 每个 CLAUDE.md **目标 200 行以内**；"Longer files consume more context and **reduce adherence**" | **官方建议**（含因果说明） | <https://code.claude.com/docs/en/memory> |
| Anthropic Claude Code | 单文件 **4 MiB** 硬阈值，超限**整文件跳过** | **硬上限** | <https://code.claude.com/docs/en/memory> |
| Anthropic Claude Code（auto memory，相邻机制） | `MEMORY.md` 只读前 **200 行 / 25 KB**（先到为准） | 硬上限（非 CLAUDE.md 本体，仅供参考量级） | <https://code.claude.com/docs/en/memory> |
| Cursor | 规则**保持 500 行以内**；大规则拆成多个可组合规则 | **官方建议**（rules 最佳实践，AGENTS.md 被列为四类规则之一） | <https://cursor.com/docs/rules> |
| GitHub Copilot | 生成 copilot-instructions.md 的提示词硬限制「**no longer than 2 pages**」「not task specific」 | 官方生成流程内的**硬限制**（针对 copilot-instructions.md） | <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions> |
| agents.md 规范站 | **无任何数字** | —（缺席即发现） | <https://agents.md/> |
| Gemini CLI | **未找到**体积数字（仅子目录扫描 200 目录上限） | — | <https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/configuration.md> |
| Amp / OpenCode / Jules / Zed / Aider | **均未找到**体积数字（OpenCode/Aider 仅定性说 concise / small） | — | <https://ampcode.com/docs/customize/agents-md>、<https://opencode.ai/docs/rules/>、<https://jules.google/docs>、<https://zed.dev/docs/ai/instructions>、<https://aider.chat/docs/usage/conventions.html> |

**对照本仓库**：根 AGENTS.md = 729 行 / 60,584 B ≈ 59.2 KiB。→ 超 Claude 200 行建议约 3.6 倍；超 Codex 32 KiB 默认链预算约 1.8 倍（且 Codex 口径下嵌套文件与根文件**共享**该预算）；若按 Cursor 500 行规则上限作宽松锚，也超约 46%。**没有任何一手来源把 32 KiB 当作"推荐体积"；它是 Codex 的截断默认值。**

---

## 3. 结构分层约定（多文件解析规则）

| 工具 | 全局/个人层 | 项目层 | 多文件语义 | `@导入` | 对 AGENTS.md 的原生支持 |
| --- | --- | --- | --- | --- | --- |
| OpenAI Codex | `~/.codex/AGENTS.md`（override 顶替） | 根→CWD 逐级，每目录至多一份 | **拼接**（根→叶，近者后读覆盖） | 无（用 `project_doc_fallback_filenames` 补认别名） | 原生（发起方之一） |
| Claude Code | `~/.claude/CLAUDE.md` + managed policy | `./CLAUDE.md`、子目录按需 | **拼接**（根→叶）；rules 可 `paths:` 按需 | `@path`（深度 ≤4） | **不原生读**，官方解法 `@AGENTS.md` 导入或符号链接 |
| GitHub Copilot coding agent | —（personal instructions 另设） | 仓库任意位置，可嵌套 | **就近唯一**（nearest wins） | 无 | 原生（2025-08-28 起；code review 2026-06-18 起仅根） |
| Cursor | User Rules（UI） | 根 + 子目录嵌套 | **拼接**（nested 与父目录合并，更具体者优先）；Team > Project > User | mdc 内 `@file`；AGENTS.md 内不解析 | 原生（四类规则之一，"simple alternative"） |
| Gemini CLI | `~/.gemini/GEMINI.md`（名可配） | 根→CWD + 子目录（≤200 目录） | **拼接**进系统提示词 | `@path`（memport） | 经 `contextFileName` 配置 |
| Amp | `~/.config/amp/AGENTS.md` + 系统级 | cwd/父目录常驻 + 子树按需 | **拼接**（回退 AGENT.md/CLAUDE.md） | `@path` 支持 glob + `globs:` frontmatter | 原生（发起方之一） |
| OpenCode | `~/.config/opencode/AGENTS.md`（回退 `~/.claude/CLAUDE.md`） | 向上遍历就近 | **就近唯一**（first match wins） | **不解析**；改用 `opencode.json` instructions（支持 glob/远程 URL） | 原生 |
| Zed | `~/.config/zed/AGENTS.md` | 项目根文件名候选列表**取第一个命中** | 就近唯一（project override personal） | 无 | 原生（primary instruction file） |
| Google Jules | — | **仅仓库根** | 单文件 | 无 | 原生（发起方之一） |
| agents.md 规范站 FAQ | — | 根 + 嵌套 | "**closest wins**；用户 prompt 凌驾一切"（简化的就近优先表述） | 无 | 规范本体 |

要点：①"嵌套 AGENTS.md"已是主流（9/11 家支持），但**合并语义分两派**——拼接派意味着"根文件被全量携带、嵌套文件是增量覆盖"；就近唯一派（OpenCode、GitHub Copilot）意味着"嵌套目录工作时**完全看不到**根文件内容"。拆内容到嵌套文件时，必须按"就近唯一派工具进入子目录即丢失全局指令"来评估风险。②Claude Code 生态（含本 harness 的 Kimi Code 风格 CLAUDE.md 机制）不读 AGENTS.md，双挂（CLAUDE.md `@AGENTS.md` 导入）是官方推荐兼容形态。

---

## 4. 维护（防 rot / 防膨胀）的一手做法汇总

- **指针优于内联（pointer over inline）**：Cursor「Reference files instead of copying their contents … prevents them from becoming stale」；OpenCode「Keep AGENTS.md concise while referencing detailed guidelines」+ lazy-loading 范式；Amp 顶层 general + 子树 specific；Claude Code 把多步流程/局部规则挪去 skills 或 path-scoped rules。(<https://cursor.com/docs/rules>、<https://opencode.ai/docs/rules/>、<https://ampcode.com/docs/customize/agents-md>、<https://code.claude.com/docs/en/memory>)
- **定期审查**：Claude Code「Review your CLAUDE.md files … periodically to remove outdated or conflicting instructions」；Jules「Keep AGENTS.md up to date」；agents.md「living documentation」。(<https://code.claude.com/docs/en/memory>、<https://jules.google/docs>、<https://agents.md/>)
- **官方裁剪/审计工具**：Claude Code `/doctor` 自动提出裁剪（砍可从代码推导的、留陷阱/rationale/与默认不同的约定）；Codex `codex "Summarize the current instructions."` 验证加载链；Amp `agents-md list`；Gemini `/memory show`；Claude `/context`。(<https://code.claude.com/docs/en/memory>、<https://developers.openai.com/codex/agent-configuration/agents-md>、<https://ampcode.com/docs/customize/agents-md>、<https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/configuration.md>)
- **`@import` 的组织手法**：Claude Code（≤4 跳、代码块内不解析）、Gemini CLI（memport）、Amp（glob + globs frontmatter）三家官方支持；**OpenCode 明确不解析** AGENTS.md 内引用；Cursor AGENTS.md 内不解析（mdc 规则内才有 `@file`）。→ 依赖 `@import` 做拆分对 OpenCode/Cursor 无效，需保留"嵌套 AGENTS.md"或"agent 按需 Read"两类退路。(各 URL 见上)
- **未找到**：任何一方提供"CI 中校验 AGENTS.md 体积/结构/有效性"的官方机制或推荐（无官方 lint、无官方体积门禁）。防 rot 在业界目前停留在"文档建议 + 交互式命令"层面。

---

## 5. 对本项目的启示（对应 #599 / #600 / #601）

- **#599（目标体积/baseline）**：一手证据呈三档——**200 行**（Claude 建议 + "reduce adherence" 因果，最适合做严谨 baseline）、**500 行**（Cursor 规则上限，宽松锚）、**2 页**（GitHub 生成流程硬限制，约等于 100~150 行）。32 KiB 只是 Codex 的**截断默认值**（且口径是"组合链合计"），不应作为"推荐体积"引用；若 harness 警告语写"recommended 32KB"，建议改述为"Codex 默认链预算 32 KiB，超限截断"。当前 729 行按哪档都超标，**≤200 行有唯一写明遵从度代价的一手依据**，另有 4 MiB 硬下限兜底证明"远未触雷区、纯属质量问题"。(<https://code.claude.com/docs/en/memory>、<https://cursor.com/docs/rules>、<https://developers.openai.com/codex/agent-configuration/agents-md>)
- **#600（裁出内容去向）**：业界共识形态 = "**根文件瘦身成通用指令 + 指针**"（agents.md 站 / Amp / Cursor / Claude 全部同向），且本项目已有现成承接层：`docs/`（ADR、agents 工作流文档）、`openwiki/`（生成文档，禁手改）、`CONTEXT-MAP.md` + 各上下文 `CONTEXT.md`、`packages/*/AGENTS.md` 嵌套（9/11 家工具支持嵌套）。**两个必须记录的语义风险**：① OpenCode 与 GitHub Copilot 是就近唯一语义——在 `packages/app/` 下工作时**看不到**根 AGENTS.md 的全局硬约束（如提交规范、Fluent 禁令），关键全局规则需在嵌套文件里复述或接受失效；② Claude Code/Kimi Code 不读 AGENTS.md，双挂方案（CLAUDE.md `@AGENTS.md` 导入，Anthropic 官方姿势）与"符号链接"需在裁切时一并定案。(<https://agents.md/>、<https://ampcode.com/docs/customize/agents-md>、<https://code.claude.com/docs/en/memory>、<https://opencode.ai/docs/rules/>、<https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>)
- **#601（回归验证）**：业界没有官方 AGENTS.md CI 校验可抄（§4 缺席项），可迁移的官方等价物是 Claude `/doctor` 的**裁剪准则**——"砍掉可从代码推导的（目录布局、依赖清单、架构概览），保留陷阱、rationale、与工具默认不同的约定"。这可直接转化为本仓的裁切验收单 + 机器防线（沿用 `engineKeysConsistency` / `*.template.test.ts` 的"从源码提取常量比对"先例，为 AGENTS.md 中声明的命令、路径、键名做存在性契约测试）；行为级验证用业界现成的"让 agent 复述指令链"手法（Codex `Summarize the current instructions` / Gemini `/memory show` / Claude `/context`）作为裁剪前后的 diff 门，叠加仓库已有的 agent-browser E2E 观察行为漂移。(<https://code.claude.com/docs/en/memory>、<https://developers.openai.com/codex/agent-configuration/agents-md>)

---

## 6. 参考链接清单

- agents.md 规范站：<https://agents.md/>；规范仓库：<https://github.com/agentsmd/agents.md>
- OpenAI Codex：AGENTS.md 指南 <https://developers.openai.com/codex/agent-configuration/agents-md>；配置参考 <https://developers.openai.com/codex/config-reference>
- Anthropic Claude Code：Memory <https://code.claude.com/docs/en/memory>
- GitHub：changelog 2025-08-28 <https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/>；changelog 2026-06-18 <https://github.blog/changelog/2026-06-18-copilot-code-review-agents-md-support-and-ui-improvements/>；docs 仓库自定义指令 <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>；官方博客 2500 仓分析 <https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/>
- Cursor：Rules <https://cursor.com/docs/rules>（同 <https://docs.cursor.com/context/rules>）
- Gemini CLI：configuration <https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/configuration.md>
- Amp：AGENTS.md <https://ampcode.com/docs/customize/agents-md>；Chronicle <https://ampcode.com/chronicle>
- OpenCode：Rules <https://opencode.ai/docs/rules/>
- Google Jules：Docs <https://jules.google/docs>
- Zed：Instructions <https://zed.dev/docs/ai/instructions>
- Aider：Conventions <https://aider.chat/docs/usage/conventions.html>
