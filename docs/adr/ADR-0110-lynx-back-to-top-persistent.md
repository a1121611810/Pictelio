# ADR-0110: app-lynx 回顶按钮（常驻版）

- 状态：accepted
- 日期：2026-08-24
- 关联：ADR-0109（superseded——阈值感知设计被平台事实否决）、ADR-0107（RefreshableList 深模块）、ADR-0108（原生 keyframes 动画实证）、`packages/app-lynx/CONTEXT.md`（回顶按钮 / back-to-top button）
- 来源：grill-with-docs 会话——T1 T-spike 实证原设计（滚动阈值感知）不可行，用户拍板改常驻按钮

## 背景

ADR-0109 原设计：滚动超过阈值（800px）才显示回顶按钮，依赖 `<list>` 的 per-frame `scroll` 事件做位置感知。T1 T-spike 模拟器实测（四色探针，2026-08-24）**否决该前提**：

**平台事实（实证）：`<list>` 对 JS 派发的滚动事件仅 `load` / `scrolltolower` / `scrolltoupper`（边界事件）。** `@scroll` / `@scrollend` / `@scrollstatechange` 直接绑定 + `scroll-event-throttle="100"` 四路全测，JS 端零派发。字节码佐证：`LynxListEvent.EVENT_SCROLL` 常量存在但派发受 `mEnableScrollEvent` 门控；per-frame scroll 是 scroll-view 的特性，list 事件面被裁剪。因此"滚动超过一定距离显示"在 JS 层**无信号源**（原生桥/每帧 bridge 违背 ADR-0106 性能原则；worklet 本工具链无支持证据）。

用户拍板：**按钮常驻**——彻底砍掉感知层。

## 决策

1. **按钮常驻**：右下角（刷新 FAB 上方，`right-4 bottom-[25.6vw]`）M3 small FAB 40dp，恒显示。无阈值、无显示/隐藏状态机、无滚动感知。顶部时点击为无害 no-op（list 已在前端）。
2. **触发 = scroll-to-index + 一次性复位 timer**：tap 置 `backToTopPending` → `scrollProps` 的 `'scroll-to-index'` 变 `{ index: 0, smooth: true }`（对象形态 + isSmooth 已字节码实证）→ 原生平滑回顶。`scroll-to-index` 仅在**值变化**时触发——1000ms 一次性 timer 清 pending（值回 undefined，下次 tap 可再触发）；复位窗口内连点防重入。
3. **红线修订**：原"禁止 setTimeout"（ADR-0109）改为——**禁止 timer 驱动动画 / 常驻轮询；允许一次性触发复位 timer（有界 1000ms、非动画驱动、onUnmounted 清理）**。负向单测相应放宽为断言复位 timer 有界 + 清理。
4. **接口 = scoped slot 不透明句柄**（沿用 ADR-0109 D1，spike 已验证渲染正常）：`v-slot="{ scrollProps }"` + `<list v-bind="scrollProps">`。`scrollProps` 现仅含 `'scroll-to-index'`（无 onScroll）。页面每列表 +1 行。
5. **动画**：挂载入场 keyframes（fade + 上滑 + 微缩放，200ms，ADR-0108 已验证机制）+ 按压反馈（`active:bg-layer-pressed-on-surface`）+ 回顶本身为原生平滑滚动。
6. **删除**：`createBackToTopState` 原语（阈值状态机不再需要，无逻辑可收口——删除测试删除测试同删）；原 spec 的阈值/感知/边界表废弃。

## 被考虑的方案

- **滚动阈值感知**（ADR-0109 原设计）：`<list>` 无 per-frame scroll，JS 无信号源。否决。
- **原生桥暴露 scrollTop**：违背"零新原生面" + per-frame bridge 性能反模式（ADR-0106 否决项）。否决。
- **main-thread worklet（scroll-monitor-tag）**：本工具链（rspeedy 4.0.1 / vue-lynx）无 worklet 支持证据，spike 成本高、成功概率低。否决。
- **list-item appear 事件推算位置**：瀑布流高度不定，脆弱。否决。
- **scrolltolower/toupper 粗粒度**（滚过一页显示）：语义偏移（一页 ≈ 3-4 屏），且用户已拍板常驻更优。否决。

## 后果

- 正面：砍掉整个感知层（状态机/阈值/scroll 事件/探针），实现面大幅缩小；按钮常驻无感知依赖；复用已验证机制（keyframes 动画 ADR-0108、scroll-to-index 属性通道、scoped slot 渲染）；页面 9 处各 +1 行。
- 负面：按钮在列表顶部/短列表时无实际作用（无害 no-op）；遮挡右下角内容（与刷新 FAB 垂直堆叠，56dp 见方区域，可接受）。
- 待验证项（实现期模拟器闭环）：scroll-to-index 平滑回顶实际生效；1000ms 复位 timer 下重复点击再触发；入场动画表现；刷新 FAB 与回顶按钮互不干扰（位置/事件）。
