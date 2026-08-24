# Pictelio app-lynx 上下文

app-lynx 是 vue-lynx 客户端 MVP（登录 / 推荐 / 插画 / 小说 / 收藏 / 用户主页 / 更新 / 错误页），渲染目标是 LynxView 真机与 web-core 预览。本上下文记录列表浏览、受限内容与分页的领域语言。

## 术语

### 受限内容（Restricted content）

**受限条目（restricted item）**：
`x_restrict` 为 1（R-18）或 2（R-18G）且设置中对应开关（`showR18` / `showR18G`）未开启的作品。由 `settingsStore.isRestricted()` 判定。列表**全量渲染**受限条目（不过滤、不删除），以受限卡呈现；开关打开后遮罩即时消失，无需重新请求。
_Avoid_: 被挡住、隐藏条目、过滤条目

**受限卡（restricted card）**：
列表中受限条目的占位卡：scrim 半透明底 + R-18 / R-18G 徽章 + 文案「受浏览限制，不予显示」。显式固定高度（与普通卡等高）、内容居中、无交互（不跳详情、点击不穿透）。插画条目为方形受限图区（`h-[48.4vw]`），小说条目用 `RestrictedNovelCard`（全站统一高度）。
_Avoid_: 遮罩卡（与遮罩的 absolute 覆盖模式语义不同）

**遮罩（overlay）**：
`RestrictOverlay` 组件的 absolute 覆盖模式（铺满父容器），用于详情页正文等「内容仍渲染、遮罩盖其上」的场景。列表卡一律用流内受限卡模式，**禁止**在 list-item 内使用 absolute 遮罩（真机高度测量异常，会撑满内容区）。

### 分页（Pagination）

**混合分页 feed（mixed pagination feed）**：
`createMixFeed` 深模块——把多路远程分页源（插画/小说）按比例交替合并成单一渲染流，向调用方隐藏双防抖（throttle 800ms + cooldown 3s）、竞态代（generation）、去重、分批渲染（pageSize=20）、翻页优先级、15s 超时、空页防护。所有列表页统一经它分页，页面只做 ref 快照桥接（sync）。
_Avoid_: 手写 loadMore、页面内双防抖/竞态/空页防护

**分页到底态（end-of-feed）**：
所有分页源耗尽（`nextUrl` 为 null）且列表非空时的状态。列表底部 footer 显示「没有更多了」，`scrolltolower` 不再触发请求。
_Avoid_: 到底后报错、静默空白

**内联分页错误（inline pagination error）**：
分页（fetchMore）失败时在**列表底部**显示的错误提示，保留已加载内容，`nextUrl` 保留供滚动自动重试。与首屏错误（顶部整页提示）相对——两者槽位分离（createMixFeed 的 `error()` / `pageError()`）。
_Avoid_: 分页错误显示在列表顶部、清空已加载内容

### 下拉刷新（Pull-to-refresh）

**下拉刷新手势（pull-to-refresh gesture）**：
列表页的刷新手势入口。原生 LynxView 由 `<refresh>` XElement（xelement-refresh，底层 SmartRefreshLayout）承载；web-core 预览无 `refresh` 标签映射，降级为组件内建刷新按钮。刷新语义对齐根 ADR-0076 语义 A（可见刷新过程）：原生侧由 `<refresh-header>` 停留 + spinner 实现，**不做**骨架遮罩替换（那是 webview 无原生 header 时的代偿）。数据动作统一为既有 `feed.refresh()` / `fetchFirstPage()`（幂等 + generation 竞态防护），下拉刷新不新增数据层语义。
_Avoid_: 骨架遮罩刷新（webview 专属代偿）、页面自实现 touch 手势

**RefreshableList**：
下拉刷新容器组件（深模块），本上下文唯一合法的下拉刷新承载者。接口仅三件：`:refreshing` prop（外部驱动，`false` 时组件调 `finishRefresh()` 收起 header）、`@refresh` 事件（用户下拉过阈值触发）、默认 slot（放现有 `<list>`）。双端分支、header 双态（「下拉刷新」/「刷新中…」）、SelectorQuery 调用、15s 兜底全部收敛内部。9 个列表实例（Recommended / IllustList / NovelList / Following / Bookmarks×2 / UserHome×2 / FollowList）统一消费。
_Avoid_: 页面内直接写 `<refresh>` 标签、FAB 刷新按钮（已废弃，Fab.vue 随之删除）

### 客户端（Client）

**双域名 URL（double-host URL）**：
原生模式下绝对 `next_url` 未归一化产生的错误 URL：`apiBase + 绝对URL`，Pixiv 返回 404。`rewriteUrl` 原生分支负责把绝对 Pixiv URL 剥离域名成相对路径（含 query）。跨上下文共享概念，详见根 `docs/adr/glossary-search-pagination.md`。
_Avoid_: 把绝对 next_url 原样传给原生模块

**受限条目 level 派生（restrict level derivation）**：
`x_restrict === 2 ? 2 : 1` 的徽章级别映射，收敛在 `RestrictedNovelCard` 组件内部（接口只收 `item`），调用方不重复该表达式。
