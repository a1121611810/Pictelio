# ADR-0217：底部遮挡让位下沉到滚动内容末尾，取代全局 FAB 占位带

- **状态**：已接受（Proposed → Accepted，2026-10-03）
- **日期**：2026-10-03
- **决策者**：项目维护者（票 #920）
- **相关**：[ADR-0216-four-root-pages-header-removal-and-fab-allowance-removal.md](./ADR-0216-four-root-pages-header-removal-and-fab-allowance-removal.md)（删除全局 `pb-18`、登记代价未落地；本 ADR 兑现其「正解方向」）、[ADR-0214-top-inset-per-page-ownership.md](./ADR-0214-top-inset-per-page-ownership.md)（顶部让位逐页归属，底部沿用其「归属点」思路）、[ADR-0162-lynx-related-inline-section.md](./ADR-0162-lynx-related-inline-section.md)（瀑布流 list 结构变更三态）、[ADR-0123-app-lynx-fab-hit-testing-fix.md](./ADR-0123-app-lynx-fab-hit-testing-fix.md)（原生不识别 `pointer-events`）
- **术语文档**：[./glossary-bottom-occlusion-allowance.md](./glossary-bottom-occlusion-allowance.md)（**权威**）
- **修订**：ADR-0216 §2.2 的「正解方向：各页在列表末尾补内容级占位」——本 ADR 即该方向，并补上「零落地」这个缺口

---

## 1. 背景

### 1.1 触发

用户对「全站给悬浮 FAB 预留一条 72px 底部空带」的评价：

> 「我觉得底部你原本的做法不够友善……我没看到有一家 app 关于这个地方会是卡点，做的这么粗糙的。」

判定成立。业界没有把「自绘悬浮控件的遮挡」做成**根容器级固定 padding**：
Android/iOS 都是**内容级 inset**（`contentPadding` / `contentInset` / `safeAreaInset`），
让内容滚到栏/悬浮件之下，只有滚到底时才让位。

### 1.2 现状（ADR-0216 落地后）

全局 `pb-18` 已删除，四页不再有底部白带。但代价**零落地**：

- `App.vue:161-194` 登记：列表页末屏右下角约 72×72px 落在 FAB 圆盘下 —— 视觉遮挡 + 吞点击。
- 用户裁定「全站去掉预留带，**改由各页自行处理**」—— **落地前**该后半句全仓检索命中 0
  （本 ADR 即为兑现它；现状见 §4 负面项「覆盖范围仅三个根页」）。
- 即：删了全局带，**末屏可点性尚未在页面层恢复**，也尚未在沉浸页与列表页之间做出区分。

### 1.3 业界做法（联网核对，来源见 §5）

三条共识：

