---
name: code-review
description: 审查 git diff（固定点到 HEAD）的双轴 code review（Standards + Spec），带两个阻塞级强制审计（调用点完备性 + 期望值溯源）与触发式维度卡点。Spec 轴强制「翻转/接口变更的调用点完备性审计」（blast radius review）和测试「期望值溯源」（Oracle check），对抗两类 AI 评审缺陷：漏迁移调用点、测试迎合实现；并配共享强制机制（brief 注入 / 证据要求 / 声称成功无效）对抗模型跳过。Pictelio 仓库版：审计一机器证据通道为 CodeGraph，审计二锚 AGENTS.md 测试硬约束 #1-6（Oracle check / Test strength，调研依据 docs/research/ai-generated-test-quality.md）。项目级 skill，按加载优先级遮蔽全局同名 skill。
---

# Code Review（Pictelio 统一双审计版 · 翻转完备性审计 + Oracle check）

对 `git diff <fixed-point>...HEAD`（three-dot，基于 merge-base）的双轴审查：**Standards**（是否符合仓库文档化的编码规范）与 **Spec**（是否忠实实现源起 issue/PRD/spec）。两条轴作为**并行 sub-agent** 运行，互不污染上下文，最后汇总。

## 为什么存在这个版本

三个来源，缺一不可：

1. **翻转/接口变更类改动的完整性无法从 diff 证明**（blast radius 原则）。评审对象是 diff，但这类改动的风险恰恰在「应该改却没来改的调用点」——缺席的文件不进 diff，逐行评审永远看不到。结构性后果：默认行为翻转（开关默认态反转、转义/渲染策略翻转）漏掉一个消费方，线上表现为静默错误；接口收窄/签名变化漏改一个调用点，类型检查拦不住运行时行为偏差。审计一只靠人肉逐行无法完备，必须配机器证据（见审计一）。
2. **AI 生成测试会迎合实现**（Oracle 缺陷）。"测试全绿"不证明"测试正确"——期望值从实现反推、同义反复断言、自洽 mock，都让测试成为实现的镜子。审阅必须对照独立来源（spec/真实样例/字面量/不变量/差分），而非被检对象自身。调研依据：`docs/research/ai-generated-test-quality.md`、`docs/research/deepseek-harness-agents-analysis.md`；决策记录：ADR-0097。
3. **AI 执行会跳过或假装完成**。措辞是弱强制；强制机制（brief 注入、证据要求、"声称成功无效"）和机器防线（门禁脚本、代码索引工具）才是硬强制。

## 流程

1. **Pin fixed point**：用户给定 commit/branch/tag/`main`/`HEAD~N`；确认 `git rev-parse` 可解析、diff 非空。记录 diff 命令与 commit 列表。bad ref 或空 diff 在此失败，不进入 sub-agent。
2. **Identify spec source**：按序——commit message 的 issue 引用（`#123` 等，经 `docs/agents/issue-tracker.md` 流程获取）→ 用户传入路径 → `docs/`、`specs/`、`.scratch/` 下与分支/功能匹配的 spec 文件 → 询问用户。无 spec 则 Spec 轴跳过并注明 "no spec available"。
3. **Identify standards sources**：发现式——`AGENTS.md`（含测试硬约束 #1-6、Fluent 设计规范、即时导航硬约束）、`packages/app/tests/TESTING.md`、`CONTEXT.md`、`CONTRIBUTING.md`、`docs/adr/`、`docs/development/`、README，存在即用。之上始终叠加下方 Fowler smell baseline。
4. **并行 spawn 两个 sub-agent**（general-purpose）：Standards 轴与 Spec 轴，上下文互不污染。Spec sub-agent 的 brief **必须**逐字包含下方「Spec 轴强制增量」全部指令原文（brief 注入），不得改写、缩写或"酌情执行"。
5. **汇总**：两轴报告分列 `## Standards` / `## Spec`，不合并不重排。结尾一行总结每轴 finding 数与最严重项；不跨轴选 winner。

## Spec 轴强制增量（阻塞项）：双审计 + 共享强制机制

### 共享强制机制（双审计都必须执行）

- **必须+禁止配对**：指令以「必须…/禁止…」成对书写，不留灰色地带。
- **brief 注入**：Spec sub-agent 的 brief **必须**逐字包含审计一、审计二全部指令原文——强制指令穿透到 sub-agent。
- **证据要求 + 声称成功无效**：声称完成了枚举/溯源但拿不出证据（grep 命令、索引工具查询结果、未截断计数）＝无效，视为未执行。**不信任 agent 的自述**。
- **characterization 识别**：期望值只是"当前行为"锁定（快照、从实现输出抄写）而无规格依据的测试，是 characterization（防回归）而非 specification（防错误）——不能作为"实现正确"的证据，必须标出。
- **心智判据**：每个审计配一个可证伪检验（见下），用反事实回答"这样审会不会漏"。

