# app-lynx 回顶按钮 —— 功能规格

> 来源：grill-with-docs 会话（用户拍板：右下角回顶、超阈值显示、带动画）；决策记录：ADR-0109；术语：`packages/app-lynx/CONTEXT.md`（回顶按钮 / back-to-top button）
> 状态：ready-for-agent

## Problem Statement

列表页滚动较长后无回顶手段。右下角增加回顶按钮：滚动超过阈值（默认 800px）才显示（不常驻），点击平滑回顶，带动画。

## Decisions（ADR-0109 映射）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 接口 | scoped slot 不透明句柄：`v-slot="{ scrollProps }"` + list `v-bind="scrollProps"`（页面 +1 行）；T-spike 实证，失败退页面桥接 |
| D2 | 回顶触发 | `scroll-to-index` 对象形态 `{ index: 0, smooth: true }`；`pending` 驱动，scrollTop≈0 自清（无 timer） |
| D3 | 状态机 | 纯函数原语 `createBackToTopState(threshold)`：仅阈值穿越翻转 visible；pending 自清；reset |
| D4 | 阈值 | 默认 800px（spike 校准）；可选 prop 覆盖 |
| D5 | 按钮 | M3 small FAB 40dp、↑ 图标、`surface-container-high`、elevation-2；`right-4 bottom-[25.6vw]`；v-if 挂载 |
| D6 | 动画 | 入场 keyframes（fade+up+scale 200ms）；隐藏 v1 瞬撤 |
| D7 | 范围 | 9 列表实例统一；短列表阈值天然过滤 |

## 模块接口（RefreshableList.vue）

```vue
<RefreshableList :refresh="refreshFeed" v-slot="{ scrollProps }">
  <list v-bind="scrollProps" …>…</list>
</RefreshableList>
```

| 接口元素 | 类型 | 语义 | 不变量 |
|---------|------|------|--------|
| `refresh` | prop `() => Promise<void> \| void` | 幂等刷新函数（既有，不变） | 同 ADR-0107 |
| `scrollProps` | slot prop（不透明） | `{ onScroll, scrollToIndex }` 展开到 list：onScroll→`@scroll` 监听、scrollToIndex→`:scroll-to-index` 属性 | 仅需展开一次；computed 缓存避免无关渲染抖动 |
| 默认 slot | `<list>` | 现有列表 | 恰好一个可滚动子元素 |

## 组件内部（调用方零感知）

```ts
// primitives/createBackToTop.ts（纯函数，node 单测）
createBackToTopState(threshold): { onScroll(scrollTop): boolean; tap(): void; pending: boolean; reset(): void }
```

- `scrollProps` = computed：`{ onScroll: handleScroll（稳定 fn）, scrollToIndex: pending ? { index: 0, smooth: true } : undefined }`
- 按钮：`v-if="visible"`；入场动画类随挂载重放
- `onUnmounted` → `reset()`（tab v-if 切换不串状态）

## 状态与边界

| 场景 | 行为 |
|------|------|
| scrollTop ≤ 阈值 | 按钮不显示（不常驻） |
| 上穿阈值 | visible=true（仅穿越帧 setState） |
| 下穿阈值（回顶滚动中/用户上滑） | visible=false |
| 点击回顶 | pending=true → scroll-to-index `{0,smooth}` → 原生平滑回顶 |
| 回顶到位（scrollTop≤1） | pending 自清（属性移除） |
| 连点回顶 | pending 中二次 tap no-op |
| 回顶中刷新（epoch 重建） | 新 list 首屏即顶；pending 由 scrollTop≈0 自清，无害 |
| 刷新 FAB 与回顶 | 垂直堆叠不重叠；状态独立 |
| tab 切换卸载 | onUnmounted reset + scrollTop=0 自纠 |
| 短列表 | 永不达阈值，按钮不出现 |
| 程序化滚动不派发 @scroll（spike 项） | pending 无法自清 → 兜底：scrollend/scrollstatechange 清 pending（T-spike 定） |
| scroll-to-index 对象形态不支持（spike 项） | 退化纯数字 `0` + 移除重加（instant 滚动） |

## 测试计划

**单测（node）**：

1. `primitives/createBackToTop.test.ts`（oracle = ADR-0109 D3/D4）：穿越/驻留/下穿/自清/reset 纯函数断言
2. `tests/unit.test.ts` 结构断言（oracle = ADR-0109 D1/D5/D6）：RefreshableList 含 `v-slot`/`scrollProps`/`scroll-to-index`/`{ index: 0, smooth: true }`/`bottom-[25.6vw]`/keyframes/a11y「回到顶部」/`createBackToTopState`/`reset()`
3. 页面断言：7 页 9 实例均 `v-slot="{ scrollProps }"` + list `v-bind="scrollProps"`
4. 负向断言保持（无 setTimeout / `<refresh` / createSelectorQuery 等）

**模拟器实测**（AVD `pictelio_ui`，lynx debug）：

| # | 项 | 通过判据 |
|---|----|---------|
| V1 | scoped slot | list 正常渲染（无编译/渲染错误） |
| V2 | 滚动出现 | 滚动 >800px 后按钮出现（入场动画）；回顶后消失 |
| V3 | 回顶执行 | 点击 → 平滑回顶到顶；logcat 无 scroll-to-index 解析错误 |
| V4 | pending 自清 | 回顶后可再次滚动/再次点击回顶（重复触发有效） |
| V5 | 回归 | FAB 刷新（旋转动画）、RemoveNode 归零、epoch 重建、tab 互斥不回归 |
| V6 | web 构建 | 双 bundle 构建无新 warning（登录墙降级，同构模板） |

## 排除项（Non-goals）

- 不做隐藏淡出动画（v1 瞬撤；animationend 支持为增量 spike）
- 不做"已回顶"视觉反馈
- 不引入 scroll-event-throttle（阈值穿越逻辑已免每帧重渲染）
- 详情页 / Me / ErrorPage 不加
- 不引入新原生面 / NativeModule
- 不改组件名（避免 9 页 churn）

## 红线

1. 不新增 `setTimeout` / JS 计时器（pending 自清不得用 timer）
2. 不引入新原生面 / NativeModule
3. 状态机必须走 `createBackToTopState` 纯函数（禁止组件内裸写阈值逻辑）
4. `scrollProps` 必须 computed 缓存（禁止每渲染新建对象抖 list 属性）
5. 模拟器实测异常 → 停下回报，不静默绕路

## Tickets

| # | 内容 | 前置依赖 | 验收 |
|---|------|---------|------|
| T0 | 术语 + ADR-0109 + 本 spec | — | docs 提交 |
| T1 | T-spike：Recommended 单页接入全链路（scoped slot + scroll-to-index 对象形态 + @scroll 单位 + 阈值校准） | T0 | 模拟器 V1-V4 过；结论回写 spec/ADR |
| T2 | `createBackToTopState` 原语 + 单测 | T0 | 单测绿 |
| T3 | RefreshableList 集成（scrollProps + 按钮 + 动画 + 触发）+ 结构单测 | T1 + T2 | 单测绿 |
| T4 | 9 页接入（v-bind 一行）+ 页面断言 | T3 | 单测绿 |
| T5 | 模拟器全量验收 V1-V6 + 回归 | T4 | 截图/logcat 留证 |
| T6 | code-review 双轴 + 提交 + ADR 待验证项回写 | T5 | 提交绿 |