- **A（内容级 inset）**：滚动内容应当延伸到系统栏/遮挡物之下，靠**内容级 inset** 让首末项不被遮挡。
  Android 官方明确区分「内容级 padding」与「容器级 padding」——后者会裁剪内容、阻止其滚到系统栏下
  （[Edge-to-edge (Views)](https://developer.android.com/develop/ui/views/layout/edge-to-edge)，
  该页含 `android:clipToPadding="false"` 原文；Compose 侧对应 `LazyColumn(contentPadding=)` 与
  `Modifier.padding()` 的区别，见 [Insets](https://developer.android.com/develop/ui/compose/layouts/insets)）。
  ⚠️ 引文口径：上面**逐字**的 `clipToPadding` 原文只在 Views 页可核；Insets 页当前是
  canonical 重定向到 *About window insets*，其正文未必含 `contentPadding` 字面量。
  code-review Standards 抽查（抓取 Insets 页正文 22,760 字符）确认 `contentPadding` /
  `Modifier.padding` **命中 0** ⇒ 此处按「要点成立、逐字引文不属该页」表述，不伪称逐字引用。
- **B（遮挡局部解决）**：底部有**自绘**悬浮控件时，用内容级 inset / 内容末尾占位**局部**解决，
  不升级为全局固定带。iOS 侧的分界是「系统默认已处理安全区，**只有自己加的遮挡物才需要额外 inset**」
  （[safeAreaInset](https://developer.apple.com/documentation/swiftui/view/safeareainset(_:edges:content:))）。
  ⚠️ 这是**要点转述**，非 HIG 逐字原话；所链为 SwiftUI **API 参考页**（正文极短），
  不能当作「HIG 原文」引用。
- **C（单一消费）**：同一份 inset 只消费一次；父子都加会产生双倍间隙
  （[Edge-to-edge (Views)](https://developer.android.com/develop/ui/views/layout/edge-to-edge) 的 insets 小节）。

补充事实（本仓自有口径，**非**引用官方数值）：本项目原来的 `pb-18`（19.2vw）把
**FAB 自身边距**（`FAB_EDGE_VW` + `FAB_SIZE_VW`）当成了**内容的 padding**——
即「谁的几何，贴在谁身上」搞反了。真正的竖向净空由 FAB 定位 `bottom: FAB_EDGE_VW` 决定
（`utils/fabGeometry.ts`）。MD3 bottom app bar 只有 Overlap / Inset 两形态，
**都不是**「给内容加一条全局带」——可作为「原方案无出处」的佐证
（[m3](https://m3.material.io/components/bottom-app-bar/overview)；
⚠️ 该站 JS 渲染、抓不到正文，本仓 ADR-0205 已登记「仅作图示参考，不作数值来源」）。

## 2. 决策

> ⚠️ **本节的「值恒为 19.2vw」已被文末《修订（票 #922）》取代**（2026-10-03）。
> 该前提只对 **menu 模式**（4 个顶层 tab 页）成立；非 tab 内容页的 FAB 在 **search 模式**，
> 顶边 58.668vw。现行口径 = `fabAllowanceHeightVw(routeMode)` **按路由分两档**。
> 本节其余内容（降为内容级占位、三处落点、不复用 Tailwind 档位）**仍然有效**，未被取代。

**把底部遮挡让位从「根容器容器级 padding」降为「滚动内容末尾级零内容占位」，由各滚动容器自持，值恒为 19.2vw。**

三处落点，形态按各自滚动容器类型分：

| 页面 | 滚动容器 | 形态 |
|---|---|---|
| 插画 / 小说 | `<list>`（瀑布流） | **末尾追加**一个 `full-span` `list-item`，内含零内容 `<view>` |
| 我的 | `<scroll-view>` | 末尾追加零内容 `<view>` |

值来自 `utils/fabGeometry.ts` 的 `fabAllowanceHeightVw(routeMode)`（`menu` 档 = `FAB_EDGE_VW` + `FAB_SIZE_VW` = 19.2vw；`search` 档 = 58.668vw，见文末修订）——
**既不新增 Tailwind 档位，也不复用既有档位**（当时复用的是 `spacing.18`）。复用档位**做不到**跟随，
已被 code-review 实测证伪：档位是**编译期常量**、FAB 几何是 **JS 常量**，两者不同源，
把 `spacing.18` 改成 30vw 时占位高度纹丝不动。
真正让「改 FAB 尺寸时占位自动跟随」成立的是 `GlobalFab` 与 `FabAllowanceSpacer` **同 import 同一组 JS 常量**
（术语表 §三·3）。

### 2.1 为什么不选其他形态

| 候选 | 判定 | 理由 |
|---|---|---|
| 恢复全局 `pb-18` | **否决** | 业界无对应形态（见 §1.3 补充事实）；且它是沉浸页持续受损的原始原因（ADR-0216 §1 症状 #2） |
| 滚动容器加底部 padding | **否决** | 形状贴近 A，但落地上是**已踩过的坑**：`utils/topInset.ts` 约束 2 明令「让位用零内容元素、不用父容器 padding」（border-box UA 默认 vs web-core 预览不复刻 ⇒ 跨渲染器分叉） |
| 往 `<list>` 里插占位 item | **硬排除** | ADR-0162：瀑布流 `list-item` **插入=静默丢弃 / 移除=留空位 / 替换=错位** |
| 滚动时收起 FAB | **不推荐** | 业界有此形态，但本项目 FAB 外环是 4 个 tab 的**导航**（收起会削弱导航可达性）；且 `<list>` 无 JS 可控滚动属性，只能 `@scroll` throttle=0 逐帧算，成本与抖动风险高于收益。**这是产品判断，非平台限制。** |
| 只在 `RefreshableList` 里加 | **不可行** | slot 内是页面的 `<list>`，组件**无法**在页面 `<list>` 内追加子节点（原生 `<list>` 只认 `list-item` 子节点）。占位必须由页面写在 `<list>` 内；组件侧只提供**哑占位组件 + 几何共享模块**（`utils/fabGeometry.ts`） |

### 2.2 ⚠️ 关键陷阱：占位不能塞进既有 footer

三个根页已有 footer `list-item`（`item-key="footer"`, `full-span`），形态同构，看起来该复用。**但不能**：

```
v-if="loadingMore || pageErrorMsg || endOfFeed"
```

footer 是**三态条件渲染** —— 三态皆假（最常见的「有数据、未加载更多、未到底」）时**整个节点不存在**。
把占位塞进去 ⇒ 在最常见态下**完全失效**，且这种失效在低数据量页面上肉眼可见。

⇒ 必须**新增独立 list-item**，与 footer 同构但 `item-key` 不同、无 `v-if`。

## 3. T0 spike（真机取证，不拿二手结论当承重墙）

ADR-0162 只说「**中途**插入被丢弃」，**末尾追加**是否安全此前无直接实测。
落地前先在插画页注入末尾 `list-item`（19.2vw 零内容 `<view>`）做 spike。

**完整 spike 记录（设备 / 日期 / 场景表 / 复现步骤 / 限制条件）见
[`./spikes/bottom-allowance-list-append.md`](./spikes/bottom-allowance-list-append.md)**。
摘要：emulator-5554 / Android 14 / 1080×2160，四场景（冷挂载、连续滚动、分页追加、tab 切换）全部正常。

**结论：末尾追加不在 ADR-0162 的三种失效形态（插入/移除/替换）之内，真机行为安全。**
本 spike 取代 ADR-0162 中「追加是安全路径」那句**转述**，成为一手证据。

⚠️ **限制条件**：该 spike **未覆盖**会**替换整个渲染流**的三条路径
（标签静音过滤 / R18 过滤 / 相关作品行注入收起）——它们属 ADR-0162 的「移除/替换」类风险，
与末尾追加不同源，故不阻塞本决策，但**未取证**。已登记于 spike 记录 §4。

## 4. 后果

**正面**
- 沉浸页（首页轮播）**零改动**，不再吃任何底部空带。
- 列表页末屏可点性**结构性恢复**（而非登记为取舍）——ADR-0216 登记的「关 chip x[915,990] 点不动」被消除。
- 符合三条业界共识：A（内容级 inset）/ B（局部解决）/ C（与 `safeBottom` 正交不叠加）。

**负面 / 已知偏差**
- ✅ **接线形态已覆盖**（票 #921，2026-10-03）：9 个列表页（`Bookmarks` / `FollowList` /
  `Following` / `MyPixiv` / `Notifications` / `Ranking` / `TagNeighbors` / `UserHome` /
  `Watchlist`）全部接入让位，形态与三根页一致（`<list>` 末尾追加 `full-span` `list-item`）。
- ❌ **「几何同源」的前提曾经是错的**（2026-10-03 复审 + 真机取证发现，票 **#922**）——
  **已修复**，修复记录见文末《修订（票 #922）》。以下保留发现过程作为证据：这些页面都是
  **非 tab 路由** ⇒ `createGlobalFab.ts:184` 让 `GlobalFab` 走 **search 模式**，底边
  **43.734vw**、**顶边 58.667vw**（为避开 `RefreshableList` 分页菜单顶 42.667vw 而刻意抬升，
  ADR-0132 决策 2）。而本 ADR 的让位高度取自 `fabGeometry` 的 `FAB_EDGE_VW + FAB_SIZE_VW`
  = **19.2vw** —— 那个数只对应 **menu 模式**的 4 个根页。
  ⇒ 差额 **39.467vw 未让位**。真机实测（收藏页滚到底，1080×2160）：搜索 FAB 底边
  **43.796vw**、顶边 **58.611vw**（与理论偏差 <0.15%），**压在末张卡片上** ⇒ 点末项右侧
  开的是搜索弹层而非作品详情。`TagNeighbors` 更甚：它**不用** `RefreshableList`，
  唯一遮挡源就是 58.667vw 的搜索 FAB。
  ⇒ 「全部 12 个有自绘 FAB 的页面均已覆盖」**只在接线形态上成立**，几何上不成立。
- ✅ **4 页从未接线**（票 #922）——**已补接线**：`WatchLater` / `NovelDetail` /
  `IllustDetail` / `MuteTags`。门禁 `LIST_PAGES` 已从手工数组扩为
  **「从 `router.ts` 反查」判据**（新增页面漏接线会转红并点名），不再依赖人肉同步。
- ✅ **`DownloadManager` 的手工 `h-[30vw]`**（票 #922）——**已改用 `FabAllowanceSpacer`**。
  ⚠️ 此前据「底部动作栏 in-flow ⇒ 不遮挡」而免检，**该判断是错的**：in-flow 只说明动作栏本身
  不覆盖 `scroll-view`，而 `GlobalFab` 是**从屏幕底边定位的固定浮层**，照样落在滚动内容上。
  真机实测 `/downloads` 的搜索 FAB 顶边 = **58.611vw**（与其他 search 页逐字一致），
  而 30vw 只有 324px ⇒ **少让位 310px**。
- **业界无直接对应**：末尾 `list-item` 占位是 Lynx 的近似（`<list>` 无 `contentPadding`），
  不是标准做法。已在术语文档 §五标注为妥协。
- 根容器 `paddingBottom: safeBottom`（系统栏那半边）仍是**容器 padding** 形态，非内容级 inset。
  已核实**不是** double inset（原生 insets 未被消费），但与共识 A 的理想形态仍有差距
  —— 改动会波及 6 个底部弹层与 web-core 预览分叉，**不建议本票顺带改**。

## 5. 来源

**可逐字核验的（code-review Standards 实测抓取确认）**
- [Edge-to-edge（Views）](https://developer.android.com/develop/ui/views/layout/edge-to-edge) —— `clipToPadding` 与 insets 处理（`android:clipToPadding="false"` 原文在页内）

**要点成立但不能逐字引用的**（code-review 实测：所引页正文不含下述字面量）
- [Insets（Compose）](https://developer.android.com/develop/ui/compose/layouts/insets) —— `contentPadding` 与容器 padding 的区别（canonical 已重定向到 *About window insets*，正文无 `contentPadding` 字面量）
- [safeAreaInset（SwiftUI API 参考）](https://developer.apple.com/documentation/swiftui/view/safeareainset(_:edges:content:)) —— 内容避让 + 浮动件成对承担（**要点转述**，非 HIG 逐字原话；该页正文极短）

**仅作图示参考的**（本仓 ADR-0205 已登记：m3.material.io 为 JS 渲染、抓不到正文，不作数值来源）
- [MD3 bottom app bar](https://m3.material.io/components/bottom-app-bar/overview) —— 只有 Overlap / Inset 两形态，均非「全局带」

**本仓自有口径（不是引用外部数值）**
- 让位高度 = `fabAllowanceHeightVw(mode)`（`utils/fabGeometry.ts`），**按 FAB 所在路由分两档**：

  | 档位 | 页面 | FAB 底边 | **让位高度** |
  |---|---|---|---|
  | `menu` | 4 个顶层 tab 页 | 4.267vw | **19.2vw** |
  | `search` | 其余全部非 tab 内容页 | 43.734vw | **58.668vw** |

  `search` 档之所以远高于 `menu` 档：`GlobalFab` 在非 tab 页要避开 `RefreshableList` 分页
  菜单的面板顶 42.667vw（ADR-0132 决策 2），故其底边被抬到 43.734vw。
  ⚠️ **2026-10-03 之前本 ADR 只有 19.2vw 一档**，而 9 个非 tab 页的真实遮挡源是 search 档
  ⇒ 少让位 **39.467vw**。详见下方「修订」。

**一手设备证据**
- [spike：末尾追加 list-item 真机验证](./spikes/bottom-allowance-list-append.md)
- 数值量测（染色法，Me 页 `<scroll-view>` 形态）：占位块实测 **207px** vs 理论
  `19.2vw` = 207.36px，**偏差 −0.17%**；平台 inset 真值取自 `adb shell dumpsys window`
  （`safeBottom` = 72px）。完整方法、逐项数据与两处如实登记的偏差见
  [spec §5.1](../specs/bottom-occlusion-allowance.md)。
  ✅ **三页两种滚动容器形态全部已取证**：我的页（`<scroll-view>`）、插画页与小说页（原生 `<list>`）
  让位块均实测 **207px** vs 理论 207.36px，**偏差 −0.17%**，三页结果完全一致。
  `<list>` 两页用「构建期裁剪渲染流 + 冻结分页」的临时探针法（无限流无「可达的末尾」，
  直接滚不到底），各页探针均已独立还原并复验。

---

## 修订（2026-10-03，票 #922）：让位高度按 FAB 路由档位分两档

### 问题（本 ADR 原决策的适用前提被证伪）

原 §2 只给了「FAB 竖向净空 = 19.2vw」一档，隐含前提是「所有页面的 FAB 都在 `bottom: FAB_EDGE_VW`」。
真机证伪：该前提只对 **4 个顶层 tab 页**成立。

`createGlobalFab.ts` 的显示门让**所有非 tab、非 login/update/error 的路由**走 `search` 模式，
而 search 模式的 FAB 底边是 **43.734vw**（为避开 `RefreshableList` 分页菜单面板顶 42.667vw
而刻意抬升，ADR-0132 决策 2）⇒ 顶边 **58.667vw**。

⇒ 9 个非 tab 列表页全部按 19.2vw 让位，**比真实遮挡源少 39.467vw**。
真机证据（emulator-5554 / Android 14 / 1080×2160 / 手势导航 / 收藏页滚到底）：

| 量 | 实测 | 理论 | 偏差 |
|---|---|---|---|
| 搜索 FAB 底边距内容区底 | 43.796vw | 43.734vw | +0.14% |
| 搜索 FAB 顶边距内容区底 | **58.611vw** | 58.667vw | −0.10% |
| FAB 尺寸 | 14.907vw | 14.933vw | ✓ |

末张卡片 y≈1318..1739 与 FAB y[1383..1543] **重叠 356px** ⇒ 点末项右侧开的是搜索弹层，
不是作品详情。

### 决策

1. **两档让位**：`fabAllowanceHeightVw('menu' | 'search')`，`mode` **必填无默认**
   （给了默认就等于替调用方做选择，而「选错」在这套几何里是不对称的：算小了遮挡内容、
   算大了只多一段看不见的空白）。实现写成 `mode === 'menu' ? 低档 : 高档`，
   使「非 menu 一律取高档」的兜底**真的**成立。
2. **档位由路由自动推导，页面不传任何高度**：`FabAllowanceSpacer` 读
   `globalFab.view.routeMode`。`routeMode` 是**不含弹层互斥**的纯路由派生值 ——
   若读 `view.mode`，弹层一开关让位高度就跳变、内容整体重排。
   这不只是省事，是**防呆**：此前 9 页各自按 19.2vw 让位，正是「页面各自判断/漏判断」的形态。
3. **search 抬高的推导迁入 `utils/fabGeometry`**：它原先是 `GlobalFab` 的组件局部常量，
   占位侧根本看不到那一档 —— 这就是「两个独立来源 + 一个看起来在防漂移的空门禁」。
   现 `GlobalFab` 与 `FabAllowanceSpacer` 共用同一组导出常量。
4. **补接线 4 个从未接线的页面**（全量盘点 25 条路由才发现）：`WatchLater` / `NovelDetail` /
   `IllustDetail` / `MuteTags`。
5. **门禁从「手工清单」改为「从 `router.ts` 反查」**（B4）：任何路由对应的页面只要模板里有
   滚动容器就必须挂占位，例外须在 `NO_ALLOWANCE` 里逐条写明理由。实测：新增一个未接线页面
   ⇒ 该判据立刻转红，且失败信息**点名**是哪个页、怎么修。

### 修复后真机复验

| 页面 | 档位 | 末项底边距内容区底 | 理论 | 偏差 | 与 FAB 顶边 |
|---|---|---|---|---|---|
| 收藏（`/bookmarks`） | search | **634px = 58.704vw** | 58.668vw = 633.6px | **+0.06%** | 间隙 1px，**零重叠** |
| 我的（`/me`） | menu | 空白带 267px = 24.7vw | 19.2vw = 207.4px | — | **未被误抬**（若误抬应为 634px+） |
| 下载管理（`/downloads`） | search | — | — | — | FAB 位置已实测（58.611vw）；**让位量未实测**（见下） |

我的页那 267px 里含末卡片自身的下边距（占位块本身零内容、量不出来），
所以该页用「空白带是否远小于 634px」判定**未被误抬**；`menu` 档的精确值 19.2vw
由 `bottomOcclusionAllowance.test.ts` 的几何 oracle 钉住（`toBeCloseTo(19.2, 6)`）。

### 门禁（`tests/bottomOcclusionAllowance.test.ts` 89 条 + `tests/fabGeometry.test.ts` 6 条 = 95 条）

两文件共三类判据，**变异全部按预期转红/放行**（几何 oracle 已拆到 `tests/fabGeometry.test.ts`
以治门禁规模超冻结线 #1；⚠️ 拆分后**变异工具必须同时跑两个文件** —— 只跑旧的会漏掉几何判据，
并误得「几何无门禁」结论。本轮踩过：看到 3 个几何变异全绿，第一反应是「门禁弄丢了」，
**结论正好反了**）
- **接线形态**（结构解析，不再用字面量正则）：占位是滚动容器的**直接子节点**（标签栈深度 0）、
  是最后一个直接子节点、full-span、不带条件指令、不被条件 `<template>` 包裹。
  ⚠️ 旧判据「占位是最后一个 list-item」用 `.pop()` 取开标签，占位嵌进 footer 内部时
  footer 开标签反而在占位之后 ⇒ 恒绿（实测 72 条全绿）。
- **几何数值 oracle**（直接把公式跑出数字断言，对「搬不搬家/等价不等价」免疫）：
  `menu` 19.2vw、`search` 58.668vw、差值 39.467vw、`FAB_BOTTOM_SEARCH_VW` 43.734vw。
- **清单完备性**（从 `router.ts` 反查）+ 例外清单自检（免检页不得偷偷挂占位）。

### 仍未做

- `DownloadManager` 的手工 `h-[30vw]` 未归单一来源 —— 它的底部动作栏是 **in-flow**
  （不覆盖 `scroll-view`），语义与 FAB 让位不同，贸然改属范围外误伤，另挂票处理。
- `NetworkCheck` / `PlatformCheck` 两个诊断页内容不足一屏，补占位会**凭空造出可滚动的空白区**
  （比遮挡更糟），故列入 `NO_ALLOWANCE` 并写明「内容变长时须重新评估」。
- ⚠️ **`DownloadManager` 的让位量是「算」出来的，不是「量」出来的**。该页的遮挡源几何
  （FAB 顶边 58.611vw）**已真机实测**；但要让位真正可见需要下载队列非空，而本机队列为空
  （空态不渲染底部动作栏与列表），**造一个任务会往用户账号写数据**，故未做。
  让位是否够用是按本页自身档位**核算**的：动作栏 = `py-2`(4.27) + 摘要行(4.27) + `gap-1`(1.07)
  + pill 行(10.67，5 个 pill 横排在 1080px 上会换行则再 +10.67) ≈ **20.3~30.9vw = 219~334px**，
  远低于 FAB 顶边 633px ⇒ FAB 整个浮在滚动内容之上，30vw 必然不足。
  ⚠️ 这是**推算**，不是量测；结论对 ±100% 的误差仍稳健（最坏估计仍差 300px），
  但严格意义上它属于「未取证」。
- 9 个非 tab 页中只抽验了 `Bookmarks`；其余为同组件同档位，未逐页像素量测
  （多为无限流，无「可达的末尾」）。
- **补接线的 4 页真机走查：3 页已取证，1 页无法取证**（emulator-5554 / 1080×2160）：

  | 页 | 结果 |
  |---|---|
  | `IllustDetail` | ✅ **已完整取证**：滚到底后末个标签 chip 底边 y=1369，搜索 FAB 顶边 y=1383 ⇒ **无重叠、间隙 14px**。实测余量 59.907vw vs 理论 58.668vw（+2.11%）—— 差额是 chip 自身的下边距，属**安全方向**（多让位） |
  | `MuteTags` | ⚠️ **页面已取证**（无崩溃、search 档 FAB 实测 43.796 / 58.611vw），但本机**无静音标签** ⇒ 走 `v-else` 空态、`<scroll-view>` **未渲染**，占位本身未被渲染验证 |
  | `WatchLater` | ⚠️ 同上（页面 + FAB 档位已取证；0 条目 ⇒ `<list>` 未渲染） |
  | `NovelDetail` | ❌ **无法取证**（不是「没试」）：本机小说列表条目**全部为 R-18 受限**，「小说」标签页进不去详情页。其让位位置由结构门禁 + §3 spike 的同形态（`list-type` 末尾追加）覆盖 |

  ⇒ 共享组件的两档行为已在**三条**独立路径上取证：收藏页（search，634px/+0.06%/零重叠）、
  作品详情页（search，间隙 14px）、我的页（menu，268px 未误抬）。
