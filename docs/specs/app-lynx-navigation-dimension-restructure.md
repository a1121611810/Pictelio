# 提案：顶层导航换维度 + 功能归组（P0 结构对齐）

- 日期：2026-10-03（决策记录同日追加）；**挂账补记同日**（见下「门禁豁免」）
- 状态：**六项决策已拍板（2026-10-03）**，见 §9。
  ⚠️ **本文档已落后于实现**：P0 三批（§9.1 ①②③）**已全部落地**，而 §8 的 card sorting
  **从未执行**。下方「门禁豁免」登记该偏差，§2.2/§2.4/§3.2/§4-P0.5 已按**已交付事实**订正。
- 依据（按"先外部取证、再结合项目"）：
  - [`../research/feature-dimension-external-evidence-2026-10.md`](../research/feature-dimension-external-evidence-2026-10.md)（NN/g + 产品一手）
  - [`../research/feature-coupling-decoupling-map-2026-10.md`](../research/feature-coupling-decoupling-map-2026-10.md)（项目实测地图）
  - [`../research/nav-dimension-and-stickiness-2026-10.md`](../research/nav-dimension-and-stickiness-2026-10.md)（导航维度 + 几何约束）
  - [`../adr/ADR-0218-app-lynx-top-nav-user-question-dimension.md`](../adr/ADR-0218-app-lynx-top-nav-user-question-dimension.md)（本文的**决策化记录**；含外环 4 项几何约束与已登记偏差）
- ⚠️ **四组分组仍未经用户研究验证**。已拍板 **1A = 先验证再动手**（§9），
  故 §8 的 card sorting 从"可选"升为**开工前置**，执行材料见
  [`../research/card-sorting-protocol-2026-10.md`](../research/card-sorting-protocol-2026-10.md)。

### 门禁豁免与「风险已接受」（2026-10-03，挂账）

| 项 | 事实（已核） |
|---|---|
| 决策 1 拍板内容 | A = **先做 card sorting 再动手**，§8 升为**开工前置** |
| 实际发生 | 产品负责人**授权跳过该前置、直接实现**。`docs/research/card-sorting-results-2026-10.md` **不存在**（全仓无此文件），验证**从未运行** |
| 后果 | §9.1 三批（①②③）**在零验证数据的情况下全部交付** |
| 状态 | **四组分组假设仍为未经用户研究验证的假设**。本文档的分组结论**没有**任何实测支撑 |

**风险已接受**：分组结论错了怎么办 ⇒ 唯一已建的防线是回滚成本
（P0-1 只改 `navTabs.ts` 标签，低成本可退；ADR-0218 已把该决策 ADR 化并登记此偏差）。
若后续要补验证，[`card-sorting-protocol-2026-10.md`](../research/card-sorting-protocol-2026-10.md)
**仍是可执行的现成协议**（12 卡 · 8–12 人 · 约 1 人日），但**截至本文补记时零结果**，
不得据本文档推断分组已被验证。后续项 issue 号：**TBD**。

---

## 1. 目标形态

### 1.1 现状 → 目标

```
【现在】                                   【目标】
外环 4 项                                 外环 4 项（数量不变，几何不动）
├ 推荐  ┐                                 ├ 发现  ┐ 全部 / 插画 / 小说（页内二级）
├ 插画  ├ 同一批上游推荐的 3 种媒介过滤   ├ 更新  ┐ 关注更新 / 追更新 / 通知（页内三段）
├ 小说  ┘                                 ├ 书架  ┐ 收藏 / 稍后看 / 继续读（页内三段）
└ 我的  ┐ 7 个留存资产 + 4 个调试项混排   └ 我的  ┐ 账号与设置
        └ 下载/通知/网络自检/退避调参…                └ 高级（二级）：自检/引擎/调参
```

### 1.2 四个顶层各自回答的问题

| 顶层 | 回答 | 装什么 | 原来散在哪 |
|---|---|---|---|
| **发现** | 「有什么新的」 | 混合推荐 + 媒介二级切换 | 推荐/插画/小说（三页合一） |
| **更新** | 「我关注的更新了吗」 | 关注流 / 追更 / 通知 | `/following`（零入口）、`/watchlist`、通知 |
| **书架** | 「我存的、没看完的」 | 收藏 / 稍后看 / 继续读 | 收藏、稍后看（+ 继续读**新建**） |
| **我的** | 「账号与设置」 | 外观 / 备份 / 下载队列 / 高级 | 我的（瘦身） |

### 1.3 为什么是 4 个而不是 5 个

