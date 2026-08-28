# ADR-0120: app-lynx 全局导航改为「放射双层环悬浮 FAB」（合并刷新/回顶/翻页）

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0111（M3 FAB menu，`RefreshableList` 分页/回顶 FAB + `createFabMenuState`）、ADR-0115（推荐轮播，Recommended 自带内联刷新 FAB）、`packages/app-lynx/CONTEXT.md`（「放射导航」「双层环」词条）、`packages/app-lynx/src/components/navTabs.ts`（`NAV_TABS` 唯一事实源）、`packages/app-lynx/src/primitives/createGlobalFab.ts`（深模块接口）、`packages/app-lynx/src/components/GlobalFab.vue`（薄渲染适配器）、`packages/app-lynx/src/components/NavigationBar.vue`（被替换）、`packages/app-lynx/src/components/RefreshableList.vue`（加 `:fab="false"`）
- 来源：需求「把全局导航(tabs)改为环形放射悬浮菜单」，原型（`packages/app-lynx/prototype/prototype-radial-nav.html`）三变体比选后定稿 **B 方案（双层环）**；经 `/codebase-design` 深模块接口多方案对比后定稿。
- 术语：见 `docs/adr/glossary-app-lynx-radial-nav-fab.md`（本文档只记录决策与术语，不写代码）。深模块接口经原型/设计确认，签名在 `createGlobalFab.ts`（严格属实现，见配套实现）。

## 背景

app-lynx 的全局导航与页面操作当前分散在三处：

1. **`NavigationBar.vue`**（M3 底部导航，80dp）：4 个顶层 tab 页（推荐/插画/小说/我的）各自嵌入一个 `<NavigationBar>`，各页重复一份 `onNavSelect`（当前 tab no-op、其余 `navigate(path,{replace})`）；`NAV_TABS` 曾四处重复（文件头已记录 4 方重复教训）。
2. **各页自带刷新 FAB**：`RefreshableList.vue` 有 FAB menu（刷新+回顶+可选 `FabMenuExtraItem` 翻页项，ADR-0111），被列表页与**非 tab 页**（书签/Watchlist/关注列表/UserHome）共用；`Recommended.vue`（轮播，ADR-0115）则是**另一套内联刷新 FAB**（自持 `refreshing`/`refreshEpoch`/spinner）。
3. 以上两套 FAB + 底部导航并存，且均为页面级，**代码与语义分属 4+ 页**，open/busy 互斥、回顶防重入、路由绑定各页自持。

需求把「全局导航（tabs）」改为**悬浮放射菜单**，并把刷新/回顶/翻页**合并**到同一 FAB。**方案决策（已确认）**：B 方案——右下角 FAB 展开成**双层同心环**（外环=4 导航 tab、内环=页面动作项），替代底部 NavigationBar 与各顶层页自带 FAB；非 tab 页保留 `RefreshableList` 的 FAB。

## 决策

1. **新建深模块 `createGlobalFab`**（`packages/app-lynx/src/primitives/createGlobalFab.ts`，纯逻辑、Vue 响应式、node 可单测、无 DOM）——把「页面→FAB 桥 + open/busy 状态机 + 派生读模型」大行为藏在小接口后：
   - **对外接口**（最小化）：`view: Readonly<Ref<FabView>>`（`{ visible, active, isOpen, isBusy, outer, inner }`）+ `dispatch(cmd)`（`toggle/close/select{name}/refresh/back-to-top/extra{key}`）+ `usePage(routeName, actions): () => void`。
   - **依赖注入**（local-substitutable，一律注入而非创建）：`routeState: Ref<RouteState>`、`navigate(path,{replace?})`、`navTabs: NavTab[]`、`menuState?(): FabMenuState`（内部接缝，默认 `createFabMenuState`）。**不**把 in-process 的路由/桥抽象成正式 Port（避免单适配器投机缝）。
   - **内部接缝**：复用 `createFabMenuState`（open/busy 互斥）作为内部 seam，不暴露进接口。
