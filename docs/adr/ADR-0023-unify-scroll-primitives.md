# ADR 0023: 统一滚动原语

## 状态

已批准

## 分类

重构

## 日期

2026-07-25

## 背景

`primitives/` 目录包含 **6 个滚动相关原语**，它们共同组成项目的滚动交互基础设施：

| 文件 | 行数 | 导出 | 消费者 |
|------|------|------|--------|
| `createScrollDirection.ts` | 68 | 滚动方向判定 | NavBar, NovelDetail |
| `createScrolledPast.ts` | 14 | 滚动位置阈值检测 | NavBar, IllustDetail |
| `createScrollDrivenVisibility.ts` | 59 | 滚动驱动显隐控制 | Bookmarks, Feed, FollowListPage, TabFeedPage, UserIllusts |
| `createScrollRestore.ts` | 143 | 滚动恢复工厂+全局单例 | bookmarkStore, userIllustsStore |
| `createVirtualScrollRestore.ts` | 86 | 虚拟滚动恢复策略 | NovelVirtualFeed, VirtualFeed |
| `createFeedScrollStore.ts` | 46 | Feed Tab 粒度的滚动状态 | feedStore, novelStore |

### 问题

1. **接口 == 实现**：最薄的 `createScrolledPast.ts`（14行）和 `createScrollDirection.ts`（68行）的接口复杂度几乎等于其实现。消费者知道"用哪个原语"的门槛 = 知道 6 个工厂函数的签名。

2. **知识分散**：要理解 NavBar 的 header 隐藏逻辑，需要打开 `createScrollDirection` + `createScrolledPast` + `createScrollDrivenVisibility` 3 个文件。

3. **重复组合模式**：NavBar 和 NovelDetail 各自由 `createScrollDirection` + `createScrolledPast/DrivenVisibility` 的 effect 组合。这些组合逻辑在每个消费者中重复。

## 决策

将前 3 个原语（方向、阈值、显隐）合并为 `createScrollBehavior` 工厂，后 3 个原语保持独立但统一 re-export。

### 合并方案：createScrollBehavior

```typescript
// primitives/scroll/createScrollBehavior.ts

interface ScrollBehaviorConfig {
  /** 方向判定最小位移（默认 4px） */
  directionThreshold?: number;
  /** 空闲重现延迟 ms（默认 250ms） */
  idleDelay?: number;
  /** 顶部保护区 px（默认 48px，即 header 高度） */
  topGuard?: number;
  /** 是否启用向下滚动隐藏（默认 true） */
  hideOnScrollDown?: boolean;
}

interface ScrollBehaviorResult {
  /** 是否可见（由方向 + 保护区 + 空闲控制） */
  visible: Accessor<boolean>;
  /** 动态阈值检测函数，返回是否已超过 threshold px */
  scrolledPast: (threshold: number) => Accessor<boolean>;
  /** 暂停滚动方向判定（程序性滚动期间使用） */
  suppress: (durationMs?: number) => void;
  /** 当前滚动方向 */
  direction: Accessor<"up" | "down" | null>;
}
```

`scrolledPast` 设计为函数而非信号：消费者传入动态阈值，每次调用返回一个独立的 `Accessor<boolean>`。

### 保持独立的原语

后 3 个原语各自服务不同的抽象层次，合并会降低通用性：
- `scrollRestoreGlobal` — 持久化基础设施单例
- `createVirtualScrollRestore` — 虚拟滚动恢复策略
- `createFeedScrollStore` — Feed Tab 粒度的编排层

### 统一入口

创建 `primitives/scroll/index.ts` re-export 所有滚动相关导出，包括保持独立的 3 个原语。

### 迁移步骤

1. 创建 `primitives/scroll/` 目录
2. 编写 `createScrollBehavior.ts`
3. 编写 `scroll/index.ts`（re-export 所有）
4. 逐个迁移 7 个消费者文件，验证行为等价
5. 删除原 3 个文件（`createScrollDirection.ts`、`createScrolledPast.ts`、`createScrollDrivenVisibility.ts`）
6. 重写测试（从 3 组测试 -> 1 组）

## 理由

1. **Locality ↑**：理解滚动行为逻辑只需读 1 个文件
2. **Leverage ↑**：测试从 3 个独立原语的组合 → 1 个工厂的配置
3. **接口简化**：消费者从"组合多个原语" → "声明式配置对象"
4. **降低认知负担**：新开发者不需要了解 6 个工厂函数

## 后果

### 正面

- 减少 3 个文件
- 消费端代码更简洁
- 所有滚动行为配置化

### 负面

- 重构涉及 7 个消费者文件，需要仔细验证行为等价
- `scrolledPast` 作为函数的设计需要消费者适配

### 风险

中。需要逐个验证 7 个消费者的行为与重构前一致。建议分两步：先实现工厂但不删除旧原语，待所有消费者迁移后再清理旧文件。
