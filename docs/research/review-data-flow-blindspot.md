---
type: Research
title: Review 的数据流盲区：「承诺的输入源从未被读取」类缺陷的业界命名、工具链与对策
status: 调研事实卡 · 供 code-review skill 增强引用
date: 2026-09
tags: [code-review, configuration, silent-misconfiguration, traceability, wiring-test, feature-flags]
---

# Review 的数据流盲区：「承诺的输入源从未被读取」类缺陷

> 调研日期：2026-09-21
> 用途：支撑 Pictelio `code-review` skill 的下一步增强（审计一/审计三/触发式卡点表）。skill 现状结构见 `.agents/skills/code-review/SKILL.md`。
> 方法：一手来源优先（论文原文抽页、官方文档、作者本人文章）；每个论断附出处 URL。来源清单（§5）标注了访问方式：**直读** = 本调研直接抓取页面内容；**快照** = 经搜索结果的页面内容快照读取；**元数据** = 只读到题录/摘要级信息。未找到可靠来源的方向已在 §3.8 显式标注。
> 触发案例：lynx 夜间模式 T3/T5（ADR-0180 D7）。spec/ADR 曾承诺「splash 兜底轨覆盖手动模式（`settings_dark_mode` = dark）的下一次冷启动」；实现兜底轨只读**系统 uiMode**，全仓 Java 从未读取该设置键——**承诺的数据源从未被接线**。第一轮 review 验证了「`setSplashScreenTheme` 有版本 guard、不会崩」（机制存在性）通过；第二轮做「文档 vs 实现」对照才发现数据流断开。ADR-0180 已按「订正 + 显式挂账」处置（本文 §4 推荐纪律的现行先例）；该接线与配套机器防线随后于 **review 修复轮（2026-09-21，#692）** 落地，真机走查仍为发版 gate。

---

## 0. TL;DR（可执行结论）

1. **这个缺陷类族有学术命名：silent misconfiguration**（"参数被设置但不影响运行时行为，且不报错不抛异常"）——Yale/UIUC 的 ConfigX（OOPSLA 2021）给出定义与第一个静态检测工具。它和本案例（设置键被写、被备份、被注册，但没有任何**读点**影响 splash 行为）是同一分类。
2. **「声明方（定义/写入/注册）≠ 消费方（读取）」是判据核心**：ConfigX 要解的是「配置与代码的交互是否成立」；Android Lint `UnusedResources` 用「declaration vs reference 可达图」做同类判定；LaunchDarkly `ld-find-code-refs` 把「flag ↔ 代码引用」作为归档前置检查。**工具链的共同形态 = 找出「有定义、无读取」的符号。**
3. **语言级先例证明「声明即断言读取」可行**：TypeScript `noUnusedLocals`（"Report errors on unused local variables."）、Go/Rust 的 unused 检查——语法符号层面早已自动化，**设置键是字符串，逃过了编译器，但没逃过逻辑**。机器防线必须自建。
4. **需求→代码双向追溯是安全关键行业的法定动作**（DO-178C：**每条源码都必须能追溯到一条需求**，不可追溯的代码被当作 extraneous 处理；反面 = 每条需求承诺的数据/行为必须有落地实现）。「spec 说行为 X 由 Y 驱动 → 必须存在 Y 的读点」正是这个追溯链在普通项目的轻量版。
5. **review 实证研究解释了为什么两轮 review 才抓到**：现代 code review 的动机与产出都**不以缺陷为中心**（Bacchelli & Bird：finding defects 是首要动机，但实际产出以改进建议、知识转移为主；"code and change understanding is the key aspect"），review 的检查对象是 diff——**缺席的文件/从未被写下的读点不进 diff**。SmartBear 明确写着：omission（该有而没有）**是最难被发现的缺陷类型**，"difficult to review something that isn't there"，而 checklist 是对抗 omission 的最有效手段——这正是本次 skill 增强的形态依据。
6. **防线的正解是「读点断言」类适应度函数**：ArchUnit 把架构约束写成测试（且默认**禁止 should 子句面对空集**——防「规则静默地什么都没检查」，与本类缺陷同构）；本项目已有同形态模板（`settingsStore.test.ts` 的「键清单 ⊆ 备份域」+「备份域每项有 `applyRawKey` 分支」双 source-scan 守卫）。把「每条设置键必须有生产读点」编码成测试，是现有工具链缺口的直接补位。
7. **AI 辅助要谨慎**：ASE 2025 实证 LLM 在「代码是否符合自然语言规格」判定上存在系统性失败（误判率高，且更复杂的提示反而加剧）——LLM 适合做**读点清单生成/候选枚举**，不适合当一致性判据；判据必须是 grep/索引的机器证据。

---

## 1. 缺陷类族的命名与文献

### 1.1 学术命名：silent misconfiguration

**ConfigX**（Zhang, Piskac, Zhai, Xu，OOPSLA 2021，PACMPL Vol.5 Article 140）是本主题最直接的一手文献，原文定义：

> "it is often the case that, although some parameters are set in the configuration file, **they do not influence the system runtime behavior, thus failing to meet the user's intent**. Moreover, such misconfigurations **rarely lead to an error message or raising an exception**. We introduce the notion of **silent misconfigurations** which are prohibitively hard to identify due to (1) lack of feedback and (2) complex interactions between configurations and code."

