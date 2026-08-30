# ADR-0123: 修复放射 FAB 全屏容器在原生 LynxView 吞掉页面触摸（hit-testing 平台约束固化）

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0120（放射双层环悬浮 FAB，`GlobalFab.vue`）、ADR-0121（FAB 尺寸/层叠，容器内 `scrim z-10 < 菜单 z-20 < FAB z-30`）、ADR-0111（M3 FAB menu，`RefreshableList`——本问题的**正确对照实现**）、`packages/app-lynx/CONTEXT.md`（「推荐轮播 scrim」词条含 pointer-events 真机失效记录；「展开层叠序」词条需同步）、`docs/adr/glossary-app-lynx-hit-testing.md`（新建统一术语表）、`docs/adr/glossary-app-lynx-radial-nav-fab.md`（「展开层叠序」词条更新）
- 来源：用户报告「lynx 客户端进入后，除右下角全局导航外其他点击都没反应」。经 diagnosing-bugs 流程（模拟器原生复现 + logcat + 代码取证）确认根因；经 codebase-design 视角（与 `RefreshableList`/各 overlay 的正确模式对照）定稿修复方案。
- 术语：见 `docs/adr/glossary-app-lynx-hit-testing.md`（本文档只记录决策，不写代码）。

## 背景

app-lynx（lynx `4.0.1`，原生 LynxView）在 tab 页上出现**全页面点击失效、仅右下角放射 FAB 可点**。

**复现**（模拟器原生，adb 驱动 + 截图像素 diff）：推荐页菜单关闭态下，点 scrim 区（360,1000）→ **0 像素变化**（死）；点 FAB（635,1195）→ **21,789 像素变化**（菜单弹出，正常）。logcat 同步出现 `Lynx HandleEventInternal failed, response_chain empty`（触摸命中无句柄节点）。对照组：登录页（无 FAB 容器）点击正常。

**根因**：`GlobalFab.vue` 根容器为 `absolute inset-0 z-40 pointer-events-none` 的**全屏透明层**。原生 LynxView 的 hit-testing **不识别 `pointer-events`**（官方 3.5 才引入该属性，4.0.1 实机实测仍不生效——代码库已有今日实证记录于 CONTEXT.md「推荐轮播 scrim」词条与 Recommended.vue:244 注释）。于是该全屏层在菜单关闭态仍是命中面，盖在页面之上吞掉全部点击；只有画在它内部、`z-30` 的主 FAB 按钮能命中。

**设计层面的定性**：这是**渲染适配器的平台约束违规**，不是深模块 `createGlobalFab` 的接口问题（ADR-0120 的模块接口 `view/dispatch/usePage` 无需任何改动）。全仓同类模式扫描证明正确模式早已存在：`RefreshableList`（ADR-0111）的 scrim 是 `v-if="menu.isOpen"` + `@tap="onCloseMenu"`（**仅在展开时存在、且是交互面**）；`CommentOverlay`/`WatchlistPromptDialog` 等全屏 backdrop 均带 `@tap`。`GlobalFab` 是**全仓唯一**「全屏 + 无 `@tap` + 依赖 `pointer-events:none`」的违规实例——ADR-0120 引入时丢失了 ADR-0111 的既有约定。同款低危违规还有 `App.vue` 的 exitHint 提示条（全宽条 + `pointer-events-none`，双击返回后 2s 吞底部点击）。

## 决策

