# app-lynx 回顶按钮（常驻版） —— 功能规格

> 来源：grill-with-docs 会话（T1 T-spike 否决阈值感知，用户拍板常驻）；决策记录：ADR-0110（supersede ADR-0109）；术语：`packages/app-lynx/CONTEXT.md`（回顶按钮 / back-to-top button）
> 状态：ready-for-agent

## Problem Statement

列表页右下角回顶按钮：点击平滑回顶、有动画。ADR-0109 的"滚动超阈值显示"因 `<list>` 无 per-frame scroll 事件（平台事实，T-spike 实证）不可行，改为**常驻显示**。

## Decisions（ADR-0110 映射）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 常驻 | 按钮恒显示（无阈值/感知）；顶部点击为无害 no-op |
| D2 | 触发 | tap → `emit('back-to-top')` → 页面 `@back-to-top="refreshEpoch++"` → list `:key` 重建（重建即回顶）；防重入 1000ms timer 窗口连点只重建一次 |
| D3 | 红线修订 | 禁 timer 驱动动画/常驻轮询；允许一次性触发复位 timer（有界、onUnmounted 清理） |
| D4 | 接口 | `:refresh` prop + `@back-to-top` 事件 + slot（2 元素；无 scoped slot/scrollProps） |
| D5 | 动画 | 挂载入场 keyframes（fade+up+scale 200ms）+ 按压反馈 + 原生平滑回顶 |
| D6 | 删除 | `createBackToTopState` 原语及其测试删除 |

## 模块接口（RefreshableList.vue）

```vue
<RefreshableList :refresh="refreshFeed" @back-to-top="refreshEpoch++">
  <list :key="refreshEpoch" …>…</list>
</RefreshableList>
```

| 接口元素 | 类型 | 语义 | 不变量 |
|---------|------|------|--------|
| `refresh` | prop `() => Promise<void> \| void` | 幂等刷新函数（既有） | 同 ADR-0107 |
| `back-to-top` | event `() => void` | 回顶按钮点击 → 页面应 bump list `:key` 强制重建 | 重建即回顶（与刷新 epoch 同机制） |
| 默认 slot | `<list>` | 现有列表 | 恰好一个可滚动子元素 |

## 组件内部

- 刷新部分：不变（ADR-0107/0108）
- 回顶：`backToTopPending` ref + `BACK_TO_TOP_RESET_MS=1000` 一次性 timer（防重入）；tap → `emit('back-to-top')`；`onUnmounted` 清 timer
- 按钮：常驻，`back-to-top-in` 入场动画类（挂载即播一次），无 v-if

## 状态与边界

| 场景 | 行为 |
|------|------|
| 列表顶部点回顶 | emit → 重建（list 已在顶部，无视觉变化）；无害 |
| 滚动后点回顶 | emit → `:key` 重建 → 新列表起始顶部（V2 像素级 0.0） |
| 1s 内连点 | 防重入（只重建一次） |
| 回顶后再次滚动、再点 | 复位已完成 → 再次重建回顶（V3） |
| 组件卸载（切 tab） | onUnmounted 清 timer，无泄漏 |
| 刷新 FAB 与回顶 | 垂直堆叠（回顶在上），事件互不干扰（V4） |
| 短列表 | 按钮常驻（无感知），点击为无害重建 |
| web-core | 同构模板 + 浏览器原生动画 |

## 测试计划

**单测（node）**：

1. `tests/unit.test.ts` 结构断言（oracle = ADR-0110 D1/D2/D4/D5）：
   - RefreshableList 含 `(e: 'back-to-top')` / `emit('back-to-top')` / `BACK_TO_TOP_RESET_MS = 1000` / 防重入 guard / `bottom-[25.6vw]` / `back-to-top-in` / `BACK_TO_TOP_A11Y_LABELS.backToTop` / `clearBackToTopReset`（onUnmounted 清理）
   - 负向：无 `<refresh` / `createSelectorQuery` / `createBackToTopState` / `scrollProps`（感知/直绑层删除）
   - timer 红线修订：断言 `BACK_TO_TOP_RESET_MS = 1000` 有界（不再断言无 setTimeout）
2. 页面断言：7 页 9 实例均 `@back-to-top="refreshEpoch++"`

**模拟器实测**（AVD `pictelio_ui`，lynx debug）：

| # | 项 | 通过判据 |
|---|----|---------|
| V1 | 常驻渲染 | 按钮恒显示于刷新 FAB 上方（表面色像素确认） |
| V2 | 回顶执行 | 滚动数屏 → 点回顶 → list `:key` 重建回到顶部（顶部区基线 vs 回顶后 = **0.0** 像素级一致） |
| V3 | 重复触发 | 再次滚动 → 再点 → 再次回顶（0.0）；防重入窗口内连点只重建一次 |
| V4 | 回归 | FAB 刷新（数据替换 diff 44 + RemoveNode 归零）、回顶按钮共存 |
| V5 | web 构建 | 双 bundle 构建无新 warning |

## 排除项（Non-goals）

- 不做滚动阈值显示（平台事实否决）
- 不做隐藏/退场动画（常驻无隐藏）
- 不做"顶部禁用态"（无感知信号）
- 详情页 / Me / ErrorPage 不加
- 不引入新原生面 / NativeModule / worklet

## 红线

1. timer 仅限一次性触发复位（1000ms 有界）；禁止 timer 驱动动画 / 常驻轮询
2. 不引入新原生面 / NativeModule
3. `scrollProps` 必须 computed 缓存（禁止每渲染新建对象抖 list 属性）
4. 模拟器实测异常 → 停下回报，不静默绕路

## Tickets

| # | 内容 | 前置依赖 | 验收 |
|---|------|---------|------|
| T0 | CONTEXT 术语 + ADR-0110 + ADR-0109 supersede + 本 spec | — | docs 提交 |
| T1 | 清理探针 + 实现常驻回顶（RefreshableList）+ 删 createBackToTop | T0 | `test:app-lynx` + `check:app-lynx` 绿 |
| T2 | 9 页 v-slot/v-bind + 页面断言 | T1 | 单测绿 |
| T3 | 模拟器验收 V1-V5 | T2 | 截图/logcat 留证 |
| T4 | code-review 双轴 + 提交 | T3 | 提交绿 |