- ConfigX 是「first tool for the detection of silent misconfigurations」：静态分析建立「配置参数 ↔ 关联代码块」映射，再分析参数之间的相互作用，并用可达性分析剔除伪规则。
- 评测：5 个真实数据集、3 个系统（Apache / vsftpd / PostgreSQL），**检出 2200+ silent misconfigurations**；并有用户研究（对论坛上真实用户报的配置问题给出检测与修复建议，被用户确认接受）。
- 出处：ACM DL https://dl.acm.org/doi/abs/10.1145/3485517 （快照）；SPLASH/OOPSLA 2021 程序页 https://2021.splashcon.org/details/splash-2021-oopsla/44/Static-Detection-of-Silent-Misconfigurations-with-Deep-Interaction-Analysis （快照，含 DOI 10.1145/3485517）；NSF PAR 记录 https://par.nsf.gov/biblio/10311545 （快照）。

**对本项目案例的映射**：`settings_dark_mode` 被写入（用户切「外观 → 深色」）、被登记进 `BACKUP_DEVICE_KEYS`、被 `applyRawKey` 处理——但 splash 兜底轨的输入源是 `Configuration.uiMode`。用户的 intent（"我设了深色，下次启动画面也该是深色"）未被满足，且**无任何报错**。这是教科书级的 silent misconfiguration。

### 1.2 相邻概念家族（用于命名与检索）

| 名称 | 含义 | 一手出处 | 与本案例的关系 |
|---|---|---|---|
| **silent misconfiguration** | 参数被设置但不影响运行时行为，且无错误反馈 | ConfigX, OOPSLA 2021（§1.1） | **最贴切的学术命名** |
| **unused definition** | 给变量赋值但该值从未被使用；作者实证其中一部分是**非平凡缺陷**（安全、数据损坏） | ValueCheck, EuroSys 2024, https://dl.acm.org/doi/abs/10.1145/3627703.3629576 （快照） | 提供「未读 = 缺陷信号（而非仅仅冗余）」的实证支持；ValueCheck 的观察：**交互边界上的 unused definition 更易是 bug** |
| **dead code / unreachable code** | 永不执行的代码；DO-178C/MISRA C 语境下是被标准明令消灭的对象 | MISRA C Rule 2.1/2.2 与 DO-178C 对照讲解（AdaCore Learn）https://learn.adacore.com/courses/SPARK_for_the_MISRA_C_Developer/chapters/08_unreachable_and_dead_code.html （快照） | 说明「未使用/不可达」在安全关键标准里是**强制关注项**；但本类缺陷的代码**是可执行的**（函数能被调用，只是没人给它喂那个值），故 dead code 工具抓不到 |
| **configuration smell** | 配置代码层面的坏味道目录（MSR 2016 提出 13 个 implementation + 11 个 design 配置坏味道，分析 4621 个 Puppet 仓库） | Sharma/Fragkoulis/Spinellis, MSR 2016, DOI 10.1145/2901739.2901761；工作稿 HTML https://www.dmst.aueb.gr/dds/pubs/conf/2016-MSR-conf-smells/html/SFS16.html （直读摘要） | 提供「配置也要被当作代码审」的谱系；本调研**未取得其 24 个 smell 的完整清单**（工作稿页只有摘要），故不对「unused key 是否在其目录内」下结论 |
| **flag-controlled dead code / dead paths** | 被 feature flag 长期钉死在一侧的代码路径 | LaunchDarkly/FlagShark 一类工程叙述（商用博客，非学术）：https://flagshark.com/blog/dead-code-detection-codebase-more-than-you-think （快照） | 反向形态：flag 有读取、另一支死；本案例是更隐蔽的「flag/键连读取都没有」 |
| **dead configuration / "knob not connected"** | 社区口语，无权威定义 | 未找到可靠一手来源（§3.8） | 检索时可用作关键词，引用时应回落到 silent misconfiguration |

### 1.3 结论：本类缺陷的精确定义（供 skill 采用）

> **未接线数据流（unwired data flow）/ silent misconfiguration**：规格或设计声明「行为 X 由数据源 Y 驱动」（Y = 设置键、配置项、feature flag、迁移后的新存储位置），但生产代码中不存在 Y 的**读取点**（或读点存在但值未流入 X 的行为），写入/注册/持久化/备份一律存在，且失败静默。

判别三分法（定义/写入/读取）：

- **已定义**（常量、类型、schema）——不是证据；
- **已写入/已注册**（set、persist、backup 域、applyRawKey 分支）——不是证据；
- **存在读取点且值流入承诺行为**——唯一证据。

---

## 2. 工具链：业界如何机器检测「有定义、无读取」

### 2.1 静态数据流分析（通用机制，且明确不限于安全）

- **CodeQL** 官方文档：数据流分析 "computes the possible values that a variable can hold at various points in a program, determining **how those values propagate through the program and where they are used**"；分 local（函数内）/global（跨函数、含对象属性）；taint tracking 为其扩展。文档明确把用途扩展到安全之外：**"you can also use data flow analysis to understand other aspects of how a program behaves, by finding, for example, uses of uninitialized variables and resource leaks."**
  - 出处：https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/ （快照）；路径查询的 sources/sinks 写法：https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries （快照）。
- **对「设置键 → 行为」的推论**：把「读设置键」建模为 source、「splash 主题解析」建模为 sink，就是一条可写的自定义路径查询。这是「把读点断言升级为数据流查询」的可行性依据（本项目未接入 CodeQL，属备选路径）。

### 2.2 声明 vs 引用：可达图判定（最接近「声明但无读取」的现成工具形态）

