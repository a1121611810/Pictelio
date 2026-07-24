# ADR 0031: 统一 VirtualFeed 与 NovelVirtualFeed 为泛型 VirtualFeedShell

## 状态

提议

## 分类

重构

## 日期

2026-07-17

## 背景

`VirtualFeed.tsx`（~170 行）和 `NovelVirtualFeed.tsx`（~200 行）之间存在约 **70% 的结构副本**。具体重复内容包括：

1. **ScrollRestore 集成**（VirtualFeed:68-83, NovelVirtualFeed:49-60）—— 相同的 `createVirtualScrollRestore` 调用模式，仅 store key 和 save/get 函数不同
2. **createFeedVirtualizer 配置**（VirtualFeed:85-106, NovelVirtualFeed:62-81）—— 几乎相同的参数传递
3. **PullIndicator 渲染**（VirtualFeed:158-163, NovelVirtualFeed:101-106）
4. **ErrorDisplay 渲染**（VirtualFeed:165, NovelVirtualFeed:108）
5. **Loading spinner + 到底提示 + 空状态**（VirtualFeed:223-237, NovelVirtualFeed:186-200）
6. **骨架屏逻辑**—— 形式不同但概念相同
7. **哨兵分页 div**（VirtualFeed:239, NovelVirtualFeed:202）

此外，`UserWorksFeed.tsx` 同时挂载两个 feed 实例（CSS `display:none` 隐藏一个），进一步放大了问题。

## 决策

### D1: 创建泛型 VirtualFeedShell<T> 组件

```typescript
interface VirtualFeedShellProps<T> {
  items: T[];
  loading: boolean;
  error: ApiError | null;
  hasMore: boolean;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string | number;
  lanes: number;
  renderItem: (item: T, vItem: VirtualItem, columnWidth: number) => JSX.Element;
  renderSkeleton?: (columnCount: number, columnWidth: number) => JSX.Element;
  onLoadMore: () => void;
  onRefresh: () => Promise<void> | void;
  scrollStore: ScrollStoreAdapter;
  emptyText?: string;
  skipAnimation?: boolean;
  suppressHeaderVisibility?: (durationMs?: number) => void;
  laneAssignmentMode?: "estimate" | "measured";
  measureElement?: boolean;
}
```

### D2: 定义 ScrollStoreAdapter 接口

```typescript
interface ScrollStoreAdapter {
  saveState: (state: ScrollRestoreState) => void;
  getState: () => ScrollRestoreState | undefined;
}
```

### D3: VirtualFeed 和 NovelVirtualFeed 变为薄包装

```typescript
// VirtualFeed.tsx
const VirtualFeed = (props) => (
  <VirtualFeedShell<PixivIllust>
    {...commonProps}
    estimateSize={illustSizeEstimator}
    renderItem={renderIllustCard}
    scrollStore={illustScrollAdapter}
    lanes={LAYOUT_COLUMNS[layoutMode()]}
  />
);

// NovelVirtualFeed.tsx
const NovelVirtualFeed = (props) => (
  <VirtualFeedShell<PixivNovel>
    {...commonProps}
    estimateSize={novelSizeEstimator}
    renderItem={renderNovelCard}
    scrollStore={novelScrollAdapter}
    lanes={mode() === "coverWall" ? 2 : 1}
    measureElement={mode() === "coverWall"}
    laneAssignmentMode={mode() === "coverWall" ? "measured" : "estimate"}
  />
);
```

### D4: UserWorksFeed 条件挂载

与 ADR-0027 同步执行，使用 `<Switch>/<Match>` 替代双实例。

## 与 ADR 的关系

本设计建立在 ADR-0017（Virtual Feed 统一化）的基础上，是其进一步深化。

## 后果

### 正面
- 消除 ~70% 重复代码（~250 行）
- 修改共享行为（如滚动恢复、下拉刷新）只需改 VirtualFeedShell
- 新增数据类型的 Feed（如搜索混排）只需编写渲染器

### 负面
- 引入泛型参数类型约束
- 渲染器函数作为 prop（`renderItem`）增加 JSX 嵌套可读性成本

### 风险
中。需要仔细设计接口以覆盖现有两种 feed 的所有差异（coverWall 的 measureElement、textList 的特殊骨架屏）。建议分步实施：先抽出 VirtualFeedShell，薄包装器适配，最后改 UserWorksFeed。
