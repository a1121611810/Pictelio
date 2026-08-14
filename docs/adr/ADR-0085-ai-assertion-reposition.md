# ADR-0085: agent-browser AI 断言归位（确定性为主，LLM 保留语义判断）

## 状态

已采纳

## 分类

技术决策

## 日期

2026-08-14

## 背景

ADR-0034（迁移至 agent-browser）的核心动机之一是"AI 语义断言对 UI 变更天然免疫"。但实测现状（agent-browser-e2e-perf-direction-c-feasibility）：64 条 `aiAssert` 中 55 条实为"页面是否正常"类宽泛 DOM 检查（A 34 + B 21），仅 1 条（s48）是真实语义判断（标签内容与作品相关性）。宽泛断言是负资产：每次 LLM 网络往返、不可复现、掩盖测试失真（8 条 X 类失真断言被 LLM 宽松放行）。

## 决策

1. 63 条宽泛/可确定化的 `aiAssert` → 确定性 DOM 断言（`evaluate` + `expect`），LLM 调用 64 → 1（-98.4%）。
2. s48（真实语义判断）保留 LLM；`assertion.ts` 的 `aiAssert` 设施保留且存活（ADR-0034 能力火种）。
3. 套件仍依赖本地 `DEEPSEEK_API_KEY`（仅 s48 使用；CI 已移除 test job，纯本地依赖）。

## 理由

- 确定性断言：可复现、失败精确定位、无第三方网络依赖、页面内容不外泄。
- 保留 s48 + 设施：不推翻 ADR-0034 引入 agent-browser 的核心动机；将来"布局合理性"等真语义断言即插即用。

## 替代方案

- 全部降级并删除 `assertion.ts`：被拒绝——自废 ADR-0034 引入 agent-browser 的核心动机。
- 维持 64 条全 LLM：被拒绝——性能目标无法达成，64 次 LLM 是硬成本。