- **Android Lint `UnusedResources`**：官方文档描述 lint "detects resources in the `res/` folder that are not referenced from the code"，示例告警 `The resource R.layout.preferences appears to be unused [UnusedResources]`（https://developer.android.com/topic/performance/reduce-apk-size ，快照）。
- **其底层算法**（Android 工具链源码文档）："we store all the **resource declarations** and **resource references** we find in the project as we process each file, and then in the afterCheckRootProject method we analyze the resource graph and compute any **resource declarations that are not reachable in the reference graph**, and then we report each of these as unused."
  - 出处：https://android.googlesource.com/platform/tools/base/+/58c850407f4aff3158688ea3b6844e0b2aeac518/lint/docs/api-guide/basics.md.html （快照）。
- **类比价值**：资源、导出符号都能做「声明→引用可达性」检查；**字符串键（SharedPreferences key）也可以**，只是没有内建工具——这正是需要项目自建「读点断言」的原因（§4 R3）。

### 2.3 Feature flag / 设置消费扫描器（商用工具体系的现成范式）

- **LaunchDarkly Code References**：用开源工具 `ld-find-code-refs` 扫描代码库中的 flag 引用并推送回平台；官方文档要点：
  - "The code references feature makes it easy to determine which projects reference your feature flags, and **simplifies removal of technical debt**"；
  - **archive checks**（归档前置检查）使用 code reference 数据确认 flag 可被移除；
  - 代码中所有引用被移除后记录为 **extinction event**；
  - 支持 **aliases**（flag key 存在变量里、或被 SDK 包装时仍能找到间接引用）。
  - 出处：https://launchdarkly.com/docs/home/flags/code-references （快照）；flag 债治理指南：https://docs.launchdarkly.com/guides/flags/technical-debt （快照）。
  - 发布博文原文（更直白的「接线检查」表述）："With Code References, you can ensure that **you've wrapped the correct code with the appropriate flag** and identify all places a flag lives in your code when it's time to remove it."
    - 出处：https://launchdarkly-com.netlify.app/blog/launched-code-references （快照，官方博客镜像页）。
- **要点抽象（可直接迁移）**：flag 平台把「flag 有 key、但代码里 0 处引用」当成一个**可查询的状态**（alias 处理间接引用）。设置键同理：**「键在存储里、在代码里 0 读点」应当是一个可查询、可报警的状态。**

### 2.4 语言级先例：把「声明必被读取」写进类型系统/编译器

- **TypeScript `noUnusedLocals`**：官方 tsconfig 文档定义 **"Report errors on unused local variables."**（`noUnusedParameters` 同理）。
  - 出处：https://www.typescriptlang.org/tsconfig/noUnusedLocals.html （直读）。
- **含义**：在符号层面（局部变量、参数、导入、资源）「定义但从不读取」早已是自动化检查项；**配置键的字符串形态是这条防线的盲区**。项目的「读点断言」本质是把语言级检查手工补到字符串键上。

### 2.5 研究原型与缺口

- ConfigX（§1.1）是研究原型，不是可下载的通用工具链（是否开源未见一手证据）。
- 未发现任何通用工具能直接解决「Android SharedPreferences key / JS 设置键的读点检查」；**结论：该检查需要项目自建**，但形态已被上述四类工具体系充分验证（声明/引用可达、flag 引用扫描、语言级 unused 检查、数据流路径查询）。
- 本项目已存在同形态的**自建模板**（source-scan guards）：
  - `packages/app-lynx/src/stores/settingsStore.test.ts` 的两条 source-scan 守卫（**用例名即锚点，本文不引行号**——#692 实施轮实测：守卫位置随用例增长从 `:940` 漂到 `:10xx`，行号锚点在交付当天即失准）：①「`settingsStore.ts` 内所有 `*_KEY` 字面量 ⊆ `BACKUP_DEVICE_KEYS`（设备级键完整性守卫）」；②「`BACKUP_DEVICE_KEYS` 每项均有 `applyRawKey` 分支（导入侧完整性守卫）」（读源码 + 正则抽取 + 集合关系断言）。
  - 注意：这两条守卫覆盖的是「**写入/导入侧**完备性」。本类缺陷（**读取/消费侧**缺失）恰好在其盲区——守卫全绿而读点为零，与本次案例完全吻合。

### 2.6 mutation testing：能证「测试对实现敏感」，不能证「接线存在」

- Stryker 官方定义："Bugs, or mutants, are automatically inserted into your production code. Your tests are run for each mutant. If your tests fail then the mutant is killed... The higher the percentage of mutants killed, the more effective your tests are."（另有对 code coverage 的明确区分）。
  - 出处：https://stryker-mutator.io/docs/ （直读）。
- 对本类缺陷的作用：如果存在「把设置键读成常量」的变异体且测试全绿，说明**测试没覆盖该接线**——它是检测接线测试是否有效的**放大器**；但它不负责发现「读点本来就不存在」（无读点 → 变异体无从产生）。定位为辅助手段。

---

## 3. 流程与评审实践

### 3.1 需求→代码双向可追溯性（安全关键行业的法定动作）

- **DO-178C** 要求 certification artifacts 之间**双向 trace**：forward traceability 保证每条需求被实现并被测试；**backward traceability 保证每一行代码、每个测试都能被一条需求解释**（"detecting extraneous code and unnecessary tests"）；不可追溯到需求的代码在 DO-178C 术语里被当作 **extraneous**，须走「评审-分析-验证」的迭代处置；Annex A Table A-7 Objective 9 更专门要求 "Verification of additional code, that cannot be traced to Source Code, is achieved"。
  - 出处（二手转述，标准原文付费）：Jama Software《What Is DO-178C?》：https://www.jamasoftware.com/requirements-management-guide/aerospace-and-defense/do-178c/ （快照）；DO-178C 综述（含 traceability 图与 Objective 9 引文）：https://en.wikipedia.org-on-ipfs.org/wiki/DO-178C （快照，维基百科镜像页，务必按二手来源对待）。
