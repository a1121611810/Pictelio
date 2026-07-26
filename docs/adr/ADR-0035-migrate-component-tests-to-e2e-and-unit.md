# ADR 0035: 组件测试逐步迁移至 Agent-Browser E2E + 单元测试

## 状态

已采纳

## 分类

技术决策

## 日期

2026-07-26

## 背景

Pictelio 项目存在三层测试架构：

1. **Vitest 单元测试**（`vitest.config.ts`）— 纯 Node.js，约 60 个文件
2. **Vitest browser 组件测试**（`vitest.browser.config.ts`）— 使用 `@vitest/browser` + `@vitest/browser-playwright` provider，在真实浏览器中渲染 SolidJS 组件，共 29 个文件
3. **Agent-browser E2E 测试**（`vitest.agent-browser.config.ts`）— AI 驱动 E2E，已通过 ADR-0034 迁移完成

第②层依赖 `playwright` 和 `@vitest/browser-playwright` 两个包，与 Vercel 官方测试策略（"单元测试 + E2E，不做组件测试"，如 Next.js、Turborepo、agent-browser 项目均无组件测试）不一致。维护这三层测试的成本与收益已偏离平衡。

## 决策

将 29 个 Vitest browser 组件测试按以下三类策略迁移，迁移完成后移除 `@vitest/browser-playwright` 和 `playwright` 依赖。

## 迁移策略

### 三类测试处理方式

**🔵 行为验证类（~14 个测试）— 迁移到 agent-browser E2E**

这些测试验证的是用户可见的行为（点击导航、滚动后 UI 变化、页面状态切换），agent-browser 的 AI 断言可以覆盖。

迁移方式：在 `sub-flows.test.ts` 或 `main-flow.test.ts` 中添加新 describe/it 块，用 `aiAssert` 验证行为结果。

典型例子：
- NovelDetail 双击回顶 → `aiAssert("双击顶部后页面回到顶端")`
- SeriesSheet 系列列表 → `aiAssert("系列章节列表正常加载")`
- PersonalCenter 菜单点击 → 已有 E2E 覆盖（用户子路由）

**🟡 DOM 属性检查类（~8 个测试）— 迁移到 agent-browser + evaluate()**

这些测试需要精确检查 CSS class、计算样式、DOM 属性。agent-browser 的 accessibility tree 不包含这些信息，但可以通过 `driver.evaluate()` 在浏览器中执行 JS 获取精确值后 `expect()` 断言。

需要在 `driver.ts` 中新增辅助方法：
```ts
async getAttribute(selector: string, attr: string): Promise<string | null>
async getComputedStyle(selector: string, prop: string): Promise<string>
```

典型例子：
- CollapsedHeader 的 `opacity-0` class → `driver.evaluate("el.classList.contains('opacity-0')")`
- ThemeSelectorSelection 的 `aria-pressed` → `driver.evaluate("el.getAttribute('aria-pressed')")`
- 各类文本内容 → `driver.evaluate("el.textContent")`

**🔴 Mock 依赖类（~7 个测试）— 重构或删除**

这些测试依赖 `vi.mock()`、`vi.fn()`、mock Capacitor/router/API 数据，agent-browser 在完整应用中运行无法注入 mock。

处理方式：

| 原测试 | 处理 | 原因 |
|--------|------|------|
| UserWorksFeed（mock 子组件、display: none） | 移到 `tests/unit/` | 保留组件编排逻辑验证，去掉浏览器依赖 |
| NovelDetailDedupe（spy 函数调用） | 移到 `tests/unit/` | 保留请求去重逻辑验证 |
| NovelTextListCard（mock 回调参数） | 移到 `tests/unit/` | 保留回调参数验证 |
| LoginFluent（animation-name、CSS 变量） | **删除** | 测试的是 Fluent Web Components 库行为，非 Pictelio 逻辑 |
| NovelCard（精确 mock 数据匹配） | **删除** | 测试数据已硬编码，无实际覆盖价值 |

### 执行顺序

| 批次 | 内容 | 依赖 |
|------|------|------|
| 第一批 | driver.ts 新增 `getAttribute`/`getComputedStyle` 辅助方法 | 无 |
| 第二批 | 迁移 🟡 DOM 属性类（CollapsedHeader、IllustTags、ThemeSelector 等） | 第一批 |
| 第三批 | 迁移 🔵 行为验证类（NovelDetail、SeriesSheet、VirtualFeed 等） | 第二批 |
| 第四批 | 重构/删除 🔴 mock 依赖类 | 第三批 |
| 清理 | 删除 `vitest.browser.config.ts`、`@vitest/browser-playwright`、`playwright` | 第四批 |

### 测试文件变更清单

```
packages/app/tests/
├── agent-browser/specs/sub-flows.test.ts    ← 新增 🔵 🟡 类测试
├── unit/                                     ← 新增重构后的 🔴 类测试
│   ├── components/
│   │   ├── UserWorksFeed.test.ts            ← 从 browser/ 移入
│   │   ├── NovelDetailDedupe.test.ts        ← 从 browser/ 移入
│   │   └── NovelTextListCard.test.ts        ← 从 browser/ 移入
└── browser/                                  ← 全部删除（29 文件）
```

### 依赖清理

```diff
- "playwright": "^1.61.1",
- "@vitest/browser-playwright": "^4.1.10",
```

同时删除 `vitest.browser.config.ts` 和 `tests/browser/setup.ts`。

## 考虑过的方案

### 方案一：保留所有组件测试

维持三层架构不变，只维护现有测试。

**拒绝原因**：与 Vercel 项目（Next.js、Turborepo、agent-browser）已验证的"单元测试 + E2E"策略不一致，三层增加维护负担。

### 方案二：全部迁移到 E2E

所有 29 个测试都用 agent-browser 覆盖，不做单元测试迁移。

**拒绝原因**：依赖 mock 的测试（spy 函数调用、mock 数据渲染）在 E2E 中无法运行，强行迁移会丢失覆盖。

### 方案三：仅删除不重构

直接删除全部 29 个组件测试，不做任何替代。

**拒绝原因**：部分测试验证了 Pictelio 的核心业务逻辑（去重、组件编排），直接删除会降低代码质量保障。

## 涉及文件

- `packages/app/tests/browser/` — 全部 29 个测试文件（逐步删除）
- `packages/app/tests/unit/components/` — 3 个新建单元测试
- `packages/app/tests/agent-browser/specs/sub-flows.test.ts` — 新增 E2E 测试
- `packages/app/tests/agent-browser/driver.ts` — 新增 getAttribute/getComputedStyle 方法
- `packages/app/vitest.browser.config.ts` — 全量迁移完成后删除
- `packages/app/tests/browser/setup.ts` — 全量迁移完成后删除
- `packages/app/package.json` — 移除 playwright、@vitest/browser-playwright 依赖
