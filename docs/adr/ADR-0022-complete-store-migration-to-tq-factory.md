# ADR 0022: 完成 Store 到 createTQFeedStore 工厂的迁移

## 状态

已批准

## 分类

重构

## 日期

2026-07-25

## 背景

ADR-0016 引入了 `createTQFeedStore` 工厂封装 TanStack Query InfiniteQuery 的创建、enabled 推导、派生数据、滚动恢复和错误处理模式。`feedStore`（ADR-0016）和 `novelStore`（ADR-0021）已成功迁移，但剩余 3 个 store 仍未迁移：

- **userIllustsStore**（179行）：2 处手写 `createInfiniteQuery`（illust + novel），2 处 `queryClient.invalidateQueries`（force 刷新）
- **followListStore**（127行）：1 处手写 `createInfiniteQuery`，2 处 `queryClient.setQueryData`（乐观更新 + 回滚），1 处 `queryClient.removeQueries`（reset）
- **bookmarkStore**：1 处手写 `createInfiniteQuery`，通过 signal 驱动 queryKey 变化（restrict 切换）

3 个 store 每个都在重复相同的 boilerplate：enabled 条件、staleTime/gcTime、getNextPageParam、错误归一化。

## 决策

将 userIllustsStore、followListStore、bookmarkStore 迁移到 `createTQFeedStore` 工厂。

### userIllustsStore 适配

- illust 和 novel 作为 factory 的不同 tab
- illust tab 含 manga 和 illust 两个 subTab（allMode: merge）
- novel tab 为单 subTab（allMode: single）
- force refresh 保留通过 `queryClient.invalidateQueries`，因为在 factory 外部调用更直接

### followListStore 适配

- mode（following/followers）作为 factory 的 subTab
- 乐观更新（toggleFollow）保留在 wrapper 层——直接调用 `queryClient.setQueryData`。工厂不感知乐观更新，这是合理的设计决策：工厂负责标准化 TQ 创建，乐观更新是业务特有逻辑
- reset 中的 `removeQueries` 通过 factory 的 `invalidateAll` 或 wrapper 保留

### bookmarkStore 适配

- restrict（public/private）作为 factory 的 subTab
- 最简单的迁移路径，无特殊逻辑

### 关键设计

1. **乐观更新不在工厂内**：`createTQFeedStore` 不添加 `onMutate` 钩子，保持接口简单。
2. **`invalidateQueries` 外部调用**：userIllustsStore 的 force refresh 通过 wrapper 调用 factory.ensureLoaded 或直接 invalidate。
3. **向后兼容**：每个 store 保留对外导出的公共 API 签名不变。

## 理由

1. **已验证的模式**：feedStore 和 novelStore 已成功使用工厂，迁移路径清晰
2. **Leverage 提升**：一次工厂改进（如错误处理策略调整）惠及所有 store
3. **减少重复代码**：3 个 store 合计约减少 200-300 行重复 boilerplate
4. **统一模式**：所有列表 store 遵循同一模式，降低认知负担

## 后果

### 正面

- 统一的 TQ 创建和管理模式
- 测试广度通过工厂自动覆盖
- 更薄的 store 文件

### 负面

- followListStore 仍保留少量直接 `queryClient.setQueryData` 调用（乐观更新 wrapper），不完美但务实
- userIllustsStore 的 illust/novel 双 tab 结构略复杂于当前手写

### 风险

低。feedStore 和 novelStore 已验证工厂稳定性，迁移本质上是模式对齐。
