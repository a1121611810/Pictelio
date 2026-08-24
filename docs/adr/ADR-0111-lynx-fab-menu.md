# ADR-0111: app-lynx 采用 M3 FAB menu 整合刷新与回顶入口

## 状态

- 提案人：AI Agent
- 日期：2026-08-24
- 状态：accepted
- 依赖：ADR-0107（刷新 FAB）、ADR-0108（刷新旋转动画）、ADR-0110（回顶按钮常驻 + 重建回顶）

## 背景

app-lynx 当前列表页使用 `RefreshableList` 组件承载两个常驻浮动入口：

1. 刷新 FAB（56dp，右下角），ADR-0107/0108。
2. 回顶 small FAB（40dp，叠于刷新 FAB 上方），ADR-0110。

随着入口增加，两个堆叠 FAB 开始显得拥挤，且回顶按钮常驻占用列表可视区域。用户希望把入口整合为一个更干净的交互模式。

Material Design 3 于 2025 年 5 月 M3 Expressive update 新增官方组件 **FAB menu**，明确用于「从 FAB 展开 2–6 个相关操作」，并声明「应取代 speed dial 和任何堆叠 small FAB 的用法」。该组件与我们「刷新 + 回顶」两个紧密相关操作的场景完全匹配。

## 决策

将 `RefreshableList` 的刷新与回顶入口合并为 **M3 FAB menu**：

- 常态：一个刷新 FAB（↻）。
- 点击 FAB 后：FAB **变身为 close button**（✕，56dp 原位），浮出 scrim，并从 FAB top-trailing edge 展开两个 pill 形 medium-button 规格菜单项：「刷新」「回顶」。
- 菜单项执行对应操作并自动收起。
- 页面接口**零变化**：仍仅 `:refresh` + `@back-to-top` + 默认 slot。

## 理由

1. **官方语义匹配**：M3 FAB menu 明确用于 2–6 个相关操作，刷新与回顶同属「列表操作」，且官方要求取代堆叠 small FAB。
2. **接口深度保持**：`RefreshableList` 仍是一个深模块——复杂交互内收，9 个调用页零改动。
3. **屏幕空间更干净**：常态只留一个 FAB，回顶操作需要时再出现。
4. **可测试性**：抽出 `createFabMenuState` 纯函数状态机，node 单测锁定互斥不变量；结构单测锁定模板与 a11y 契约。

## 关键规范摘录（来自 M3 官方 `components/fab-menu/*`）

- FAB menu opens from a FAB to show **2–6 related actions**.
- It should **replace the speed dial and any usage of stacked small FABs**.
- The FAB should **transform into the close button** of the FAB menu.
- Menu items should always have **label text**; icons shouldn't be removed.
- FAB menu items share measurements with the **medium button specs**.
- The close button should always be **56dp**.
- FABs should always have **16dp margins** (24dp on large windows).
- The menu animates from the **top trailing edge** of the FAB.
- On web, FAB menu inherits states/specs from the baseline menu component.
- Accessibility: 48dp minimum target; initial focus on close button; item labels match UI text.

## 实现要点

### 模块边界

- `primitives/createFabMenu.ts`：纯逻辑状态机（`open/busy/toggle/close/startRefresh/endRefresh/reset`），无渲染。
- `components/RefreshableList.vue`：内部组合状态机 + 渲染，外部接口不变。
- 9 个页面：无改动。

### 状态机不变量

```
- busy=true  → toggle()/open() no-op（刷新中禁止展开）
- open=true  → toggle() 触发 close()（close button 语义）
- startRefresh() → open=false, busy=true
- reset() → open=false, busy=false
```

### 视觉规格

| 元素 | 规格 |
|------|------|
| 主 FAB / close button | 56dp，primary-container，图标 ↻/✕ 切换，同节点原位。 |
| 菜单项 | medium button：40dp 高，pill 圆角，surface-container，图标 + label。 |
| 边距 | FAB 16px（`right-4 bottom-6`），menu 距 FAB 4dp。 |
| 展开动画 | scrim fade-in 200ms；items 从右上角 stagger 浮出（60ms）。 |
| 收起动画 | v1 **瞬撤**（Lynx 无 `transitionend`，避免 setTimeout）。 |

### 无障碍变更

移除：
- `REFRESH_A11Y_LABELS.refreshList: '刷新列表'`
- `BACK_TO_TOP_A11Y_LABELS.backToTop: '回到顶部'`

新增：
```ts
FAB_MENU_A11Y_LABELS = {
  toggleMenu: '列表操作菜单',
  refreshList: '刷新列表',
  backToTop: '回到顶部',
}
```

- 主 FAB 用 `toggleMenu` label（描述将打开的菜单）。
- 菜单项 label 与 UI 文本一致。

## 验收

- [x] `createFabMenuState` 行为单测（8/8）
- [x] `tests/unit.test.ts` 结构断言（335/335）
- [x] `tsc` 类型检查
- [x] 模拟器 E2E 全链路（pictelio_ui/android-34，2026-08-24）：
  - 常态单 FAB（↻，右下角）✓
  - 点击展开（scrim + ✕ + 刷新/回顶两项 pill 按钮）✓
  - 点「刷新」（数据替换 + FAB 回 ↻）✓
  - 滚动后展开 → 点「回顶」（epoch 重建回顶 + FAB 回 ↻）✓
  - 点 scrim 收起 ✓
  - logcat 无 RemoveNode / 渲染错误 ✓

## 影响

- 9 个列表页无需任何改动（接口不变）。
- 旧的 `REFRESH_A11Y_LABELS` 与 `BACK_TO_TOP_A11Y_LABELS` 被移除；任何未来 Appium E2E 若依赖旧 label 需同步更新为 `FAB_MENU_A11Y_LABELS`。

## 相关文档

- docs/specs/app-lynx-fab-menu.md
- packages/app-lynx/CONTEXT.md（列表刷新术语更新）
