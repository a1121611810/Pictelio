# ADR-0218：顶层导航由「媒介维度」改为「用户问题维度」（发现/更新/书架/我的）

- **状态**：已接受（Accepted，2026-10-03）
- **日期**：2026-10-03
- **决策者**：产品负责人（六项决策同日记于 spec §9；决策 1 的验证前置由产品负责人豁免，见 §4）
- **相关**：
  - [ADR-0120-app-lynx-radial-nav-fab.md](./ADR-0120-app-lynx-radial-nav-fab.md)（外环 = 4 导航 tab 的载体决策；本 ADR 只换 4 项的**语义**，不动载体）
  - [ADR-0121-app-lynx-radial-fab-m3-size.md](./ADR-0121-app-lynx-radial-fab-m3-size.md)（环几何实测口径，60.5px vs 57.1px 的差异见 §3.2）
  - [ADR-0216-four-root-pages-header-removal-and-fab-allowance-removal.md](./ADR-0216-four-root-pages-header-removal-and-fab-allowance-removal.md)（四个根页去顶栏；本 ADR 改的是「哪四个根页」）
  - [ADR-0208-material-symbols-icons.md](./ADR-0208-material-symbols-icons.md)（外环图标字形）
  - [ADR-0203](./ADR-0203-webview-client-source-removal.md)（旧 `historyStore` 随 WebView 客户端删除，"继续读"需重建）
  - 提案与证据底座：[`../specs/app-lynx-navigation-dimension-restructure.md`](../specs/app-lynx-navigation-dimension-restructure.md)、
    [`../research/nav-dimension-and-stickiness-2026-10.md`](../research/nav-dimension-and-stickiness-2026-10.md)、
    [`../research/feature-dimension-external-evidence-2026-10.md`](../research/feature-dimension-external-evidence-2026-10.md)、
    [`../research/feature-coupling-decoupling-map-2026-10.md`](../research/feature-coupling-decoupling-map-2026-10.md)
- **唯一事实源**：`packages/app-lynx/src/components/navTabs.ts` 的 `NAV_TABS`（封闭 4 项数组）

---

## 1. 背景

顶层导航的四个目的地此前按**媒介**切分：推荐 / 插画 / 小说 / 我的。三个问题：

1. **推荐 / 插画 / 小说不是三个目的地，是同一目录的三个视角。** 三页消费同一批上游推荐的
   媒介过滤（`loadRecommended` / `loadRecommendedNovels` + `time-merge`），
   用户切它们是在**换筛选条件**，不是在换地点。
2. **「更新」类功能无处可去。** `/following` 零用户入口、追更与通知各自只挂在「我的」单入口，
   「我关注的更新了吗」这个问题**没有对应的顶层位置**。
3. **「我存的、没看完的」没有位置。** 收藏与稍后看挤在「我的」的账户区里。

依据侧（按"先外部取证、再结合项目"）：NN/g 与产品一手材料主张导航项应回答**用户问题**
而非内容类别；项目侧实测给出上列耦合事实。详见 spec 与两份 research 底座。

**载体不动**：ADR-0120 已定放射双层环 FAB（外环 = 4 导航项）。本 ADR **不推翻 ADR-0120**，
只换外环 4 项的语义集合——这正是 §2.1 把 `navTabs.ts` 列为单点事实源的原因。

## 2. 决策

### 2.1 顶层四个目的地：媒介 → 用户问题

| # | name / path | 回答的问题 | 装什么 |
|---|---|---|---|
| 1 | `discover` / `/discover` | 「有什么新的」 | 混合推荐 + 页内 全部/插画/小说 二级 |
| 2 | `updates` / `/updates` | 「我关注的更新了吗」 | 关注更新 / 追更新 / 通知（**一页三段**） |
| 3 | `shelf` / `/shelf` | 「我存的、没看完的」 | 收藏 / 稍后看 / 继续读 |
| 4 | `me` / `/me` | 「账号与设置」 | 账号信息 / 外观 / 备份 / 下载队列 / 高级（自检·引擎·调参） |

`NAV_TABS` 是**封闭 4 项**集合（`navTabs.ts` 内注释已写死此约束）。

### 2.2 插画 / 小说降为「发现」页内 Tabs

