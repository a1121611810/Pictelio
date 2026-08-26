# Spec: app-lynx 小说系列追更（返回拦截询问 + 追更列表）

> 阶段：to-spec（Grill 决策已锁定，见 §2）
> 范围：**仅 packages/app-lynx**；主 app（pictelio-app）本期不动
> 关联：ADR-0066（系统返回桥）、ADR-0049（内存路由历史栈）、issue #163（modalStack 返回键关弹层）

## 1. 背景与目标

用户在 app-lynx 阅读系列小说时，离开页面（左上角返回 / 系统侧滑返回）是"追更意愿"最强的时刻。本期目标：

1. 小说详情页：当小说属于系列、且用户已实质阅读时，返回动作被拦截并弹出"是否追更该系列"询问；
2. 补齐追更的**显示面**：追更列表页（Me 页入口）+ 详情页系列行的追更状态标记。

## 2. 决策记录（Grill 结论，2026-08 锁定）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 触发阈值 | 滚动进度 **≥70%** 或**到达底部**；且页面停留 **≥10s**（防秒进秒退误触） |
| D2 | "暂不"记忆 | **本会话级**：内存 Set，应用重启后重置；不持久化 |
| D3 | 已完结系列（`is_concluded=true`） | **也弹** |
| D4 | 追更列表条目点击 | 直达**最新一话**（`latest_content_id` → `/novel/:id`）；不建系列章节页 |
| D5 | 范围 | 只做 app-lynx |
| D6 | 追更通知开关（`watchlist/notification`） | 本期不做 |

## 3. 接口契约（App API，OAuth Bearer，与现有客户端同路）

契约真实来源（测试 mock 的 oracle）：**Pixiv-Shaft 源码**（`ceui/lisa/http/AppApi.kt`、`ceui/loxia/API.kt`、`ceui/loxia/Models.kt`），逐字核实。Web ajax 路线（`/ajax/novel/series/{id}/watch`，需 PHPSESSID + x-csrf-token）**明确排除**——app-lynx 无 webview 登录，拿不到 web 会话。

| 用途 | 方法 & 路径 | 参数 | 响应要点 |
|------|------------|------|----------|
| 系列详情（含追更状态） | `GET /v2/novel/series` | `series_id` | `novel_series_detail.watchlist_added: boolean`、`is_concluded`、`title`、`content_count` |
| 追更 | `POST /v1/watchlist/novel/add` | form: `series_id` | 空响应 |
| 取消追更 | `POST /v1/watchlist/novel/delete` | form: `series_id` | 空响应 |
| 追更列表 | `GET /v1/watchlist/novel` | 无 query | 顶层字段 `series: WatchlistSeries[]` + `next_url` |

`WatchlistSeries` 字段（Shaft `Models.kt` 逐字）：`id`（系列 id）、`title`、`url`（封面，可空）、`mask_text`（非空=被屏蔽/下架占位）、`published_content_count`、`latest_content_id`（最新一话**作品 id**）、`latest_content_date`（ISO 串，卡片显示前 10 位）、`user`。

**mask 条目判定**（对齐 Shaft `isMasked`）：`title` 空 且 `url == null` 且 `mask_text != null` 且 `user.id == 0`。

传输层复用 `apiClient.get` / `apiClient.post(path, body: Record<string,string>)`（form-encoded 现成）。双模式（web 代理 / 原生桥）由 client 层既有机制承接，无新增原生工作。

## 4. 功能分解

### US1 · API 层与类型

`packages/app-lynx/src/api/`：

- `types.ts` 新增 `NovelSeriesDetailResponse`（`novel_series_detail: { id, title, content_count, is_concluded, watchlist_added }`）与 `WatchlistNovelListResponse`（`series: WatchlistSeries[]`、`next_url`）
- `novel.ts` 新增：
  - `loadNovelSeries(seriesId, signal?)` → `GET /v2/novel/series`
  - `addNovelWatchlist(seriesId)` → `POST /v1/watchlist/novel/add`
  - `deleteNovelWatchlist(seriesId)` → `POST /v1/watchlist/novel/delete`
  - `loadWatchlistNovels(signal?)` / `loadWatchlistNovelsNext(url, signal?)`

### US2 · 触发判定（纯逻辑 seam）

新原语 `primitives/watchlistPrompt.ts`（纯函数，零 Vue 依赖，可单测）：