1. **修复原则（不可变约束固化）**：**渲染树中的全屏元素必须是交互面（带 `@tap`），否则不得存在（`v-if`/零尺寸盒）；`pointer-events: none` 不是合法的穿透手段**（原生 LynxView hit-testing 不识别）。此约束入术语表与 CONTEXT.md，作为 app-lynx 覆盖层的平台事实。
2. **`GlobalFab.vue` 改单根容器结构**（保留 ADR-0121 层叠相对次序、几何、动效语义）：

   ```
   外层    v-if="view.visible"  absolute z-40  style="top:0;left:0"  （(0,0) 零尺寸盒锚点，不参与命中）
   ├─ 遮罩   v-if="view.isOpen"  absolute z-10 bg-scrim  scrimStyle=显式 vw 全屏  @tap=dispatchClose  （交互面 ✓）
   ├─ 环层   v-if="view.isOpen"  absolute z-20  （零尺寸盒，只承载环项）
   │   ├─ 外环   v-for  absolute z-20  left/top vw + translate(-50%,-50%) + fab-ring-in keyframes
   │   └─ 内环   v-for  absolute z-20  （同上）
   └─ 主 FAB  absolute z-30  fabStyle=left/top vw + translate 居中  @tap=dispatchToggle  （常显）
   ```

   - **关闭态**：遮罩与环层整层不渲染 → 渲染树只有主 FAB → 页面点击穿透（与 `RefreshableList` 同语义）。
   - **展开态**：遮罩全屏（显式 vw 尺寸）`@tap` 收起；菜单项 `z-20` 浮于遮罩之上；主 FAB `z-30` 恒在。
   - **定位锚点（模拟器实测修订）**：原生 LynxView 把「最近的 view 祖先」当作 absolute 子元素的定位锚点（即使祖先未设 position，与 Web 回退视口不同）。首版实现曾让主 FAB 用 `right/bottom` vw + 独立层、外层零尺寸——FAB 按父盒边缘解析直接跑出屏幕（模拟器实测消失）。**修订**：外层钉在 (0,0)（绝对定位 + `top/left:0` + 零尺寸盒，只作锚点、不参与命中），遮罩/FAB 一律 `left/top` vw + `translate(-50%,-50%)`（vw 视口基准，从 (0,0) 起算恒等于视口坐标）。
   - **层叠序**：`遮罩(z-10) < 菜单项(z-20) < 主 FAB(z-30)`，同一 z-40 外层内——与 ADR-0121 的 z 相对次序**逐字一致**（外层由「常显全屏容器」改为「(0,0) 零尺寸盒锚点」+ 遮罩/环层条件渲染）。
   - **动画改 keyframes**：环项 `transition`（依赖 isOpen 状态变化）在 `v-if` 挂载下不触发，改 `fab-ring-in` keyframes（`both` + 逐项 stagger `i*30ms`，300ms `cubic-bezier(.05,.7,.1,1)`，对齐 ADR-0111 的 `item-rise` 弹出习语）；`ringStyle` 中原 `pointer-events` 动态样式删除（双端皆不再需要）。遮罩复用全局 `scrim-in` 淡入（200ms，ADR-0111 已有）。
   - **代价**：菜单关闭动画从 staggered 收起变为瞬时消失（主 FAB 旋转动画保留）。可接受——`RefreshableList` 同为 v-if 瞬时收起。
3. **`App.vue` exitHint**：取消全宽盒（`left-0 right-0`）并移除 `pointer-events-none`，改为**胶囊居中定位**（`left: 50vw; bottom: 12vw` + `transform: translate(-50%,0)`）。命中面只剩提示条自身：原生侧不再吞底部整条点击（其 z-50 高于 FAB 的 z-40 层，原先会盖住 FAB 区域），web-core 侧行为一致（原 `pointer-events-none` 在原生无效、在 web 才生效，双端本就分叉）。
4. **回归接缝**：
   - 单测（既有模板结构断言模式，`tests/unit.test.ts`）：更新 GlobalFab 结构断言到新结构，并新增**负向断言**——模板不得再含全屏 `pointer-events-none` 元素、展开层必须 `v-if="view.isOpen"` 条件渲染。
   - E2E（android-e2e，adb 驱动仿 `lynx-boot-renders.spec.ts`）：登录后经 FAB 进「我的」页，点账户卡「我的收藏」行，断言导航到 /bookmarks（全屏像素 diff；离线可点、确定性）。修复前该点击被全屏容器吞掉 0 变化（红）、修复后导航（绿）。
5. **文档同步**：新建 `glossary-app-lynx-hit-testing.md`；更新 `glossary-app-lynx-radial-nav-fab.md`「展开层叠序」、`packages/app-lynx/CONTEXT.md`（平台约束固化 + 展开层叠序措辞）。