- **迁移到普通项目**：「spec 声明 X 由 Y 驱动」= 一条需求；「Y 的读点」= 该需求的实现。**读点缺失 = 追溯链断开**，理应阻塞；缺失被发现时应「订正文档到交付现状 + 显式挂账」而非静默（ADR-0180 D7 的现行做法）。
- 代价自觉：完整 RTM（requirements traceability matrix）对普通项目过重；本文推荐的是**只对「声明驱动关系」这一类断言做追溯**（触发式，非全量）。

### 3.2 wiring test / 端到端接线验证

- **Fowler 对 integration test 的权威定义**："Integration tests determine if independently developed units of software work correctly **when they are connected to each other**"；并区分 narrow（用 test double 只测对接部分）与 broad（全通路的 system/e2e test）。
  - 出处：https://martinfowler.com/bliki/IntegrationTest.html （直读）。
- **Walking Skeleton**（Cockburn，Crystal Clear 的经典定义）"a tiny implementation of the system that performs a small end-to-end function. It need not use the final architecture, but it should **link together the main architectural components**"——「最薄的端到端通路先行」的动机之一就是**尽早暴露接线问题**（各层各自完工、集成时才发现对不上）。
  - 出处：Gojko Adzic《Forget the walking skeleton – put it on crutches》（引用 Cockburn 定义并延伸讨论）：https://gojko.net/2014/06/09/forget-the-walking-skeleton-put-it-on-crutches （快照）。
- **BDD 的可执行验收标准**（Dan North 原文）："**Acceptance criteria should be executable**"——验收标准（Given/When/Then 场景）应能被映射为可执行代码，最终成为真正的端到端功能测试。
  - 出处：https://dannorth.net/blog/introducing-bdd/ （直读）。
- **对本案例的映射**：设备可见行为「设 dark → 下次冷启动 splash 深色」是一个天然的 Given-When-Then 场景；若在 spec 阶段就把它落成可执行验收（或至少 e2e/走查锚点），缺口会在实现期即时暴露（与 §3.5 flag 双态测试同理）。

### 3.3 架构适应度函数（fitness function）——把「每条设置键必须有读点」编码成测试

- **概念**：Ford/Parsons/Kua《Building Evolutionary Architectures》（2017）提出 fitness function = 对架构特征的自动化、客观、持续验证；「governance by rule 取代 governance by inspection」，在 CI 每个提交上跑。
  - 出处：书（ISBN 记录见 §5）；二手定义汇总 https://cstopics.com/encyclopedia/software-engineering/software-architecture/architecture-documentation/architecture-fitness-functions （快照，按二手对待）。
- **可落地的工具形态（Java）**：ArchUnit 官方 User Guide（version 1.5.0）给出把架构规则写成 JUnit 测试的标准形式 `@AnalyzeClasses` + `@ArchTest`（规则即测试；JUnit 4 用 `ArchUnitRunner`，JUnit 5/6 用 TestEngine）。
  - 出处：https://www.archunit.org/userguide/html/000_Index.html （直读）。
- **一个可直接借用的设计教训——防「规则静默地什么都没检查」**：ArchUnit 默认**禁止 should 子句被空集求值**（`archRule.failOnEmptyShould`），原文理由：包名一旦改名，规则会在**不检查任何类**的情况下「通过」——"The rule will now always evaluate successfully without any reported error. **However, it actually does not check any classes at all anymore.**"
  - 同构风险：读点断言若写成「所有键都有读点」，而键集合抽取正则失效（抽到空集），断言语义上恒真。**任何「全称量词」守卫都必须断言集合非空、且数量下界**（本项目模板已含此意：`expect(declared.length).toBeGreaterThan(10)`）。
- **本项目形态**：Vitest 内做 source-scan + 集合断言（`settingsStore.test.ts` 的键完整性双守卫），等价于「设置域适应度函数」；可扩展为「读点断言」（§4 R3）。

### 3.4 code review 实证：为什么系统性漏掉设计/数据流级缺陷

- **Bacchelli & Bird（ICSE 2013，"Expectations, Outcomes, and Challenges of Modern Code Review"，Microsoft）**：finding defects 仍是**首要动机**，但 "reviews are less about defects than expected"，实际收益更多是 knowledge transfer、团队感知、替代方案；**"code and change understanding is the key aspect of code reviewing"**，而开发者的理解手段大多不被工具支持（本文结论：由于 review 靠「理解变更」驱动，**理解不到的维度（不在 diff 里的缺失）系统性失守**）。
  - 出处：DOI 10.1109/ICSE.2013.6606617；TU Delft 记录/摘要 https://repository.tudelft.nl/record/uuid:d629803b-bbec-4593-a7f2-6f4b2266ff5a （快照）。
- **MacLeod et al.（IEEE Software 2018，"Code Reviewing in the Trenches"，Microsoft，4300 人问卷）**：把真实工业环境中的 review 挑战与最佳实践做了汇总（作者/评审者面临的语境、大变更、期望偏差等），面向从业者给出可采纳实践清单。
  - 出处：https://www.computer.org/10.1109/MS.2017.265100500 （快照，摘要级）。
- **Sadowski et al.（ICSE-SEIP 2018，Google，900 万次 change 分析）**：**finding bugs 重要，但更重要的是 normative/educational effects**（一致性、知识扩散、护栏）；Google 的实践包含**评审前已接入的静态分析生态（Tricorder，110+ analyzers）**与自动化的 reviewer 推荐——即「把机械检查从人眼前移走，让人专注逻辑与知识传递」。
  - 出处：DOI 10.1145/3183519.3183525；论文笔记页（含上述结论条目）https://alastairreid.github.io/RelatedWork/papers/sadowski:icse-seip:2018/ （快照）。
