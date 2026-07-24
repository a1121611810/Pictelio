# ADR 0029: 消除 uiStore 与 themeStore 间的循环引用

## 状态

已批准 — 立即执行

## 分类

重构

## 日期

2026-07-17

## 背景

ADR-0020 将设置字段从 `uiStore.ts` 迁出到 `settingsStore.ts`，但主题相关字段（`theme`、`resolvedTheme`、`followSystemTheme`）仍留在 `uiStore.ts` 中。与此同时，`themeStore.ts` 需要引用 `uiStore.resolvedTheme` 来同步 `<html>` 的 dark class：

```typescript
// themeStore.ts:4
import { resolvedTheme } from "@/stores/uiStore";
```

这造成了跨 store 交叉引用：uiStore 主题字段 → themeStore 消费 → themeStore 独立管理页面风格。虽然 TypeScript 不会报循环依赖（import 是值引用而非类型引用），但架构上模糊了职责边界：

1. **订阅放大**：`currentTab`（导航状态）每秒都可能变化，但存储在同一个 `createStore` 中，themeStore 的 effect 虽不会因 `currentTab` 变化而触发，但从概念上混淆了关注点
2. **resetUiStore 不完整**：`resetUiStore()` 仅恢复主题到 system 默认值，但无法完全重置 themeStore 的状态
3. **测试困难**：测试 themeStore 时必须同时 mock uiStore 的主题导出

## 决策

### D1: 将所有主题状态迁入 themeStore

将 `uiStore.ts` 中以下字段和函数迁移到 `themeStore.ts`：

| 当前位置 (uiStore) | 目标位置 (themeStore) |
|-------------------|----------------------|
| `theme` signal | `themeStore` internal state |
| `resolvedTheme` signal | `themeStore` internal state |
| `setTheme()` | `themeStore.setTheme()` |
| `setThemePersisted()` | `themeStore.setThemePersisted()` |
| `loadThemePreference()` | `themeStore.loadThemePreference()` |
| PREF_KEY_THEME constant | `themeStore` private constant |
| `computeResolvedTheme()` | `themeStore` private function |
| `getSystemTheme()` | `themeStore` private function |
| matchMedia change listener | `themeStore` module-level effect |

### D2: themeStore 成为主题唯一真相源

- `themeStore` 完全管理明暗主题
- 所有引用 `import { resolvedTheme } from "@/stores/uiStore"` 改为 `from "@/stores/themeStore"`
- `resetUiStore()` 不再处理主题重置

### D3: uiStore 仅保留导航状态

- `currentTab`
- `contentType` + `setContentType()` + `loadContentTypePreference()`
- `PREF_KEY_CONTENT_TYPE` 常量

## 后果

### 正面
- 消除跨 store 循环引用
- 主题管理集中化，职责清晰
- 导航状态变更不涉及主题订阅者

### 负面
- 需要更新所有引用 `uiStore.resolvedTheme` 的 import 路径
- 需要导出新的公共 API 保持向后兼容（临时 re-export）

### 风险
低。涉及 import 调整 + 代码移动。测试覆盖率确保行为不变。
