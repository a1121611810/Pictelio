# ADR 0006: VirtualFeed 与 NovelVirtualFeed 保持分离

## 状态

已实现

## 日期

2025-06-22

## 背景

`VirtualFeed.tsx`（244 行）和 `NovelVirtualFeed.tsx`（207 行）具有类似的整体结构：virtualizer 设置、scroll
restore、pull-to-refresh、loading/error/empty 状态渲染。

然而项目已将核心共享逻辑提取到 primitives 中：
- `createFeedVirtualizer` — Virtualizer 的创建与配置
- `createVirtualScrollRestore` — 滚动位置恢复

两个组件使用了相同的 primitives，这是正确的抽象层级。

## 分析

| 方面 | VirtualFeed | NovelVirtualFeed |
|------|-------------|-----------------|
| 数据源类型 | PixivIllust | PixivNovel |
| 渲染卡片 | ImageCard / GridCard / LazyImageCard | NovelCard / NovelCoverCard / NovelTextListCard |
| 骨架屏 | 绝对定位 + SkeletonCard | flex 列 + SkeletonCard / 脉冲条 |
| 特殊功能 | 图片预取（scroll prediction） | measureElement（coverWall 模式） |
| layout 模式 | waterfall / single / grid | list / textList / coverWall |
| Props 数量 | 17 | 12 |

两个组件的差异超过 20%，且分布在 prop 接口、card 渲染、骨架屏实现、特有功能等多个维度。

## 决策

**不创建泛型 VirtualFeed 组件。** 当前两个组件的重复属于"意外重复"（shared infrastructure already factored），而非"本质重复"。创建一个泛型组件将引入过多的条件分支和可配置性，反而降低可维护性。

保留两个组件分离，同时：
1. 共同依赖的 virtualizer/scrollRestore primitives 已合理提取
2. 各自的 card 渲染逻辑可以继续独立演化
3. 未来如果出现第三个 feed 类型，再考虑泛化（YAGNI）

## 影响

- 正面：避免不必要的泛化；保持组件接口具体、可读
- 负面：两个组件中约 30 行 JSX 结构（loading/error/empty 状态）仍为重复
- 风险：无

## 符合原则

- 可维护性：具体优于泛化；YAGNI
- 删除测试：删除任一 feed 不影响另一个
