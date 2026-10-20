# ADR-0224：领域文档约定对齐上游——`CONTEXT.md` / `CONTEXT-MAP.md` 改名为 `GLOSSARY.md` / `GLOSSARY-MAP.md`

- **状态**：已接受（Accepted，2026-10-20）｜**已实施**（本轮落地）
- **日期**：2026-10-20
- **相关**：[ADR-0203（WebView 客户端源码删除，词汇搬入 app-lynx 的先例）](./ADR-0203-webview-client-source-removal.md)、[spec: webview-client-knowledge-migration（悬空引用「登记而不全修」的先例）](../specs/webview-client-knowledge-migration.md)
- **术语文档**：`packages/app-lynx/GLOSSARY.md`、`packages/android-host/GLOSSARY.md`、根 `GLOSSARY-MAP.md`
- **证据**：上游提交 `006a52be23` / `d80fa0f4`（§5.1）｜本机已装 skill 检索（§5.2）｜仓内引用面统计（§5.3）

---

## 1. 背景

本仓的领域文档（词汇层）此前用 `CONTEXT.md` / `CONTEXT-MAP.md` 命名，来源是上游 `mattpocock/skills` 的 setup skill **一次性写下的脚手架产物**（仓内 `docs/agents/domain.md`，已本地化改写为中文 + 本仓目录结构）。

上游已于 **2026-08-15** 翻转了「**消费仓**领域文档」的读取约定，**两次提交相隔 4 分钟**：

| 提交 | 时间 | 实际做了什么 |
| --- | --- | --- |
| `006a52be23` | 20:14 | 只把 skills 仓**自己**的词汇表改名。commit message 明写：*"This is the skills repo's own domain glossary, **not the CONTEXT.md convention that skills like domain-modeling and grill-with-docs read and write in consumer repos — that convention is left untouched**."* |
| `d80fa0f4` | 20:18 | **真正翻转**：repoint 了 **9 个 skill**（`domain-modeling` / `improve-codebase-architecture` / `setup-matt-pocock-skills` / `triage` / `tdd` / `diagnosing-bugs` / `ask-matt` / `codebase-design` / `wait-what`，含各自格式文件）+ **11 个文档页**（其中 `grill-with-docs` / `grill-me` / `grilling` **三页无独立 SKILL.md**，只是文档页）+ `.agents/` notes + README，并把 `CONTEXT-FORMAT.md` 改名为 `GLOSSARY-FORMAT.md` |

⚠️ **只看 `006a52be23` 会得出完全相反的结论**——它明说消费仓约定「left untouched」。判据是**那条 repoint 了 skill 读取路径的提交**（`d80fa0f4`），不是 skills 仓自己词汇表的改名。

本机 `~/.agents/skills/`（2026-10-08 安装）已是新约定：**16 个文件提到 `GLOSSARY`**，只剩 `_shared/grill-to-retro.md` 一处混用旧名（该行本身自相矛盾：`CONTEXT.md (or GLOSSARY-MAP.md → the CONTEXT.md it points at)`）。

**不改会怎样**（这是本 ADR 的动因）：

1. **词汇对一批 skill 隐形（已在发生）**：`tdd` / `triage` / `wait-what` / `ask-matt` / `diagnosing-bugs` / `improve-codebase-architecture` / `domain-modeling` / `setup-matt-pocock-skills` / `codebase-design` / `pr` / `teach` / `writing-great-skills` 等 **12 个本地 skill 文件**按 `GLOSSARY.md` 找/写词条（另有 3 份格式规范文件：`domain-modeling/GLOSSARY-FORMAT.md`、`teach/GLOSSARY-FORMAT.md`、`teach/LEARNING-RECORD-FORMAT.md`），而 skill 明文要求「文件不存在就**静默继续**、不要标记缺失」⇒ 本仓 **872 行**词汇（app-lynx 805 + android-host 67；根 `CONTEXT-MAP.md` 26 行是地图、从不参与 skill 查找）对这些 skill **完全不可见，且无任何报错**。
2. **分叉（下一个 `/domain-modeling` 即触发）**：该 skill 的规则是「没有 `GLOSSARY.md` 就**在第一个术语落定时新建**」⇒ 下一次 grill / domain-modeling 会在根目录另建一份 `GLOSSARY.md`，与现有 `CONTEXT.md` 分叉成两份词汇源。
3. **仓内指引与已装 skill 行为互相矛盾**：仓内 `docs/agents/domain.md` 仍指向 `CONTEXT-MAP.md`，而 skill 实际找 `GLOSSARY-MAP.md`；重跑 setup skill 也会把该文件改写成上游口径，与本地化版本冲突。

