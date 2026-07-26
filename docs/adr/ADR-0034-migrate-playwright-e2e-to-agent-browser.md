# ADR 0034: Playwright E2E 测试逐步迁移至 Agent-Browser

## 状态

已采纳

## 分类

技术决策

## 日期

2026-07-26

## 背景

Pictelio 项目存在两套并行的 E2E 测试方案：

1. **Playwright E2E**：11 个 spec 文件，`@playwright/test` runner，确定性 CSS/文本选择器 + `expect()` 断言
2. **Agent-Browser E2E**：2 个测试文件（1 个超长链 + 1 个中链合集），基于 Vitest + [agent-browser CLI](https://github.com/vercel-labs/agent-browser) 调用。agent-browser 是 Vercel Labs 开发的浏览器自动化 CLI 工具，通过 accessibility tree 语义选择器（`@e2` 等 ref）与页面交互，配合 AI 断言引擎（DeepSeek Flash）做语义化验证。

两套方案的共享设施仅有同一台 Vite dev server（端口 5173）和相同的 `PIXIV_REFRESH_TOKEN` env 变量。Fixture、runner、配置均独立维护。

## 决策

将 Playwright E2E 测试逐步迁移至 agent-browser，迁移完成后弃用 Playwright。

## 核心动机

四条因素共同驱动此决策：

1. **维护负担**：两套独立 E2E 方案需要维护两套 fixture / runner / 配置 / globalSetup / globalTeardown / token-loader，运维成本叠加
2. **AI 断言优势**：Playwright 的确定性选择器在频繁变化的 Fluent Web Components UI 下脆弱（元素类型、标签名、Shadow DOM 规则变化均会导致选择器失效）；agent-browser 基于 accessibility tree 的 ref 选择 + AI 语义断言对 UI 变更天然免疫
3. **继承覆盖**：Playwright 的 11 个 spec 覆盖了 agent-browser 尚未覆盖的边界场景（登录错误态、图床确认/取消流程、导航 404 fallback 等），迁移可直接继承这些覆盖
4. **方向统一**：决定弃用 Playwright，集中精力维护一套 AI 驱动的 E2E 测试方案

## 迁移策略

### 逐批替换

Playwright 和 agent-browser 两套配置共存期间互不干扰。每迁移一个 spec 就删除对应的 Playwright spec 文件，直到最后一个迁移完成后删除 Playwright 整体配置。

### 迁移清单

按测试目的分为三类，对应不同的迁移方式：

**A 类——核心用户流（7 个 spec）：AI 优势最大化**
- feed、illust-detail、novel-detail、login、user-bookmarks、user-profile、child-route-navigation
- 迁移方式：不逐条翻译 Playwright 断言，按用户故事整合为 agent-browser 长链 / 中链；AI 断言一步验证全局状态（"推荐 Feed 展示插画卡片瀑布流"）替代多条 `expect()`

**B 类——UI 组件行为（3 个 spec）：AI 中等优势**
- extra-flows（图床 toggle 确认/取消、主题切换、布局模式）、image-cache-settings、navigation-settings
- 迁移方式：每个核心交互保留独立 `it` 块，用 `aiAssert` 验证最终状态；不检查 `fluent-switch.checked` 等底层 DOM 属性

**C 类——底层浏览器行为（1 个 spec）：不移**
- cache-immutable（测试 `Cache-Control: immutable` 头是否阻止浏览器二次网络请求）
- 不移到 agent-browser。该测试自建 HTTP server 计数图片请求数，验证的是浏览器 HTTP 缓存行为，不是 Pictelio 应用行为。
- **具体行动**：保留在 Playwright 中暂不动，等全部 A/B 类迁移完成后，评估是否转为纯 Node.js Vitest 单元测试（移到 `tests/unit/` 下），或直接删除（若认为该测试价值有限）。

### 迁移顺序

| 批次 | 内容 | 目的 |
|------|------|------|
| 第一批 | login + feed + extra-flows（图床部分） | 验证 AI 断言在"登录流"、"内容加载流"、"UI 状态检查"三类场景的可用性 |
| 第二批 | illust-detail + novel-detail + extra-flows 剩余部分 | 核心交互场景 |
| 第三批 | user-bookmarks + user-profile + child-route-navigation | 个人中心相关场景 |
| 第四批 | image-cache-settings + navigation-settings | 设置页场景 |
| 清理 | 删除 Playwright 配置 | 全部迁移完成 + 至少一轮全量通过后 |

### 文件组织结构

保留现有 `main-flow.test.ts`（超长链）+ `sub-flows.test.ts`（中链）的架构：
- A 类核心流整合到两个现有文件的 describe 块中
- B 类场景以独立 describe 块追加到 `sub-flows.test.ts`

### 批次通过标准

每个批次完成后，必须满足以下条件才能进入下一批次：

1. **该批次迁移的 agent-browser 测试连续 3 次运行**通过率 100%（非网络/基础设施原因导致的偶发失败不计入，但需记录）
2. **该批次对应的 Playwright spec 已从文件系统删除**（确保不会遗留双倍维护）
3. **无新增未处理的 `todo`/`skip`**（已识别的已知限制可加 `skip` 但需写明原因和追踪 Issue）

第一批通过标准额外要求：对 AI 断言结果进行人工抽样复核至少 1 次，确认无假阳性/假阴性。

### 回滚/应急方案

若某批次迁移后出现以下情况，应暂停迁移并回退该批次：

1. **AI 断言持续不稳定**：同一测试在无代码变更的情况下，AI 断言通过率低于 60%（连续 3 次运行中，超过 40% 的测试因 AI 断言而非应用 bug 失败）
2. **AI 断言假阳性导致退化漏检**：应用引入视觉/功能退化但 AI 断言未检出（需人工发现）

**回滚操作**：
- 恢复该批次已删除的 Playwright spec 文件（git checkout）
- 关闭 agent-browser 中对应新增的 it 块（加 `it.skip`）
- 记录回滚原因到 ADR 注释中
- 修复根本问题后再重新迁移该批次

### AI 模型风险

本方案依赖 DeepSeek Flash 作为 AI 断言引擎，存在以下风险：

1. **模型可用性**：DeepSeek API 离线或降级时，AI 断言全部失败。当前 `aiAssert` 已内置重试机制（默认 2 次），但未配置 fallback 模型。
2. **成本**：每次 AI 断言调用约 3-6 秒，消耗 token。当前项目规模下成本可忽略，但若测试规模扩大 10 倍需评估。
3. **确定性**：LLM 输出非确定性，同一页面状态可能在不同调用中得到不同结果。通过 `temperature: 0.1` 和重试机制缓解，但无法完全消除。
4. **模型离线降级**：若 DeepSeek Flash 不可用且无 fallback 模型，整个 agent-browser 测试套件不可运行。当前无自动降级方案——开发者需手动切换到 Playwright（在迁移完成前）或等待 DeepSeek 恢复。

**当前缓解措施**：
- 迁移完成前，Playwright 作为兜底保留
- `aiAssert` 的重试机制（2 次）处理偶发失败
- 锁定 `temperature: 0.1` 降低输出随机性

### 共存期 CI/CD 影响

Playwright 和 agent-browser 两套配置共存期间：
- **运行耗时**：两套套件串行运行约增加 3-5 分钟 CI 时间（Playwright ~2 分钟 + agent-browser ~2-3 分钟）。可考虑在 CI 中并行运行（不同 job）。
- **端口冲突**：两套套件共用同一 Vite dev server（端口 5173），但不会同时运行（由 runner 串行管理）。若未来并行运行需分配不同端口。
- **环境变量**：两套套件依赖相同的 `PIXIV_REFRESH_TOKEN`，无冲突。
- **退出策略**：每删除一个 Playwright spec，CI 中对应测试数减少，直到全部删除后移除 Playwright job。

## 考虑过的方案

### 方案一：大爆炸式一次性迁移

一次性将所有 11 个 Playwright spec 重写为 agent-browser 格式，然后删除 Playwright。

**拒绝原因**：风险过高。agent-browser 的 AI 断言在部分场景（特别是不依赖 UI 交互的底层行为检查）的适用性未经验证，一次性迁移可能导致大范围退化。

### 方案二：两套长期共存

保留 Playwright 用于确定性边界场景，agent-browser 仅用于核心用户流。

**拒绝原因**：维护负担未解决，且与"统一方向"的动机冲突。

### 方案三：保留 Playwright runner，仅替换断言层

保持 Playwright 的交互能力，但用 `aiAssert` 替代 `expect()`。

**拒绝原因**：最坏折中——同时保留了两套运行时的复杂性，又未获得 agent-browser 的 ref-based 交互优势（AI 断言 + 语义选择器是协同优势，分开仅得其一）。

## 涉及文件

- `packages/app/tests/e2e/` — Playwright 配置和 11 个 spec 文件（逐步删除）
- `packages/app/tests/agent-browser/specs/` — agent-browser 测试文件（逐步扩充）
- `packages/app/tests/agent-browser/driver.ts` — 可能需要扩展以支持更多交互模式
- `packages/app/tests/ai-shared/assertion.ts` — AI 断言引擎（无需修改）
- `packages/app/vitest.agent-browser.config.ts` — agent-browser Vitest 配置（无需修改）
- `packages/app/tests/e2e/playwright.config.ts` — 全量迁移完成后删除
- `packages/app/package.json` — 迁移完成后移除 `test:e2e` 等 Playwright 相关命令
