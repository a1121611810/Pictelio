# app-lynx 放射导航 FAB 展开项按 M3 尺寸重定（B 方案 56dp 圆）

> 状态：ready-for-agent
> 前置决策：[ADR-0120](./docs/adr/ADR-0120-app-lynx-radial-nav-fab.md)（放射双层环悬浮 FAB）、[ADR-0121](./docs/adr/ADR-0121-app-lynx-radial-fab-m3-size.md)（本文所述 B 方案尺寸 + 层叠与扫角修复）
> 术语：见 `docs/adr/glossary-app-lynx-radial-nav-fab.md`

## Problem Statement

在 app-lynx 的**放射导航 FAB**（全局右下角双层环悬浮菜单，ADR-0120）展开后，用户发现两个问题：

1. **展开的菜单项被遮罩压住**：外环/内环菜单项落在半透明 scrim 遮罩之下，被压暗且点不到——点菜单项实际点到的是遮罩（`inset-0` + `pointer-events-auto`），直接触发收起而非执行该动作。
2. **菜单项内容太小**：外环图标仅 20dp、文字仅 11sp，内环图标仅 16dp，FAB 图标硬编码 22px，均明显低于 Material Design 3 推荐尺寸（24dp 图标 / 12sp 文字 / 24dp FAB 图标），与「按 M3 尺寸做」的预期不符。

## Solution

把放射导航 FAB 展开态的菜单项按 **M3 尺寸（B 方案 56dp 大圆）** 重定，并修复层叠与几何扫角问题：

- **层叠**：菜单项浮于遮罩之上，`遮罩(10) < 菜单项(20) < 主 FAB(30)`（同一 z-40 容器内），展开内容可见、可点。
- **尺寸（B 方案定稿）**：外环导航项为 **56dp 圆**（`14.93vw`），圆内 **24dp 图标**（`6.4vw`）+ **12sp 文字**（`3.2vw`）；内环动作项保持 **40dp 圆**（`10.67vw`）+ **24dp 图标**；FAB 图标 **24dp**（原 22px 硬编码改为 `6.4vw`）。
- **几何**：外环半径 `R_OUTER_VW` 从 31 提到 **35**（容纳 56dp 大圆防重叠）；外环扫角 `OUTER_END` 从 `-100°` 收窄到 **`-88°`**（末端项不再探出屏幕底边）。
- 尺寸换算基准：**vw 缩放 + 375dp 设计宽**（`1vw = 3.75px`），与 app-lynx 全项目 vw 缩放约定一致。
- **不改** `RefreshableList`（非 tab 页）的 pill FAB menu——两者职责不同（全局导航 vs 局部列表操作），形态差异是刻意的。

## User Stories

1. 作为 app-lynx 用户，当我点击右下角放射导航 FAB 展开菜单时，我希望所有导航项/动作项**清晰地浮在遮罩上方**，以便我看到完整菜单并准确点击目标项。
2. 作为 app-lynx 用户，当我展开菜单时，我希望**点击菜单项能执行该动作**（而非被遮罩拦截、误触发「收起」），以便菜单可正常使用。
3. 作为 app-lynx 用户，我希望**外环导航项（推荐/插画/小说/我的）是 56dp 大圆、含 24dp 图标 + 12sp 文字**，以便符合 Material Design 3 的视觉与触控标准。
4. 作为 app-lynx 用户，我希望**内环动作项（刷新↻ / 回顶↑）含 24dp 图标**，以便与 M3 图标尺寸一致、点击目标足够大。
5. 作为 app-lynx 用户，我希望**主 FAB 图标是 24dp**（而非 22px 硬编码），以便缩放一致、在不同屏幕尺寸下都不失真。
6. 作为 app-lynx 用户，我希望展开菜单时**所有菜单项都落在屏幕内、互不重叠**，以便小屏/窄屏下菜单也完整可用（修复末端项探出屏幕底边的 bug）。
7. 作为 app-lynx 用户，我希望**外环各项展开时有错落的进场动画**（stagger），以便交互反馈自然。
8. 作为 app-lynx 用户，我希望**开启 reduced-motion 时飞出/旋转动画被禁用**，以便符合无障碍偏好。
9. 作为 app-lynx 用户，我希望**菜单项仍有正确的无障碍标注**（主 FAB「打开菜单/关闭菜单」、内环刷新「刷新列表」、回顶「回到顶部」），以便读屏与 Appium E2E 正常。
10. 作为 app-lynx 维护者，我希望**非 tab 页（书签/关注列表/UserHome）的 RefreshableList pill FAB menu 保持不变**，以便本次改动不扩大影响面、不破坏局部列表操作。
11. 作为 app-lynx 维护者，我希望**全局放射导航 FAB 的开合/可见性/busy 互斥行为不变**（仍由 createGlobalFab 深模块 + createFabMenuState 状态机裁决），以便本次只改视觉与几何、不改导航语义。

## Implementation Decisions

- **改动面**：所有几何/尺寸改动集中在薄渲染适配器 `GlobalFab.vue`（模块级几何常量 + 模板 vw 值 + FAB 图标 px 值）。深模块 `createGlobalFab.ts`（`view`/`dispatch`/`usePage`）**零改动**——几何不属其职责（其 doc 注释 `几何/动效不在本模块职责`）。
- **几何常量（GlobalFab.vue 模块作用域）**：
  - `R_OUTER_VW`：`31` → `35`（防 56dp 大圆重叠；实测 35vw 中心距 57.1px > 56+4px 间隙）。
  - `R_INNER_VW`：保持 `20`。
  - `OUTER_END`：`-100` → `-88`（末端项停在 FAB 水平线上方，不再探底）。
  - `OUTER_START / INNER_START / INNER_END`：不变（`-8 / -14 / -80`）。
  - `FAB_SIZE_VW`（14.933）、`FAB_RIGHT_VW`（4.267）：不变（FAB 即 56dp，已符合 M3）。
