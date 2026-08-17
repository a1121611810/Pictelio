# ADR 0096：自建虚拟滚动迁移到 TanStack Virtual

**状态**：已批准  
**日期**：2026-06  
**决策者**：团队成员 + 代码审查  
**背景**：参考 `grill-with-docs` 会话记录  

---

## 背景

项目当前使用自建虚拟滚动系统，包含以下文件：

- `createVirtualScroll.ts` — 基于 MasonryLayout 的虚拟滚动核心
- `createNovelVirtualLayout.ts` — 小说正文混合块虚拟化（含 pretext 集成）
- `computeMasonryLayout.ts` — 瀑布流/网格/单列布局算法
- `createScrollRestoration.ts` — 滚动位置恢复轮询机制
- `LayoutEngine.tsx` — 布局计算引擎（含 Web Worker 异步）

存在的问题：
1. **滚动恢复不可靠**：`createScrollRestoration` 依赖 RAF 轮询 + 1000ms 超时，偶尔完全失败停在顶部
2. **无法序列化测量状态**：切换 Tab/路由后需要从头计算布局
3. **维护成本**：自建虚拟滚动需要自行处理边角情况（滚动监听、ResizeObserver、overscan 窗口计算）

## 决策

将项目中的自建虚拟滚动系统全部替换为 `@tanstack/solid-virtual`（v3）。

## 替代方案评估

| 方案 | 评估 |
|------|------|
| 保留现状，只修 Bug | 滚动恢复的 RAF 轮询方案根本缺陷难以根治，无法序列化测量状态 |
| 只增强现有实现 | 增加 snapshot/restore 能力需要对 `createVirtualScroll` 做大型改动，效果等价于引入 TanStack Virtual 的 subset |
| 迁移到 TanStack Virtual | 使用成熟的第三方库，获得 `takeSnapshot`、`scrollToIndex`、动态 `measureElement` 等能力，项目代码减少约 500 行 |

## 影响范围

### 修改的消费者文件

| 文件 | 改动概要 |
|------|----------|
| `components/VirtualFeed.tsx` | 用 `createWindowVirtualizer` 替换 `createVirtualScroll` |
| `components/NovelVirtualFeed.tsx` | 同上 |
| `primitives/createNovelVirtualLayout.ts` | 内部虚拟化层替换为 `createVirtualizer`，暴露 `virtualizer` 实例 |
| `routes/NovelDetail.tsx` | 渲染模式从 spacer 改为 absolute + translateY |
| `stores/feedStore.ts` | scroll 状态格式从 `number` 改为 `{ snapshot, offset, version }` |
| `stores/novelStore.ts` | 同上 |
| `components/LayoutEngine.tsx` | 移除 Worker 依赖，改为纯高度计算函数 |

### 删除的文件

| 文件 | 替代 |
|------|------|
| `primitives/createVirtualScroll.ts` | TanStack Virtual |
| `primitives/computeMasonryLayout.ts` | TanStack lanes |
| `primitives/createMasonryWorker.ts` | 不再需要 |
| `primitives/masonryWorker.ts` | 不再需要 |
| `primitives/createScrollRestoration.ts` | takeSnapshot |
| `primitives/createTextListLayout.ts` | 死代码 |

### 保留的文件

| 文件 | 理由 |
|------|------|
| `primitives/createComputedTextCard.ts` | 提供 `estimateSize` 所需的文本高度计算 |
| `primitives/createNovelTextLayout.ts` | pretext 纯文本布局，与虚拟滚动无关 |
| `primitives/novelTextLayoutCache.ts` | 布局缓存，与虚拟滚动无关 |

## 架构变更

### 迁移前

```
LayoutEngine → MasonryLayout → createVirtualScroll → visibleRange → 渲染
                                   ↑
                       createScrollRestoration (RAF 轮询)
```

### 迁移后

```
estimateSize(index) ──→ createWindowVirtualizer ──→ getVirtualItems() → 渲染
                             ↑
                   takeSnapshot → initialMeasurementsCache
```

关键变化：
1. **不再需要预先计算完整布局**：`estimateSize` 按需惰性求值
2. **不再需要 RAF 轮询恢复**：`initialMeasurementsCache` + `initialOffset` 在 Virtualizer 创建时生效
3. **不再需要自定义可见窗口计算**：TanStack 内部管理

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| TanStack Virtual 的 lane 分配算法与当前 `computeMasonryLayout` 的 shortest-column 可能不同 | 当前项目使用图片已知宽高，列分配差异对视觉影响极小 |
| overscan 从像素（400px）改为 item 数（2 个） | 差异仅在快速滚动时可能出现空白，可通过调大 overscan 解决 |
| NovelDetail 的渲染模式从 spacer 改为 absolute + translateY | 需要仔细验证 pretext 布局的一致性 |
| `@tanstack/solid-virtual` 进入维护状态的风险 | TanStack 系列库活跃维护，替代方案可回退 |

## 实施步骤

见 `docs/adr/plan-virtual-scroll-migration.md`。