### 审计一 · 调用点完备性（blast radius）

**触发信号**（命中任一即触发审计）：

- **默认行为翻转**：默认值改动、开关默认状态反转、转义/渲染策略翻转
- **接口删除或收窄**：export 删除、函数改名、函数签名变化
- **参数语义反转或 optional → required**：参数含义反转、新增必填参数、可选变必选
- **输出契约变化**：渲染结果、序列化格式、返回结构的变化（影响所有消费方）
- **错误模型变化**：错误码、异常类型、失败语义变化（调用方的错误处理可能失效）
- **顺序/排序假设变化**：返回列表默认排序、遍历顺序、事件触发顺序变化
- **配置语义变化**：调用方需改配置或假设才能保持行为的一切变化

**审计要求**：

- **必须**自行枚举该接口的**全部调用点**，两个证据通道**都要**：
  ① 代码索引工具（本仓库可用 CodeGraph：`codegraph explore "<符号名>"` 一次返回符号源码 + 调用路径 + blast radius（含关联测试）；pi agent 用原生 `codegraph_explore` 工具，sub-agent 用 bash `codegraph` CLI——两者输出逐字等价）；
  ② 全仓 grep，**必须覆盖间接层**：变量传参、三元分支、字符串拼接、转发封装。
- 逐一标注：`已迁移` / `不受影响（说明理由）` / `遗漏`。`遗漏` = **阻塞 finding**，引用具体文件与行号。
- **禁止**以「diff 中未出现其他调用点」作为无遗漏证据——完整性无法从 diff 证明。
- **机器证据规范**：索引工具结果必须核对**完整性**——explore 输出是否覆盖全部调用路径、是否被截断；任何截断必须显式扩大范围重查（拆细符号、收窄到文件），**不得把截断集当作完备性证据**。全仓 grep 必须出示**未截断的计数或完整清单**。
- **防线判定（阻塞）**：该翻转是否配有机器防线（dev 运行时守卫 / 全仓断言测试 / lint 规则 / pre-push 门禁，任一即可）？**无机器防线 = 审计不完备 = 阻塞 finding**（锚 ADR-0097 治理记录）。本仓库既有防线可作判据：pre-push 双门禁（`check-e2e-anchors`、`verify-agent-skills`）、T0 机械门禁（`passWithNoTests`、`expect-expect`）、测试硬约束 #4。
- **心智判据**：把 diff 当作「唯一被改的文件集」是否成立？成立 = 完备；不成立 = 找出缺失文件。再反问一次：**值流呢？** 结构图（调用/导入边）证明不了"什么值流进了什么参数"——三元分支/变量间接传参必须人工过一遍，不能只信图。

### 审计二 · 期望值溯源（Oracle check）

**触发信号**：diff 含新增或修改的测试。

**审计要求**：

- **必须**逐条判定每个断言期望值的来源，仅以下来源合法：
  - **规格/需求原文**（引用 spec 行号或 ticket 验收条件）
  - **可执行验收样例**（ticket 附的输入 → 期望输出样例）
  - **真实数据/字面量**（真实响应快照、插件源码常量、线上文件——测试硬约束 #2 的 backupRulesConsistency.test.ts 模式）
  - **性质/不变量**（property-based：幂等、round-trip、守恒）
  - **独立实现/差分测试**（双实现互为 oracle，如 app 与 app-lynx 同语义模块：R18 过滤、URL 重写、错误分类）
- 以下来源 = **嫌疑，必须标出**（文件 + 测试名 + 来源类型）：
  - 从被测实现反推（先看实现再写期望值）
  - 自洽 mock 字段（手写、与实现共享同一错误假设）
  - 同义反复断言（`expect(add(a,b)).toBe(a+b)` 式）
- **禁止**用「测试对着实现是绿的」作为测试正确性证据。
- **心智判据**：把实现改成"显然错误但符合该测试断言"的版本，测试会红吗？不会 = conformance 嫌疑。
- **Test strength**：每个测试必须能说清它防的 **intended regression**（目标回归）；断言必须验证**可观察行为**（事件流、存储、日志、输出），**禁止** restate implementation；说不出的 = 嫌疑。

## 触发式维度卡点（命中才强制；tooling 已强制的不报）

