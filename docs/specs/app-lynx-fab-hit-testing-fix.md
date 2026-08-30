# app-lynx FAB 全屏容器吞触摸修复（原生 hit-testing 平台约束）

> 状态：ready-for-agent
> 前置决策：[ADR-0123](./docs/adr/ADR-0123-app-lynx-fab-hit-testing-fix.md)（根因 + 单根容器方案 + 平台约束固化）、[ADR-0120](./docs/adr/ADR-0120-app-lynx-radial-nav-fab.md)（放射双层环 FAB）、[ADR-0121](./docs/adr/ADR-0121-app-lynx-radial-fab-m3-size.md)（FAB 尺寸/层叠）
> 术语：见 `docs/adr/glossary-app-lynx-hit-testing.md`（命中测试/全屏层规则/交互面等）

## Problem Statement

在 app-lynx（lynx `4.0.1`，原生 LynxView）进入任意 tab 页（推荐/插画/小说/我的）后，**除右下角放射导航 FAB 外的所有点击都没有反应**：点作品卡、点菜单行、点遮罩区均无效；只有右下角 FAB 能展开菜单、切换 tab。

**复现证据**（模拟器原生，adb + 截图像素 diff）：菜单关闭态下点页面 scrim 区 → 0 像素变化（死）；点 FAB → 21,789 像素变化（菜单弹出，正常）；logcat 出现 `Lynx HandleEventInternal failed, response_chain empty`（触摸命中无句柄节点）。对照组登录页（无 FAB 容器）点击正常。

## Solution

移除 `GlobalFab.vue` 中**菜单关闭态仍存在的全屏透明容器**（`absolute inset-0 z-40 pointer-events-none`），改为**展开层条件渲染**：菜单关闭时渲染树中不存在任何全屏元素，页面点击自然穿透；菜单展开时遮罩（交互面）才出现。

- **渲染结构**（单根容器，保留 ADR-0121 层叠相对次序与 z 值）：外层（z-40，(0,0) 零尺寸盒锚点）→ 遮罩 `v-if="view.isOpen"`（z-10，显式 vw 全屏）+ 环层 `v-if="view.isOpen"`（z-20）+ 主 FAB（z-30，常显，`left/top vw + translate` 定位）。
- **平台约束固化**：原生 LynxView hit-testing 不识别 `pointer-events`；全屏元素必须是交互面（带 `@tap`）或不存在。此约束入术语表 + CONTEXT.md，作为 app-lynx 覆盖层的不可变规则。
- **同款清理**：`App.vue` exitHint 提示条移除 `pointer-events-none`。
- **动画迁移**：环项弹出动画从 `transition`（依赖 isOpen 状态变化）改为 **keyframes**（`both` + 逐项 stagger），对齐 ADR-0111 的 `item-rise` 弹出习语。

## User Stories

1. 作为 app-lynx 用户，当我进入任意 tab 页（菜单关闭态）时，我希望**点作品卡能进详情、点菜单行/开关有反应**，以便页面正常可用。
2. 作为 app-lynx 用户，当我点右下角 FAB 展开菜单时，我希望**遮罩盖住页面、点空白处收起菜单**，以便既有交互语义不回归。
3. 作为 app-lynx 用户，当我展开菜单时，我希望**外环导航项/内环动作项浮在遮罩之上且可点击**，以便菜单项不被遮罩拦截（ADR-0121 不变量保持）。
4. 作为 app-lynx 用户，我希望**主 FAB 在菜单开/关两种状态下都常显、可点**（展开态图标为 ✕、关闭态为当前 tab 图标），以便 FAB 始终是导航中枢。
5. 作为 app-lynx 用户，我希望**菜单项展开时仍有错落进场动画（stagger）**，以便交互反馈自然（reduced-motion 下禁用）。
6. 作为 app-lynx 用户，我希望**FAB 刷新 busy 状态（旋转 spinner、禁用）行为不变**，以便刷新语义不回归。
7. 作为 app-lynx 维护者，我希望**深模块 `createGlobalFab`（view/dispatch/usePage）零改动**，以便修复局限在薄渲染适配器、行为单测不受影响。
8. 作为 app-lynx 维护者，我希望**模板结构断言更新到新结构并新增负向断言**（不得再出现全屏 `pointer-events-none` 元素、展开层必须条件渲染），以便该平台约束有回归兜底。
9. 作为 app-lynx 维护者，我希望**新增 android-e2e 回归**（离线可点的确定性目标：Me 页「我的收藏」行导航），以便修复前后有红/绿闭环。
10. 作为 app-lynx 维护者，我希望**平台约束固化进术语表与 CONTEXT.md**，以便未来覆盖层组件不再踩 `pointer-events` 的坑（含 exitHint 同类清理）。

## Implementation Decisions

