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
| **搜索目标档位（SearchTargetMode）** | 用户可选的**匹配方式**三档：`partial`（标签部分一致）/ `exact`（标签完全一致）/ `title_and_caption`（标题·说明）。⚠️ **与 API 原始值不是一回事**：原始值是 `search_target` 参数的枚举 `partial_match_for_tags` / `exact_match_for_tags` / `title_and_caption`，本仓用短名，两者在 `buildParams.ts` 汇合。⚠️ **三端映射不对称**（spec `docs/specs/search-target-mode.md` §4、§4.1）：`partial` 在插画端是**整个参数不传**，在小说端是**必须显式发** `partial_match_for_tags`（不传退化为纯字面匹配、同义词/译名不展开，#1038），在用户端是**必须不发**（该端点对它做枚举校验，见「用户搜索范围」词条）。⚠️ **插画端取「不传」是保守选择，不是已证实的必需**（2026-10-17 一手实测订正）：旧表述「显式传 partial 会被转成严格标签匹配并忽略 `merge_plain_keyword_results`、丢掉关键字/标题命中」出自 **Shaft #906 的第三方源码推断，本次一手实测未复现**——四组组合（omit / 显式 partial / `merge_plain_keyword_results=true` / 两者并用）在 3 检索词 × 2 轮**交错**采样下 **ID 序列 md5 完全相同**；决定性反证是多词 `Rosmontis rosemary` 在 omit 与显式 partial 下**同为 4 条**，而 `exact` 是 1 条（若显式 partial 真会触发严格标签匹配，此处应退回 1 条）。**映射维持「不传」不变**，但理由已从「显式发会坏行为」降级为「不依赖未经证实的差异，且与改动前单词词路径逐字一致」。⚠️ **`title_and_caption` 在小说端是「实测被拒」，不是「不被识别」**（2026-10-17 交错 2 轮一手实测，端点 `/v1/search/novel`、word=東方）：省略 `search_target` → **200 / 30 条**；显式发 `search_target=title_and_caption` → **HTTP 400 / 0 条**；`search_target=partial_match_for_tags` 与未知参数名 `foo=bar`（对照）均 **200 / 30 条**。对照组说明**不是「参数名不被认识」而是服务端明确拒绝该取值** ⇒ 早期「不被识别属推断（未实测）」的表述**低估了后果强度**（旧推断证据 Mako `SearchNovelTagMatchOption` 只有 partial/exact/text/keyword + 官方帮助中心未列该档，保留作历史留痕）：小说端置灰保值挡的**不是「服务端没实现所以无害」而是「一次 HTTP 400」**——一旦置灰保值逻辑哪天回归、小说端开始真发这个参数，**每一次小说搜索都会直接失败**。⚠️ **任何「A/B 序列相同/不同」的断言必须交错采样**（方法论见 spec `docs/specs/search-target-mode.md` §4.1）：插画端结果集**随时间漂移**——同一查询连续采样，首位 ID 从 **150944641 漂到 150944731**（秒级内稳定），顺序采样（A 全跑完再跑 B）会把时间漂移误读成参数差异，产生**方向完全相反的假差异**；交错采样下 md5 **相同** ⇒ 该组合在本轮**无可观测效果**（不是「保证无影响」）。档位**不再**由 `word.includes(" ")` 派生；`partial` 是默认档，也是缓存键与「默认筛选」判定的基准档（默认档不落键，非默认落 `ft=` 段）。 |
| **查询语法透传（query syntax passthrough）** | 搜索词里的**布尔语法由 pixiv 服务端解析**：空格 = AND、`OR` = 或、`-` 前缀 = 排除、`( )` = 嵌套、全角 = 半角。本仓**只把用户原始 `word` 透传**，不做客户端解析（客户端解析会与服务端语义重复且易漂移）。一手实测见 `docs/research/verify-query-syntax.sh` + 结论摘要 `docs/research/pixiv-query-syntax-verified-2026-10.md`（2026-10-16；插画 / 小说双端点 × **可被服务端接受的** `search_target` 档成立——小说端 `title_and_caption` 实测被拒 HTTP 400，该组合从未产生可判别结果集，不计入「成立」）。⚠️ **大小写归一只在 partial / 不传档成立**——`exact_match_for_tags` 档实测大小写敏感（`RoSeMaRy` 返回 0 条）⇒ 文案与文档**不得承诺「大小写无关」**。 |
| **搜索范围（SearchScope）** | `all`（插画+小说合并）/ `illust` / `novel` / `user`。`all` 时首屏并行请求 `search/illust` 与 `search/novel`，结果按 `create_date` 降序合并；`user` 走独立端点，单类型不混排（见「用户搜索范围」）。 |
| **用户搜索范围（scope=user）** | 搜索范围第四档（ADR-0132 §4，2026-10-16 修订推翻「无用户搜索」）。端点 `GET /v1/search/user`，**参数只有 `word` / `filter=for_ios` / `sort`**。⚠️ **`search_target` 是「必须不发」而不是「不消费」**（2026-10-17 一手反向实测订正；口径见 spec `docs/specs/search-advanced-filters.md` §3.2 与 `docs/specs/search-user-scope.md` §5.1、一手记录 `docs/research/pixiv-appapi-search-filter-params.md` §11.3）：该端点对它做**枚举校验**，传**任何**值（空串 / `partial_match_for_tags` / `exact_match_for_tags` / `title_and_caption` / 非法值 `zzz`）一律 **HTTP 400**；对照的不相关**未知参数名**（`foo=bar`）返回 **200 且结果不变** ⇒ 它**校验已识别参数、忽略未识别参数**，不是来者不拒。⚠️ **「不消费」是危险措辞**——它读起来像「发了无害」，实测是「发了必失败」。⚠️ **其余筛选参数（期间 / 收藏数 / 比例 / 分辨率 / AI 覆盖）依据不同**：实测**未发** + 第三方实现同款（pixez `getSearchUser` / Mako `UserSearchEngine`，两家也只发 `word` / `filter` + `word`），**尚未做反向实验**——那次反向实验只针对 `search_target` 一个参数，**不要借它的 400 结论给其余筛选参数盖上「已实测」的章**。⚠️ **`merge_plain_keyword_results` 置信度已下调**（2026-10-17 实测）：illust / novel / user **三端**传 `true` / `false` / 不传**结果都不变**，**无可观测效果**；illust 端对非法值 `zzz` **400**（校验枚举），novel 与 user 端对 `zzz` **静默接受** ⇒ **恒发行为不变**（无害 + 对齐第三方 + 与既有实现零 diff），此处只降级声明强度，不改行为。响应顶层两个键：`user_previews`（`PixivUserPreview[]` = `user` + `illusts` + `novels` + `is_muted`）与 `next_url`（该端点自身游标，单游标推进）。⚠️ **`user` 是轻量对象、无 `profile`**（无 `total_follow_users` / `total_illusts` / `total_followers`，那些只在 `/v1/user/detail`）⇒ 用户行**不得渲染粉丝数/作品数**，要显示须二次请求 `getUserDetail`。⚠️ `profile_image_urls` 实测**只有 `medium`**（无 `px_16x16` / `px_50x50` / `px_170x170`）⇒ 头像只取 `medium`。预览小说 `image_urls` 只有 `large` / `medium` / `square_medium`（无 `original`）⇒ 缩略图一律走 `square_medium`。用户无 `create_date`，`SearchResultItem.date` 恒 `null`，**不参与混排**。一手实测：`docs/research/verify-search-user-api.sh` + fixture `packages/app-lynx/src/api/__fixtures__/search-users.json`（2026-10-16）。⚠️ **复跑该脚本或任何「A/B 结果相同/不同」比对时必须交错采样**（A、B、A、B…）：插画端结果集已实证**随时间漂移**（同一查询连续采样，首位 ID 从 150944641 漂到 150944731，秒级内稳定），顺序采样会把漂移误读成参数差异，产生**方向完全相反的假差异**；口径见 spec `docs/specs/search-target-mode.md` §4.1。 |
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