## 2. 决策

### 2.1 改名：三个领域文档 `git mv`，内容一字不改

| 旧名 | 新名 |
| --- | --- |
| `CONTEXT-MAP.md`（根，26 行） | `GLOSSARY-MAP.md` |
| `packages/app-lynx/CONTEXT.md`（805 行） | `packages/app-lynx/GLOSSARY.md` |
| `packages/android-host/CONTEXT.md`（67 行） | `packages/android-host/GLOSSARY.md` |

形态与上游多上下文约定一致（根 `GLOSSARY-MAP.md` + 每上下文 `GLOSSARY.md`）。**这是改名，不是重写**——`git` 记为 rename，历史可追；**词汇条目本身一字未动**。实际改动只有三类：① H1 措辞（`# Pictelio app-lynx 上下文` → `# Pictelio app-lynx 术语表`）② 首段并入一行改名留痕括注（**零行位移**，理由见 §2.2）③ 一处跨包活指针（`packages/android-host/CONTEXT.md` → `GLOSSARY.md`）+ 地图的表头与使用规则措辞。顺带对齐上游 `GLOSSARY-FORMAT.md` 的结构要求：H1 = 上下文名、术语带 `_Avoid_`、按主题分组——本仓原文件本已符合。

### 2.2 分档处理引用：**活指针改、快照不动、歧义不动**

| 档 | 判据 | 处置 | 数量（基线 = 改名前的 HEAD） |
| --- | --- | --- | --- |
| 活指针（完整路径，指向本次改名的文件） | 该文件今天仍存在，读者按指针要能走到 | **改** | 全仓 164 处 → ADR + spec **112 处**（分布在 75 个含指针文件；该区域共改动 76 个文件）全改；入口/源码/脚本 **19 处**（分布在 9 个含指针文件；该区共改动 26 个文件）全改 |
| 裸写 · 判读后确认指向本次改名文件 | 逐条读上下文可判（如「术语见 `CONTEXT.md`「作品标识」节」指的是**本包**词汇表） | **改** | 40 处（19 个文件） |
| 裸写 · 指向已删 app 包文档 / 历史事实 | 指 `packages/app/CONTEXT.md`（随 ADR-0203 删除）或作历史叙述——机械替换会**改错历史** | **不动** | 剩余 78 处（occurrence，不含本 ADR 自身；基线 112） |
| 快照（`docs/research/**`、`research/**`） | 某时刻的研究记录，改了就不是快照（上游自己也把 CHANGELOG 与旧 changeset 留作历史） | **不动** | 33 处旧名完整路径，**0 个文件改动** |
| 已删文件的历史引用（`packages/app/CONTEXT.md`） | 该文件随 ADR-0203 删除，引用是历史事实本身 | **不动** | 54 处 |

计数口径（可复现，见 §5.3 命令）：均为**出现次数**（occurrence），非行数。

> ⚠️ **裸写档原为「整体不动」，后按 Spec 轴审计拆为两档**：实测发现其中 40 处经逐条判读**确指本次改名的文件**（如源码注释「术语见 `CONTEXT.md`「作品标识」节」指的是本包词汇表），已改；剩下的才是指向已删 app 包文档的历史指代，保持原样。**拆分是为了让「声明—实现」对齐**（原表述会让读者以为裸写一律保留）。

**改名留痕兜底**：改名留痕**不新增任何行**——它并入两个词汇文档与地图的**首段描述**（单行内加括注），`GLOSSARY-MAP.md` 文末另起一节「改名留痕」声明两条规则。**为什么不用顶部独立块**：顶部块会整体下移行号，令 `docs/specs/webview-client-knowledge-migration.md` 登记表里指向 `packages/app-lynx/GLOSSARY.md:28 / :47 / :260 / :263` 与 `GLOSSARY-MAP.md:7` 的**行号锚点**失准（这些锚点原本指向正确词条）⇒ 零行位移是更小的改动面。留痕内容：`GLOSSARY-MAP.md` 声明「**历史文档中的 `CONTEXT.md` / `CONTEXT-MAP.md` 指的就是这同一批文件**」⇒ 旧文档里的指针虽不逐字更新，但不会被读成「文件不存在」；词汇文档首段注明「`packages/app/CONTEXT.md` 属已随 ADR-0203 删除的历史引用，保留原名」。