```ts
shouldPromptWatchlist(input: {
  hasSeries: boolean
  watchlistAdded: boolean | null  // null = 状态未知（预取失败/未回）
  dismissedThisSession: boolean
  scrollProgress: number          // 0~1
  reachedBottom: boolean
  dwellMs: number
}): boolean
```

判定规则（oracle = §2 决策记录）：

- `hasSeries && watchlistAdded === false && !dismissed && dwellMs ≥ 10_000 && (scrollProgress ≥ 0.7 || reachedBottom)` → true
- `watchlistAdded === null`（状态未知）→ **false（保守不弹）**，预取失败须 `console.warn('[watchlist]')`（禁静默降级）
- 已完结系列**不影响**判定（D3）

### US3 · 返回守卫机制

`routerCore.ts`（纯逻辑）+ `router.ts`：

- `router.ts` 新增模块级 back-guard 注册表：`registerBackGuard(guard: () => boolean): () => void`（返回注销函数，对齐 `registerModal` 形态）
- `handleSystemBack` 裁决顺序调整为：**modalStack → backGuard → backBehavior/history**（guard 返回 true = 已拦截，不 pop 历史栈）
- 裁决顺序的变化纳入 routerCore 纯函数或保持 router.ts 内联，单测覆盖"guard 拦截后历史栈不动"
- NovelDetail 左上角 `@tap` 从直调 `goBack()` 改为 `requestBack()`（先跑 guard，未拦截才 `goBack()`），**两条返回路径行为一致**

生命周期：NovelDetail `onMounted` 注册 / `onUnmounted` 注销。若实现时确认 detail 页被 KeepAlive 缓存（参考 Me.vue `defineOptions` 模式），改挂 `onActivated/onDeactivated`。

### US4 · 详情页集成（NovelDetail.vue）——页面保持薄，逻辑内收 primitive

**深模块划分**：触发编排（预取 + 竞态门 + 判定 + 弹窗状态机）全部内收进 `primitives/createWatchlistPrompt.ts`（对齐 `createBookmarkToggle` 的 deps 注入风格，node 可单测）；NovelDetail 只做三件事——喂滚动事件、把 `requestBack` 接进返回守卫（US3）、按状态渲染弹窗。

`createWatchlistPrompt` 接口：

```ts
createWatchlistPrompt(deps: {
  getSeries: () => { id: number; title: string } | null  // 页面提供当前小说的系列
  loadWatchState: (seriesId: number) => Promise<boolean> // US1 loadNovelSeries 适配
  isDismissed: (id: number) => boolean                   // ↓ 三者由 watchlistStore 满足（US6）
  markDismissed: (id: number) => void
  setWatchState: (id: number, added: boolean) => void
  addWatchlist: (id: number) => Promise<void>  // 追更请求（review P2-3 修订补录：
                                               // confirm 要发请求且保持 node 可测，必须注入）
  now?: () => number                                     // 测试注入时钟
}): {
  notifyScroll(progress: number, reachedBottom: boolean): void
  requestBack(): boolean   // 守卫回调：true=已拦截（弹窗打开）
  readonly dialogOpen: boolean
  readonly dialogBusy: boolean      // 追更请求在飞（防连点）
  readonly dialogError: string
  readonly watchAdded: boolean | null  // 详情页系列行「已追更」标记数据源
  confirm(): Promise<void>  // 「追更」：add → 成功关弹窗（页面继续返回）/ 失败置 dialogError
  decline(): void           // 「暂不」：dismiss + 关弹窗（页面继续返回）
  cancel(): void            // 返回键关弹窗：dismiss + 关弹窗（**不离开**，停留详情页）
  dispose(): void           // 卸载：代递增 + 清计时
}
```

- **进度跟踪**：scroll-view 监听滚动，`scrollProgress = scrollTop / (scrollHeight - viewportHeight)`；`@scrolltolower` 置 `reachedBottom`；页面转发给 `notifyScroll`
- **停留计时**：primitive 内记录创建时间戳（`deps.now`）
- **追更状态预取**：`getSeries()` 非空时 `loadWatchState` 取 `watchlist_added`；内部 generation-gate 防竞态（`dispose`/重建递增）；结果写 `watchlistStore.setWatchState`
- **系列信息行**：元信息区新增系列行 `《系列名》`，`watchAdded === true` 显示「已追更」标记（M3 assist-chip 风格）
- **受限小说**（isRestricted 遮罩，正文不可读）：无正文可滚，进度恒不达阈值，无需特判