| 维度 | 触发信号 | 必查项 |
|---|---|---|
| 安全与隐私 | 认证/授权/用户数据/密钥/HTML 渲染/外部输入 | 注入面、`innerHTML`/小说正文渲染用途、敏感数据日志泄漏、密钥硬编码 |
| 错误处理/日志 | IO 边界、降级路径、失败路径 | 成功/失败双路径都处理；失败有 warn 或显式错误状态；不留静默失败（测试硬约束 #3） |
| 并发/竞态 | 并行代码、定时器、共享状态、异步互斥 | 竞态/死锁只能人审：仔细读并发逻辑，跑不出来 |
| 性能 | 热路径、循环、查询、大列表渲染 | 明显低效：循环内请求、无必要重复计算、大对象重复构建 |
| 依赖 | 新增/替换依赖 | 新依赖是否必要、是否多余、来源可信 |
| 文档同步 | 改变构建/测试/使用/发布方式 | README/AGENTS.md/TESTING.md 相关文档同步更新 |
| UI/用户可见变更 | 用户可见行为变化 | 只读代码看不出体验：要求验证（demo/截图）或仔细推理；对照 E2E 锚点机制 |
| 数据迁移 | schema/数据变更、backfill、枚举转换 | 迁移当运维审：只跑一次、对生产数据、不可回滚——查幂等与回滚路径 |

## Standards 轴

文档化标准（第 3 步发现的来源）+ Fowler smell baseline（_Refactoring_, ch.3）。两条绑定规则：**仓库文档化标准优先**（其认可的做法压制 baseline 的标记）；**baseline smell 永远是 judgement call**，标注「possible X」，非硬违规；**跳过 tooling 已强制项**（linter/formatter/类型检查管的不重复报）。

Smell baseline（每个读「是什么 → 怎么修」）：

- **Mysterious Name** — 名字不揭示用途 → 重命名；想不出诚实的名字说明设计模糊
- **Duplicated Code** — 同一逻辑形状出现在多处 → 提取共享形状
- **Feature Envy** — 方法对别的对象的数据比对自己的更感兴趣 → 移到它所羡慕的数据上
- **Data Clumps** — 同几个字段/参数总是一起出现 → 捆成一个类型
- **Primitive Obsession** — 原始类型/字符串顶替领域概念 → 给概念一个小类型
- **Repeated Switches** — 同一类型的 switch/if 级联重复出现 → 多态或共享 map
- **Shotgun Surgery** — 一个逻辑改动迫使 diff 里散落多文件修改 → 把一起变的收进一个模块
- **Divergent Change** — 一个文件因多个不相关原因被改 → 拆分为单一变化原因
- **Speculative Generality** — 为 spec 没有的需求加抽象/参数/钩子 → 删掉，内联回真实需求
- **Message Chains** — 调用方依赖长链导航 `a.b().c().d()` → 在第一个对象上藏住这条路径
- **Middle Man** — 类/函数大半只是转发 → 砍掉，直接调真目标
- **Refused Bequest** — 子类忽略/重写大部分继承 → 弃继承用组合

## 汇总

两轴报告分列（verbatim 或轻清理），不合并、不重排、不跨轴选 winner。每条 finding 引用 spec 行号 / 标准条款 / 文件行号。结尾一行：每轴 finding 数与最严重项。

## 仓库锚点（overlay 层）

- **审计一防线判定锚**：`docs/adr/ADR-0097-agent-skill-repo-localization.md`（治理记录：无机器防线 = 审计不完备）
- **审计二锚点**：AGENTS.md 测试硬约束 #1-6（完整清单）+ `docs/research/ai-generated-test-quality.md`（Oracle check / Test strength 原始出处）
- **机器证据工具**：CodeGraph（`.codegraph/` 已建图，`codegraph explore` 提供调用路径与 blast radius 机器证据；健康检查 `codegraph status`）；不可用时退化为全仓 grep + 显式声明证据命令

## 本仓库测试硬约束对照（核心 4 条，完整清单见 AGENTS.md「测试硬约束」#1-#6；审查测试时逐条过）

1. IO 边界成功/失败双路径都有单测？（硬约束 #1）
2. 契约 mock 来自真实样例？（硬约束 #2，backupRulesConsistency.test.ts 模式）
3. 降级路径有 warn 或显式错误状态？（硬约束 #3）
4. 期望值能指向独立来源？（本 skill Oracle check）

## 为什么双轴

一个改动可以只过一轴：符合全部规范但实现错了东西 → Standards 过、Spec 挂；忠实实现 issue 但破坏仓库约定 → Spec 过、Standards 挂。分列报告防止一轴掩盖另一轴。