## 被考虑的方案

- **保留全屏容器 + 用 Lynx 官方命中开关/属性**：Lynx 3.5 才引入 `pointer-events`，4.0.1 实机不生效（双重复现）；无其它可用命中测试开关（文档未检索到）。否决。
- **主 FAB 移出为兄弟根节点（fragment 多根模板）**：需依赖 vue-lynx 多根 fragment 支持，未验证。否决（单根容器无此风险）。
- **容器在关闭态收缩为 0 尺寸 + FAB 保留 `right/bottom`**：首版按此思路实现（外层零尺寸盒 + FAB 独立层 right/bottom vw），模拟器实测 **FAB 跑出屏幕**——原生 LynxView 把最近 view 祖先当定位锚点（即使未设 position），`right/bottom` 按父盒（0×0）边缘解析为负值。否决并修订：外层钉 (0,0) 作锚点，子元素一律 `left/top` vw + translate（见决策 2）。
- **在 web-core 验证通过即视为修复**：web-core 浏览器语义下 `pointer-events` 正常，bug 不出现；真机/模拟器才复现。必须原生验证，web-core 全绿不构成证据。否决。
- **单测提取渲染结构为纯函数以测命中语义**：模板就是实现，提取是假接缝。否决（沿用既有模板结构断言 + E2E）。

## 后果

**正面**：
- 修复全页面点击失效（页面点击穿透恢复），深模块 `createGlobalFab` **零改动**，其行为单测不受影响。
- 消灭全仓唯一「全屏 + 无 @tap + pointer-events-none」违规实例；平台约束固化后，未来覆盖层（弹窗/引导层）有据可依。
- 与 `RefreshableList`（ADR-0111）的既有正确模式统一（展开层条件渲染 + 交互面遮罩 + keyframes 弹出习语）。

**负面/风险**：
- 主 FAB 定位从 `right/bottom` 改为 `left/top vw + translate`（原生锚点语义修订，见决策 2）：需真机/模拟器回归确认右下角位置与命中（已模拟器验证通过）。
- 菜单关闭动画瞬时（无 staggered 收起）；可接受，与 RefreshableList 一致。
- 模板结构断言更新：原断言 `absolute inset-0 z-40 pointer-events-none` 等需同步改写（断言编码了 buggy 结构，必须随修复更新，否则测试全绿是虚假信心）。

## 验收

- [ ] 模拟器原生（lynx 客户端已登录）：tab 页菜单关闭态下，点页面 scrim/菜单行**有反应**（像素变化 > 阈值）；点 FAB 展开/收起正常；菜单项可点。
- [ ] 展开态遮罩点空白收起；主 FAB 恒在遮罩与菜单项之上。
- [ ] `GlobalFab.vue` 渲染树在菜单关闭态**无任何全屏元素**（模板结构断言：负向断言 `pointer-events-none` 全屏容器不存在 + 展开层 `v-if="view.isOpen"`）。
- [ ] `tests/unit.test.ts` GlobalFab 结构断言更新并通过；`createGlobalFab.test.ts` 行为单测全绿（深模块无改动）。
- [ ] E2E（android-e2e 新增 spec）：修复前红（Me 页「我的收藏」行点击 0 变化）、修复后绿（导航到 /bookmarks）。
- [ ] `App.vue` exitHint 无全宽盒、无 `pointer-events-none`（胶囊居中定位，命中面=提示条自身）。
- [ ] `pnpm check:app-lynx` 类型检查通过；`pnpm test:app-lynx` 单测全绿。
- [ ] CONTEXT.md / 术语表同步。

## 相关文档

- docs/adr/glossary-app-lynx-hit-testing.md（新建）
- docs/adr/glossary-app-lynx-radial-nav-fab.md（「展开层叠序」更新）
- docs/specs/app-lynx-fab-hit-testing-fix.md
- packages/app-lynx/CONTEXT.md（平台约束固化）