- **改动面**：全部在薄渲染适配器 `GlobalFab.vue`（模板结构 + ringStyle + keyframes）+ `App.vue`（exitHint 一行）+ 测试/文档。深模块 `createGlobalFab.ts` **零改动**。
- **GlobalFab.vue 模板结构**（单根容器，多子节点）：
  - 外层：`v-if="view.visible"`，`absolute z-40` + `style="top:0;left:0"`——(0,0) 零尺寸盒，只作定位锚点、不参与命中测试。
  - 遮罩：`v-if="view.isOpen"`，`absolute z-10 bg-scrim scrim-in`，`scrimStyle`（显式 `left:0;top:0;width:100vw;height:<屏高vw>`）`@tap="dispatchClose"`（交互面）。
  - 环层：`v-if="view.isOpen"`，`absolute z-20` 零尺寸盒，只承载环项；环项 `absolute z-20` + `left/top` vw + `translate(-50%,-50%)` + `fab-ring-in` keyframes。
  - 主 FAB：常显，`absolute z-30`，`fabStyle`（`left/top` vw + `translate(-50%,-50%)` + 尺寸 vw）`@tap="dispatchToggle"`。
- **定位锚点（原生平台事实）**：原生 LynxView 把「最近的 view 祖先」当作 absolute 子元素的定位锚点（即使祖先未设 position，与 Web 回退视口不同）；故覆盖层一律 `left/top` vw + translate，**禁止**在非全屏父盒内用 `right/bottom`。
- **ringStyle 改造**：删除 `pointer-events: s ? auto : none` 动态样式与 transition；返回 `left/top` vw + 静态 `transform: translate(-50%,-50%)` + `fab-ring-in` 动画（reduced-motion 时 `animation: none`）。
- **keyframes**：新增 `fab-ring-in`（`from translate(-50%,-50%) scale(0) opacity 0 → to translate(-50%,-50%) scale(1) opacity 1`），300ms `cubic-bezier(.05,.7,.1,1)`，`both` fill；stagger 沿用 `i*30ms`。
- **层叠序**：`遮罩(z-10) < 菜单项(z-20) < 主 FAB(z-30)`，同一 z-40 外层内（与 ADR-0121 z 值一致；外层由常显全屏容器改为 (0,0) 零尺寸盒锚点）。
- **exitHint**（App.vue）：取消全宽盒（`left-0 right-0`）+ 移除 `pointer-events-none`，胶囊居中定位（`left: 50vw; bottom: 12vw` + `translate(-50%,0)`）；命中面=提示条自身，双端一致、不盖 FAB 区域。
- **无障碍标注不变**：`GLOBAL_FAB_A11Y_LABELS` / `FAB_MENU_A11Y_LABELS` 与各 `accessibility-element` 均不动。
- **关闭动画代价**：环项收起瞬时（v-if 卸载）；主 FAB 旋转动画保留。与 `RefreshableList`（ADR-0111）一致，可接受。

## Testing Decisions

- **测试哲学**：只测外部行为与结构不变量，不测实现细节；平台约束（命中测试）以原生模拟器验证为准，web-core 全绿不构成证据。
- **单测**（既有接缝：`tests/unit.test.ts` 对 `GlobalFab.vue` 模板源码的结构断言，ADR-0121 先例）：
  - 更新现有「层叠序」断言到新结构（外层 `v-if="view.visible"` + `absolute z-40` + (0,0) 锚点、遮罩 `v-if` + `z-10 bg-scrim scrim-in` + `@tap`、环层 `v-if` + `z-20`、主 FAB `z-30`）。
  - **新增负向断言（本 bug 回归）**：模板不含 `pointer-events-none` / `pointer-events-auto`；遮罩与环层必须 `v-if="view.isOpen"` 条件渲染。
  - 深模块 `createGlobalFab.test.ts` 不动、全绿。
- **E2E**（android-e2e，adb 驱动，仿 `lynx-boot-renders.spec.ts` 轻量模式）：登录 → FAB 控制组 → FAB 切「我的」→ 点账户卡「我的收藏」行 → 断言导航到 /bookmarks（全屏像素 diff > 阈值）。离线可点、确定性；修复前红（0 变化）、修复后绿。
- **手动验证回路**（模拟器原生）：沿用 diagnosing-bugs 已建回路——菜单关闭态点页面 scrim/菜单行有反应（像素变化 > 阈值），点 FAB 展开/收起正常。

## Out of Scope

- 深模块 `createGlobalFab` 的行为/接口改动（零改动）。
- `RefreshableList`（非 tab 页）pill FAB menu 的结构（其 scrim 已是正确模式，不参与本次重构）。
- `CoverImage` 失败 overlay 的命中问题（图片盒内、无用户可见症状，仅记录）。
- Lynx 版本升级或原生 `pointer-events` 支持性跟进（平台事实固化即可，不阻塞修复）。
- web-core 预览的行为改动（其本就走 pointer-events 穿透，重构后语义等价，无用户可见变化）。

## Further Notes

- 模拟器复现环境（diagnosing-bugs 产物）：emulator-5556，lynx 客户端登录后 tab 页；修复验证复用同一回路。
- 本 bug 属「渲染适配器平台约束违规」，非模块接口问题；修复回归了 ADR-0111（RefreshableList）既有的「覆盖层条件渲染 + 交互面遮罩」正确模式。
- 提交遵循 Conventional Commits；本次文档（glossary/ADR/spec）+ 代码 + 测试拆分多个 commit。