- **模板尺寸（GlobalFab.vue）**：

  | 元素 | 现状 | 改为 | 依据 |
  |------|------|------|------|
  | 外环圆 | `w-[12.8vw] h-[12.8vw]` | `w-[14.93vw] h-[14.93vw]` | 56dp 圆 |
  | 外环图标 | `font-size: 5.33vw` | `font-size: 6.4vw` | 24dp 图标 |
  | 外环文字 | `font-size: 2.93vw`（+`mt-[1px]`） | `font-size: 3.2vw` | 12sp 文字 |
  | 内环图标 | `font-size: 4.27vw` | `font-size: 6.4vw` | 24dp 图标 |
  | FAB 图标 | `font-size: 22px` | `font-size: 6.4vw` | 24dp 图标 |
  | 内环圆 | `w-[10.67vw] h-[10.67vw]` | 不变 | 已对齐 M3 |
- **层叠（模板）**：给外环/内环菜单项加 z-index，令 `scrim(z-10) < 菜单项(z-20) < 主 FAB(z-30)`。容器保持 `z-40`。菜单项当前无显式 z-index（默认 0），故需显式设为 `z-20`（在容器 stacking context 内）。
- **尺寸基准**：vw 缩放 + 375dp 设计宽（`1vw=3.75px`，56dp=`14.93vw`、24dp=`6.4vw`、12sp=`3.2vw`）。沿用 app-lynx 全项目 vw 约定，**不**改固定 dp。
- **边界**：不改 `RefreshableList.vue` 的 pill FAB（`14.933vw` size、`h-[10.667vw]` 菜单项），避免被扫入（两者共享相似 token 但组件不同）。
- **无障碍标注不变**：`GLOBAL_FAB_A11Y_LABELS`（主 FAB 开/关）+ 内环复用 `FAB_MENU_A11Y_LABELS`（refreshList/backToTop）均不变，Appium/E2E 定位不受影响。
- **接口零变化**：`createGlobalFab` 的 `view`/`dispatch`/`usePage` 签名不变；9 页面的 `usePage` 注册逻辑不变；`createFabMenuState` 状态机不变。

## Testing Decisions

- **行为单测（已有 seam，不改）**：`packages/app-lynx/src/primitives/createGlobalFab.test.ts` 已覆盖 `view`/`dispatch`/`usePage` 行为——注入 fake `routeState`/`navigate`/`NAV_TABS`，断言 `visible/active/inner`、`navigate` 调用、busy 切换、内环装配、防重入。本改动不动深模块，该套测试应保持全绿。
- **结构单测（新增/更新）**：`packages/app-lynx/tests/unit.test.ts` 已有对 `GlobalFab.vue` 的 a11y 结构断言（`a11yLabel`、`GLOBAL_FAB_A11Y_LABELS.open/close`）。新增对**几何与层叠**的结构断言：
  - GlobalFab.vue 含外环圆 `14.93vw`、外环图标 `6.4vw`、外环文字 `3.2vw`、内环图标 `6.4vw`、FAB 图标 `6.4vw`；
  - GlobalFab.vue 含层叠序：scrim `z-10`、菜单项 `z-20`、FAB `z-30`（容器 `z-40`）。
  - 断言用**结构字符串**（`readFileSync` + `toContain`/正则），沿用现有 unit.test.ts 模式；**不断言具体像素坐标**（那是渲染行为，非结构契约）。
- **Oracle 溯源**：期望值来自 M3 规范与 ADR-0121 决策表（56dp=`14.93vw` 等由 `1vw=3.75px` 换算），非从实现反推。
- **geometry 断言不可行说明**：本改动是纯视觉/几何，无纯函数可单测（几何内联在 `GlobalFab.vue`）。故用结构断言锁定"用了正确的 token/值"，真实渲染正确性由模拟器 E2E + 视觉回归确认。
- **不改的测试**：`3 `createGlobalFab.test.ts` 行为套件保持绿色（深模块零改动）；`RefreshableList` 相关结构与 `14.933vw` 断言（针对非 tab FAB）不受影响。

## Out of Scope

- **不改 `RefreshableList` 的 pill FAB menu**（非 tab 页局部列表操作，ADR-0111）——形态差异是刻意的，本次不改其尺寸/形态。
- **不改导航语义**：`createGlobalFab` 的 `view`/`dispatch`/`usePage` 接口与行为、`createFabMenuState` 状态机（open/busy 互斥、防重入）均不变。
- **不改无障碍标注**：`GLOBAL_FAB_A11Y_LABELS` 与内环复用 `FAB_MENU_A11Y_LABELS` 不变。
- **不引入固定 dp**：坚持 vw 缩放 + 375dp 基准，不破坏 app-lynx 全局 vw 约定。
- **不新增菜单项/操作**：本次只调尺寸与几何，不新增/删除导航项或动作项。

## Further Notes

- 背景参考：ADR-0120（放射双层环 B 方案）、ADR-0111（M3 FAB menu，被替换）、ADR-0107（56dp=14.933vw 换算）。
- 原型参考：`packages/app-lynx/prototype/prototype-radial-menu-sizes.html`（三变体 A/B/C 比选，本变更取自 B 方案；原型已验证层叠序与 -88° 扫角下无溢出、无重叠）。
- 真机/E2E 待办：展开后菜单项可见可点、刷新/回顶/导航正常、无 RemoveNode。
