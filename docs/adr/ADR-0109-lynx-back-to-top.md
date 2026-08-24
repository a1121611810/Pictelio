# ADR-0109: app-lynx 回顶按钮（scroll-to-index 通道 + scoped slot 接口）

- 状态：accepted
- 日期：2026-08-24
- 关联：ADR-0107（RefreshableList 深模块：FAB 刷新入口）、ADR-0108（原生 keyframes 动画实证）、ADR-0104（createMixFeed 分页）、`packages/app-lynx/CONTEXT.md`（回顶按钮 / back-to-top button）
- 来源：grill-with-docs 会话，用户拍板：右下角回顶按钮、滚动超阈值才显示、带动画；本 ADR 按推荐定案

## 背景

列表页滚动较长后无回顶手段（下拉刷新已废弃，FAB 只负责刷新）。需求：右下角回顶按钮，滚动超过阈值才显示（不常驻），带动画，点击平滑回顶。

**技术前提（字节码实证 2026-08-24，`lynx-4.0.1.aar`）：**

1. **回顶通道 = `scroll-to-index` 属性**：`UIScrollView`/`AbsLynxUIScroll` 处理，含 `isSmooth`/`smooth` 标志与 `scrollToPositionSmoothly`（原生平滑滚动）；**走属性 patch 管线**，不经过已废弃的 SelectorQuery（ADR-0107 平台事实 ①）。
2. **位置感知 = `@scroll` 事件**：`LynxScrollEvent` payload 含 `scrollTop`/`scrollLeft`/`scrollHeight`/`scrollWidth`/`deltaX`/`deltaY`；list 另有 `scrollend`/`scrollstatechange`。
3. **动画 = CSS keyframes**：ADR-0108 已实证原生 transform 旋转可用。
4. **定位档位**：tailwind spacing vw（bottom-6=6.4vw、FAB 高 14.933vw、right-4=4.267vw）。

**核心设计约束**：list 位于页面 slot（数据绑定在页面），组件无法直接给 slot 内容绑 `@scroll`/`:scroll-to-index`——需"触达"页面拥有的 list 元素。

## 决策

1. **接口 = scoped slot 不透明句柄**：RefreshableList 暴露 `v-slot="{ scrollProps }"`，页面 list 加一行 `v-bind="scrollProps"`（`onScroll`→`@scroll` 事件、`scrollToIndex`→`:scroll-to-index` 属性，Vue v-bind 语义天然映射）。调用方只需学习 1 个事实（把不透明对象展开到 list），阈值状态机/按钮/动画/触发全隐藏——深模块。`scrollProps` 为 computed 缓存（仅 pending 翻转时新实例，避免无关渲染抖属性）。vue-lynx 基于 Vue 标准编译器 + runtime-core，scoped slot 属核心机制，**T-spike 实证**；失败退页面桥接（浅模块权衡，如实标注）。
2. **回顶触发 = scroll-to-index 对象形态**：`{ index: 0, smooth: true }`（isSmooth 实证）；`pending` ref 驱动，tap 置 true、scrollTop≈0 自清（无 timer，ADR-0107 红线）。对象形态 spike 证伪则退化纯数字 `0` + 移除重加（instant）。
3. **阈值状态机 = 纯函数原语 `createBackToTopState(threshold)`**（primitives/，对齐 createFeedVirtualizer 先例）：`onScroll(scrollTop) → visible` 仅阈值穿越时翻转（不每帧 setState）；`tap()` 置 pending；`pending` 在 scrollTop≤1 自清；`reset()` 供卸载复位。node 环境直接单测（内部 seam = 测试面）。
4. **阈值 = 800px**（≈1.5 屏 @720x1280，T-spike 校准；可选 prop 覆盖）。
5. **按钮 = M3 small FAB 40dp（10.667vw）**：`surface-container-high` + on-surface ↑ 字形、`elevation-2` 按压降 1、a11y「回到顶部」（注册表常量）；定位 `absolute right-4 bottom-[25.6vw]`（刷新 FAB 上方：6.4+14.933+~4.3 间距）；`v-if="visible"` 仅可见时挂载。
6. **动画 = 入场 keyframes**（fade-in + translateY(8→0) + scale(0.92→1)，200ms `--durationNormal`，M3 emphasized-decelerate）；**隐藏 v1 瞬撤**（setTimeout 红线禁止延迟卸载；`animationend` 支持列为增量 spike，不进 v1）。
7. **范围 = 9 列表实例统一**（沿用 ADR-0107 D5）；短列表由阈值天然过滤；组件名保留 `RefreshableList`（演进为"列表滚动操作容器：刷新 + 回顶"，CONTEXT.md 术语承载）。

## 被考虑的方案

- **页面桥接（prop/event + 页面自持 scrollIndex ref）**：接口 3+ 事实 + 页面持有状态 + 复位逻辑，状态散落 9 页，浅模块。仅作 scoped slot 失败时的兜底。
- **全局共享 store**：隐式耦合，否决。
- **独立 BackToTop 组件**：面临同样的"触达 list"问题，且页面需双层包裹，更差，否决。
- **scroll 事件冒泡捕获**：Lynx scroll 事件冒泡性未实证且无法解决 actuation（scroll-to-index 仍须绑定在 list 上），否决为主通道（可作 T-spike 附带观察）。
- **常驻按钮**：违背需求（不常驻），否决。
- **JS 逐帧回顶**（requestAnimationFrame/定时器驱动 offset）：每帧 bridge，违背 ADR-0106 性能结论，且 timer 触碰红线，否决。

## 后果

- 正面：9 页各 +1 行（v-bind）获得完整回顶能力（locality 单点）；原生平滑滚动 + 原生动画线程（零 JS 逐帧）；零新原生面（既有属性/事件通道）；阈值状态机纯函数可 node 单测；复用已验证的 keyframes 机制（ADR-0108）。
- 负面：接口依赖 scoped slot（vue-lynx 支持度 T-spike 实证）；`scroll-to-index` 重复触发依赖 pending 移除重加（值变化语义）；回顶中无"已触发"视觉态（按钮随阈值隐藏，可接受）。
- 待验证项（T-spike / 模拟器闭环）：scoped slot 支持、scroll-to-index 对象形态 + 重复触发 + 程序化滚动是否派发 @scroll（pending 自清依赖此）、scrollTop 单位（px/dp）、阈值校准、动画表现。