### 2.3 门禁必须与改名**同批**改

`packages/app-lynx/tests/captureScriptInvariants.test.ts` 有一条断言：被治理文件的文件头必须**显式引用**词汇文档的「剥注释例外」条目（`packages/app-lynx/GLOSSARY.md`「源级守卫（source-level guard）」节）。被治理文件是 `packages/app-lynx/scripts/capture-md3-matrix.sh`（其文件头引用该例外出处）。

二者（脚本头 + 测试正则）**必须同批改**，否则门禁立即转红——这正是本仓「门禁锁约定」的价值：改名不是纯文案替换，它有牙齿。

**顺带把断言收紧**：原正则 `/CONTEXT\.md/` 未尾锚定，`CONTEXT.mdx` 这类换皮也能蒙混通过（改名前既有宽松，非本轮引入）。本轮随改名一并改为 `/packages\/app-lynx\/GLOSSARY\.md\b/`——**钉住完整路径 + 词边界**，两种换皮（`GLOSSARYX.md` / `GLOSSARY.mdx`）都必转红（实测见 §5.4）。

## 3. 不做什么（防止制造新的分叉源）

- **不留 stub / alias / 软链**：上游自己在 consumer 仓也没留；留了就会让「哪个是真源」重新含糊。
- **不删 `packages/app/CONTEXT.md` 的历史引用**：那是已删文件的历史事实，删引用等于改写历史。
- **不改 research 快照**：改了就不是快照（§2.2 已定档）。
- **不动裸写引用**：避免把「app 包词汇文档」的历史指代机械改成「app-lynx 词汇文档」——那是**改错历史**。

## 4. 后果

**消除的风险**：§1 的三条（词汇隐形 / 即将分叉 / 仓内指引与 skill 行为矛盾）一次性消解；仓内 `docs/agents/domain.md` 现在与上游 setup 模板口径一致，重跑 setup 不会打翻。

**新增的代价**：仓内出现「同一批文件的新旧两套名字」并存的历史层——旧名只存在于历史文档与歧义引用中，靠改名留痕说明串联。

**遗留（明确记录，不假装清零）**：

- **剩余裸写 `CONTEXT.md` 78 处**（occurrence 口径，**不含本 ADR 自身**；基线 112 处，本轮判读后改掉 40 处）仍指旧名——其中多数指**已随 ADR-0203 删除**的 app 包文档（`packages/app/CONTEXT.md`），属历史事实；
- **research 快照 33 处**旧名完整路径按「快照逐字」保留（**0 个文件改动**）；
- 本机 `~/.agents/skills/_shared/grill-to-retro.md` 的上游混用残留（**上游自身的问题**，不在本仓范围内；本仓未 vendored 该文件）。

> 复算命令见 §5.3；口径统一为 **occurrence**（research 档 33 处落在 30 行上，3 行各含 2 处）。

**门禁联动面**：`docs/adr/README.md` 由 `scripts/generate-adr-index.mjs` 确定性生成，**勿手改**；本 ADR 落地后需重跑该脚本。

## 5. 证据

### 5.1 上游提交

```
gh api repos/mattpocock/skills/commits/d80fa0f4 \
  --jq '.commit.message, (.files[] | "\(.status) \(.previous_filename // "-") -> \(.filename)")'
```

关键行：commit message 首行 `rename CONTEXT.md/CONTEXT-MAP.md convention to GLOSSARY.md/GLOSSARY-MAP.md`；文件清单含 `renamed skills/engineering/domain-modeling/CONTEXT-FORMAT.md -> .../GLOSSARY-FORMAT.md`，以及 `domain-modeling` / `tdd` / `triage` / `wait-what` / `ask-matt` / `setup-matt-pocock-skills` 等 skill 与 `skills/engineering/setup-matt-pocock-skills/domain.md`（**脚手架模板本体**）的修改。

### 5.2 本机已装 skill

```
grep -rl "GLOSSARY" ~/.agents/skills/ | wc -l   # 16
grep -rl "CONTEXT\.md\|CONTEXT-MAP" ~/.agents/skills/ | wc -l   # 1（_shared/grill-to-retro.md）
```

16 = **12 个按 `GLOSSARY.md` 找/写词条的 skill 文件** + **3 份格式规范**（`domain-modeling/GLOSSARY-FORMAT.md`、`teach/GLOSSARY-FORMAT.md`、`teach/LEARNING-RECORD-FORMAT.md`）+ 1 个仅提到词条的 `writing-great-skills`。