- **SmartBear（Cisco 研究 + 工程总结）**——**本类缺陷「为什么难」的一手表述**：
  - "**Omissions in particular are the hardest defects to find because it's difficult to review something that isn't there.** Checklists are the most effective way to eliminate frequently made errors and to combat the challenges of omission finding."
  - 同页还给出 Cisco 研究的其它量化结论（如单次 review 200–400 LOC 内缺陷发现率 70–90%；轻量级 review 耗时 < 20% 正式审查而发现同样多的 bug）。
  - 出处：https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ （直读）。
- **综合归因（对本案例的解释）**：第一轮 review 验证「API 有 guard、不会崩」——这是 diff 内**可见机制**的检查；「读点不存在」是 **omission**，结构上不进 diff、也超出 reviewer 的 change understanding 范围。对抗手段只能是：**checklist/强制审计（把 omission 类问题变成"必须出示证据"的动作）** + **机器防线（把"没有"变成可检测的状态）**。

### 3.5 feature flag 工程卫生（同构领域的成熟纪律）

- **Pete Hodgson / Martin Fowler《Feature Toggles (aka Feature Flags)》**：flag 的代价与纪律；关键实操——**两态都要被测**："This allows automated tests to verify both sides of a toggled feature"（原文用 toggle router 动态切换，在测试里断言 on/off 两侧）。
  - 出处：https://martinfowler.com/articles/feature-toggles.html （快照）。
- **Mahdavi-Hezaveh et al.（NC State）**：109 份互联网 artifact 的定性分析 → 17 项实践（Management/Initialization/Implementation/Clean-up 四类）；论文开篇即用 **Knight Capital** 事故说明风险："repurposing an old feature toggle which activated functionality that had been **unused for 8 years**" 导致约 4 亿美元损失并破产；并指出 toggles 使用不当会产生 **dead code 与复杂度**。
  - 出处：arXiv:1907.06157（Feature Toggle Driven Development: Practices used by Practitioners）https://doi.org/10.48550/arXiv.1907.06157 ；期刊版 Empirical Software Engineering 26(1):1（2021）DOI 10.1007/s10664-020-09901-z。
  - 后续工作把 feature toggle 与 **configuration option** 两类研究合并（TOSEM 33(7):172, 2024，《Paving a Path for a Combined Family of Feature Toggle and Configuration Option Research》）——说明学术界已把「flag」与「配置项」视为同一族对象：**元数据（记录见 dblp 条目）** https://dblp.uni-trier.de/pid/223/4526.html （快照）。
- **可迁移规则**：任何「开关/设置驱动行为」的改动，**两态（或三态）都要有可执行验证**，且 flag/键的生命周期终点（清理/归档）要有检查——LD 的 code references 就是这条规则的工业化形态（§2.3）。

### 3.6 mutation testing 的定位（复述 §2.6 结论）

- 能证「现有测试对实现敏感」；不能证「接线存在」。适合作为**接线测试有效性**的放大器，而非检出手段。出处：Stryker docs（https://stryker-mutator.io/docs/ ，直读）。

### 3.7 LLM / AI 辅助的 spec 一致性验证（2024–2025）

- **负面证据（重要）**：ASE 2025《Uncovering Systematic Failures of LLMs in Verifying Code Against Natural Language Specifications》：LLM 在「代码是否满足自然语言需求」判定上**频繁误判**（把正确实现判为不满足/有缺陷）；且**更复杂的提示（要求解释与给出修正）反而提升误判率**；作者据此对「把 LLM 当 code review assistant」提出可靠性警告，并给出两种缓解提示策略。
  - 出处：DOI 10.1109/ASE63991.2025.00323；https://dl.acm.org/doi/10.1109/ASE63991.2025.00323 （快照，摘要级）。
- **正面探索（个案）**：IEEE 2025《Multi-Level Protocol Consistency Verification Using Large Language Model Agents》——用多 agent（规格分析/代码分析/语义对齐/主验证）做协议规格与实现的一致性核对，5 个网络协议平均 F1 82.7%，引入 weak bisimulation 作语义一致性形式框架。
  - 出处：DOI 10.1109/ISCIPT67144.2025.11265514 （快照，摘要级）；https://xplorestaging.ieee.org/document/11265514/ （快照）。
- **结论（供 skill 采用）**：LLM 可以做「**枚举候选读点/生成检索清单**」（提示 agent 去哪 grep），但**判据必须落在可复核的机器证据上**（与 skill 现有「证据要求 + 声称成功无效」一致）。不要把「LLM 说接线了」当结论。

### 3.8 未找到可靠一手来源的方向（明确标注）

1. **「dead setting / phantom feature / knob not connected / unwired configuration」**：未找到学术或大厂官方文档给出权威定义——本项目文档引用此类口语时，应回落到 **silent misconfiguration**（§1.1）。
2. **配置迁移专项研究（键更名后旧键仍被读、新键无人读的对策）**：未检索到直接的一手研究；可得的最接近材料是 ConfigX（通用检测）与 MSR 2016 configuration smells（配置代码坏味道目录，§1.2）。**不建议**在 skill 文案中引用未证实的「业界通行做法」。
3. **RTCA DO-178C 标准原文**：付费标准，本次仅取得二手转述（§3.1），引用时应按二手来源标注（Jama / 维基镜像）。
4. **《Building Evolutionary Architectures》书籍原文**：仅取得二手定义汇总（§3.3）；ArchUnit 官方指南作为可执行形态的一手材料。

