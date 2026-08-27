# Spec: app-lynx 推荐页按钮分页（替换式翻书，绕开 list 增量渲染 bug）

- 状态：draft（Grill 已收敛，待用户确认后进实现）
- 日期：2026-08-29
- 关联：`docs/specs/app-lynx-feed-pagination-and-watchlist-prompt-fix.md`（前序翻页修复，T1 补触发保留）、ADR-0107（epoch 重建 workaround）、ADR-0104（createMixFeed 分页收敛）

## 1. 背景与根因

前序调查（web-core DOM 实证 + 真机确认）钉死一个框架级 bug：

**vue-lynx `<list>` 组件对新增 list-item 的增量渲染失效**——items 数据增长（rendered 40→60→100）后，新条目不进入布局（内容高度不涨、UI 不增），双端一致；且 list 无 JS 滚动接口（ADR-0110 事实③），无法在重建后保持滚动位置。滚轮/属性 toggle/initial-scroll-index 等全部实测无效。

唯一可靠的渲染机制是 **epoch 重建（:key 整树替换，ADR-0107 已验证）**，但重建必然回顶。

**方案决策（Grill 确认）**：放弃「滚动到底自动翻页」的无限滚动形态，改为 **FAB 按钮分页（替换式翻书）**——列表永远只显示当前页，切页 = epoch 重建 + 从页顶看。回顶从"缺陷"变成"翻页的自然语义"，彻底绕开两个框架限制。

## 2. 产品行为（推荐页）

### 2.1 每页内容构成

- 每页 = **插画路一页（20 条）+ 小说路一页（20 条）**各自拉取后，**按 `create_date` 时间交叉合并排序**（app 端 recommendedStore 的 sortByDate + mergeAndSort 语义，替代 lynx 现状的 4:1 固定比例交替）
- 页内全量展示两路之和（约 40 条），不做"取前 N"截断——按时间排序后截断会丢数据（剩余条目被丢弃且无衔接）

### 2.2 翻页交互（FAB menu）

- FAB menu 现有两项（刷新 / 回顶），新增**「上一页」「下一页」**：
  - 第 1 页：只显示「下一页」（用户原话：第一页只有下一页）
  - 第 2 页起：显示「上一页 + 下一页」
  - 无下一页（两路 next_url 均空）：「下一页」**隐藏**（Grill 开放项「禁用或隐藏」收敛为隐藏——菜单项不渲染，截图可判定）【审阅补充：收敛选择，便于验收判定】
- 点「下一页」：拉两路各下一页 → 时间合并 → 替换当前页 → **epoch 重建** → 从页顶看新页
  - 【审阅补充·往返一致性】目标页已在页缓存中（翻回后再翻前）时**直接切缓存、不重复请求**——否则「下一页→上一页→下一页」往返会看到与首次不同的页内容，违反 §5「上一页/下一页往返正确」验收。缓存优先与「上一页缓存」对称（§3.1：next 先查缓存，miss 才拉取）
- 点「上一页」：切回内存缓存的上一页数据（**Pixiv API 无 prev_url**，只能缓存已拉页）→ 替换 + epoch 重建 → 从页顶看
- 「刷新」：回到第 1 页重新拉取（清缓存）
- 「回顶」：保留现有回顶语义（epoch 重建回顶）

### 2.3 页面状态

- 首载（当前无任何数据）加载中：骨架屏（沿用现状 SkeletonCard 8 张）
- 切页加载中：**保留当前页** + 页内 loading 指示（页脚「加载中…」或顶部细条）；数据就绪后一次性替换 + epoch 重建，切页中途不清空旧页（避免闪白；翻页失败可无缝停在原页）【审阅补充：明确切页 loading 不清旧页，与「失败保留当前页」一致】
- 加载失败：错误文案 + 可重试（重试当前页；next/prev 失败 = 重拉同一页，游标回滚见 §3.1.1；首载失败 = 整页错误 + 重试刷新）
- 错误呈现两态（单一 error 槽）【审阅补充】：`error && items 为空` → 整页错误；`error && items 非空` → 页内错误条、当前页保留
- 每页条数变化提示：无（不展示总数，Pixiv 无 total）

## 3. 技术设计

### 3.1 数据层：`createPagedFeed` 深模块（新建，推荐页专用）

对齐 createMixFeed 的风格（纯 TS 无 DOM 依赖、node 可测），但语义从"流式累积"改为"页式缓存"：

