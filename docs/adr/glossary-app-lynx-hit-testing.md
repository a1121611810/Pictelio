# app-lynx 命中测试与覆盖层统一术语表

> 范围：`packages/app-lynx` 在**原生 LynxView** 上渲染覆盖层（遮罩、弹窗、悬浮菜单）时的**统一术语**与**平台约束**。配套 ADR：[ADR-0123](./ADR-0123-app-lynx-fab-hit-testing-fix.md)（本次修复）；相关 ADR：[ADR-0120](./ADR-0120-app-lynx-radial-nav-fab.md)（放射 FAB）、[ADR-0121](./ADR-0121-app-lynx-radial-fab-m3-size.md)（FAB 尺寸/层叠）、[ADR-0111](./ADR-0111-app-lynx-fab-menu.md)（RefreshableList FAB menu）。本表只定义领域语言与平台事实，不写实现。

## 核心术语

| 术语 | 定义 |
|------|------|
| **命中测试（hit-testing）** | 原生 LynxView 把触摸事件路由到目标元素的机制：取触点下**最顶层**（层叠序最高）的渲染元素作为事件目标。与 Web 语义一致，但**不识别 `pointer-events`**（见下）。 |
| **命中面（hit surface）** | 参与命中测试、可能成为触摸目标的一个渲染元素。**任何全屏元素都是命中面**——不管有没有内容、有没有背景色。 |
| **全屏层规则（full-screen layer rule）** | app-lynx 覆盖层的**不可变约束**：渲染树中的**全屏元素必须是交互面（带 `@tap` 句柄），否则必须从命中测试中移除**（`v-if` 条件渲染 / 零尺寸盒）。_Avoid_: 全屏元素 + `pointer-events-none` 指望它穿透触摸（原生不生效 → 吞掉其下所有点击）。 |
| **非命中层（inert layer）** | 从命中测试中移除、不参与触摸路由的层。实现手段只有两种：**`v-if` 不渲染**（关闭态最常用）或**零尺寸盒**（`absolute` 钉在 (0,0)、无宽高，只作定位锚点，子元素 vw 定位仍正常渲染）。`pointer-events: none` 在原生 LynxView **不是**合法手段。 |
| **定位锚点（positioning anchor）** | **平台事实**：原生 LynxView 把「最近的 view 祖先」当作 absolute 子元素的定位锚点——即使该祖先未设 `position`（与 Web「无定位祖先回退到视口」的语义不同，模拟器实测：`right/bottom` 按非全屏父盒边缘解析，FAB 直接跑出屏幕）。因此覆盖层元素的绝对定位一律用 **`left/top` vw + `translate(-50%,-50%)` 居中**（vw 视口基准，从 (0,0) 锚点起算恒等于视口坐标）。_Avoid_: 非全屏父盒内用 `right/bottom`。 |
| **交互面（interactive surface）** | 带 `@tap` 句柄的全屏层：触摸落在其上时事件被消费（如遮罩点空白收起）。示例：`CommentOverlay` 的遮罩 `@tap="onClose"`、`RefreshableList` 展开态 scrim `@tap="onCloseMenu"`。 |
| **pointer-events 平台约束（pointer-events platform constraint）** | **平台事实**：原生 LynxView（本项目 lynx `4.0.1`）的 hit-testing **不识别 `pointer-events` CSS 属性**（官方 3.5 才引入，4.0.1 实机实测仍不生效；2026-08-30 T5 真机验证 + 模拟器复现双重印证）。结果：`pointer-events: none` 的**全屏透明层依旧命中触摸**，吞掉其下页面全部点击。web-core（浏览器）行为正常，**双端行为不一致**——不能以 web-core 验证通过推断真机行为。_Avoid_: 用 `pointer-events` 控制覆盖层穿透。 |
| **展开层（expanded layer）** | 放射 FAB 的**展开态渲染层**：整层 `v-if="view.isOpen"` 条件渲染，内含遮罩（z-10）与菜单项（z-20）。关闭态整层不存在 → 渲染树无全屏命中面。 |
| **展开层叠序（expanded stacking order）** | 放射 FAB 展开后的层叠：**遮罩(z-10) < 菜单项(z-20) < 主 FAB(z-30)**，同一 **z-40 外层**内。外层为钉在 (0,0) 的**零尺寸盒**（只作定位锚点、不参与命中测试）；遮罩与菜单项整层 `v-if="view.isOpen"` 条件渲染（关闭态不存在），主 FAB 常显于其内。修复前（ADR-0123 之前）外层为**常显全屏容器**（`absolute inset-0` + `pointer-events-none`），关闭态吞掉页面全部点击（见「pointer-events 平台约束」）。ADR-0121 时期的 z 相对次序与此一致（当时容器常显全屏，FAB 在容器内 z-30）。 |
| **弹出动画习语（menu pop-in idiom）** | 菜单项进入动画的既定写法：**keyframes + `both` fill + 逐项 stagger**（`RefreshableList` 的 `item-rise`、放射 FAB 的 `fab-ring-in`）。覆盖层元素用 `v-if` 挂载时，`transition` 不触发（状态无变化），必须改用 keyframes。 |

## 边界约定

- 全屏层规则适用于**所有**覆盖层（弹窗 backdrop、菜单遮罩、引导层），不只是 FAB。
- 交互面的语义属于渲染适配器（`.vue` 模板），不进入深模块接口（`createGlobalFab` 不感知渲染/命中）。
- web-core 与原生 LynxView 的 hit-testing 行为可不同；**涉及穿透/遮挡的改动必须以原生验证为准**（模拟器或真机），web-core 全绿不构成充分证据。