### US5 · 追更询问弹窗（WatchlistPromptDialog.vue）

M3 Dialog（复用 Me.vue `ugoiraConfirm` 的结构与 token：fixed scrim + `surface-container-high` 居中卡片 + `md-shape-extra-large`）：

- 标题「追更这个系列？」；内容 `《{series.title}》· {作者名}`；操作：「暂不」（text button）/「追更」（primary text button）
- **打开时 `registerModal` 注册进 modalStack** → 系统返回键优先关弹窗（等同"暂不"，记录会话 dismissed，**不继续返回**，留在详情页）
- 「暂不」→ 记录 dismissed（US6）→ 关弹窗 → **继续原返回动作**（goBack）
- 「追更」→ `addNovelWatchlist` → 成功：关弹窗 + 轻量「已追更」反馈 + 更新详情页状态标记 → 继续原返回动作；失败：弹窗内错误条（`presentError`）+ 可重试，不静默
- a11y：交互元素 label 登记进 `utils/accessibility.ts` 注册表（单测断言注册表全消费）

### US6 · watchlistStore（追更状态单一 seam）

`stores/watchlistStore.ts`（模块级响应式，对齐既有 store 约定）——**追更相关知识只住在这里**，详情页/弹窗/列表页共享：

- **dismissed 会话记忆**（D2）：`dismissedSeriesIds: Set<number>`，`markDismissed` / `isDismissed`；内存态不持久化，重启即清
- **watch 状态缓存**：`watchStateBySeries: Map<number, boolean>`，`setWatchState` / `getWatchState`；写入方 = 详情页预取、弹窗 confirm 成功、列表页取消；读取方 = 详情页系列行标记、触发判定

### US7 · 追更列表页 + 入口

- 路由 `{ path: '/watchlist', name: 'watchlist', component: Watchlist }`（navigate 默认入栈，goBack 可回）
- `pages/Watchlist.vue`：`loadWatchlistNovels` + `next_url` 分页（`@scrolltolower`）；条目卡片：封面（`proxyImageUrl`）、标题、作者、`published_content_count` 话、更新日期（`latest_content_date` 前 10 位）；**mask 条目**（§3 判定）只显示 `mask_text` 且不可点
- 点击条目 → `navigate('/novel/' + latest_content_id)`（D4）
- 条目右侧「取消追更」操作：`createWatchlistToggle` primitive（镜像 `createBookmarkToggle`：deps 注入 add/remove + busy 锁 + error 槽），二次确认复用 M3 Dialog 模式；成功后写 `watchlistStore.setWatchState`（详情页标记联动）
- Me 页账户组「我的收藏」下加入口行「追更列表」→ `navigate('/watchlist')`（a11y label 登记）

## 5. 数据流

```
NovelDetail 挂载
  ├─ loadNovelDetail → novel.series? ──是──→ loadNovelSeries(series.id) ─→ watchlistAdded ─┐
  │ （先渲染后加载，现状不变）                 （失败 → null + warn，保守不弹）               │
  ├─ scroll-view 滚动 → scrollProgress / reachedBottom ──────────────────────────────────┤
  └─ 停留计时 dwellMs ───────────────────────────────────────────────────────────────────┤
                                                                                          ▼
返回动作（左上角 requestBack / 系统返回 handleSystemBack → backGuard）
  ──→ createWatchlistPrompt.requestBack() 内部跑 shouldPromptWatchlist(...)
  ├─ false → 正常返回
  └─ true  → WatchlistPromptDialog（registerModal 入栈，读 primitive 状态渲染）
                ├─ 返回键关弹窗 → cancel()：dismiss + 关弹窗，**留在详情页**
                ├─ 暂不 → decline()：dismiss + 关弹窗 → 页面继续返回
                └─ 追更 → confirm()：POST /v1/watchlist/novel/add
                            → 成功：setWatchState + 关弹窗 → 页面继续返回
                            → 失败：dialogError 弹窗内报错可重试（不静默）

Me 页「追更列表」→ /watchlist → GET /v1/watchlist/novel → 系列卡片流 → 点击直达最新一话
```

