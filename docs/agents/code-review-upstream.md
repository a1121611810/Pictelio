# code-review skill 的上游基线与同步裁决

本仓的项目级 skill [`SKILL.md`](../../.agents/skills/code-review/SKILL.md) fork 自开源技能集
`mattpocock/skills` 的 `skills/engineering/code-review/SKILL.md`，并在其上叠加本仓专属的三审计、
触发式维度卡点与仓库锚点。

**上游改了不会自动跟过来。** 本文件是「上游基线 + 逐条裁决」的唯一事实源；`SKILL.md` 只留指向
与基线摘要，裁决表不抄。

## 基线

- **上游**：`mattpocock/skills`（`github.com/mattpocock/skills`），skill 路径
  `skills/engineering/code-review/SKILL.md`（**不在仓根**，`code-review/SKILL.md` 会 404）
- **local-fork-of**：`4bf64232`（2026-08-20，本仓加入这个 skill 的提交）
- **last-synced**：2026-10-20
- **各文件的基线 commit**：见下方「上游派生文件清单」表的「基线 commit」列——**sha 只有这一处**，
  闸从表里解析；此处再抄一份就是「同一事实两个副本」，正是这套机制要消灭的东西。

上游自己的文档里写着这条纪律（`docs/engineering/code-review.md`）：

> Keep a note of the commit you forked from so you can re-sync by hand.

只记 SHA 不够——SHA 只让「发现上游动了」变容易；要让「发现不了」变不可能，得靠机械闸（见下）。

### 上游派生文件清单

**这张表是机械闸的驱动面**（脚本从本文件解析，不在代码里硬编码路径）——**新增任何从上游派生的文件，
都要在这里加一行**，否则它的漂移永远零信号。

| ID | 上游路径 | 本仓路径 | 形态 | 基线 commit |
| --- | --- | --- | --- | --- |
| F1 | `skills/engineering/code-review/SKILL.md` | `.agents/skills/code-review/SKILL.md` | `structured`（上游骨架 + 本仓 override） | `3da8c011`（2026-10-07, #1208） |
| F2 | `skills/engineering/setup-matt-pocock-skills/triage-labels.md` | `docs/agents/triage-labels.md` | `adapted`（本地化改编，只查漂移） | `5b7cade4`（2026-10-07, #1197） |
| F3 | `skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md` | `docs/agents/issue-tracker.md` | `adapted`（裁剪 + 改编，只查漂移） | `5b7cade4`（2026-10-07, #1197） |
| F4 | `skills/engineering/setup-matt-pocock-skills/domain.md` | `docs/agents/domain.md` | `adapted`（本地化改编，只查漂移） | `d80fa0f4`（**提交** 2026-09-17，作者日期 08-15） |

**形态的两种含义**：`structured` 走**三方一致性**全文比对（上游正文 ↔ 本仓文件 ↔ 裁决表）；
`adapted` 只做**漂移检测**（上游自基线起又动过没有）——因为本仓这三个文件是**本地化改编**，
逐字比对既不成立也无意义（上游是英文模板，本仓是中文操作手册）。漂移时由人按下面的
「文件级裁决」表裁定要跟什么。

> ⚠️ F2/F3/F4 的上游祖先是 setup skill 的**种子模板**，**不是**上游仓自己的 `docs/agents/`
> （后者是 setup 在上游自己仓里跑出来的产物，路径相同但来源不同）——核上游漂移要核对种子模板那条路径。

## 结构约定：上游骨架 + 本仓 overlay

本仓 `SKILL.md` 以**上游的段落为骨架**：上游每个标题在本仓文件里都有一个同名锚点
`<!-- upstream-section: <上游标题> -->`，本仓内容写在锚点之下；上游没有的机制集中在
`## 本仓 overlay（上游无此段）` 一节。

三处必须同时说得清，机械闸按这个三方关系校验：

1. **上游正文**（`base-commit` 的 `SKILL.md`）——骨架与措辞的来源。
2. **本仓文件**——上游正文 + 显式 override。
3. **本文件的裁决表**——每个 override 的理由与落点。

