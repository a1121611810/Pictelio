# app-lynx 放射导航统一术语表

> 范围：`packages/app-lynx` 把**全局底部导航（M3 NavigationBar，4 tab）+ 各页自身刷新 FAB** 合并为一个**右下角放射双层环悬浮 FAB** 的**统一术语**。配套 ADR：[ADR-0120](./ADR-0120-app-lynx-radial-nav-fab.md)；深模块接口见 `packages/app-lynx/src/primitives/createGlobalFab.ts`。本表只定义领域语言，不写实现。

## 核心术语

| 术语 | 定义 |
|------|------|
| **放射导航 FAB（radial nav FAB）** | 全局唯一的**右下角悬浮 FAB**，是 app-lynx 的导航中枢；点按展开成「双层环」放射菜单，替代原 `NavigationBar`（底部 4 tab）与各顶层页自己的刷新 FAB。仅在 4 个顶层 tab 页（推荐/插画/小说/我的）显示。_Avoid_: 底部导航栏、浮动按钮、FAB 菜单（与 feed 分页 FAB 菜单区分，见下） |
| **双层环（double ring）** | 放射菜单的几何结构：**外环**为导航项、**内环**为页面动作项，同角度双半径，锚定在 FAB 右下。是 B 方案的定稿形态（A=单弧扇出、C=混合 均否决）。 |
| **外环（outer ring）** | 双层环的外层：4 个**导航 tab**（推荐/插画/小说/我的），取 `navTabs.ts` 的 `NAV_TABS`（唯一事实源），带 label，当前 tab 以 `secondary-container` 高亮；点击→`navigate(path,{replace})`（当前 tab 只收起不重导航）。 |
| **内环（inner ring）** | 双层环的内层：**页面动作项**（刷新/回顶/翻页），由**激活页**注册的动作派生。字段存在=该页有此内环项；**Me 页注册空动作 → 内环为空**（只有外环导航）。 |
| **页面动作桥（page action bridge）** | 页面 → 放射 FAB 的桥：顶层页以 `usePage(routeName, actions)` 注册 `{ refresh?, backToTop?, extras? }`（按路由名作键，KeepAlive 安全），模块读**激活页**的那份。非 tab 页不注册，保留各自 `RefreshableList` 的 FAB。_Avoid_: 全局事件总线、provide/inject 逐跳传递 |
| **激活页（active page）** | 当前显示的路由对应 tab 页；只有它的动作会进入内环。从 `routeState.name` 与 4 tab 名匹配派生；非 tab 路由 → `active===null`、整体隐藏。 |
| **读模型（view）** | 模块对外暴露的**单一只读响应式模型** `view: Readonly<Ref<FabView>>`：`{ visible, active, isOpen, isBusy, outer, inner }`。组件只读它渲染，不再读散落的多份状态。 |
| **命令通道（dispatch）** | 模块对外暴露的**单一命令入口** `dispatch(cmd)`：`toggle / close / select{name} / refresh / back-to-top / extra{key}`。打开/关闭/选中/分发全部经它，由模块内状态机裁决互斥。_Avoid_: 暴露 `open()/close()/startRefresh()/endRefresh()` 等细粒度 setter。 |
| **busy 互斥（busy exclusion）** | 刷新或异步扩展项**进行中**时：`isOpen` 被强制关闭、`toggle/refresh/back-to-top/extra` 被忽略（no-op+warn）、中心 FAB 显示 spinner（`isBusy`）。`select` 与 `close` 始终允许（导航与收合正交）。复用 `createFabMenuState` 作为**内部接缝**。 |
| **可见性门（visibility gate）** | `view.visible === true ⟺ routeState.name ∈ 4 tab 名`。一旦离开 tab 页立即隐藏；`view.inner` 在非 tab 路由恒为空。 |
| **回顶（back-to-top）** | 内环动作之一：列表页重建到顶（`refreshEpoch++` 触发 `:key` 重建）；**Recommended 轮播**映射为「重建回第一张」（其 `refreshEpoch` 重挂载 CarouselSwiper）。同步、无网络，带 1s 防重入。 |
| **KeepAlive 安全注册（KeepAlive-safe registration）** | 顶层 tab 页在 `<KeepAlive :include=[...]>` 下**常驻**；注册表按路由名作键，因此**并存的激活页之间不串扰**内环，切换路由自动收起菜单。 |
| **feed 分页 FAB（button-pagination FAB）** | 与放射导航 FAB 区分：`RefreshableList` 里为**分页/回顶**提供的 FAB 菜单（`FabMenuExtraItem`：上一页/下一页/刷新/回顶），仅**非 tab 页**保留；tab 页切换 `:fab="false"` 关闭它，动作经页面动作桥上抛到放射 FAB。 |

## 边界约定

- 放射 FAB 属**导航中枢**，与 `RefreshableList` 的**分页/回顶 FAB** 职责不同（一个全局导航、一个局部列表操作）；tab 页二者合一，非 tab 页二者并存。
- 动作语义保留在页面闭包内（Recommended 的「重建回第一张」、列表页的「重建到顶」），模块只调用闭包，不编码页面特有语义。
- 几何（半径/角度）与动效属薄渲染适配器 `GlobalFab.vue`，**不是**深模块职责。
