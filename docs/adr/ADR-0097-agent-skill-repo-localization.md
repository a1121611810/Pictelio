# ADR 0097：code-review skill 仓库化 + 测试期望值溯源（oracle check）

**状态**：已批准
**日期**：2026-08
**决策者**：团队成员 + grill-with-docs 会话
**背景**：参考 `docs/research/ai-generated-test-quality.md`（AI 测试生成质量）、`docs/research/deepseek-harness-agents-analysis.md`（DSH .agents 系统分析）、`docs/research/deepseek-harness-agents-analysis.md` §6.2（skill 仓库化）

---

## 背景

AI 模型生成的测试用例存在两类系统性缺陷：

1. **conformance（测试配合实现）**：期望值从被测实现反推、同义反复断言、自洽 mock——测试全绿但只验证"实现与自身一致"。
2. **oracle（期望值本身写错）**：测试是判定基准，基准错了红绿循环以高置信度生产错误软件。

本仓库已有多层防御（测试硬约束 #1-#5、ADR-0084/0085），但缺口在**执行层**：硬约束只活在 AGENTS.md（提示词自约束，模型执行是概率事件），且 code-review 的 Spec 轴不审"测试期望值是否符合规格、而非从实现推导"。

业界调研结论：期望值溯源检查是当前**空白领域**（Meta TestGen-LLM、Qodo Cover 均无此检查，见 `docs/research/ai-generated-test-quality.md` §4、§6）；DeepSeek Harness 的实践证明"skill 仓库化"可行（`docs/research/deepseek-harness-agents-analysis.md` §4、§6.2）。

## 决策

1. **code-review skill 仓库化**：在 `.agents/skills/code-review/SKILL.md` 提供仓库版 code-review（同名遮蔽全局 skill，项目级加载优先级高于用户级，已用探针验证本部署会加载项目级 `.agents/skills/`）。Spec 轴强制两个阻塞项：**Oracle check**（逐测试判定期望值来源：规格/验收样例/真实数据/性质为合法，实现反推/自洽 mock/同义反复为嫌疑）+ **Test strength**（断言必须验证可观察行为、能说清 intended regression、出示证据）。
2. **T0.5 格式门禁**：新增 `scripts/verify-agent-skills.mjs`，校验 `.agents/skills/` 的 frontmatter 合法性、name 与目录一致性、关键段落标记（防 oracle check 漂移）；挂 pre-push（触碰 `.agents/` 时运行，机制与 `check-e2e-anchors` 同款）。
3. **T0 机械门禁强化**：`passWithNoTests` 从 `true` 改为 `false`（防空壳测试文件）；oxlint `expect-expect` 从 `off` 改为 `error`（测试必须有断言）。注意 `expect-expect` 只保证"有断言"，Oracle check 保证"断言值得信"，两者互补。
4. **AGENTS.md 测试硬约束新增第 6 条**（期望值出处可追溯），并在 `packages/app/tests/TESTING.md` 同步。

## 替代方案评估

| 方案 | 评估 |
|------|------|
| A) 改全局 skill（`~/.agents/skills/code-review/SKILL.md`） | 影响所有项目；该目录无版本控制，不可 diff/回滚，重装可能被覆盖。否决。 |
| B) 仅 AGENTS.md 包一层 | 作用域限本仓库、随版本控制，但 oracle check 定义散落在 AGENTS.md，skill 升级后需手动同步；可靠性依赖 agent 每次读到 AGENTS.md。 |
| C) skill 条件化定义 + 仓库声明激活 | 定义全局唯一、激活仓库控制，但全局 skill 无版本控制的问题仍在，且条件触发依赖模型判断。 |
| **D) skill 仓库化（选定）** | `.agents/skills/` 随仓库版本控制、走 PR 审查、项目级加载优先级自动遮蔽全局同名 skill；检查定义在 skill body（agent 加载即执行），激活靠机械的加载优先级。 |

## 影响范围