外环 `R_OUTER_VW=35`、扫角 80°、环项 56dp：4 项中心距 60.5px 恰好排开，
**第 5 项降到 45.6px 必然重叠**（需 `R≥46vw`，需新 ADR + 真机验证）。
⇒ 本次**不新增第 5 个目的地**。

---

## 2. 逐项设计

### 2.1 发现（改造 `Recommended.vue`，不新建页）

- **页内二级**：`SubTabBar` = 全部 / 插画 / 小说（**复用现成组件**，`IllustList.vue:262` 已在用）
- **数据源**：
  | 二级 | source | 现状 |
  |---|---|---|
  | 全部 | `loadRecommended` + `loadRecommendedNovels`（`time-merge`） | `Recommended.vue:98-110` 原样 |
  | 插画 | `loadRecommended` | `IllustList.vue:63-76` 的 `recommend` 分支 |
  | 小说 | `loadRecommendedNovels` | `NovelList.vue:50-60` |
- **路由**：`/illusts` `/novels` **保留**（深链/benchNav/回退），只是不再出现在导航。
- ⚠️ **不动**：`/ranking` 入口卡（`RankingEntryCard`）留在「全部」二级内，不动它。

### 2.2 更新（**新建页**，是本次改动的主体）

**一条设计决策**：三件事回答同一个问题（「有什么更新的」），
所以做成**一页三段纵向排列**，而不是三个二级 tab。
理由：二级 tab 逼用户逐个点开检查；一页三段**一滚就答完**。

```
┌─ 更新 ────────────────────────┐
│ ● 关注更新（3）                 │  ← 有新作品的关注作者
│   [卡] [卡] [卡]               │
│                                │
│ ● 追更新（1）                  │  ← 有新章节的小说系列
│   [卡：系列名 · 最新话次]        │
│                                │
│ ● 通知（未读 2）                │  ← Pixiv 通知
│   [条目] [条目]                │
└────────────────────────────────┘
```

- **路由**：新增 `/updates`，页面 `pages/Updates.vue`
- **复用**：`Following.vue` 的关注流 + `Watchlist.vue` 的追更列表 + `notificationStore`
- **空段处理**：某段无更新时**折叠成一行**（如「关注更新 · 暂无」），不隐藏——
  理由：NN/g「If a section is empty, **explain why** its content is unavailable」；
  同时也告诉用户"这个功能存在"。
- **角标**：✅ **「外环「更新」项带未读计数」已落地**（原挂账项；2026-10-03 复核由「未发生」转「已缓解」）。
  链路逐点已核：
  - 值来源 = `notificationStore.unreadCount`，由 `stores/notificationStore.ts` 的
    `refreshUnreadBadge()` 拉取（失败 warn 保留上次计数）；
  - **冷启动预取** = `App.vue` 的 `onMounted` → `useNotificationStore().refreshUnreadBadge()`。
    ⚠️ 此前该调用**只在** `Me.vue` 挂载时发生 ⇒ 不打开「我的」则角标恒为 0
    （即 read-point 纪律要防的「机制在、值不流动」）；
  - 读点接线 = `stores/globalFab.ts` 的
    `navBadge: (name) => (name === 'updates' ? useNotificationStore().unreadCount : 0)`；
  - 渲染 = `GlobalFab.vue` 的 `v-if="e.tab.badge > 0"` 节点，`>99` 折成 `99+`；
  - 回归防线 = `primitives/globalFabNavBadge.test.ts`，**6 passed**（2026-10-03 `vitest run`）——
    含一条**偏移内收**判据（第三轮 review 补：角标不得用 `-top`/`-right` 外伸，
    否则被相邻环项压住；外环 4 项中心距 60.5px、环项直径 56px，间隙仅 ~4px）。
  - `NavTab` 接口**仍无** badge 字段（契约只有 `name/path/icon/labelKey/a11yLabel`）：
    badge 是 `createGlobalFab` 在 `view.outer` 上派生的读模型，**不属 tab 契约**——
    这是有意的接口分层，**不是残留缺口**，不必"补字段"。
  ⇒ 角标对用户可见。另两处未读读点仍在：`Me.vue` 通知行行尾圆点、
  `Updates.vue`「更新」页**页内**未读徽标。
  ✅ **模拟器目检已闭环**（2026-10-03）：存证 `docs/research/screenshots-2026-10/10-nav-badge-visible.png`
  ——外环展开态可见「更新」项右上角红色角标 `5`。
  （此前登记的「尚无仓内存证」以 `02-nav-ring.png` 未见角标为据；那张图拍摄于角标实现**之前**，
    已被本张取代。**截图也会过期**，引用时须核对拍摄时点。）
  ⚠️ 引用规范：本节此前大量使用 `file:line` 坐标，实测已腐化（`App.vue:70`→实际 `onMounted`
    段、`Updates.vue:338-341` 已随文件增长漂移）。**跨文件引用一律只到符号/章节，不带行号**。
  补录目检存证的后续项 issue 号 **TBD**。
