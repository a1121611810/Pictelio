# ADR 0021: novelStore 迁移到 createTQFeedStore 工厂

## 状态

已批准

## 分类

重构

## 日期

2026-07-24

## 背景

`createTQFeedStore` 工厂函数（ADR-0016 引入）封装了 TanStack Query InfiniteQuery 的创建、enabled 推导、派生数据、滚动恢复和错误处理模式。`feedStore` 已在 ADR-0016 期间成功迁移到该工厂。

然而 `novelStore` 仍然使用原始 `createInfiniteQuery` + `createRoot` 手动管理 4 个独立查询（follow_public、follow_private、recommended、bookmarks），每个查询重复相同的 boilerplate：enabled 条件、staleTime/gcTime、getNextPageParam、错误归一化、滚动恢复。

## 决策

将 `novelStore` 迁移到 `createTQFeedStore` 工厂，保持对外 API 完全向后兼容。

### 方案细节

**工厂调用模式**：仿照 `feedStore`，novelStore 顶层调用 `createTQFeedStore` 获取核心数据层，保留 `createFeedScrollStore` 用于滚动持久化。

**Tab 映射**：

| 外部 Tab | Factory Tab | subTabs | 说明 |
|---|---|---|---|
| follow | follow | public, private | 与 feedStore 的 follow tab 相同模式 |
| recommended | recommended | 单 subTab（allMode: single） | 无子 tab 切换 |
| bookmarks | bookmarks | 单 subTab（allMode: single） | queryKey 含 userId + restrict |

**响应适配**：Pixiv Novel API 返回 `{ novels: PixivNovel[]; next_url }`，factory 需要 `{ items: TItem[]; next_url }`。在 queryFn 中使用适配函数转换。

**fallbackError 处理**：保留在 novelStore wrapper 层，factory 不涉足此逻辑。`ensureLoaded` 在 bookmarks tab + 未登录时返回 UNAUTHORIZED 错误。

**Scroll 持久化**：保持 `createFeedScrollStore` 外挂在 novelStore 中，与 feedStore 一致。factory 内部的 scrollRestoreGlobal 不用于 novelStore 的滚动。

### 关键适配点

1. `queryFn` 的响应类型适配：`{novels:[]}` → `{items:[]}`
2. `fetchMore`：factory 只取第一个活跃查询，novelStore 曾遍历所有。在 merge(all) 模式下 factory 行为足够
3. `error()`：novelStore 包装 factory.error() + fallbackError
4. `ensureLoaded`：novelStore 包装 factory.ensureLoaded()，前置 fallbackError 检查
5. `isNovelCached`：保留 wrapper 以兼容未传递 tab 参数的调用方（实际上无外部调用方）
6. `saveTabScroll(tab)`/`getFeedScrollY(tab)`等：保持不变，来自 createFeedScrollStore

### 保留的导出

- `novelFollowTab` / `setNovelFollowTab` — 关注子标签页状态信号
- `bookmarkRestrict` / `setBookmarkRestrict` — 收藏限制状态信号
- `saveTabScroll` / `getFeedScrollY` — 标签页级滚动持久化
- `saveNovelScrollState` / `getNovelScrollState` — 虚拟滚动持久化
- `novels` / `nextUrl` / `loading` / `refreshing` / `error` — 派生数据（代理到 factory）
- `ensureLoaded` / `refresh` / `fetchMore` — 动作（代理到 factory + fallbackError 包装）
- `isNovelCached` — 缓存判断（代理到 factory）

## 理由

1. **已验证的模式**：feedStore 已成功使用 createTQFeedStore，迁移路径清晰可控
2. **代码量减少**：novelStore 从 ~323 行减到 ~130 行
3. **Leverage 提升**：factory 的测试自动覆盖 novelStore
4. **Locality 提升**：novelStore 只保留 novel 特有的 filter/dedup/fallback 逻辑，通用 TQ 模式集中在 factory

## 后果

### 正面

- 减少 ~190 行重复的 TQ boilerplate
- 统一 feedStore / novelStore 的模式
- 降低未来 store 迁移的阻力（userIllustsStore、followListStore 可沿同样路径迁移）

### 负面

- factory 的 `fetchMore` 在 merge(all) 模式下只取第一个活跃查询，novelStore 原行为遍历所有。经分析此差异不影响功能，因为哨兵分页每次只触发一次 fetchMore
- factory 的 `ensureLoaded` 不处理 fallbackError，需要 wrapper 层维护

### 风险

低。feedStore 已验证 factory 的稳定性，迁移本质上是模式对齐而非引入新逻辑。

## 对照

否决的方案：
- **手写自定义抽象**：已有 createTQFeedStore 可用，没必要重复发明
- **不迁移**：novelStore 与 feedStore 的模式将持续分化，维护成本增加
- **合并到 feedStore**：novel 和 illust 的数据结构和 API 端点不同，不适合合并