| 文件 | 改动 |
|------|------|
| `.agents/skills/code-review/SKILL.md` | 新增：仓库版 code-review（oracle check + test strength） |
| `scripts/verify-agent-skills.mjs` | 新增：T0.5 格式门禁脚本 |
| `.husky/pre-push` | 增加 `.agents/` 触碰时的 skill 校验分支 |
| `packages/app/vitest.config.ts` | `passWithNoTests: true → false` |
| `packages/app/vite.config.ts` | 测试 override 中 `expect-expect: off → error` |
| `AGENTS.md` / `packages/app/tests/TESTING.md` | 测试硬约束新增第 6 条（期望值出处可追溯） |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `expect-expect` 对既有测试误报（如仅抛错断言、helper 断言） | 翻 error 后运行全量 lint，逐个修正真实违规；若确有规则与仓库模式不兼容的合理模式，回到本 ADR 讨论而非静默关闭 |
| 项目级 skill 未被某部署加载 | 探针已验证本部署加载 `.agents/skills/`（provider: filesystem）；T0.5 门禁保证格式正确 |
| Oracle check 误伤（期望值合法但审阅者判断错） | 清单式判定 + 标出嫌疑（不自动拒绝），最终由人工裁决；报告可审计 |
| pre-push 双检查增加延迟 | 两脚本均为秒级纯文件扫描，与既有 `check-e2e-anchors` 同量级 |

---

## 治理记录（2026-08-31）：统一双审计扩展（审计一 · 调用点完备性）

本 ADR 的仓库版 skill 从「Oracle check + Test strength」扩展为**统一双审计**形态，在 Spec 轴强制两个阻塞级审计：

1. **新增审计一（调用点完备性 / blast radius）**：结构性动机——翻转/接口变更类改动的完整性无法从 diff 证明，「应该改却没来改的调用点」缺席于 diff，逐行评审永远看不到。触发信号 7 类：默认行为翻转、接口删除或收窄、参数语义反转或 optional→required、输出契约变化、错误模型变化、顺序/排序假设变化、配置语义变化。审计要求双证据通道（代码索引工具 + 全仓 grep 含间接层：变量传参/三元分支/字符串拼接/转发封装），逐一标注 `已迁移` / `不受影响（说明理由）` / `遗漏`；`遗漏` = 阻塞 finding。
2. **防线判定（阻塞级）**：翻转必须配有机器防线（dev 运行时守卫 / 全仓断言测试 / lint 规则 / pre-push 门禁，任一即可）；**无机器防线 = 审计不完备 = 阻塞 finding**。本仓库既有防线判据：pre-push 双门禁（`check-e2e-anchors`、`verify-agent-skills`）、T0 机械门禁（`passWithNoTests`、`expect-expect`）、测试硬约束 #4（重构行为不变约束）——审计一是硬约束 #4 在审查执行层的机械延伸。
3. **机器证据通道选型**：采用既有 CodeGraph（`.codegraph/` 健康索引，`codegraph explore` 返回符号源码 + 调用路径 + blast radius）作为审计一主证据通道，**不引入第二索引**；机器证据规范要求核对未截断计数/完整清单，截断集不得当作完备性证据。
4. **触发式维度卡点**：8 维度（安全与隐私 / 错误处理与日志 / 并发与竞态 / 性能 / 依赖 / 文档同步 / UI 与用户可见变更 / 数据迁移），命中才强制；tooling 已强制项不重复报。
5. **共享强制机制**：必须/禁止配对、brief 注入（Spec sub-agent 逐字携带全部强制指令原文）、证据要求 + 声称成功无效（不信任 agent 自述）、characterization 识别。
6. **门禁同步**：`scripts/verify-agent-skills.mjs` 的 REQUIRED_MARKERS 登记「调用点完备性」「机器防线」，防审计一从 skill 漂移（pre-push 触碰 `.agents/` 时校验）。

与既有的审计二（Oracle check + Test strength，锚测试硬约束 #1-6）构成完整双审计：审计一防「漏迁移调用点」，审计二防「测试迎合实现」，共享强制机制防「AI 跳过执行」。

**回滚路径**：`git checkout .agents/skills/code-review/SKILL.md scripts/verify-agent-skills.mjs`（skill 与门禁同步回滚）；治理记录为历史记录，不回滚。