- ⚠️ **本项目无推送通道**（全仓 Java 无 `NotificationManager`），
  所以「更新」页的**发现**依赖用户主动打开。送达通道见 §4 的 **P2**（§5「明确不做」
  指的是服务端推送，不是本项）。

### 2.3 书架（**新建页**）

| 二级 | 数据 | 状态 |
|---|---|---|
| 收藏 | `Bookmarks.vue` 现成（Pixiv 服务端收藏） | 复用 |
| 稍后看 | `WatchLater.vue` 现成（本地快照，500 上限） | 复用 |
| **继续读** | 浏览历史 + 阅读位置 | **新建，见 §4.3** |

- **路由**：新增 `/shelf`，页面 `pages/Shelf.vue`
- ⚠️ **下载不放这里**：`/downloads` 是**任务队列控制面**（start/pause/stop），
  不是内容列表，**留在「我的」**。这是对前一版建议的修正。

### 2.4 我的（**按决策 4 = B：只搬调试项**，账号区与外观区不动）

| 去向 | 原「我的」条目 |
|---|---|
| → 更新 | 通知、追更（**已复制过去，但「我的」侧未删除**——见下方订正） |
| → 书架（一级入口） | 收藏、稍后看 |
| → **高级（新二级页）** | 网络自检、限流退避调参、引擎降级提示、平台一致性自检 |
| **留在「我的」** | 账号信息、收藏/稍后看/好P友/**下载队列**、外观（主题色/全屏）、WebDAV 备份 |

- 新增 `pages/AdvancedSettings.vue`，路由 `/advanced`
- ⚠️ **已交付订正（2026-10-03，挂账）**：本表「→ 更新」一行描述的是**设计去向，不是删除**。
  实测 `Me.vue` 仍保留两条次级入口——通知中心（`Me.vue:430` / 行尾未读圆点 `Me.vue:690`）
  与追更列表（`Me.vue:406`）——这与**决策 4 = B「保留次级入口」的意图一致**
  （同 ② 收藏/稍后看保留次级入口的处置），但本文原表措辞让人读成"搬走了"。故订正为下表。
- ⚠️ **决策 4 选 B 的两个要点**：
  ① **不拆**账号信息区与外观区（那是 `Me.vue` 里风险最低的部分，本期不动）
  ② **收藏/稍后看/通知/追更保留次级入口**（一级入口在「书架」「更新」，「我的」里仍可达）
     ⇒ 老用户不失联，代价是入口重复。**若后续度量显示重复入口有害，可再收**。

**本批要解决的问题只有一个**：业务行与调试行**不再平级混排**。

---

## 3. 跨切面改动（P0 必做）

### 3.1 能力对齐：修「小说正文页不能收藏/稍后看」

| 能力 | 现状 | 改后 |
|---|---|---|
| 收藏 | `NovelDetail` ✗ / `NovelIntro` ✓ | 两个页面都可用（能力绑**作品对象**，不绑路由） |
| 稍后看 | `NovelDetail` ✗ / `NovelIntro` ✓ | 同上 |

> 复用 `useBookmarkMutation`；`watchLaterStore` 已有 `(kind, id)` 去重键，无需改模型。

### 3.2 撤掉「同一功能两条路」

`Recommended.vue:298` 的通知顶栏补位入口**移除**（已落地，`Recommended.vue:372-377` 留有删除注记）。

⚠️ **原「通知唯一入口」表述与已交付实现不符，本文订正为实况**（挂账）：

| | 原文承诺 | **已交付实况（已核）** |
|---|---|---|
| 通知 | 唯一入口 = 「更新」页第三段（+ 外环「更新」角标） | **3 条路径**：「更新」页第三段 · 「我的」通知中心行（带未读圆点）· E2E/深链可达的 `/notifications` |
| 追更 | （原文未声明唯一） | **2 条路径**：「更新」页第二段 · 「我的」追更列表行 |
| 外环角标 | 有 | **用户可见**（2026-10-03 复核 + **模拟器目检存证**）：读点 `stores/globalFab.ts` 的 `navBadge` 接 `notificationStore.unreadCount`，冷启动由 `App.vue` 的 `onMounted` 预取值，`GlobalFab.vue` 渲染（`>99` 折 `99+`）；`globalFabNavBadge.test.ts` 6 passed（含偏移内收判据）。存证 `screenshots-2026-10/10-nav-badge-visible.png` |

**为何不收敛成唯一入口**：决策 4 = B 明确选择「保留次级入口」以保老用户不失联，
"同一功能两条路"的清理只覆盖**顶栏补位**（页内冗余），**未**覆盖「我的」次级入口（跨页可达性）。
故 NN/g「rarely a good idea to offer multiple ways to progress to secondary options」
在本期**只被应用了一半**，这是有意取舍不是遗漏。

> 依据：NN/g「it's rarely a good idea to offer multiple ways to progress to secondary options」。

### 3.3 清理

- 删除 `components/NavigationBar.vue`（全仓唯一零 `import` 孤儿）
- 修正 `navTabs.ts:3,6` 的过期注释（现称"各顶层页接入 NavigationBar"，ADR-0120 后已不成立）
- 清理前**先确认**那 16 个零消费者 API 函数是否为"备用接线"，不批量删

---

## 4. 分期

### P0 · 结构对齐（不需新后端、不需推送）

⚠️ **按决策 3，分三批交付**（切法见 §9.1）。下列条目保留完整清单，括号内为批次归属。

| # | 改动 | 批次 | 涉及 |
|---|---|---|---|
| P0-1 | `navTabs.ts` 改为 发现/更新/书架/我的 | ① | 单点事实源 |
| P0-2 | `Recommended.vue` 扩为「发现」，加 全部/插画/小说 二级 | ② | 复用 `SubTabBar` |
| P0-3 | 新建 `Updates.vue`（三段，决策 2 = 甲） | ② | 复用 Following/Watchlist/notificationStore |
| P0-4 | 新建 `Shelf.vue`（三段，继续读先占位空态） | ② | 复用 Bookmarks/WatchLater |
| P0-5 | 搬 4 个调试项 → 新建 `AdvancedSettings.vue`（**不拆账号/外观区**，决策 4 = B） | ③ | `Me.vue` |
| P0-6 | 能力对齐：收藏/稍后看 上 `NovelDetail` | ③ | 复用 `useBookmarkMutation` |
| P0-7 | 撤通知顶栏补位 | ③ | `Recommended.vue` |
| P0-8 | 删 `NavigationBar.vue` + 修 `navTabs.ts:3,6` 过期注释 | ③ | — |
| P0-9 | 「我的」保留收藏/稍后看次级入口 | ③ | — |

**状态：三批（①②③）已全部交付。** ⚠️ 其中 P0-3 原本**依赖 §8 的 card sorting 结果**
（决策 1 = A），实际该前置**被产品负责人豁免、验证从未运行** ⇒ `Updates.vue` 的形态
是在零验证数据下落地的（见文首「门禁豁免」与 §8 挂账）。

> ⚠️ **P0-3 依赖 §8 的 card sorting 结果**（决策 1 = A）—— **该依赖已被豁免，未兑现**。
> 批次 ①② 与分组结论无强耦合；**批次 ② 的 `Updates.vue` 形态原应待验证结论，现按未验证落地**。

### P0.5 · 最小度量（与 P0 同期，不拆）

⚠️ **决策 5 = A：只存本地，不上传。零服务端、零第三方 SDK。**

只存本地计数与时间戳，走现有 `prefs` seam。

⚠️ **刻意不进备份通道**（偏离本节初稿，2026-10-03 登记）：初稿写「走 prefs seam **与备份通道**」，
但使用度量是**设备行为**——不随账号同步、也不应随备份外传到别的设备。落盘键
`usage_metrics_v1` 因此**不带 uid 后缀**，且被 `tests/unit/usageMetricsReadPoints.test.ts`
反向断言「`settingsStore` 不得出现 usage_metrics」（防它被误列进 `BACKUP_DEVICE_KEYS`）。
「seam 相同、域不同」：读写都走 `prefs()`，但不在账号/备份域内。

| 指标 | 口径 |
|---|---|
| 复访间隔 | 相邻两次启动的时间差分布 |
| 顶层触达率 | 4 个顶层各自**触达**次数占比（口径修订见下） |
| 二级使用占比 | 发现页三个二级各被选次数 |
| 空段出现率 | 「更新」页三段各自为空的比例（验 §2.2 空态假设） |

> ⚠️ **口径修订（2026-10-03，模拟器实测触发）：「切入」→「触达」**
> 初稿写「各自**切入**次数占比」，实现按初稿把记录点挂在 `createGlobalFab` 的
> `select{name}` 派发上。**模拟器实测抓到漏记**：冷启动直接落在「发现」、登录成功后也直接
> `navigate('/discover')`，两条路径都不过 FAB 派发 ⇒ `tabHits.discover` 恒为 0，
> 面板显示「发现 0% / 我的 100%」，而用户每次启动**都**在「发现」——数字会让人判反。
> ⇒ 口径改为「**到达**一个顶层目的地即计一次触达」，记录点上移到**路由落定侧**
> （`App.vue` 监听 `routeState.value`）。本条是**有意的口径变更**，不是实现跑偏。
> ⚠️ 那边的 watch 监听的是**对象**而非 `.value.path`：`routeState` 的占位初值就是
> `DISCOVER_PATH`，与首落点相同 ⇒ 监听 `.path` 会因「值未变」而**不触发**
> （全量单测绿、真机仍 0%）。反向断言已钉在读点门禁里。

> ⚠️ NN/g 警告：不能只看点击量——"a page gets many hits because users want it
> **or because they simply enter the page by mistake**"。故第三项才是关键。
> ⚠️ 本项目无服务端 ⇒ **这些指标只反映单个用户**，不可外推到整体人群。

⚠️ **实现状态（2026-10-03 复核）：四项指标的采集层与消费层均已落地**。落地形态 = 新 store
（`src/stores/usageMetrics.ts` 状态层 + `src/primitives/usageMetrics.ts` 纯逻辑层）
+ 「高级」页的**本地使用度量面板**（`pages/AdvancedSettings.vue`）作为**唯一消费方**。
先前「零实现」与「只有采集层、没有消费层」的登记均已作废。
逐项写入点（已核；引用只到**符号**不给行号 —— 行号在本文件每次复核时都会漂）：

| 指标 | 写入点 |
|---|---|
| 复访间隔 | `App.vue` `onMounted` → `metrics.hydrate().then(() => metrics.recordLaunch(Date.now()))`（**先 hydrate 再记**，顺序反了会丢历史间隔） |
| 顶层触达率 | `App.vue` 的 `watch(() => routeState.value)` → `topLevelTabForPath(path)` → `recordTabVisit(tab.name)`（**路由落定侧**；口径修订见上） |
| 二级使用占比 | `pages/Recommended.vue` `switchTab` → `recordSubTabUse(next)` |
| 空段出现率 | `pages/Updates.vue` `noteSection(name, count)` → `recordSectionObserved(name, count === 0)` |

**消费层（唯一消费方 = 「高级」页度量面板）**：`pages/AdvancedSettings.vue` 读
`emptySectionRate` / `tabShare` / `subTabShare` 三个纯函数并渲染。
- **分母为 0 时三个函数返回 `null`，面板显示「暂无数据」而非 0%** —— 刻意不谎报（首装、
  某段从未被观察过时 0% 是**假的**）。
- 键空间（顶层 tab / 二级 tab / 更新页三段）由 `primitives/usageMetrics.ts` 的
  `NAV_TABS` + `DISCOVER_SUB_TAB_METRIC_ROWS` + `UPDATE_SECTION_METRIC_ROWS` **单点定义**，
  写入侧与读出侧共用；改键名只改一处，`pnpm check` 即会因 `noteSection` 的
  `UpdateSectionKey` 收窄而转红。

读点契约 vs 实际落点（已核；契约不变，但**三处与原设想不同**）：
- 复访间隔 → 契约说「`router.ts` 首启动点 / 会话恢复」；实际落在 **`App.vue` 的 `onMounted`**，
  不是 `router.ts`；
- 顶层触达率 → 契约说「`createGlobalFab` 的 `select{name}` 派发」；实际落在 **`App.vue` 监听
  `routeState.value` 的路由落定侧**。原收口点**已撤销**（`stores/globalFab.ts` 不再打点，
  否则与落定侧双计）；打点从「手势发起侧」移到「路由落定侧」的原因见上方口径修订；
- 二级使用占比 → 未走 `select{name}`，实际改落在 `Recommended.vue` 的 `switchTab`；
- 空段出现率 → `Updates.vue` 的 `noteSection`，与契约「三段各自完成拉取后的空/非空判定」一致。

⚠️ **hydrate 竞态已处理**：`prefs().get`（原生 callback）会让出执行权，期间另外三个读点
可能先落地。初版 hydrate 结束时**整体替换**状态机实例 ⇒ 那些记录被丢弃，且它们的
落盘会把 `lastLaunchAt: null` 写回，使「相邻两次启动的时间差」**永久断链**。
现为**缓冲 + 重放**（`stores/usageMetrics.ts` 的 `deferred`），并有单测钉住
（`src/stores/usageMetrics.test.ts`）。

⇒ 即使数据已在本地采集，**仍不得**据本节做分组假设的二次论证：仓内无导出、无呈现，
数据未被人读过（无消费层）；且 §8 的卡组验证**从未执行**——"有数据"与"数据可信"是两件事。
挂账补记 issue 号 **TBD**。

### P1 · 继续读（需新建）
浏览历史 store + 小说阅读位置持久化 + 书架第三段接上。
> 旧 WebView 客户端曾有 `historyStore`（ADR-0094），随 ADR-0203 删除 ⇒ 需重建。

### P2 · 送达通道
`POST_NOTIFICATIONS` 权限 + Lynx 原生模块 + **本地周期拉取**。
> 依据：LINE WEBTOON 官方——加入最爱后"新集上架时在 App 中收到推播"。
> ⚠️ **决策 6：服务端推送明确不做。** 本项**无后端依赖**，仅需客户端原生能力。
> 本项的真正作用是**验证"用户想不想要这个回执"**——若本地通知的打开率很低，
> 说明回执本身价值有限，也就不必回头考虑服务端方案。

---

## 5. 明确不做

| 不做 | 理由 |
|---|---|
| 加第 5 个顶层目的地 | 环几何会重叠（§1.3） |
| 推翻 ADR-0120 加回常驻底栏 | HIG 确实点名"藏导航→忘记在哪"，但 ADR-0120 是**有意决策**；本方案不依赖载体变更 |
| 把下载队列搬进书架 | 它是控制面不是内容面（§2.3） |
| 批量删 16 个零消费者 API | 需逐个确认是否备用接线 |

---

## 6. 影响面（已核查，非估算）

改 tab 集合会牵动：

| 位置 | 性质 |
|---|---|
| `components/navTabs.ts` | 事实源 |
| `stores/globalFab.test.ts:107` | **硬编码**顶层 tab 名。**已随本次改动更新**：原 `["recommended","illusts","novels","me"]` → 现 `["discover","updates","shelf","me"]`（该测试显式写出期望清单、不遍历 `NAV_TABS`，避免重言式） |
| `primitives/createGlobalFab.test.ts:205,211` | 用 `'novels'` 做 select 用例 |
| `i18n/locales/{zh-CN,en}/misc.ts` | `navTabs.*` 增删 |
| `tests/unit.test.ts:272` | 路由表断言 |
| `tests/{tagMuteTemplate,meNotificationsTemplate,md3GuardScans}.test.ts`、`hardcode-whitelist.json` | 门禁扫描 `navTabs` 字面量 |
| **E2E a11y 标号** | ⚠️ **`a11yLabel` 钉住中文，且 android-e2e 不进 CI（ADR-0084）** |

⚠️ 最后一类是**静默失效**：改 tab 名不会变红。P0 合并前需**手工重跑**受影响的 android-e2e spec。

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| **「更新」页冷启动全空** | 三段**空态不隐藏**，各显示一行说明（已落地：`Updates.vue` 三段各自的空态块）。**关注段补了引导**（2026-10-03，此前未实现）：空态给出「为什么空」的解释 + 两个出口「去关注作者」(`/following`) / 「看看排行榜」(`/ranking`)，覆盖「去补关注」与「先逛逛」两种意图。⚠️ **加载失败时不显示该引导**——取不到数据 ≠ 没关注，此时推荐「去关注」是误导；门禁 `tests/updatesFollowingEmptyGuidance.test.ts` 钉住这一区分 |
| **分组假设可能是错的**（⚠️ **已发生**） | 缓解手段 §8 的验证**从未执行**（见下与文首「门禁豁免」）⇒ 现存防线只剩 P0-1 只改 tab 标签、回滚成本低。**分组至今未验证** |
| **通知可发现性下降**（⚠️ **曾发生**；2026-10-03 复核 → **已缓解**，见 §3.2） | 顶栏补位已撤时，承诺的外环角标**当时对用户不可见** ⇒ 撤销补位**一度**没有换来唯一的、更显眼的入口。**缓解事实**：外环角标已端到端接线并渲染（`stores/globalFab.ts` 的 `navBadge` 读点 · `App.vue` 冷启动取值 · `GlobalFab.vue` 渲染），通知在全局级恢复可发现性；`globalFabNavBadge.test.ts` 6 passed。✅ **模拟器目检已存证**（2026-10-03，`docs/research/screenshots-2026-10/10-nav-badge-visible.png`：外环展开态可见「更新」项右上角红色角标 `5`）——此前登记的 TBD 至此消解。⚠️ **残余**：「通知」仍**不是唯一入口**（「我的」次级入口按决策 4 = B 有意保留）——本行不销案，改为**降级跟踪** |
| 老用户找不到收藏/追更 | 「我的」保留次级入口（收藏/稍后看/通知/追更 4 条，**已核实在位**）+ **一次性迁移提示**（2026-10-03 补做，此前全仓无任何实现）：「我的」页 scroll-view **最上方**的可关闭卡片，说明「插画与小说已并入『发现』；收藏 / 稍后看 / 通知 / 追更仍在下方」。已读旗标 `nav_migration_v1_seen` 是**设备级**（换账号不重看）且**刻意不进备份域**（备份恢复到新设备时再看一次才是合意的）。⚠️ **有意取舍**：只做「我的」页内联卡片，**未做全局弹层**——「发现」页是 full-bleed 渗色流（ADR-0216/ADR-0075），顶部塞卡片会与整屏插画打架；全局弹层要动 modalStack 与返回键契约，风险面大得多。接线门禁 `tests/meMigrationNoticeWiring.test.ts` |
| 媒介入口变深（1 步→2 步） | 二级 tab 常驻；深度仍在 NN/g/HIG 的 2 层上限内 |
| 「继续读」P1 前书架只有 2 段 | P0 先给空态占位，不假装有数据 |

---

## 8. 分组假设的验证（**决策 1 = A 曾升为开工前置；实际被豁免，从未执行**）

NN/g 明确要求分组靠 **card sorting**，不能靠直觉。本提案的四组是**从代码结构推出来的**。

⚠️ **状态：从未执行（挂账，2026-10-03 补记）**。

- 拍板时状态 = **阻塞 P0-3**（`Updates.vue` 的形态依赖分组结果）。
- 实际发生 = 产品负责人**授权跳过**该前置直接实现；
  `docs/research/card-sorting-results-2026-10.md` **不存在**（全仓无此文件），
  批次 ①②③ **全部已交付**。
- ⇒ **本提案的四组分组至今零用户研究数据支撑**，只能当作待验假设。
- 补救路径（若仍要验）：下方协议**仍可直接执行**，无需重写。

**完整执行材料**（卡片清单、参与者、指令、判据、失败处置）：
[`../research/card-sorting-protocol-2026-10.md`](../research/card-sorting-protocol-2026-10.md)

摘要：12 张功能卡 · 8–12 位真实用户 · **不提示分组名** · 一致性聚类判是否自然浮现四组
· 约 1 人日。

> 决策 = 产品负责人，风险 = 产品负责人已接受；登记于 ADR-0218。
> 后续项 issue 号：**TBD**。

---

## 9. 决策记录（2026-10-03 已拍板）

| # | 决定 | 拍板 | 对本文的影响 |
|---|---|---|---|
| 1 | 四组分组是否先验证 | **A — 先做 card sorting 再动手** | §8 升为**开工前置**；P0-1 之后、P0-3 之前必须完成 —— ⚠️ **未兑现**（前置被豁免，见 §8 挂账） |
| 2 | 「更新」页形态 | **甲 — 一页三段**（按推荐） | §2.2 维持原设计，无需改 |
| 3 | P0 发版粒度 | **B — 分 3 批**（按推荐） | §4 改为三批，批间可独立验证/回滚 |
| 4 | 「我的」改到哪 | **B — 只搬调试项 + 保留收藏/稍后看次级入口**（按推荐） | §2.4 收窄：不拆账号区与外观区 |
| 5 | 度量数据存哪 | **A — 只存本地，不上传**（按推荐） | §4 P0.5 明确"零服务端、零第三方 SDK" |
| 6 | P2 推送形态 | **先本地周期拉取；服务端推送明确不做**（按推荐） | P2 收窄为本地实现，无后端依赖 |

### 9.1 由决策 3 推出的三批切法

| 批 | 内容 | 批末必须做 |
|---|---|---|
| **① 只改标签** | `navTabs.ts` 换成四组名，**页面内容不动** | 跑 `pnpm check:all` + `test:all` + **手工重跑受影响 android-e2e**（a11y 中文标号，静默失效） |
| **② 接新位置** | 建 `Updates.vue`（三段）、`Shelf.vue`（三段，继续读先空态占位） | 同上 + 核对三段空态文案 |
| **③ 瘦身与对齐** | 搬调试项进 `AdvancedSettings.vue` · 收藏/稍后看上 `NovelDetail` · 撤通知补位 · 删 `NavigationBar.vue` | 同上 + `Me.vue` 专项模板测试 |

⚠️ **分批的核心理由**：`a11yLabel` 钉住中文而 android-e2e **不进 CI**（ADR-0084），
改 tab 名**不会变红**。分批让"哪一批弄坏的"可定位。

### 9.2 决策 1 的执行位置（**计划 vs 实际**）

**计划**：

```
card sorting 验证（§8）
      ↓  分组成立？
   ┌──┴──┐
  是     否
   ↓      ↓
 走三批   重做分组；P0-1 只改标签，可低成本回滚
```

**在 card sorting 出结果前，可动手的只有 §9.1 第①批**（只改标签、不依赖分组结论）。

**实际（2026-10-03 补记，挂账）**：

```
card sorting 验证（§8）  ──▶ ✗ 从未执行（无 results 文件）
      ↓  前置被产品负责人豁免
直接实现 ──▶ 走完三批 ①②③（全部已交付）
      ↓
分组结论 = 零用户研究数据（未验证假设）
```

⇒ 「只准动第①批」的门禁**已被明确放弃**，不是漏做。
  现存回退阀只剩"P0-1 只改 `navTabs.ts` 标签、可低成本回滚"。
  决策与风险 = 产品负责人；登记于 **ADR-0218**；后续项 issue 号 **TBD**。

---

## 10. E2E 基线对照结论（2026-10-03 22:50–22:56）

android-e2e 手动门（`BENCH_NAV=1 pnpm test:android-host:e2e`）在本次重构后跑出的失败，
**逐条与重构前固定点 `799f1285` 做了对照实验**，结论如下。

⚠️ 对照实验的干净性有保障：`transition-matrix.spec.ts` 与 `lynx-bookmark-tags.spec.ts`
在 `799f1285` 与 HEAD 之间 `git diff` **为空**（两 spec 逐字相同）⇒ 基线与当前的任何差异
**只可能来自产品代码**。

| spec / 用例 | 重构后 HEAD | 基线 `799f1285` | 归因 |
|---|---|---|---|
| `md3-visual-tokens` A1–A4 | **4/4 通过** | —（本次重校准后通过） | 本次回归**已修**（见下） |
| `settings-sync-contract` | 通过 | — | 先前一次失败是执行顺序/瞬态，非缺陷 |
| `lynx-bookmark-tags` | FAIL（`findHeartGlyph` 恒 null） | FAIL（**逐字相同**） | **基线已坏，非本次引入** |
| `transition-matrix` R1 | FAIL ×2（差异 0.19 / 0.26） | PASS ×1 / **FAIL ×1**（差异 **0.78**） | **环境网络抖动导致的偶发**，见下 |
| `transition-matrix` R2 | FAIL（结果不再增长） | FAIL（**网络层无响应**，`status<=0`） | 两次失败模式不同，**归因不成立** |

### R1 为何不判为本次回归

基线自身也会红，且红得**更狠**（0.78 vs 0.19/0.26）。机制上，R1 断言的是「系统返回后锚点
上方区域逐像素不变」，而返回时 KeepAlive 激活会触发 `consumeAnchor` **注入「相关作品」行**
（spec 原文注明该注入是**网络请求**）。当前环境下模拟器到 Pixiv 的链路**间歇性不通**
（实测同一 token 连续 3 次里 1 次 `Connection reset`；R2 在基线直接报「网络层无响应」）。
⇒ n=2 vs n=2 的通过率不足以判定回归，**不以 0/2 对 1/2 下「是本次引入」的结论**。

另经 `git diff` 核实：本次重构**未触及** `IllustList.vue` / `IllustDetail.vue` /
`routeTransition.ts` / `routerCore.ts`，也未改动 `App.vue` 的 `KeepAlive` / `RouterView` 模板。

### 附带发现：e2e 判据与本次重构的三处连带损伤（均已修）

改 `md3-visual-tokens` 的采样窗以适配 ADR-0216 撤顶栏时，**连带打坏了两个只在该窗下
才暴露的机制**，两者都不报错、只**静默失去判别力**：

1. 采样窗移到 Root 渗色带后，该带在**任何**页面（含登录页、空屏）都是纯 `--md-surface`
   ⇒ 「屏是空的」也能通过底色断言（实测 32KB 纯色帧让 A1/A2 全过）。
   ⇒ 新增「非空白」判据（非底色像素占比 ≥ 0.05；实测空白帧 0.018 / 有内容帧 0.346）。
2. `relaunchAndSample` 靠「连续 3 帧底色完全相同」判断画面停稳，而渗色带**静态**
   ⇒ 第一批帧就「收敛」，采到骨架/空屏帧。⇒ 收敛改为「底色一致 **且** 画面已有内容」。
3. 该 spec 原先依赖「设备上已有登录态」，而同批 `settings-sync-contract` 会 `pm clear`
   ⇒ 一旦排在其前，本 spec 就对着空白屏取样。⇒ 改为 `beforeAll` 主动 dev hook 登录。

> **教训（可复用）**：把采样窗从「动态区域」移到「静态区域」不是局部改动——它会同时
> 抽掉「收敛」与「有内容」两个隐含前提。两者都不会报错，只会**开始说谎**。
