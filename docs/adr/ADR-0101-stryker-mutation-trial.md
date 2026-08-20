# ADR 0101：StrykerJS mutation testing 试点（纯函数包本地灵敏度门禁）

**状态**：待批准（草案，供评审）
**日期**：2026-08
**决策者**：团队成员 + grill-with-docs / goal 会话
**背景**：承接 ADR-0098 决策 7 的 mutation 试点规划；依据 docs/research/ai-generated-test-quality.md（mutation 定位与盲区）。

---

## 背景

ADR-0097 引入 oracle 溯源（期望值来自独立来源）与 T0/T0.5 门禁，从执行层约束 AI 生成测试的 conformance/oracle 缺陷。但 oracle 溯源是人工 review 机制（code-review Spec 轴），无机械门禁自动化检测「测试太弱 / 覆盖但无效断言」这类 conformance 信号。

mutation testing 提供这种机械信号：注入变异体（对实现做行为微改），若测试未杀死（测试仍绿）则该变异体存活，说明测试对目标行为不敏感。存活率高 = 测试灵敏度低 = conformance 风险。

**定位（据调研）**：mutation score 是「测试灵敏度 / 弱断言检测器」，**不是正确性证据**——期望值写错的测试照样杀死偏离错误期望的变异体，也能放行保持错误行为的变异体。因此 mutation 与 oracle 溯源（ADR-0097）互补：前者抓 conformance（弱测试），后者抓 oracle 错误（错的期望）。

## 决策

1. **引入 StrykerJS mutation testing** 作为 @pictelio/ugoira 与 @pictelio/update-check 两包的**本地**测试灵敏度门禁。选择 Stryker 因 TypeScript 生态 + 官方 vitest runner（since v7.0，@stryker-mutator/vitest-runner），与两包现有 vitest 无缝。
2. **依赖**：@stryker-mutator/core + @stryker-mutator/vitest-runner 加为两包 devDependency。注意 pnpm minimumReleaseAge:1440 冷却期——当前评估版本满足（StrykerJS 为长期稳定项目），安装前最终核实。
3. **配置**：每包一个 stryker.config（或根级共享配置），mutate 指向 src/index.ts，test runner = vitest，mutation score 初始阈值合理值（建议 50~70%，试点后按实际上调）。HTML + JSON 报告输出到本地目录（临时，入 .gitignore）。
4. **执行形态**：新增根/包级 npm script（如 test:mutation），**不进 CI**（本地可选门禁），作为开发者对纯函数模块做质量自查的手动工具。
5. **定位声明**：mutation score 只作「测试灵敏度 / 弱断言检测器 / 防 conformance」；**永远不作为正确性证据**（盲区见调研 §6）。实际正确性由 oracle 溯源（ADR-0097 code-review）+ 真实样例硬约束（契约测试）守护。
6. **试点范围**：仅 ugoira + update-check 两个 in-process 纯函数包——避免 IO / 桥接代码的等效变异体噪音，先验证工具链收益再评估推广。

## 替代方案评估

| 方案 | 评估 |
|---|---|
| **StrykerJS（选定）** | TS 生态 + 官方 vitest runner，与现有测试无缝；mutation score 阈值可配置 |
| PITest（Java）/ 其它 JS 工具 | 生态不匹配或维护弱；Stryker 是 JS/TS 事实标准 |
| mutation 进 CI | 否决——runner 时长、flakiness、盲区（score 不能当正确性证据）会让 CI 门禁产生虚假信心；先本地试点 |
| 全仓库 mutation | 否决——IO / 桥接代码等效变异体噪音高、成本大；先纯函数试点 |

## 影响范围

| 文件 | 改动 |
|---|---|
| packages/ugoira/package.json | + devDep @stryker-mutator/core + vitest-runner |
| packages/update-check/package.json | 同上（+ 已有 fast-check） |
| 两包各新增 stryker.config（或根级） | mutate=src/index.ts, runner=vitest, 阈值 |
| 根 package.json | + test:mutation 脚本（委托两包） |
| .gitignore | + mutation 报告产物目录 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 等效变异体（equivalent mutants）致分数虚低 | Stryker 内置识别；阈值设初始低值包容；报告人工判读 |
| 运行时长（纯函数库 mutation 较快） | 仅两包、本地跑；不进 CI 无阻断压力 |
| pnpm 冷却期（minimumReleaseAge 1440）不满足最新版 | 安装前核实发布日期，选满足版；StrykerJS 长期稳定 |
| score 被误当正确性证据 | ADR 明示定位（灵敏度门禁，非正确性）；与 oracle 溯源互补 |
| 试点收益不明确 | 报告产出让开发者判读存活变异体，验证收益后再推广 |

## 后果

- 纯函数模块获得本地 mutation 灵敏度门禁，提供 conformance 的机械信号（补 ADR-0097 人工 review 的自动化空白）。
- 与 oracle 溯源互补：mutation 查「测试弱 / 弱断言」，oracle check 查「期望值错」；二者共同使用才完整。
- 试点结果（报告、阈值、是否推广）经验证后另行评估，不改入门禁。