凡本仓与上游不同之处，在本仓文件里用 `<!-- upstream-override: <ID> -->` 标记，`ID` 指向
下方裁决表的一行。裁决表每行的「处置」列说明语义，「本仓落点」列说明它在文件里对应什么。

机械闸按下面七条规则校验（`scripts/check-code-review-upstream.mjs`）：

1. **每个裁决行都要有对应标记**：裁决表里的 ID 必须在 `SKILL.md` 里出现——唯一例外是「本仓落点」
   列为 `—` 的行（它们说的是「上游有而本仓刻意不搬的东西」，本仓没有落点，**也不允许有标记**）。
2. **每个标记都要有裁决行**：文件里出现一个 ID 而表里没有 ⇒ 红（有人改了但没记录理由）。
3. **上游块在本地缺失**：必须有一条「处置 = `not-ported`」且「上游位置」含该块键的行。
4. **本仓块不在上游**（新增的机制）：必须有一条「处置 = `local-only`」且「上游位置」含该块键的行。
5. **块内容与上游不同**（frontmatter 除外）：该块内必须有 ≥1 个标记。
   ⚠️ **这条是「块级登记存在性」，不是「逐处差异登记」**——它保证「这个块被登记过」，**不**保证
   「块内每一处差异都登记过」。逐处登记目前靠人的纪律，见文末「机检的边界」。
6. **`not-ported` 行不得指名本地还存在的块**：否则裁决表可以预登记一条白名单，把「删掉一整段上游块」
   洗成「我们没搬它」⇒ 红。（`frontmatter` 豁免：那类行说的是 frontmatter 的**内容**。）
7. **本仓独占块（local-only）正文不得为空**：只留锚点 + 标记而正文被清空 = 空壳 ⇒ 红。

「上游位置」列里的块键必须逐字等于上游的标题（`## Process` / `### 1. Pin the fixed point` / …），
本仓文件里的锚点用同一个键。frontmatter 的块键是 `frontmatter`；本仓 frontmatter 的差异由裁决表
登记（YAML 里放不了 HTML 标记，见 `SKILL.md` 开头的说明）。

## 裁决表

上游 #1208（+5/−3）改了 3 处，外加上游文档里记录但**没有进 SKILL.md** 的 1 个已知 bug。
裁决口径：**优先采纳上游的意图，落地时按本仓实况改写，改写处逐条记在这里。**