---

## 4. 对 Pictelio `code-review` skill 的修改建议（Part B）

> 设计原则：**结构不动、增量挂载**——新机制全部挂进既有的三审计/触发式卡点表/共享强制机制三种容器，保持「必须/禁止配对」「证据要求」「心智判据」的既有格式。每条给出：补在哪 / 加什么 / 与现有机制衔接 / 业界依据。行文中的「Y」= spec/ADR 声明的驱动数据源（设置键、配置、flag、桥接通道）；「X」= 承诺行为。

### R1. 审计一新增触发信号 + 审计要求：「输入源接线审计（read-point evidence）」

**补在哪**：审计一（调用点完备性）——扩展「触发信号」列表与「审计要求」，不改审计数量与标题。

**加什么（建议原文级措辞）**：

- 触发信号（新增一条）：**声明驱动关系**——diff 或 spec/ADR 声明「行为 X 由数据源/设置/flag/桥接通道 Y 驱动」（含：新增设置项、双轨/兜底设计、迁移换键、flag gate、"由设置控制"字样的文档改动）。注：审计一现有触发信号已含「配置语义变化」，本条为其**读点方向的收紧**，两者并列。
- 审计要求（新增）：**必须**给出 Y 在**生产代码中的读取点**清单（`file:line`），并说明值如何流入 X（Y → 派生值/解析分支 → 行为）。写入侧证据（定义、注册、set/persist、备份域、`applyRawKey` 分支、schema）**一律不计**。
- **禁止**：以「键已定义/已注册/已写入/已进备份域/已有类型」作为接线证据；以「机制存在（API 有 guard、函数可调用）」替代「输入源正确」；以「单测全绿」替代读点存在性证明。
- 证据要求：读点检索必须出示**未截断清单**（grep 命中列表或索引工具引用列表）；检索词至少覆盖键名字面量与常量名（如 `DARK_MODE_KEY` 与 `settings_dark_mode` 双形态）。
- 心智判据（新增，反事实）：**把 Y 换成相反值，X 会变吗？不会 = 未接线。** 第二个问题：Y 的读点是在**生产路径**上，还是只在测试/回放/备份/迁移路径上？

**与现有机制衔接**：完全套用审计一的既有「机器证据规范（未截断计数）+ 防线判定（阻塞）」格式——若声明存在而读点缺失且无机器防线，直接记**阻塞 finding**（锚 ADR-0097）。

**业界依据**：§1.1 ConfigX（silent misconfiguration 定义）；§3.1 DO-178C 双向追溯（需求→源码）；§2.1 CodeQL 数据流语义（"where they are used"）。

### R2. 触发式维度卡点表新增一行：「多轨 / 兜底 / 降级设计」

**补在哪**：`触发式维度卡点` 表格（现 8 行）追加一行；与现有「错误处理/日志」行分工明确：后者管「单条路径的失败处理」，本行管「**多条轨道的输入源**」。

**加什么**：

- 触发信号：主轨 + 兜底轨/降级路径/双写/回退/影子通道（例：`values-night` 资源主轨 + `setSplashScreenTheme` 兜底轨；主通道 + fallback 通道；迁移期新旧键双读）。
- 必查项：**逐轨**列出「输入源 → 判定逻辑 → 输出行为」三元组；任一轨的输入源缺失读点 = 未接线；**两轨输入源相同 = 冗余信号**——须追问「设计里承诺的第二输入源（如用户设置）去哪了」，不得以「两轨都工作」为由放过；每轨的触发条件必须可观察（测试、探针或走查记录）。
- 业界依据：§1.1 ConfigX（"complex interactions between configurations and code" 是 silent 的主要成因之一）；§3.5 Hodgson/Fowler 两态测试纪律。

### R3. 机器防线升级：为「设置键 → 行为」建立读点断言（锚本项目既有模板）

**补在哪**：审计一的「防线判定（阻塞）」——为其提供**本仓库通用的可执行形态**（此前只说"要有防线"，未给模板）。

**加什么**：

- 模板 A（**键完整性 ← 已有**）：`settingsStore.test.ts` 两条 source-scan 守卫（`*_KEY` ⊆ `BACKUP_DEVICE_KEYS`；`BACKUP_DEVICE_KEYS` 每项有 `applyRawKey` 分支）。
- 模板 B（**读点存在性 ← 新增建议**）：同形态的 source-scan 断言——对 spec 单一事实源（如 `DARK_MODE_IDS`、键常量清单）逐个断言「生产源码（排除 test/mock）中存在读取引用」；抽取器必须**断言集合非空且数量下界**（防正则失效导致全称断言恒真——ArchUnit `failOnEmptyShould` 的教训，§3.3）。
- 模板 C（**跨语言键契约 ← 新增建议**）：原生侧（Java）读取的 prefs 键名、序列化封装（本仓库测试可见 `prefsGet` 返回值经 `JSON.stringify` 包裹）、读取时机（冷启动 vs onResume），必须与 JS 写入侧有**成对契约测试**或单一事实源常量表；键名漂移 = 无声失效。
- Oracle 要求（对接测试硬约束 #2/#4）：这些守卫的**期望值来源必须是 spec 键清单/单一事实源常量**，不得从实现自身导出（禁止「用实现里出现的键集合断言实现里出现的键集合」的自洽式写法；本项目模板已用字面量正则 + 上界常量，属于可接受形态）。
- 注意机器防线的边界：守卫证明「有读取语法」，不证明「读到的值流入承诺行为」——后者仍需 R1 的值流人工过一遍。