### 5.3 仓内引用面（**基线 = 改名前的 HEAD**，occurrence 口径，命令可复现）

```bash
# 歧义裸写（全仓）
git grep -oP '(?<![A-Za-z0-9_/-])CONTEXT\.md' HEAD -- . | wc -l                    # 112
# 完整路径活指针（全仓 / 分档）
git grep -oP 'packages/(app-lynx|android-host)/CONTEXT\.md|(?<![A-Za-z0-9_/-])CONTEXT-MAP\.md' HEAD -- . | wc -l   # 164
git grep -oP 'packages/(app-lynx|android-host)/CONTEXT\.md|(?<![A-Za-z0-9_/-])CONTEXT-MAP\.md' HEAD -- docs/adr docs/specs packages/app-lynx/docs/specs | wc -l   # 112
git grep -oP 'packages/(app-lynx|android-host)/CONTEXT\.md|(?<![A-Za-z0-9_/-])CONTEXT-MAP\.md' HEAD -- docs/research research | wc -l   # 33
# 已删文件的历史引用
git grep -o 'packages/app/CONTEXT\.md' HEAD -- . | wc -l                           # 54
```

| 类别 | 基线（HEAD） | 本轮处置 |
| --- | --- | --- |
| 完整路径活指针 | 164 处 | ADR+spec 112 处全改（分布在 75 个含指针文件；该区域共改动 76 个文件）；入口/源码/脚本 19 处全改（分布在 9 个含指针文件；该区共改动 26 个文件）；research 33 处保留（**0 文件改动**） |
| 裸写 `CONTEXT.md` | 112 处 | 判读后改掉 40 处（19 个文件）；**剩余 78 处**保留（occurrence，不含本 ADR 自身） |
| `packages/app/CONTEXT.md` 历史引用 | 54 处 | 不动 |

剩余量的复算（post-change）：

```bash
git grep -oP '(?<![A-Za-z0-9_/-])CONTEXT\.md' -- . ':!docs/adr/ADR-0224-domain-doc-rename-to-glossary.md' | wc -l   # 78
git grep -oP 'packages/(app-lynx|android-host)/CONTEXT\.md|(?<![A-Za-z0-9_/-])CONTEXT-MAP\.md' -- docs/research research | wc -l   # 33
```

> ⚠️ 计数口径必须写明是 **occurrence 而非行数**：research 档 33 处落在 30 行上（3 行各含 2 处）——口径不同会得出不同的数，故此处以命令为准。

### 5.4 门禁变异验证

改名后必须证明新门禁**有牙齿**：把 `packages/app-lynx/scripts/capture-md3-matrix.sh` 文件头里的 `GLOSSARY.md` 换成别的名字 ⇒ `captureScriptInvariants.test.ts` 必转红；换回 ⇒ 转绿。**只跑绿灯证明不了任何事**（详见 §2.3）。

断言正则本轮同时收紧为 `/packages\/app-lynx\/GLOSSARY\.md\b/`（§2.3），故变异验证要覆盖**两种换皮**——只验一种，等于给门禁留了一条蒙混过关的路。

实测（2026-10-20）：

| 步骤 | 变异 | 结果 |
| --- | --- | --- |
| 基线（改名后原样） | — | `tests/captureScriptInvariants.test.ts` **35/35 绿** |
| 变异 A（换名） | 文件头 → `packages/app-lynx/GLOSSARYX.md` | **1 failed / 34 passed**，红在「被治理文件显式引用 GLOSSARY.md 的剥注释例外」 |
| 变异 B（**旧正则会被蒙混通过**的换皮） | 文件头 → `packages/app-lynx/GLOSSARY.mdx` | **1 failed / 34 passed**（收紧前该变体**不转红**） |
| 还原 | — | **35/35 绿** |

> ⚠️ 门禁全量跑（`test:all`）另有一项**与本次改名无依赖关系**的既有失败：
> `tests/helpers/attemptLadder.test.ts` 的「反事实」用例本地必红——它断言子 vitest 进程的**控制台输出**含指定文本，而本地该输出未被转发（`status === 0` 通过、输出里没有那句）。
> 已在**未含本轮任何改动**的纯净 HEAD 树上复现同样结果（`git archive HEAD` 抽到临时目录跑，单跑亦红），且同一 commit 在 CI 上该文件 **✓ 3 tests 全绿**（run 39354849067）⇒ 属**环境耦合的既有失败**，建议另行开票跟踪。