## 6. 边界条件

1. **重复触发**：同一次详情页停留只弹一次（弹过即 dismissed，无论选了什么）
2. **章节内跳转**：系列内从一章跳到另一章属于路由参数变化，`dispose` + 重建 primitive（代递增废掉在飞预取）
3. **弹窗打开时系统返回**：modalStack 优先关弹窗（现有行为），不触发页面返回
4. **弹窗在飞防连点**：`dialogBusy` 期间「追更」禁用（对齐 createBookmarkToggle busy 锁语义）
5. **未登录**：详情页本身有登录守卫链路，弹窗不单独处理；add/delete 遇 401 走既有 `registerUnauthorizedHandler` 链路
6. **watchlist_added 预取失败**：不弹（§US2），不阻塞阅读与返回
7. **mask 条目**：追更列表中只读展示 `mask_text`，不可点击、无取消按钮（系列已不可操作）
8. **非系列小说**：`novel.series` 缺失 → 守卫恒放行，零开销（不发起系列预取）

## 7. 平台风险（实现期 T0 验证）

- **scroll-view 滚动事件**：平台事实②（ADR-0110 注释）只证实 `<list>` 不派发 per-frame scroll；NovelDetail 用的是 `<scroll-view>`，其 `@scroll`/`scrollTop` 在原生 LynxView 的可用性**未实测**。实现第一个 ticket 时在真机/模拟器验证：
  - 可用 → 按 §US4 实现
  - 不可用 → 降级为「仅到达底部触发」（`@scrolltolower` 已在多页面验证可用），并在代码注释 + 本 spec 记录降级事实
- **web-core 预览**：scroll-view 滚动事件 web-core 预期可用，降级方案同样兜底

## 8. 测试要求（对齐 AGENTS.md 测试硬约束）

| 层 | 测试 | oracle 来源 |
|----|------|------------|
| API 契约 | `tests/api` watchlist 增删/列表/系列详情成功 + 失败路径；mock 字段**逐字取自 Shaft Models.kt**（文件头注明出处） | Shaft 源码（§3） |
| 纯逻辑 | `shouldPromptWatchlist` 全判定矩阵（阈值边界 69%/70%、dwell 9s/10s、watchlistAdded 三态、dismissed、hasSeries） | §2 决策记录 D1–D3 |
| 路由 | backGuard 注册/注销/裁决顺序（modalStack 优先于 guard、guard 优先于历史栈） | §US3 裁决顺序定义 |
| store | watchlistStore：dismissed 会话记忆 mark/is、watchState 缓存读写 | D2 / §US6 |
| primitive | createWatchlistPrompt：预取竞态门、requestBack 判定接线、confirm 成功/失败、decline/cancel 语义差、busy 锁 | §US4 接口契约 |
| 弹窗 | modalStack 注册、a11y 注册表消费 | §US5 行为定义 |
| E2E | app-lynx 现有 android-e2e 暂不扩展；回归靠单测 + 手验 | — |

## 9. 排除项（本期明确不做）

- 主 app（pictelio-app）的同名功能（D5）
- 追更通知开关（D6）
- 漫画系列追更（`/v1/watchlist/manga/*`，接口已知但无 UI 入口需求）
- 系列章节列表页（D4 直达最新一话替代）
- dismissed 持久化（D2 会话级）

## 10. Ticket 拆分预览（to-tickets 阶段细化）

- T1 API 层 + 类型 + 契约测试（US1）——无前置
- T2 watchlistStore + `shouldPromptWatchlist` 纯判定 + 单测（US2、US6）——无前置
- T3 返回守卫机制（routerCore/runBackGuards 纯函数 + router 注册表 + requestBack）+ 单测（US3）——无前置
- T4 `createWatchlistPrompt` primitive + 单测（US4 的逻辑半）——前置 T1、T2
- T5 WatchlistPromptDialog 组件 + a11y 登记（US5 的渲染半）——前置 T4（消费其状态接口）
- T6 NovelDetail 集成：滚动喂入 + 守卫接线 + 系列状态行 + 弹窗挂载（US4/US5 的接线半，含 §7 平台验证与降级）——前置 T3、T4、T5
- T7 追更列表页 + 路由 + Me 入口 + 取消追更 toggle（US7）——前置 T1、T2；与 T3–T6 链可并行