```ts
interface PagedFeedSource {
  name: string
  fetchPage: (signal?: AbortSignal, nextUrl?: string | null) =>
    Promise<{ items: MixFeedItem[]; nextUrl: string | null }>
}

interface PagedFeedOptions {
  sources: PagedFeedSource[]          // 推荐页 = [illust, novel]
  pageSize?: number                   // 单路每页条数，默认 20（【审阅补充】仅文档性：页内全量展示，无截断消费路径）
  merge?: 'time-merge' | 'ratio'      // 时间交叉合并（默认）或固定比例；【审阅补充 minor-3】仅预留，当前恒 time-merge（ratio 无消费路径，不实现，避免 dead path）
  timeoutMs?: number                  // 单页请求超时，默认 15000
  maxCachedPages?: number             // 上一页缓存上限，默认 5
  onUpdate?: () => void               // 数据变化后通知页面重新快照（沿用 T1 onUpdate 契约）
}

interface PagedFeed {
  items: () => MixFeedItem[]              // 当前页合并排序后的条目
  loading: () => boolean                  // 当前页请求在飞
  error: () => string | null              // 当前页加载失败文案
  pageIndex: () => number                 // 当前页号（0 起）
  hasPrev: () => boolean                  // pageIndex > 0
  hasNext: () => boolean                  // 两路任一 next_url 非空
  next: () => Promise<void>               // 下一页
  prev: () => Promise<void>               // 上一页（缓存）
  refresh: () => Promise<void>            // 回第 1 页重拉（清缓存）
  dispose: () => void
}
```

内部状态与状态机：
- `cachedPages: Array<{ items: MixFeedItem[]; nextUrls: (string | null)[] }>`（每页缓存两路游标 + 合并后 items；上一页/下一页据此无缝切换）
- `currentIndex: number`（当前页在 cachedPages 中的位置）
- 时间合并：`mergeByTime(pages)` —— 两路 items 按 `create_date` 降序合并（app 端 mergeAndSort 语义，同分 tie-break 稳定）
- 竞态代 generation：仅 `refresh()`（打断型）/ `dispose()` 换代作废在途响应；切页受防重入 guard 保护，不存在并发在飞（见 §3.1.1 统一语义）
- 超时 withTimeout 复用

**【审阅补充 §3.1.1 状态机与边界条件】**（本次审阅补充的明确定义；不改 Grill 决策）

**缓存窗口不变式**：`cachedPages` 始终是含 `currentIndex` 的连续窗口 `[lo..hi]`（prev/next 只走 ±1，天然连续；refresh 重置）。`hasPrev = currentIndex > lo`；`hasNext = currentIndex < hi` **或** 当前条目两路 `nextUrls` 任一非空（target 已缓存则无需请求）。**hasPrev/hasNext 一律从当前缓存条目派生，不随在途请求变化**——prev 后 hasNext 立即恢复为缓存值、next 成功后 hasPrev=true。

**切页事务（游标快照提交）**：`next()` = 读当前条目 `nextUrls` 快照 → 并行拉所有**非耗尽**源（快照 nextUrl=null 的源跳过，不算失败）→ **全部成功才提交**：新条目 `{ items: 合并结果, nextUrls: 新游标 }` 入缓存、`currentIndex++`、清 error；**任一路失败则不提交**（不新增条目、当前条目与游标不变、error 置文案）——重试 = 重新执行 `next()` 拉同一页（成功过的一路会重拉；推荐端点无 offset 语义，代价可接受）。与 createMixFeed「失败保留 nextUrl 供重试」对齐。

**prev 语义**：纯缓存切换（无网络）。`currentIndex-1` 条目存在则切换；**缓存 miss（窗口不变式破坏，理论不可达）→ warn + no-op**，不发起网络。

**防重入（统一语义）**：任一请求在飞（`loading() === true`）时 `next()` / `prev()` 全部 **no-op**（模块内 guard，与 createMixFeed 的 loadMoreInFlight 同型；UI 层翻页项复用 busy 机制天然收起菜单，§3.3）；`refresh()` 自身在飞时 `next()` / `prev()` 同样 no-op。**`refresh()` 是唯一打断型入口**：翻页请求在飞时 `refresh()` **不 no-op**，而是 generation++ 作废在途翻页响应 + 清缓存 + currentIndex 归 0——上一页缓存数据随之作废，不可再 prev 回旧页；被打断的 in-flight 响应按旧 generation 丢弃、不提交（无『快速 next×2 竞态』独立场景：guard 下第二次 next 必然 no-op，并发仅由 refresh/dispose 打断引入，见 §4 竞态用例说明）。