**业界依据**：§2.2 Android Lint UnusedResources（声明/引用可达图）；§2.3 LaunchDarkly code references（flag↔代码引用作为可查询状态）；§2.4 TS `noUnusedLocals`；§3.3 ArchUnit（规则即测试 + 空集防护）。

### R4. 共享强制机制：把「声明—读点对照行」列为 Spec 轴报告的必含输出

**补在哪**：`共享强制机制`（现 5 条）追加第 6 条；并同步写入 `汇总` 的格式要求。

**加什么**：

- **声明—实现对照（statement wiring check）**：Spec 轴报告**必须**为每条「由 Y 驱动」的 spec 声明输出一行对照：`声明（引用 spec/ADR 行） | Y 的读点证据（file:line 或机器检索清单） | 判定（已接线 / 未接线-阻塞 / 显式挂账）`。
- **禁止静默**：无法给出读点且无法立即修复时，唯一合法退路是**显式挂账**——订正文档到交付现状 + 建 follow-up issue（在报告中引用 issue 号），不得以"后续处理"字样口头带过。本仓库先例：ADR-0180 D7 对 `settings_dark_mode`/splash 的处置（订正 + issue #692）。
- 心智判据复用 R1 的反事实问题（翻转 Y 值），并新增一条：**「这行对照，我能给第二个人复现吗？」**——不能复现的"我看了代码没问题"不算证据（对齐「声称成功无效」）。
- brief 注入：R1+R4 的强制指令原文必须逐字进入 Spec sub-agent 的 brief（沿用现有机制，不新增通道）。

**业界依据**：§3.1 DO-178C（双向追溯、extraneous code 处置）；§3.4 SmartBear（omission 最难发现 → 用 checklist 把"缺什么"变成显式动作）。

### R5. Standards 轴 / 汇总：给配置类 diff 挂「Dead Configuration 嫌疑」标记

**补在哪**：Standards 轴的 Fowler smell baseline 之后，追加一个**仓库本地 smell**（或并入 Spec 轴 finding 的标签体系，二选一，建议放 Spec 轴避免与 baseline「永远 judgement call」混淆）。

**加什么**：

- 标记名建议：**possible Silent Misconfiguration（未接线配置）**，判据 = 「本 diff 新增/更名/迁移了设置键、flag、开关或桥接通道，但未附读取点或被引用说明」。
- 与 tooling 的关系：本项目 lint/类型检查**不可能**覆盖字符串键（§2.4），故不落入「跳过 tooling 已强制项」豁免——必须报。
- 术语引用纪律：文档里引「配置坏味道」时用 MSR 2016（§1.2）与 ConfigX（§1.1）的措辞，不引用未证实来源（§3.8）。

**业界依据**：§1.1 + §1.2；§3.4（Sadowski：Google 把机械检查前移，人管规范性与语义——本标记是"让 omission 显形"的机械锚点）。

### R6. 审计三扩展：把「原生侧读取用户设置」纳入平台与宿主契约

**补在哪**：审计三「触发信号」列表（现 3 条）追加第 4 条；沿用审计三既有的「探针记录 + 源级守卫」双要件格式。

**加什么**：

- 触发信号：**原生宿主（Java/Kotlin）读取用户设置数据**（SharedPreferences/prefs/Intent extras/文件），且该设置由 JS 侧写入（或反之）；含「迁移期键」「序列化封装」「读取时机（冷启动/onResume）」「跨端共享域（webview/lynx）」任一变化。
- 审计要求（**必须**同时具备）：① **键与序列化的成对记录**（写入侧常量 ↔ 读取侧键名、封装格式，落测试或注释）；② **读取时机的显式声明**（冷启动一次 / 每次 onResume / 订阅），并说明与平台生命周期契约的关系（例：`PackageManager` 持久化主题名的「一次性滞后」语义属平台事实，须实证记录）。缺任一 = 阻塞 finding。
- **禁止**以「两边都能编译/单测绿」证明跨端键契约成立（这是宿主契约层，单测姿态参考审计三既有的 Lynx 判据）。

**业界依据**：§1.1（键与行为交互）；§3.2（wiring 的端到端验证）；审计三既有平台事实纪律（ADR-0162/0163）同源。

---

## 5. 参考来源清单

> 访问方式标注：**直读** = 本调研直接抓取页面内容；**快照** = 经搜索结果的页面内容快照读取；**元数据** = 仅题录/摘要级。

**学术与标准**

