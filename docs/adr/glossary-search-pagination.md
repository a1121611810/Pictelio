# 搜索与分页 — 术语表

搜索页（`/search`）与所有分页 Feed 共享的领域概念。相关决策见 [ADR-0081](./ADR-0081-search-pagination-native-4xx-fix.md) 与 [ADR-0082](./ADR-0082-feed-pagination-inline-retry.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **next_url（下一页 URL）** | Pixiv API 分页游标。响应体中的 `next_url` 字段，值为**绝对 URL**（`https://app-api.pixiv.net/...`），携带完整查询参数（word、sort、offset 等）。为 `null` 时表示没有下一页。 |
| **rewriteUrl（URL 归一化）** | `client.ts` 导出的纯函数，把请求 path 归一化为客户端实际请求的 URL。Web 模式把 Pixiv 绝对 URL 重写为 `/pixiv-api` 代理路径；原生模式把绝对 `next_url` 剥离域名转为相对路径。 |
| **相对路径契约（relative-path contract）** | 原生 `PixivApiPlugin` 只接收**相对路径**，内部自行拼接 `apiBase()`。JS 层负责把绝对 `next_url` 归一化后再交给插件。违反契约会触发**双域名 URL**。 |
| **双域名 URL（double-host URL）** | Bug 模式：`apiBase()` + 绝对 URL 拼接产生 `https://app-api.pixiv.net/https://app-api.pixiv.net/...`，Pixiv 返回 **HTTP 404**。曾导致 Android 端所有分页（搜索/推荐/收藏/用户作品）翻页失败。 |
| **分页哨兵（pagination sentinel）** | `SearchResults` 底部一个 `IntersectionObserver` 目标（`createSentinel`），滚入视口且 `hasMore && !loading` 时自动触发 `onLoadMore`。替代手动"加载更多"按钮。 |
| **同参数搜索防重入（in-flight search dedup）** | `executeSearch` 的防重入守卫：相同 `keyword+scope+sort` 搜索在飞行时，第二次调用直接跳过，由第一个请求负责写入结果。防止搜索框提交与 URL 同步 effect 双触发互相 abort。 |
| **搜索目标（searchTarget）** | `partial_match_for_tags`（单标签部分匹配，可命中复合标签）或 `exact_match_for_tags`（多标签含空格时精确匹配）。由 `keyword().includes(" ")` 派生。 |
| **搜索范围（SearchScope）** | `all`（插画+小说合并）/ `illust` / `novel`。`all` 时首屏并行请求 `search/illust` 与 `search/novel`，结果按 `create_date` 降序合并。 |
| **热门排序（popular_desc）** | 路由到独立端点 `/v1/search/popular-preview/{illust,novel}`（单页、无 `next_url`，不分页），其他排序走标准 `/v1/search/illust`、`/v1/search/novel`。 |
| **搜索结果合并（mergeSearchResults）** | `utils/searchMerger.ts` — 按 `create_date` 降序合流 illust 与 novel 为单一时间线；同一日期内 illust 优先。 |
| **paginationError（分页错误标记）** | store 暴露的 boolean，标记当前 error 是否来自分页（fetchNextPage/loadMore）而非首载/刷新。组件据此决定"整页错误展示（ErrorDisplay）"还是"保留结果 + 底部内联重试"。分页失败时不清理已加载 data。 |
| **内联重试条（InlineRetryBar）** | 列表底部的一条失败提示 + 重试按钮（`components/ui/InlineRetryBar.tsx`）。重试只重新请求失败的那一页（沿用 `next_url`），不整页重刷。 |
| **内联重试模式（inline retry）** | 分页失败时保留已加载结果、只在列表底部给重试入口的错误呈现模式。与 `ErrorDisplay` 整页错误展示（首载/刷新失败）相对。 |
| **分页暂停（pagination pause）** | 分页错误时 sentinel/哨兵暂停触发（`SearchResults` 的 `createSentinel` `enabled` 门控、`createFeedVirtualizer` 内置 sentinel、首页 `FeedPaginationSentinel` 的 `disabled` prop），防止失败后无退避自动重试死循环。重试成功后恢复触发。 |

## 分页请求流

```
Web 模式                                    Native 模式
─────────────────────                       ─────────────────────
executeSearch / loadMore                    executeSearch / loadMore
  └─ apiClient.get(next_url)                  └─ apiClient.get(next_url)
       └─ rewriteUrl(abs URL)                     └─ rewriteUrl(abs URL)
            └─ /pixiv-api/... (Vite 代理)              └─ /v1/search/... (相对路径)
                 └─ fetch → Pixiv                          └─ PixivApiPlugin.request({ path })
                                                                └─ apiBase() + path → OkHttp
```

- Web：`rewriteUrl` 把 `https://app-api.pixiv.net/...` 重写为 `/pixiv-api/...`，经 Vite 代理转发。
- Native：`rewriteUrl` 把绝对 `next_url` 剥离域名成 `/v1/...`，插件拼回 `apiBase()` 后请求。**绝对 URL 直接传给插件 = 双域名 URL = 404**。

## 首次搜索防重入时序

```
用户提交搜索
  ├─ handleTagsChange: debounce(300ms) → navigate + executeSearch #1
  ├─ URL 变化 → URL 同步 effect: debounce(300ms) → executeSearch #2
  │
  └─ executeSearch #2 的防重入检查:
        ├─ 相同 searchKey（kw_scope_sort）已在飞行 → 跳过（不再 abort #1）
        └─ 不同 searchKey（用户改词/改筛选）→ abort 前一个请求，重新搜索
```

修复前 #2 会 `abortPrevious()` 中止 #1 的请求；#1 与 #2 都因 AbortError 静默失败，结果被清空（"没有找到相关作品"）。

## 状态与缓存

- **搜索结果 LRU 缓存（searchCache）**：`createSearchStore` 模块级 `Map`，key 为 `${word}_${scope}_${sort}`，上限 20 条。`loadMore` 不写缓存——重进同词搜索会恢复到首页分页状态。
- **GET 请求去重（inflightGetRequests）**：`client.ts` 对相同 path+params 的并发 GET 合并为单个真实请求。搜索防重入与它互补：前者挡同参数重复 `executeSearch`，后者挡同 URL 并发 fetch。

## 分页失败内联重试流程

```
滚入视口 → sentinel 触发 loadMore / fetchMore
  ├─ 成功 → 追加新页，paginationError 复位，哨兵继续武装
  └─ 失败 → paginationError = true
        ├─ 已加载结果保留（不清空列表，不隐藏已有内容）
        ├─ 列表底部渲染 InlineRetryBar（失败提示 + 重试按钮）
        └─ sentinel 暂停（enabled / disabled 门控）→ 不再自动触发

用户点击重试 → 重新请求失败的那一页（沿用 next_url）
  ├─ 成功 → 追加新页，paginationError 复位，哨兵恢复触发
  └─ 失败 → 保持内联重试状态，等待再次重试
```

- **分页失败 ≠ 首载/刷新失败**：只有 `paginationError = true` 时走内联重试模式；首载/刷新失败（无结果可保留）仍用 `ErrorDisplay` 整页展示。
- 重试绑 `fetchMore` / `loadMore`（沿用 `next_url`），**不绑 `onRefresh`**——整页重刷会丢掉已加载的后续页。