| ID | 上游位置 | 处置 | 本仓理由 | 本仓落点 |
| --- | --- | --- | --- | --- |
| OV-1 | `intro`｜`## Process` | adapt | 上游开场是英文的两轴简述；本仓中文，并要交代「三审计」与上游基线指针 | H1 后 + `## 与上游的关系` |
| OV-2 | `### 1. Pin the fixed point` | adopt（上游 `5c89081d`） | 上游那句「用户没给就问，不要自己猜」——猜错 = 审了错的 diff，而报告看着像是对的；本仓原先缺（该句在 `5c89081d` 就已存在，**不是** #1208 带来的） | 第 1 步 |
| OV-3 | `### 2. Identify the spec source` | adapt（上游 #1208） | 上游改为「走 tracker doc」而非写死路径；本仓原先写死 `docs/agents/issue-tracker.md`，路径会随 tracker 变更而失效 | 第 2 步 ① |
| OV-4 | `### 2. Identify the spec source` | adapt | 上游 spec 来源含 `docs/`、根 `specs/`、`.scratch/`；本仓只认 `docs/specs/`、`docs/adr/`（根 `specs/` 不存在，`.scratch/` 是未跟踪的实验目录，不作 spec 来源） | 第 2 步 ③ |
| OV-5 | `### 3. Identify the standards sources` | adopt（上游 #1208） | 上游硬规则：`CODING_STANDARDS.md` / `CONTRIBUTING.md` 存在时必须在清单上；从记忆列清单会漏掉唯一带规则那份。本仓清单已含 `CONTRIBUTING.md`，补上 `CODING_STANDARDS.md` 一侧 | 第 3 步 |
| OV-6 | `### 4. Spawn both sub-agents in parallel` | adopt（上游 #1208） | 上游钉「一起发出、**在前台**、并消费它们返回的报告」；本仓原先只写「并行 spawn」，未钉前台——后台化又不轮询 = 两轴报告永不到手 | 第 4 步 |
| OV-7 | `### 4. Spawn both sub-agents in parallel` | adopt（补上游漏修的已知 bug） | 上游文档记录但未进 SKILL.md：sub-agent 会重新调用本 skill 再派代理（上游记录有人跑到 50+ 个 agent）；修法上游已给 = 两个 brief 各加一句禁令 | 第 4 步 |
| OV-8 | `### 4. Spawn both sub-agents in parallel` | adapt | 上游 brief 写死「Under 400 words」；本仓 brief 承载三审计原文 + 测试硬约束 + 声明—读点对照表，装不下 ⇒ **不采纳该上限**，改为不设上限 | 第 4 步（brief 规格：明写不设字数上限） |
| OV-9 | `### 5. Aggregate` | adapt | 上游结尾一行是「每轴 finding 数 + 最严重项」；本仓追加「Spec 轴必含声明—读点对照行」——「由 Y 驱动」的每条声明都要有读点证据或显式挂账 | 第 5 步 |
| OV-10 | `## Why two axes` | adapt | 语义逐字保留，中文本地化（与本仓其余正文同语言） | `## Why two axes（为什么双轴）` |
| OV-11 | `## 本仓 overlay（上游无此段）` | local-only | 三审计 / 触发式维度卡点 / Standards 轴细则 / 仓库锚点 / 测试硬约束对照 —— 上游没有这些机制 | `## 本仓 overlay（上游无此段）` |
| OV-12 | `frontmatter` | adapt | 上游是英文短描述；本仓**不采纳**它，改用承载三审计触发线索的长中文描述（换短的会掉可发现性） | `frontmatter` |
| OV-13 | `### 3. Identify the standards sources` | adapt | 上游把 12 条 Fowler smell **全文粘在第 3 步**；本仓移到 `### Standards 轴` 独立节（第 3 步只留「发现式清单 + 存在项必须在列」），避免第 3 步过长 | `### Standards 轴` |
| OV-14 | `### 2. Identify the spec source` | adapt | 上游那句「If they say there isn't one, the Spec sub-agent will skip」被本仓压缩成一句，**行为保留**（无 spec 则跳过并注明 "no spec available"），不是否决 | 第 2 步 ④ |
| OV-15 | `skills/engineering/code-review/agents/openai.yaml`（文件级） | not-ported | 上游的 Codex UI 元数据；本仓 `.agents/skills/` 只被 pi 扫，pi 只读 `SKILL.md` —— 加一个没人读的文件 = 孤儿产物 | — |
| OV-16 | `docs/engineering/code-review.md`（文件级，上游自己的用户说明页） | not-ported | 本仓 `docs/` 分层是「`docs/agents/` 给 agent、`docs/usage/` 给用户」；这个 skill 是 agent 工具不是产品功能，不需要一层用户说明页 | — |

> **上游 #1208（`3da8c011`）的 3 处改动分别落在 OV-3 / OV-5 / OV-6**（tracker doc · 标准源检索 · 前台派发）。
> ⚠️ **「用户没给就问」不是 #1208 带来的**——它在父提交 `5c89081d`（2026-08-19）就已经存在，#1208 的 patch
> 里 `### 1. Pin the fixed point` **没有任何 hunk** ⇒ 该条记在 OV-2，处置写作「adopt（上游 `5c89081d`）」。
> 上游文档记录但**未进 SKILL.md** 的已知 bug（sub-agent 会重新调用本 skill 再派代理）由 OV-7 覆盖。

### 文件级裁决（F2 / F3 / F4：三个 setup 种子模板）

这三个文件是**本地化改编**（上游英文模板 → 本仓中文操作手册），所以裁定单位是**文件**，
不是上游的段落。逐条裁定如下（上游自各自基线起动过的提交已逐个复核）：

