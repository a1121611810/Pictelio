# ADR 0042: 按需查询 — 禁用自动 fetch，由组件生命周期驱动

## 状态

已接受（2026-07-30）

## 背景

### 问题

`createTQFeedStore` 工厂创建的 `createInfiniteQuery` 在 `enabled: true` 时，模块加载即自动发起 fetch。即使有 `tokenReady` barrier（ADR-0041）阻塞请求管道，barrier 一旦 resolve，多个 store 的查询在组件挂载前就完成了数据加载。组件挂载时数据已存在，导致骨架屏条件 `illusts.length === 0` 不满足，骨架屏不渲染。

日志证据：
```
① tokenReady resolved
② fetch 完成，illusts=58 数据就绪
③ HomePage mounted（组件挂载）
④ VirtualFeed 渲染 — illusts=58，骨架屏条件不满足
⑤ rAF fired — ensureLoaded 调用，但数据已在
```

### 约束

- 不改变组件 `onMount` → `ensureLoaded` 的调用方式
- 保留 TanStack Query 的缓存命中、staleTime、gcTime 机制
- 不影响 `refresh()`、`fetchMore()`、`refetch()` 等手动数据刷新

## 决策

### 决策 1：`createTQFeedStore` 默认 `enabled: false`

将工厂中所有查询的 `enabled` 条件前置改为 `false`：

```ts
enabled: false,
```

删除原有的 `config.enabled()` 和 tab/subTab 匹配条件。这些条件本来的职责是：
- `config.enabled()` — 登录态门控等，改为由 `ensureLoaded` 调用方自主判断
- tab/subTab 匹配 — 拆分后的独立 store 只有一个 tab，不再需要切换

### 决策 2：不删除 `config.enabled` 类型定义

保留 `TQFeedStoreConfig.enabled` 字段但不使用（标记为 `@deprecated`）。避免破坏现有 store 配置的编译通过性。后续清理 tickets 可以统一删除。

### 决策 3：各 Store 不受影响

所有 store 的 `ensureLoaded` 已在各组件的 `onMount` 中调用：

| Store | ensureLoaded 调用方 | 组件挂载时序 |
|-------|-------------------|-------------|
| recommendedStore | `RecommendedFeed.onMount` → rAF → ensureLoaded | HomePage 挂载后 |
| followStore | `FollowFeed.onMount` → rAF → ensureLoaded | 首次访问关注 Tab |
| bookmarkStore | `IllustBookmarks.onMount` | 首次访问收藏 Tab |
| novelRecommendedStore | `NovelRecommendedFeed.onMount` | 小说模式推荐 Tab |
| novelFollowStore | `NovelFollowFeed.onMount` | 小说模式关注 Tab |
| novelBookmarkStore | `NovelBookmarks.onMount` | 小说模式收藏 Tab |

## 后果

### 正面

- **骨架屏在数据加载前渲染**：组件挂载 → 骨架屏（`illusts.length === 0`）→ `ensureLoaded` → fetch → 数据到达 → 内容替换
- **零额外请求**：不会再有模块加载时自动 fetch 的请求
- **单行改动**：`createTQFeedStore.ts` 中 `enabled: false`

### 反面

- `config.enabled()` 配置项实际失效。依赖 enabled 做登录态门控的查询（如 bookmarkStore）改为由 `ensureLoaded` 中的显式检查控制。
- `bookmarkStore.ensureLoaded` 已有未登录检查逻辑（`if (!user()) return UNAUTHORIZED`），不受影响。

### 兼容性

- TanStack Query 的缓存、refetch、fetchNextPage 均不依赖 enabled
- `queryClient.ensureInfiniteQueryData` 不受 enabled 影响
- `createInfiniteQuery` 的 enabled 仅控制自动 fetch，手动调用不受限

## 实施

1. `createTQFeedStore.ts` — 将 `enabled` 改为 `false`，删除原有 enabled 链
2. 测试验证：全量 629 测试通过