1. Zhang, Piskac, Zhai, Xu. *Static Detection of Silent Misconfigurations with Deep Interaction Analysis*. PACMPL 5(OOPSLA), Art.140, 2021. DOI 10.1145/3485517 — https://dl.acm.org/doi/abs/10.1145/3485517 （快照）；https://2021.splashcon.org/details/splash-2021-oopsla/44/ （快照）；https://par.nsf.gov/biblio/10311545 （快照）。
2. Zhong et al. *Effective Bug Detection with Unused Definitions*（ValueCheck）. EuroSys 2024, pp.720-735. DOI 10.1145/3627703.3629576 — https://dl.acm.org/doi/abs/10.1145/3627703.3629576 （快照）。
3. Sharma, Fragkoulis, Spinellis. *Does your configuration code smell?* MSR 2016, pp.189-200. DOI 10.1145/2901739.2901761 — 工作稿 https://www.dmst.aueb.gr/dds/pubs/conf/2016-MSR-conf-smells/html/SFS16.html （直读，摘要级）。
4. Bacchelli & Bird. *Expectations, Outcomes, and Challenges of Modern Code Review*. ICSE 2013. DOI 10.1109/ICSE.2013.6606617 — https://repository.tudelft.nl/record/uuid:d629803b-bbec-4593-a7f2-6f4b2266ff5a （快照）。
5. MacLeod, Greiler, Storey, Bird, Czerwonka. *Code Reviewing in the Trenches: Challenges and Best Practices*. IEEE Software 35(4), 2018. DOI 10.1109/MS.2017.265100500 — https://www.computer.org/10.1109/MS.2017.265100500 （快照）。
6. Sadowski, Söderberg, Church, Sipko, Bacchelli. *Modern Code Review: A Case Study at Google*. ICSE-SEIP 2018, pp.181-190. DOI 10.1145/3183519.3183525 — 论文笔记 https://alastairreid.github.io/RelatedWork/papers/sadowski:icse-seip:2018/ （快照）；题录 https://www.rankless.org/hit-papers/10.1145/3183519.3183525 （快照）。
7. Mahdavi-Hezaveh, Dremann, Williams. *Feature Toggle Driven Development: Practices used by Practitioners*. arXiv:1907.06157 / EMSE 26(1):1, 2021 — https://doi.org/10.48550/arXiv.1907.06157 （快照）；作者著作目录（含 TOSEM 2024 合并研究题录）https://dblp.uni-trier.de/pid/223/4526.html （快照）。
8. Jin & Chen. *Uncovering Systematic Failures of LLMs in Verifying Code Against Natural Language Specifications*. ASE 2025, pp.3819-3823. DOI 10.1109/ASE63991.2025.00323 — https://dl.acm.org/doi/10.1109/ASE63991.2025.00323 （快照）。
9. Zhang et al. *Multi-Level Protocol Consistency Verification Using Large Language Model Agents*. ISCIPT 2025. DOI 10.1109/ISCIPT67144.2025.11265514 — https://xplorestaging.ieee.org/document/11265514/ （快照）。
10. DO-178C 转述（标准原文付费）：Jama Software 指南 https://www.jamasoftware.com/requirements-management-guide/aerospace-and-defense/do-178c/ （快照）；维基百科镜像 https://en.wikipedia.org-on-ipfs.org/wiki/DO-178C （快照）。
11. MISRA C / DO-178C 死代码与不可达代码讲解（AdaCore Learn）— https://learn.adacore.com/courses/SPARK_for_the_MISRA_C_Developer/chapters/08_unreachable_and_dead_code.html （快照）。
12. Ford, Parsons, Kua. *Building Evolutionary Architectures*（2017）—— 概念二手汇总 https://cstopics.com/encyclopedia/software-engineering/software-architecture/architecture-documentation/architecture-fitness-functions （快照）。

**官方文档与工具**

13. CodeQL — About data flow analysis：https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/ （快照）；Creating path queries：https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries （快照）。
14. Android — Reduce app size（UnusedResources 告警）：https://developer.android.com/topic/performance/reduce-apk-size （快照）；Lint 作者文档（unused resources 可达图算法）：https://android.googlesource.com/platform/tools/base/+/58c850407f4aff3158688ea3b6844e0b2aeac518/lint/docs/api-guide/basics.md.html （快照）。
15. LaunchDarkly — Code references：https://launchdarkly.com/docs/home/flags/code-references （快照）；Reducing technical debt from feature flags：https://docs.launchdarkly.com/guides/flags/technical-debt （快照）；Launched: Code References（博客镜像）：https://launchdarkly-com.netlify.app/blog/launched-code-references （快照）。
16. TypeScript — noUnusedLocals：https://www.typescriptlang.org/tsconfig/noUnusedLocals.html （直读）。
17. Stryker Mutator — What is mutation testing?：https://stryker-mutator.io/docs/ （直读）。
18. ArchUnit — User Guide（v1.5.0，含 `@AnalyzeClasses`/`@ArchTest`、`archRule.failOnEmptyShould`）：https://www.archunit.org/userguide/html/000_Index.html （直读）。

**一线工程实践文章**

19. Martin Fowler — Integration Test（bliki）：https://martinfowler.com/bliki/IntegrationTest.html （直读）；Feature Toggles (aka Feature Flags)（Pete Hodgson）：https://martinfowler.com/articles/feature-toggles.html （快照）。
20. Dan North — Introducing BDD：https://dannorth.net/blog/introducing-bdd/ （直读）。
21. Gojko Adzic — Forget the walking skeleton – put it on crutches（引用 Cockburn 的 walking skeleton 定义）：https://gojko.net/2014/06/09/forget-the-walking-skeleton-put-it-on-crutches （快照）。
22. SmartBear — Best Practices for Code Review（Cisco 研究；omission 表述）：https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ （直读）。
23.（辅助）FlagShark — Dead Code Detection（flag 控制死路径）：https://flagshark.com/blog/dead-code-detection-codebase-more-than-you-think （快照，商用博客，仅作工程叙述参考）。

**项目内部锚点**

24. `docs/adr/ADR-0180-lynx-dark-mode.md` D7（splash 双轨；手动模式接线 + 真机走查 gate 的现行处置——2026-09-21 review 修复轮落地）。
25. `docs/specs/lynx-night-mode.md`（`settings_dark_mode` 键声明、备份域守卫说明）。
26. `packages/app-lynx/src/stores/settingsStore.test.ts`（source-scan 双守卫模板，以用例名为锚点）；`packages/app-lynx/src/stores/settingsStore.ts` 的 `DARK_MODE_KEY` 常量（写入侧键名）。