插画与小说**不再是顶层目的地**，降为「发现」页内的 `SubTabBar` 二级 tab
（复用现成组件，`IllustList.vue` 已在用）。依据 M3 对 Tabs 与 bottom navigation 的区分：

> "Tabs share a common subject, whereas bottom navigation destinations are top-level
> and disconnected from each other."

即：插画/小说与"发现"**共享同一主题（上游推荐目录）**，属 Tabs 语义；
而发现/更新/书架/我的**回答四个互不相同的问题**，属 bottom navigation 语义。
`/illusts`、`/novels` **路由保留**（深链 / benchNav / 回退目标），只是不再出现在导航中。

### 2.3 清理 `NavigationBar.vue`

ADR-0120 落地后 `components/NavigationBar.vue` 已成**零 `import` 孤儿**（四个顶层页早已不嵌入它）。
本 ADR 随「发现」页改造**一并删除该文件**，并订正 `navTabs.ts` 中"各顶层页接入 NavigationBar"
的过期注释。**这不是新决策，是把既成事实（ADR-0120 的后果）落成文件删除**。

### 2.4 「我的」只搬调试项（决策 4 = B）

账号信息区与外观区**不拆**；网络自检 / 限流退避调参 / 引擎降级提示 / 平台一致性自检
搬进新页 `pages/AdvancedSettings.vue`（`/advanced`）。**收藏 / 稍后看 / 通知 / 追更
在「我的」保留次级入口**——一级入口在「书架」「更新」，「我的」里仍可达。
业务行与调试行不再平级混排，是本批要解决的**唯一**问题。

## 3. 后果

### 3.1 正面

- **顶层项与用户心智对齐**：四个项各回答一个不同问题，导航项本身成为信息架构的地图，
  而非内容类型的过滤器。
- **「更新」从"埋在三处"变成"一个页面三段"**：关注更新 / 追更新 / 通知不再分散，
  一滚即可答完"有什么更新的"。
- **媒介视角降级不损失可达性**：`/illusts`、`/novels` 路由保留，深链与回退不受影响；
  入口深度 1→2 步，仍在 2 层上限内，且二级 tab 常驻。
- **业务/调试分层**：「我的」不再把网络自检与账号信息排在同一层级。
- **零载体改动**：外环 FAB、几何、动效、`createGlobalFab` 接口全部不动，
  改动面收敛在 `navTabs.ts` 单点 + 三个新页 + 一个新二级页。

### 3.2 负面与已知失效面

- **⚠️ 分组假设零用户研究数据**。拍板的决策 1 = "先做 card sorting 再动手"，
  但该前置**被产品负责人豁免、验证从未运行**——
  `docs/research/card-sorting-results-2026-10.md` **不存在**（全仓无此文件），
  三批改动已在零验证数据下全部交付。⇒ 本 ADR 记录的四组是**待验假设**，不是已验证结论。
  风险已由产品负责人接受；现存回退阀只有"P0-1 只改 `navTabs.ts` 标签、可低成本回滚"。
  若日后要补验，[`card-sorting-protocol-2026-10.md`](../research/card-sorting-protocol-2026-10.md)
  是仍可直接执行的现成协议。**后续项 issue 号：TBD。**
- **⚠️ 通知可发现性下降**（2026-10-03 复核：由「仍不可见」转「**已缓解，降级跟踪**」）。
  决策化当时，顶栏补位入口已撤、而 spec 承诺的外环「更新」未读角标**对用户不可见**：
  `App.vue` 未传 `navBadge`（值恒为 0）、`GlobalFab.vue` 未渲染角标节点。
  **该缺口已修复**（逐点已核）：
  - 读点接线 `stores/globalFab.ts` 的 `navBadge` 闭包（`updates` → `notificationStore.unreadCount`）；
  - 冷启动取值 `App.vue` 的 `onMounted` → `useNotificationStore().refreshUnreadBadge()`
    （此前只在 `Me.vue` 挂载时调用 ⇒ 不开「我的」则恒为 0）；
  - 渲染 `GlobalFab.vue:257` `v-if="e.tab.badge > 0"`（`>99` 折 `99+`，`:261`）；
  - 回归防线 `primitives/globalFabNavBadge.test.ts` **5 passed**——**绿灯，非红灯**。
  ⚠️ **残余两点**（故不销案）：① 通知仍**不是唯一入口**（「我的」次级入口按决策 4 = B 有意保留）；
  ② 仓内外环截图 `docs/research/screenshots-2026-10/02-nav-ring.png` 画面上未见角标
  ⇒ 模拟器可见性目检**尚无仓内存证**，补录 issue 号 **TBD**。