| 文件 | 上游改动 | 处置 | 理由 | 本仓落点 |
| --- | --- | --- | --- | --- |
| F2 `triage-labels.md` | `5b7cade4`：末行由「编辑右列」改为「编辑 **"Label in our tracker"** 列」 | **adopt** | 上游只是把「改哪一列」说得更明确；本仓的「右列」指向同一列但不如列名清楚 ⇒ 跟上游改成指名列名 | `docs/agents/triage-labels.md` 末行 |
| F3 `issue-tracker.md` | `a2f93336` + `5b7cade4`：「Issues and PRDs」→「Issues and **specs**」 | **adopt** | 本仓没有 PRD 流程（只有 `docs/specs/`），沿用旧词会指向本仓不存在的概念 | 首段 |
| F3 | `5b7cade4`：「读 issue」由 `--comments` + 手工 jq 过滤改为 `gh issue view <n> --json number,title,body,labels,comments` | **adopt** | 一次拿全 labels 与 comments，不再依赖手工过滤（与本仓「读点证据要未截断」的纪律同向） | Conventions「Read an issue」 |
| F3 | `32165827`：去 em-dash（`—` → `;`） | **adopt** | 本仓该文件是英文逐字 fork，含 em-dash ⇒ 跟上游清掉 | 第 14 行 |
| F3 | `5b7cade4`：新增「把 issue 挂成父 issue 的 sub-issue」小节 | **not-ported** | 本仓**没有** wayfinder，也没有父子 issue 流程 ⇒ 写进去是本仓用不上的噪声 | — |
| F3 | `e0efb6e7`：external PRs 列表改用 `gh api` REST 端点 | **not-ported** | 本仓明确「PRs as a request surface: no」，PR 不进同一套 triage 流程 ⇒ 该改法无适用场景 | — |
| F3 | `8e67db21` / `9e2abf86` / `c07714b5`：wayfinder 措辞收紧、Blocking 段重写 | **not-ported** | 同上：本仓无 wayfinder 节 | — |
| F4 `domain.md` | `d80fa0f4`（作者日期 2026-08-15、**提交日期 09-17**）：领域文档约定改名 `CONTEXT.md`→`GLOSSARY.md`、`CONTEXT-MAP.md`→`GLOSSARY-MAP.md` | **adopt（已落地）** | 本仓已在 ADR-0224 那轮跟上：`docs/agents/domain.md` 与根 `GLOSSARY-MAP.md` 都已是新名口径 | `docs/agents/domain.md` 首段 |
| F4 | `32165827`：去 em-dash | **not-ported（不适用）** | 本仓该文件是**中文本地化版**，不含 em-dash（中文的「——」是全角破折号，不在该清理范围） | — |

> **裁决口径与 F1 的一致**：判据只有一个——**本仓有没有对应物 / 这条在本仓成不成立**。
> F2/F3/F4 的基线已上移到上游各自路径的**最新**提交，闸对它们只做漂移检测（`adapted` 形态）。

## 机检的边界（哪些保证得住，哪些保证不住）

这套机制保证得住的：

| 保证 | 靠哪条规则 | 在 CI 里吗 |
| --- | --- | --- |
| 上游自基线起又动了 | 闸的漂移检测 | ✗（联网，手动位） |
| 裁决表与 skill 文件**双向自洽**（标记 ↔ 行） | 规则 1、2 | ✓ |
| 「删掉一整段上游块」不能被白名单洗白 | 规则 6 | ✓ |
| 本仓独占块（overlay）**没被清空成空壳** | 规则 7 | ✓ |
| 上游有、本仓没有的块**都被登记过** | 规则 3 | ✗（仅联网侧） |
| 本仓独占块**都登记过** | 规则 4 | ✗（仅联网侧） |
| 标记语法只以真标记出现（不被内联引用伪装） | 计数核对 | ✓ |

**保证不住的（诚实登记，别当成有防线）**：

- **块内「每一处差异」都登记过**——规则 5 只是「这个块被登记过」，**不是**「这处差异登记过」。
  实测反事实：把某个**已带标记**的块正文整段静默改写 ⇒ 闸 **exit 0**、CI 测试 **全绿**。
  **逐处登记目前靠人的纪律。**
- **本仓独占块（overlay）的正文内容不被静默改写**——规则 7 挡「正文被清空」，**不挡**「改一半不留痕」。
  本仓自有内容的变更靠本仓自己的 review 流程管。