2. **薄渲染适配器 `GlobalFab.vue`**：读取 `view`、调用 `dispatch`；几何（半径/角度）与动效（飞出/stagger/FAB 旋转/reduced-motion）全在此，**非模块职责**。挂载在 `App.vue`（KeepAlive 之外），`view.visible` 决定显隐。
3. **页面动作桥**：顶层 tab 页以 `usePage(routeName, actions)` 注册 `{ refresh?, backToTop?, extras? }`（按路由名作键，KeepAlive 安全：激活页与并存页不串扰）；模块按激活页派发。`RefreshableList` 在 tab 页加 `:fab="false"` 关闭自身 FAB，并由其内部把 `{refresh, backToTop, extras}` 前向到 `usePage`；`Recommended` 显式 `usePage`；`Me` 注册空动作（内环空）。
4. **内环动作项（按页可空）**：recommended=`刷新+回顶`（回顶=重建回第一张）；illusts/novels=`刷新+回顶`；me=`空`；prev/next 为可选 `extras`（当前无页面传）。
5. **替换/移除**：4 个 tab 页移除 `<NavigationBar>` 与其自身 FAB；`following` 补返回箭头（原本无返回箭头，移除底部栏后依赖系统返回手势不足）。
6. **可见性门**：`view.visible ⟺ route ∈ 4 tab 名`；非 tab 路由整体隐藏、`inner==[]`、`isOpen` 强制 false。
7. **busy 互斥**：刷新/异步扩展项进行中禁展开、禁其他项；`select`/`close` 始终允许。**不变量**：`isOpen ∧ isBusy` 不共存；任一选择先收起；回顶带 1s 防重入；所有页面动作异常 `console.warn('[globalFab] …')` fail-open，**无 rejection 逃逸到 UI**。
8. **布局**：移除 `0.21333*w`（NavigationBar 高）预留，内容/轮播区接全高，FAB 绝对定位悬浮其上（z 高于内容）。

## 被考虑的方案

- **A 单弧扇出（8 项一条弧）**：手机屏上 8 项一条弧明显拥挤、互相叠（原型实证）。否决。
- **C 混合（导航弧 + 动作药丸列）**：职责分置较清晰，但导航弧与动作药丸列在右下 FAB 的有限空间内仍会挤压/叠（原型实测需大幅上移避让，留白过多）。否决。
- **浅 composable `useNavState`（只收敛状态机，漏掉页面→FAB 桥与读模型）**：仍需每个页面自写 dispatch/nav/可见性/几何接线；code-smell 未消除。否决。
- **ports-and-adapters 正式化 `RouteSource`/`PageActionProvider` 端口**：把 in-process 依赖（Vue ref + navigate 函数）抽象成 Port，属单适配器投机缝；直接注入 ref+spy 即可 node 测，功能等价且更少间接。否决。
- **flexible 贡献注册制（开放 `FabLayer`/`setBadge`/`cooldownMs`）**：扩展性最强，但接口面大、多为 0 消费者投机面（badge/cooldown/新 layer 现阶段无需求），杠杆被稀释。砍到最小面 + 保留 `extras` 空槽。**取消**（设计二 vs 一取舍，先取最小面）。

## 后果

**正面**：
- **leverage**：小接口（`view` + `dispatch` + `usePage`）承载大行为（桥、互斥、可见性、active 派生、内环装配、导航），4 页 + 组件 + 未来特性共用一套，每页接线≈1 次调用；
- **locality**：open/busy/可见性/桥/派发规则、active 派生、内环排序集中在单一模块，修一处全局生效，且单接缝可测；
- **可测性**：模块注入 `routeState`/`navigate`/`navTabs`，node 测试用 fake ref + spy 驱动 `usePage`/`dispatch`/`view`，断言可观测结果（`visible/active/inner`、`navigate` 调用、动作被触发），不测内部状态、不经 DOM；
- **收敛**：消除 4 页各自的 `NavigationBar`+`onNavSelect`、Recommended 内联 FAB、`RefreshableList` 的 tab 页 FAB 分派，统一到一处。

**负面**：
- `RefreshableList` 需新增 `:fab="false"` 开关，tab 页与非 tab 页行为分叉（tab 页前向到全局、非 tab 页保留自身）；需确认对现有列表调用无回归；
- 深模块渲染面（几何/动效/reduced-motion）归 `GlobalFab.vue` 的 web-core+真机验证通道（沿用 ADR-0047/0108 已验证的 keyframes/旋转动画）；
- a11y 标注统一化：`RECOMMENDED_A11Y_LABELS.refresh` 等被并入统一内环标注，**Appium/E2E 断言标号需同步**（避免 `client-kind-contract` 等依赖旧标号）。