- **入口重复**。「我的」保留 4 条次级入口，与「书架」「更新」的一级入口重复。
  这是决策 4 = B 为保老用户不失联而**有意承担**的代价，不是遗漏；
  若度量显示重复入口有害可再收。
- **"继续读"是空态占位**。旧 WebView 客户端的 `historyStore` 随 ADR-0203 删除，
  书架第三段在 P1 重建前只有空态——不假装有数据。
- **E2E `a11yLabel` 钉住中文**，且 android-e2e 不进 CI（ADR-0084）⇒ 改 tab 名**不会变红**，
  属静默失效面，需手工重跑受影响的 android-e2e spec。

### 3.3 几何约束：为何仍是 4 项、且加第 5 项不是轻量改动

外环 `R_OUTER_VW = 35`（`GlobalFab.vue:56`）、扫角 80°、环项 56dp：

| 环项数 | 角步 | 中心距 `2R·sin(step/2)` | 相对 56dp 直径 | 结论 |
|---|---|---|---|---|
| **4** | 26.67° | **60.5px** | +4.5px | 勉强排开 |
| **5** | 20.00° | **45.6px** | −10.4px | ❌ **重叠 ~10px** |

⇒ 加第 5 个顶层目的地**必须**把外环半径从 35vw 提到约 **46vw**（+32%），
并重新验证内环间距与探底（ADR-0121 曾因此溢出 7px）。属独立高成本改动，不在本 ADR 范围。

⚠️ **口径留痕**：上表 60.5px 为按公式**推算**；ADR-0121 的真机实测记为 57.1px，
两者**测量口径不同**，本 ADR 未在真机复测（与 research 底座的登记一致）。
但"5 项必重叠"的结论在两个口径下**同向**，故约束成立。

## 4. 与 spec 的偏差登记

本 ADR 决策化时，spec 存在三处"承诺但未实现"，均已按仓库纪律**显式挂账**（不静默删除）：

| 承诺 | 实况 | 处置 |
|---|---|---|
| card sorting 为开工前置，阻塞 P0-3 | 前置被豁免、验证从未运行 | spec §8 / §9.2 / 文首「门禁豁免」记为**风险已接受**；见本 ADR §3.2 |
| 通知唯一入口 = 「更新」第三段（+ 外环角标） | 通知 **3 条**路径、追更 **2 条**路径（「我的」次级入口按决策 4 = B 有意保留）；外环角标**曾对用户不可见**（读模型有、未接线、未渲染）→ **2026-10-03 复核：已接线并渲染，`globalFabNavBadge.test.ts` 5 passed，风险转「已缓解、降级跟踪」** | spec §3.2 加"承诺 vs 实况"对照表；见本 ADR §3.2 |
| P0.5 四项度量 | ✅ **采集与消费均已落地**（2026-10-03 复核）。采集：`stores/usageMetrics.ts` + `primitives/usageMetrics.ts`，写入点 = `App.vue` 的 `onMounted`（复访间隔）· `App.vue` 监听 `routeState.value` 的路由落定侧（顶层触达率）· `Recommended.vue` 的 `switchTab`（二级使用占比）· `Updates.vue` 的 `noteSection`（空段出现率）。消费：`pages/AdvancedSettings.vue` 的「本地使用度量」面板读三个 rate 函数。⚠️ **口径经实测修订**：「切入次数」→「触达次数」（原口径下冷启动落点不计数，「发现」恒 0%，数字会让人判反）；⚠️ **刻意不进备份域**（设备行为，键不带 uid，门禁反向断言）。**模拟器目检存证**：`docs/research/screenshots-2026-10/11-metrics-panel.png` | spec §4 P0.5 已同步修订口径与写入点，并登记备份通道偏离 |

**纪律出处**：承诺无实现不得静默丢弃——须实现或显式挂账（含后续 issue 引用）。
本 ADR 三处后续 issue 号均为 **TBD**（尚未建单），**不得**据本 ADR 推断已有跟进票。
