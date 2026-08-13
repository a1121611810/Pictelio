# ADR-0082：分页失败内联重试

## 状态

已接受（2026-08-13）

## 背景

搜索页（`/search`）与各 Feed 列表在"分页（加载更多）失败"时的错误处理不一致且均有缺陷：

1. **SearchResults 整页替换已加载结果**：`SearchResults` 用 `<Show when={!props.error}>` 包裹结果列表——一旦 `error` 非空（无论首载还是分页失败），**已加载的结果被整体替换为 `ErrorDisplay`**，用户已浏览的内容全部隐藏，只剩错误页。
2. **VirtualFeed 系错误展示与重试语义错误**：`VirtualFeed` / `NovelVirtualFeed` 把 `ErrorDisplay` 附加在列表**上方**，且 `onRetry` 绑定 `onRefresh`（整页重刷）。分页失败后点击重试会重新请求第一页、丢掉已加载的后续页，而非只重试失败的那一页。
3. **首页 FeedList 完全没有错误 UI**：首页统一列表容器（`home/FeedList.tsx`，ADR-0078）无错误呈现——首载失败被误报为空态（渲染 `empty` hint），分页失败**静默无提示**。
4. **sentinel 分页门控普遍不含错误状态**：`SearchResults` 的 `createSentinel`、`createFeedVirtualizer` 内置 sentinel、首页 `FeedPaginationSentinel` 的触发条件均不包含错误门控。分页失败后 sentinel 仍处于"已武装"状态，滚入视口即再次触发请求，存在**无退避自动重试**（失败-触发死循环）风险。

## 决策

### 决策 1：store 层 `paginationError` 信号

`searchStore` / `createTQFeedStore` / `userIllustsStore` 新增 `paginationError()` accessor，区分"分页失败（fetchNextPage/loadMore）"与"首载/刷新失败"：

- 分页失败时置 `true`，且**不清理已加载 data**（数据本身原本就不清理，问题出在组件渲染层）；
- 首载/刷新失败时保持 `false`；
- 分页成功或刷新成功后复位为 `false`。

组件层据此决定"整页错误展示"还是"保留结果 + 底部内联重试"。

### 决策 2：组件层内联重试

- **分页失败时保留已加载结果**，列表底部显示内联重试条——新组件 `components/ui/InlineRetryBar.tsx`；
- 重试只重试**失败的那一页**——绑 `fetchMore` / `loadMore`（沿用 `next_url`），**不整页重刷**；
- `ErrorDisplay` 仅用于**首载/刷新失败**（此时无结果可保留，整页展示）。

### 决策 3：sentinel 分页暂停

分页错误时暂停 sentinel 触发，防止失败后无退避自动重试：

- `SearchResults` 的 `createSentinel` 的 `enabled` 门控加入 `!paginationError`；
- `createFeedVirtualizer` 的内置 sentinel 的 `enabled` 门控同样处理；
- 首页 `FeedPaginationSentinel` 新增 `disabled` prop，分页错误时禁用。

### 覆盖范围

- 搜索页：`SearchResults`；
- 次级虚拟 Feed：`VirtualFeed` / `NovelVirtualFeed` 及其消费方（`RecommendedFeed` / `FollowFeed` / `IllustBookmarks` / `NovelBookmarks` / `UserWorksFeed`）；
- 首页 `FeedList` + 两个面板（`IllustFeedPanel` / `NovelFeedPanel`）。

## Considered Options

### 分页失败的错误呈现方式

| 方案 | 评估 |
|------|------|
| **内联重试（采用）** | 保留已加载结果 + 列表底部重试条；重试只重试失败页，不打断已浏览内容；符合移动端列表交互惯例。 |
| 整页 ErrorDisplay（现状） | 已加载结果全部隐藏，重试绑定整页重刷，用户需重新浏览；分页失败与首载失败混淆。 |
| 弹窗/Toast 一次性提示 | 无持久重试入口，状态不可见，用户难以恢复分页。 |

### sentinel 错误后的行为

| 方案 | 评估 |
|------|------|
| **错误时暂停 sentinel（采用）** | 失败后不再自动触发，等待用户显式点击内联重试；与内联重试条形成完整闭环。 |
| 错误时保持自动触发（现状） | 滚入视口即再次发起请求，失败-触发死循环，无退避，浪费请求。 |
| 指数退避自动重试 | 复杂度高，移动端弱网场景体验不佳；本期不引入。 |

### `paginationError` 的实现位置

| 方案 | 评估 |
|------|------|
| **store 层信号（采用）** | 数据源自己最清楚错误来自 fetchNextPage 还是 refetch；组件只需消费 accessor，无需在渲染层猜测。 |
| 组件层推导（比对 loadingMore 前后 error） | 依赖请求时序推断，易受竞态影响，各消费方需重复实现。 |

## Consequences

### 正面

- 分页失败时已加载结果保留，用户可继续浏览既有内容，通过底部内联重试条显式恢复分页。
- 重试语义正确：只重试失败的那一页（沿用 `next_url`），不整页重刷、不丢已加载数据。
- 首载/刷新失败仍走 `ErrorDisplay` 整页展示，两种失败模式的语义清晰分离。
- 分页失败后 sentinel 暂停，杜绝无退避自动重试死循环。

### 负面 / 注意

- 三个 store（`searchStore` / `createTQFeedStore` / `userIllustsStore`）各需新增 `paginationError` 信号及置位/复位逻辑；`createTQFeedStore` 的 multi-source（all 合并模式）下需明确分页错误的判定口径（任一源失败 vs 全部源失败）。
- `VirtualFeed` / `NovelVirtualFeed` 组件 props 需新增 `paginationError`，其全部消费方（RecommendedFeed / FollowFeed / IllustBookmarks / NovelBookmarks / UserWorksFeed）需同步透传，改动面较大。
- 首页 `FeedList` 接入错误状态时须避免与空态（`empty` hint）混淆——首载失败渲染错误态，不得落入空态分支。

### 测试

- store：`searchStore` / `createTQFeedStore` / `userIllustsStore` 分页失败置位、刷新/首载不复位、成功后复位的单测；
- 组件：`InlineRetryBar` 渲染与重试回调绑定 `fetchMore` / `loadMore`（非 `onRefresh`）的测试；`VirtualFeed` / `NovelVirtualFeed` 分页失败保留结果 + 底部内联重试的测试；
- sentinel：`FeedPaginationSentinel` 的 `disabled` 门控测试、`createFeedVirtualizer` / `createSentinel` 在 `paginationError` 下暂停触发的测试。