**会话 AbortController**：每次会话（generation）新建 AbortController，`fetchPage(signal, nextUrl)` 透传；`dispose()` / generation 换代时 abort 在途请求（正确性仍由 generation 判定保证，abort 是防孤儿请求的优化；超时 reject 不 abort signal，复用 withTimeout 现状）。

**去重策略**：**页内去重**（两源合并前按 `key` 去重，同页两源同 id 只留一条；条目数可能略少于两路之和）；**跨页不去重**（每页独立快照——全局 seen 会使 prev 切回的页内容与首次不一致，破坏缓存一致性；跨页重复 = 服务端分页语义，接受）。

**mergeByTime 排序细节**（oracle = app 端 createTQFeedStore merge 模式，`createTQFeedStore.ts` L151-169）：
- 每路先降序稳定排序（app `sortByDate` 语义：`localeCompare` 降序；同分保持服务端顺序——JS sort 稳定）
- 两路稳定合并（app `mergeAndSort` 语义：`a.create_date >= b.create_date` 取 a → **同分 tie-break = sources 顺序靠前者优先**，推荐页 illust 在前）
- `create_date` 缺失/空串（运行时契约破坏）：按「最旧」沉底 + `console.warn('[pagedfeed]', ...)`（非静默降级，测试硬约束 3），不 crash

**空页异常**：该源返回 `items: []` 且 `nextUrl !== null`（服务端异常形态）→ 按该源失败处理（warn + 不提交），防空页死循环；`items: []` 且 `nextUrl: null` = 正常耗尽。

**缓存上限淘汰**：`cachedPages.length > maxCachedPages` 时淘汰距 `currentIndex` 较远的一端（等距淘汰 lo 端），**永不淘汰当前页**；被淘汰页 index < currentIndex 时 currentIndex 平移（-1）。窗口不变式保持，prev/next 仍可走 ±1。第 1 页被淘汰后不可 prev 回（刷新回第 1 页），属缓存上限既定语义。

**refresh 语义**：清空 `cachedPages`、`currentIndex = 0`、generation++；成功后新第 1 页入缓存。**refresh 失败保留当前页与缓存**（error 置文案，可重试刷新）——与 createMixFeed「刷新清列表」不同：翻书模式无滚回手段，失败清空即丢上下文；首载失败（无任何缓存页）→ 整页错误 + 重试。

**推荐页两源 fetchPage 实现契约**：需透传 next_url——`nextUrl ? loadNext(nextUrl, signal) : loadRecommended(signal)`（illust.ts L48 已有 loadNext；novel 侧 `loadNovelNext`）。现状 Recommended.vue 的源忽略 nextUrl（每次返回首屏内容），页式模式必须透传，否则翻页永远拿到同一页。

### 3.2 渲染层：替换式渲染 + epoch 重建

- **统一翻页 seam**【审阅补充】：`flip()` 为唯一翻页入口（next/prev/refresh 三路共用）：`await feed 动作` → `sync()` → **同一同步 tick `refreshEpoch.value++`**（ADR-0107 D4：epoch 必须与 items 替换同一 reactive flush，await 后异步 bump 会先触发错误 patch——Recommended.vue 现有注释与实证）。`@back-to-top` 沿用现有 bump（只重建不回数据层）。
- 页面 `sync()`：`items.value = feed.items()`（当前页数据）+ `loading/error/pageIndex/hasPrev/hasNext` 快照 → 同上同 tick epoch 重建
- 移除 `@scrolltolower` 绑定（滚动只浏览当前页，不再触发翻页）
- footer：当前页号 + 「没有更多了」提示（hasNext false 时）
- 【审阅补充】t0log 打点：每次 flip 完成后 `t0log('[recommended]', 'flip page=<i> items=<n> hasNext=<b>')`，支撑 §5「日志导出可追踪每次切页」

### 3.3 FAB menu 集成

- `RefreshableList` 的 FAB menu 从 2 项扩为最多 4 项（刷新 / 回顶 / 上一页 / 下一页）
- 菜单项按状态显隐：`上一页` 需 hasPrev；`下一页` 需 hasNext（隐藏语义，§2.2）
- 页面通过 props/事件传入 `feed` 状态与 `next/prev` 回调（RefreshableList 保持深模块，只加菜单项配置）
- 【审阅补充】上一页/下一页 tap 复用 `menu.startRefresh()/endRefresh()` busy 机制：翻页中菜单收起、主 FAB 禁用态（opacity 0.6，与刷新一致），防翻页中展开菜单/再点翻页（模块 guard 兜底）
- 【审阅补充】a11y：`FAB_MENU_A11Y_LABELS` 注册表（`src/utils/accessibility.ts`，ADR-0111，现有键 `toggleMenu`/`refreshList`/`backToTop`，已核实 RefreshableList.vue 从该注册表取菜单项 label）新增 `prevPage`（「上一页」）/ `nextPage`（「下一页」），与 UI 文本一致（沿用现有注册表模式）

