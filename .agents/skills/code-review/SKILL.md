---
name: code-review
description: 审查 git diff（固定点到 HEAD）的双轴 code review（Standards + Spec）。Pictelio 仓库版：Spec 轴强制测试期望值溯源（Oracle check）与 Test strength 检查，对抗 AI 生成测试的 conformance/oracle 缺陷。项目级 skill，按加载优先级遮蔽全局同名 skill。
---

# Code Review（Pictelio 仓库版）

对 `git diff <fixed-point>...HEAD`（three-dot，基于 merge-base）的双轴审查：**Standards**（是否符合仓库编码规范）与 **Spec**（是否忠实实现源起 issue/PRD/spec）。两条轴作为**并行 sub-agent** 运行，互不污染上下文，最后汇总。

## 为什么存在本仓库版

调研依据：`docs/research/ai-generated-test-quality.md`、`docs/research/deepseek-harness-agents-analysis.md`。
动机：AI 生成的测试会迎合实现（期望值从实现反推、同义反复断言、自洽 mock），"测试全绿"不证明"测试正确"。审阅必须对照**独立来源**（spec/真实样例/字面量/不变量），而非被检对象自身。本 skill 在全局 code-review 流程之上，为 Spec 轴增加两个强制检查（Oracle check、Test strength）。

## 流程

1. **Pin fixed point**：用户给定 commit/branch/tag/`main`/`HEAD~N`；确认 `git rev-parse` 可解析、diff 非空。记录 diff 命令与 commit 列表。
2. **Identify spec source**：按序——commit message 的 issue 引用（`#123` 等，经 `docs/agents/issue-tracker.md` 流程获取）→ 用户传入路径 → `docs/`、`specs/`、`.scratch/` 下与分支/功能匹配的 spec 文件 → 询问用户。无 spec 则 Spec 轴跳过并注明 "no spec available"。
3. **Identify standards sources**：仓库文档化标准（AGENTS.md、`packages/app/tests/TESTING.md`、Fluent 设计规范等）+ 下方 Fowler smell baseline。
4. **并行 spawn 两个 sub-agent**（general-purpose）：Standards 轴与 Spec 轴，上下文互不污染。
5. **汇总**：两轴报告分列 `## Standards` / `## Spec`，不合并不重排。结尾一行总结每轴 finding 数与最严重项；不跨轴选 winner（分离存在的意义）。

## Spec 轴强制增量（本仓库特有，阻塞项）

### A. Oracle check（期望值溯源）

Spec sub-agent 的 brief **必须**包含以下指令：

- 对 diff 中**每个测试**，逐条判定其断言期望值的来源，仅以下来源合法：
  - **规格/需求原文**（引用 spec 行号或 ticket 验收条件）
  - **可执行验收样例**（ticket 附的输入→期望输出样例）
  - **真实数据/字面量**（真实响应快照、插件源码常量、线上文件——测试硬约束 #2 的 backupRulesConsistency.test.ts 模式）
  - **性质/不变量**（property-based，如幂等、round-trip、守恒）
  - **独立实现/差分测试**（双实现互为 oracle，如 app 与 app-lynx 同语义模块：R18 过滤、URL 重写、错误分类）
- 以下来源 = **嫌疑**，必须标出（文件 + 测试名 + 来源类型）：
  - 从被测实现反推（先看实现再写期望值）
  - 自洽 mock 字段（手写、与实现共享同一错误假设）
  - 同义反复断言（`expect(add(a,b)).toBe(a+b)` 式）
- 心智判据：把实现改成"显然错误但符合该测试断言"的版本，测试会红吗？不会 = conformance 嫌疑。
- characterization 识别：若测试的期望值只是"当前行为"的锁定（快照、从实现输出抄写）而无规格依据，它是 characterization（防回归）而非 specification（防错误）——不能作为"实现正确"的证据，须标出。
- 审阅者输入 = **spec + 可执行样例 + 测试**（不含实现推导过程）；brief 明写："测试通过 ≠ 测试正确，测试可能迎合实现；禁止用'测试对着实现是绿的'作为测试正确性的证据。"

### B. Test strength

- 每个测试必须能说清它防的 **intended regression**（目标回归）；说不出的 = 嫌疑。
- 断言必须验证 **external state / 可观察行为**（事件流、存储、日志、输出），禁止 restate implementation（复述实现）。
- 覆盖（coverage）必要但不充分：被覆盖但无有效断言的语句（oracle gap）不构成质量证据。
- 不信任 agent 的报告：证据（测试输出、命令与返回）必须出示；声称成功无效。

## Standards 轴（与全局版一致）

文档化标准 + Fowler smell baseline（Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man、Refused Bequest）。repo 文档化标准覆盖基线；基线 smell 是 judgement call，非硬违规；跳过 tooling 已强制项。

## 汇总

两轴报告分列（verbatim 或轻清理），不合并、不重排、不跨轴选 winner。每条 finding 引用 spec 行号 / 标准条款。结尾一行：每轴 finding 数与最严重项。

## 本仓库测试硬约束对照（核心 4 条，完整清单见 AGENTS.md「测试硬约束」#1-#6；审查测试时逐条过）

1. IO 边界成功/失败双路径都有单测？（硬约束 #1）
2. 契约 mock 来自真实样例？（硬约束 #2，backupRulesConsistency.test.ts 模式）
3. 降级路径有 warn 或显式错误状态？（硬约束 #3）
4. 期望值能指向独立来源？（本 skill Oracle check）
