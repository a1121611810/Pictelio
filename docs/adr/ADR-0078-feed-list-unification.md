# ADR-0078: 列表交互统一（FeedList 容器 + 加载语义分离）

- 状态：accepted
- 日期：2026-08-10
- 关联：ADR-0076（首页下拉刷新）、ADR-0077（FastScroller）、glossary-ui-cards.md

## 背景

### Bug：分页加载触发"清空重载"骨架屏

小说/插画列表滚动到第一页结尾触发分页（`fetchMore`）时，**整个列表被 A1 骨架遮罩替换**。根因（代码证据）：

```
工厂 refreshing() = activeQueries().some(q => q.isFetching)   // createTQFeedStore
   ↑ isFetching 包含 fetchNextPage（分页追加）
首页 FeedPanel A1 遮罩条件 refreshing() → 分页时也渲染"清空重载"骨架
```

`loading` 与 `refreshing` 在工厂里**一字不差**（都是 `isFetching`）——接口名不副实（refreshing 实际是"任意加载中"）。

### 碎片化

全仓库列表交互三套实现：VirtualFeed（虚拟滚动 + PullIndicator 指示器）、首页自建 FeedPanel（非虚拟 + A1 骨架遮罩）、NovelVirtualFeed——下拉刷新、分页、骨架各写一遍；状态语义不统一，未来新列表会重踩"分页当刷新"。

## 决策

1. **工厂加载语义分离**（`createTQFeedStore`，一处改动全局生效）：
   - `refreshing` → `isRefetching`（仅 refetch 第一页 = 下拉刷新）
   - 新增 `loadingMore` → `isFetchingNextPage`（分页追加）
   - `loading` 保持 `isFetching`（首载）
2. **FeedList 统一容器**（`components/home/FeedList.tsx`，深模块：小接口 + 交互实现深）：
   - 接口：`source`（items/loading/refreshing/loadingMore/nextUrl/fetchMore/refresh）+ `containerClass` + `refreshMode`（overlay= A1 骨架遮罩 / indicator= PullIndicator）+ `renderItem` + `skeleton` + `empty`
   - 内部统一：createPullToRefresh（下拉）+ PullIndicator + overlay 遮罩 + FeedPaginationSentinel（分页）+ loadingMore 底部指示 + 首载骨架/空态
   - 状态语义正确：骨架遮罩仅在 `pullPhase === "refreshing"`（下拉松手后）触发，**分页加载绝不触发骨架**
3. **首页 6 面板迁入 FeedList**：FeedPanel 瘦身为"store 激活 + source 构造 + renderItem"。
4. **范围**：P0（语义分离）+ P1（FeedList + 首页面板）；P2（VirtualFeed/NovelVirtualFeed 迁入，虚拟滚动走 virtualize prop）与 P3（独立页迁入）后续推进。

## 被考虑的方案

- **只改首页 2 处遮罩条件**（绑 pullPhase）：修复症状，但工厂 refreshing 语义仍名不副实，未来列表重踩——否决，选择语义分离（一处修复全局生效）。
- **VirtualFeed 直接复用**：其交互（虚拟滚动 + 指示器）与首页非虚拟 A1 遮罩差异大，强行合并风险高——FeedList 以 refreshMode 兼容两种，虚拟化 P2 再并入。

## 后果

- 正面：6 面板分页不再骨架屏（Bug 修复）；加载语义全局正确（refreshing=下拉、loadingMore=分页）；列表交互收敛为单一 FeedList（新增列表只需 source + 渲染回调）；契约测试锁定语义。
- 负面：首页面板行为从"分页骨架"变为"静默追加 + 底部加载指示"（体验变化符合预期）；FeedList 为泛型组件，类型上需 item 泛型穿透。