### 3.4 移除/保留

- createMixFeed 的推荐实例不再使用（推荐页改用 createPagedFeed）；createMixFeed 仍服务其余 8 个列表实例（本轮不动）
- T1 补触发/onUpdate/dispose 机制保留（createPagedFeed 内同样实现 onUpdate；补触发对按钮模式非必需但保留 refresh 竞态防护）
  - 【审阅补充】onUpdate 语义澄清：按钮模式无 scrolltolower，**不存在内部自动补加载路径**，onUpdate 当前永不触发；保留接口（与 createMixFeed 同签名）供未来预取/自动刷新路径复用。页面每次用户操作后显式 `sync()`（同现状），不依赖 onUpdate 驱动快照。dispose 契约 = 清定时器 + generation++ 作废在途 + abort 会话 signal（§3.1.1）

## 4. 测试

### 单测（node，`src/primitives/createPagedFeed.test.ts`）

| 用例 | 断言（oracle） |
|------|----------------|
| 首载：两路各拉第一页 → 时间合并排序 → items 长度 = 两路之和 | 排序按 create_date 降序（构造两路数据验证交叉顺序）；oracle = app 端 mergeAndSort 语义 |
| next：拉两路下一页 → 合并 → 新页替换；currentIndex 递增 | 游标正确传递（fetchPage 收到该路 next_url） |
| next() 缓存命中分支（prev 后 next 往返一致） | 目标页已在 cachedPages → 直接切缓存、不请求：items 与首次一致、fetchPage 调用次数不增、游标沿用缓存条目（§2.2 往返一致性 / §3.1 缓存优先） |
| prev：切回缓存页（不重新请求） | fetchPage 调用次数不增；items 恢复上一页 |
| prev 到第 1 页：hasPrev=false | 边界 |
| hasNext：一路耗尽仍可翻（另一路有 next_url）；两路耗尽 hasNext=false | 语义 |
| 错误：当前页失败 → error 置文案、保留当前页、可重试 | 非静默降级（warn） |
| 缓存上限：超过 maxCachedPages 淘汰最旧 | 边界 |
| refresh：清缓存回第 1 页 | fetchPage 收到 undefined（第一页） |
| dispose：清定时器 + 作废在途 | 无孤儿请求 |
| 【审阅补充】部分失败（一路成功一路失败） | 不提交：currentIndex 不变、无新缓存条目、两路游标均未推进；error 置文案；重试拉同一页 |
| 【审阅补充】失败重试成功 | 重试后页推进、error 清空、缓存条目含两路新游标 |
| 【审阅补充】防重入：翻页在飞再点 next/prev | no-op（fetchPage 调用不增）；在飞响应不受干扰；refresh 在飞时翻页同样 no-op |
| 【审阅补充】切页期间 refresh（打断型，非 no-op） | 旧翻页响应按 generation 丢弃、不提交；缓存清空、currentIndex=0；上一页缓存作废 |
| 【审阅补充】竞态作废（无独立『快速 next×2』用例） | guard 下第二次 next 必为 no-op，并发只可能由 refresh/dispose 打断引入；generation 作废语义由上行『切页期间 refresh』与 dispose 用例验证（§3.1.1 统一语义） |
| 【审阅补充】空 items + 非空 nextUrl | 该源按失败处理（warn），不提交、无空页死循环 |
| 【审阅补充】页内去重 / 跨页不去重 | 同页两源同 key 只留一条；跨页重复保留（缓存一致性） |
| 【审阅补充】create_date 同分 tie-break | 同分取 sources 顺序靠前者（illust 先）；oracle = app mergeAndSort |
| 【审阅补充】create_date 缺失 | 沉底 + console.warn（非静默降级） |
| 【审阅补充】缓存淘汰 | 超 maxCachedPages 淘汰远端、当前页保留、currentIndex 平移后 prev/next 仍正确 |
| 【审阅补充】refresh 失败 | 保留当前页与缓存、error 置文案、可重试 |
| 【审阅补充】hasNext/hasPrev 派生 | prev 后 hasNext 恢复缓存值；next 后 hasPrev=true；第 1 页 hasPrev=false |
| 【审阅补充】单源耗尽后 next | 只拉非耗尽源（fetchPage 调用数 = 非耗尽源数），耗尽源在新条目记为 null |