- **frontmatter 的内容**——YAML 放不了标记，它只靠裁决表登记。
- **上游漂移本身**——联网闸没有任何注册触发点，只挂在发布前手动位；**没人记得手跑 = 上游漂移零信号**。

## 上游原文取数

```bash
# 取上游某个版本的文件正文
gh api "repos/mattpocock/skills/contents/skills/engineering/code-review/SKILL.md?ref=<sha>" \
  --jq '.content' | tr -d '\n' | base64 -d
# 看该路径自基线以来的 commit（与机械闸同口径：文件级路径）
gh api "repos/mattpocock/skills/commits?path=skills/engineering/code-review/SKILL.md&per_page=100" \
  --jq '.[]|"\(.sha[0:8]) \(.commit.author.date[0:10]) \(.commit.message|split("\n")[0])"'
```

## 机械闸

```bash
pnpm run check:code-review-upstream
```

它做两件事，任一不通过即非零退出：

1. **上游漂移**：对清单里每一个文件，查上游自该文件记录的基线 commit 起是否还有动过它的 commit；
   有则列出未裁决项并以退出码 1 结束。
2. **三方一致性**：拉上游 `base-commit` 的正文，与本仓 `SKILL.md` 按锚点做块级比对 ——

   - 上游有、本仓无的段落 ⇒ 必须在本表有 `not-ported` 行指名它；
   - 本仓有、上游无的段落 ⇒ 必须在本表有 `local-only` 行，且该块**正文不得为空**；
   - 双方都有的段落，若内容不同 ⇒ 本仓块内必须有 override 标记，且标记在表里有行；
   - 表里每行 `adopt` / `adapt` / `local-only` ⇒ 本仓文件里必须有对应标记；
   - 表里每行「本仓落点」为 `—` 的 ⇒ 本仓文件里必须**没有**对应标记（那些行说的是「上游有而本仓
     刻意不搬的东西」，本仓没有落点）；
   - `not-ported` 行指名的块若在本地仍然存在 ⇒ 红（白名单不能用来给「删掉上游块」洗白）。

**退出码三态可分**：`0` 上游没动且三方一致 · `1` 上游动了或三方不一致 · `2` **查不了**
（缺工具 / 联网失败 / 基线悬空 / 文档解析失败）。「查不了」永远不是「没漂移」。

**它不进默认门禁**，理由与发布门禁必须离线一致：它要联网，而 PR 门禁必须是离线的。它挂在发布前
的手动检查位；仓内的离线部分由 `packages/app-lynx/tests/codeReviewUpstreamSync.test.ts` 守着
（标记 ↔ 裁决表 双向一致、锚点合法、基线齐全）。

改了上游基线记得同步更新本文件的 `base-commit` 与 `last-synced`。

## 遗留与后续

- ~~**另三个上游派生文件尚未纳入机械闸**~~ → **2026-10-20 已处理**：F2 / F3 / F4 三条已逐个复核上游
  改动、逐条裁定（见上「文件级裁决」表），本仓内容已跟上，基线已上移到上游各自路径的最新提交，
  三行已纳入本表（`adapted` 形态 ⇒ 只做漂移检测）。**闸对它们不再零信号。**
- **上游 `docs/agents/triage-labels.md` 不是本仓文件的祖先**：本仓 `docs/agents/*.md` 来自 setup skill
  的**种子模板**（`skills/engineering/setup-matt-pocock-skills/`），不是上游仓自己的 `docs/agents/`
  产物（后者是 setup 在上游自己仓里跑出来的）。核上游漂移时要核对**种子模板**那条路径——本表 F2/F3/F4
  的「上游路径」列写的正是种子模板路径。
- **联网闸仍无自动触发点**：它要联网，PR 门禁必须离线 ⇒ 只挂在发版清单第 7 条（人工跑）。
  **没人记得手跑 = 上游漂移零信号**——这是本机制当前最大的已知缺口。
  **2026-10-20 决定：维持人工触发**（不加定时任务 / push-only CI）——联网闸的产出是「该裁哪几条」，
  需要人裁决，自动触发只能提醒；缺口写在明处，不假装闭环。