### 验证闭环

- 单测全绿 + `pnpm check:app-lynx`
- **web-core 预览实测**：翻页后 x-list 内容高度随页正确变化（epoch 重建已验证）、上一页/下一页往返正确
- **模拟器 + 真机**：翻书流程（第 1 页 → 下一页 → 上一页）、真机日志导出（t0Export）确认
- 【审阅补充】真机手动验证 checklist 交付用户逐项打勾（沿用 T0-T3 验证闭环要求，用户确认真机通过前不得宣称完成）：
  ① FAB menu 展开，第 1 页无「上一页」；② 下一页翻页从页顶开始、内容与上一页无重叠；③ 上一页即时返回（无网络等待，t0Export 无 fetch 打点）；④ 翻页往返内容一致（1→2→1→2）；⑤ 滚动到底停留 5s 无任何新请求（t0Export 无 fetch 打点）；⑥ 两路耗尽后「下一页」消失、footer 显示「没有更多了」；⑦ 刷新回第 1 页且「上一页」不可用；⑧ 切页失败（飞行模式）显示错误 + 当前页保留，恢复网络重试成功后页推进

## 5. 验收条件

**可操作性说明**：以下每条均可在 web-core / 模拟器 / 真机上直接判定对错；时间交叉排序的正确性由单测断言（构造交叉时间数据），真机仅核对「无截断 + 与前一页无重叠」——卡片 UI 不展示 create_date，真机无法肉眼核对排序。【审阅补充：§5 按可判定口径改写】

- 推荐页第 1 页：条数 = 两路第一页之和（页内去重后，不取前 N 截断）；条目数可数、可截图比对【审阅补充：去掉「约 40 条」模糊表述，改为可判定口径】
- FAB「下一页」→ 新页从页顶看：翻页后首屏可见条目 = 新页第 1 条（截图），内容与上一页无重叠（抽样核对标题/封面）
- FAB「上一页」→ 缓存页即时返回：返回内容与之前该页一致（往返一致），且 t0Export 无该次 fetch 打点（证明未重新请求）
- 「刷新」→ 回第 1 页：页号显示 1、内容为最新第一页、「上一页」不可用
- 两路耗尽 →「下一页」不在菜单中（截图）；footer 显示当前页号 + 「没有更多了」
- 滚动只浏览当前页：滚到底停留 5s，t0Export 无任何 fetch 打点、无「加载中」footer
- 切页失败（飞行模式/断网）：页内错误 + 当前页保留；恢复网络重试成功
- 真机 + 模拟器行为一致；t0Export 导出日志含每次切页打点（pageIndex、条数、hasNext）
- 【审阅补充】真机 checklist（§4 验证闭环 ①~⑧）逐项打勾通过

## 6. 排除项（后续迭代）

- 其余 8 个列表实例（插画/小说/关注/收藏/用户主页/追更）：沿用 createMixFeed 无限滚动，待推荐页分页模式验收后按需铺开
- 「插画/漫画」sub-tab 分类（app 端 recommendedStore 有 mixed/illust/manga）：本轮不做
- **Lynx SDK 升级（根治增量渲染 bug）**：独立 ticket（推荐页分页只是绕过，非根治）
- 预取相邻页（减少切页等待）：暂不预取，后续优化

## 7. Ticket 拆解（to-tickets，2026-08-29）

| # | Ticket | 内容 | 前置 | 状态 |
|---|--------|------|------|------|
| T1 | createPagedFeed 数据层 + mergeByTime 纯函数 + 单测 | §3.1 模块（页缓存/切页事务/竞态/超时/onUpdate/dispose）+ §4 单测矩阵 | 无 | 波 1 |
| T2 | mergeByTime 时间交叉合并 | 独立纯函数（oracle = app mergeAndSort） | 无 | 并入 T1 |
| T3 | Recommended.vue 页面集成 | 替换式渲染 + epoch 重建、移除 scrolltolower、footer 页号、两路源配置 | T1 | 波 2 |
| T4 | RefreshableList FAB menu 扩展 | menu 2→4 项（上一页/下一页 显隐 + 回调 + busy 互斥），向后兼容 | 无 | 波 1 |
| T5 | 验证闭环 | 单测全绿 + check + web-core 实测 + 模拟器/真机日志 | T3 | 波 3 |

并发策略：波 1 = T1（含 T2）+ T4 并行；波 2 = T3；波 3 = T5。每 ticket 走 TDD + 自测 + review。
