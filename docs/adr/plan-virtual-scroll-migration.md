# 迁移实施计划：自建虚拟滚动 → TanStack Virtual

**预计工作量**：中（3-5 天开发 + 测试）  
**风险等级**：中  
**并行可行性**：各阶段内任务可部分并行  

---

## 概览

```
Phase 0: 安装依赖             [1 commit]
Phase 1: VirtualFeed 迁移     [1 commit]
Phase 2: NovelVirtualFeed 迁移 [1 commit]
Phase 3: NovelDetail 迁移     [1 commit]
Phase 4: Store 层改造         [1 commit]
Phase 5: 删除旧代码 + 更新测试 [1 commit]
```

每个阶段独立可测试。建议按顺序实施。

---

## Phase 0：安装依赖

**文件**：`packages/app/package.json`

```
pnpm add @tanstack/solid-virtual
```

**验证**：`pnpm check` 通过。

---

## Phase 1：VirtualFeed.tsx 迁移

### 文件变更

| 文件 | 操作 |
|------|------|
| `components/VirtualFeed.tsx` | 重写虚拟化部分 |
| `components/LayoutEngine.tsx` | 精简：移除 Worker，保留纯高度计算 |
| `composables/` — 不新建共享层 | |

### 核心改动

**移除的 import：**
```
- import { computeMasonryLayout } from "../primitives/computeMasonryLayout"
- import type { ComputeMasonryInput } from "../primitives/computeMasonryLayout"
- import { createVirtualScroll } from "../primitives/createVirtualScroll"
- import { createScrollRestoration } from "../primitives/createScrollRestoration"
- import { createLayout } from "./LayoutEngine"
- import { loadImage, checkImageCache } from "../utils/imageLoader"
- import { isImageHostEnabled } from "../stores/imageHostStore"
- import { imageCachePrefetch } from "../stores/uiStore"
```

**新增的 import：**
```
+ import { createWindowVirtualizer } from "@tanstack/solid-virtual"
```

**替换 createVirtualScroll + createScrollRestoration：**

```typescript
// 之前
const layout = createLayout(
  () => props.illusts,
  columnWidth,
  columnCount,
  () => VERTICAL_GAP,
  () => GAP,
  layoutMode,
);
const vs = createVirtualScroll({ layout, overscan: 400, useWindowScroll: true });
createScrollRestoration({ restoreScrollTop: () => props.restoreScrollTop, layout, containerWidth });

// 之后
const virtualizer = createWindowVirtualizer({
  count: () => props.illusts.length,
  estimateSize: (i) => {
    const ill = props.illusts[i];
    if (!ill) return 200;
    const effH = ill.type === "ugoira" ? Math.round(ill.height * 0.75) : ill.height;
    const aspectRatio = effH > 0 ? ill.width / effH : 1;
    return columnWidth() / aspectRatio + CARD_INFO_HEIGHT + VERTICAL_GAP;
  },
  lanes: columnCount(),
  overscan: 2,
  getItemKey: (i) => props.illusts[i]?.id ?? i,
  initialOffset: savedOffset,       // 从 store 恢复
  initialMeasurementsCache: savedSnapshot,  // 从 store 恢复
});
```

**渲染替换：**

```tsx
{/* 之前 */}
<For each={props.illusts.slice(vs.visibleRange().startIndex, vs.visibleRange().endIndex + 1)}>
  {(illust, i) => (
    <div style={vs.getItemStyle(realIndex)}>
      ...
    </div>
  )}
</For>

{/* 之后 */}
<For each={virtualizer.getVirtualItems()}>
  {(vItem) => (
    <div
      style={{
        position: "absolute",
        top: 0,
        transform: `translateY(${vItem.start}px)`,
        width: `${columnWidth()}px`,
        height: `${vItem.size}px`,
        left: `${(vItem.lane ?? 0) * (columnWidth() + GAP)}px`,
      }}
    >
      ...
    </div>
  )}
</For>
```

**takeSnapshot 保存（组件卸载 / Tab 切换时）：**

```typescript
// 在 onCleanup 或 Tab 切换时的保存函数中
const snapshot = virtualizer.takeSnapshot();
const offset = virtualizer.scrollOffset;
setFeedScrollState(tabKey, { snapshot, offset, version: 1 });
```

### 遗留：LayoutEngine.tsx

`LayoutEngine.tsx` 中的 `createLayout` 函数在 Phase 1 后不再被 VirtualFeed 调用。该文件暂不删除（可能有其他引用），待 Phase 5 统一清理。

### 验证

- `pnpm check` 通过
- VirtualFeed 能正常滚动
- 切换 Tab 再回来能恢复滚动位置

---

## Phase 2：NovelVirtualFeed.tsx 迁移

### 文件变更

| 文件 | 操作 |
|------|------|
| `components/NovelVirtualFeed.tsx` | 重写虚拟化部分 |

### 核心改动

与 Phase 1 模式一致，但 `estimateSize` 逻辑不同：

```typescript
const virtualizer = createWindowVirtualizer({
  count: () => props.novels.length,
  estimateSize: (i) => {
    const mode = mode();
    const novel = props.novels[i];
    if (!novel) return 100;
    if (mode === "textList") {
      return textListCardMetrics.getInfoHeight(novel.id) + 20; // gap
    }
    if (mode === "coverWall") {
      const colWidth = (containerWidth() - GAP) / 2;
      return colWidth + coverWallCardMetrics.getInfoHeight(novel.id) + GAP;
    }
    // list mode
    const infoHeight = listCardMetrics.getInfoHeight(novel.id);
    return Math.max(128, infoHeight) + 20 + GAP;
  },
  lanes: () => mode() === "coverWall" ? 2 : 1,
  overscan: 2,
  getItemKey: (i) => props.novels[i]?.id ?? i,
  initialOffset: ...,
  initialMeasurementsCache: ...,
});
```

**`createComputedTextCard` 保留不变。** 它提供纯文本计算高度，与虚拟滚动无关。

### 验证

- 三种 layout 模式均能正常滚动
- 滚动位置恢复

---

## Phase 3：NovelDetail.tsx 迁移

### 文件变更

| 文件 | 操作 |
|------|------|
| `primitives/createNovelVirtualLayout.ts` | 内部虚拟化层替换为 `createVirtualizer`，暴露 `virtualizer` |
| `routes/NovelDetail.tsx` | 渲染区域改为 absolute + translateY |

### createNovelVirtualLayout 内部改造

**保留的：**
- `textLayoutResult`（pretext 文本布局）
- `blockLayouts`（混合块编排）
- `scrollToCharIndex`
- `currentCharIndex`
- `layoutResult` 暴露

**移除的：**
- `visibleBlocks`（由 `virtualizer.getVirtualItems()` 替代）
- `totalHeight`（由 `virtualizer.getTotalSize()` 替代）
- `getBlockStyle`（由 virtualItem 定位替代）
- 内部 scroll 监听
- container 滚动逻辑

**新增的：**
- 内部 `createVirtualizer` 调用
- 暴露 `virtualizer: Virtualizer<HTMLElement>` 实例
- `blockLayouts` 输出 feeding `estimateSize`：
  ```typescript
  const virtualizer = createVirtualizer({
    count: () => blockLayouts().length,
    estimateSize: (i) => blockLayouts()[i]?.height ?? 0,
    getScrollElement: () => containerEl() ?? null,
    overscan: 5,
  });
  ```

### 返回接口变更

```typescript
interface NovelVirtualLayoutResult {
  // 新
  virtualizer: Virtualizer<HTMLElement>;
  // 保留
  layoutResult: Accessor<NovelTextLayoutResult>;
  scrollToCharIndex(paragraphIndex: number, charIndex: number): void;
  currentCharIndex: Accessor<{ paragraphIndex: number; charIndex: number }>;
  containerRef: (el: HTMLElement) => void;
  getBlockLayout(index: number): BlockLayout | undefined;
  // 移除
  // visibleBlocks ✗
  // totalHeight ✗
  // getBlockStyle ✗
}
```

### NovelDetail.tsx 渲染变更

spacer 模式 → absolute + translateY：

```tsx
{/* 之前（spacer 模式） */}
<div style={{ height: `${topH}px` }} aria-hidden="true" />
<For each={vis}>{(idx) => <NovelContentBlock ... />}</For>
<div style={{ height: `${bottomH}px` }} aria-hidden="true" />

{/* 之后（absolute + translateY） */}
<div style={{ position: "relative", height: `${virtualLayout.virtualizer.getTotalSize()}px` }}>
  <For each={virtualLayout.virtualizer.getVirtualItems()}>
    {(vItem) => (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${vItem.start}px)`,
          height: `${vItem.size}px`,
        }}
      >
        <NovelContentBlock block={all[vItem.index]} ... />
      </div>
    )}
  </For>
</div>
```

### 验证

- 小说正文正常滚动
- 阅读进度保存/恢复正常
- 搜索高亮功能正常
- `scrollToCharIndex`（从阅读进度恢复）正常工作

---

## Phase 4：Store 层改造

### feedStore.ts

```typescript
// 之前
const tabScrollY: Record<string, number> = {};
export function setFeedScrollY(tab: string) {
  tabScrollY[tab] = window.scrollY;
}
export function getFeedScrollY(tab?: string) {
  return tabScrollY[tab ?? currentTab] ?? 0;
}

// 之后
interface ScrollRestoreState {
  snapshot: VirtualItem[];
  offset: number;
  version: number;
}
const tabScrollState: Record<string, ScrollRestoreState> = {};
export function setFeedScrollState(tab: string, state: ScrollRestoreState) {
  tabScrollState[tab] = state;
}
export function getFeedScrollState(tab?: string): ScrollRestoreState | null {
  return tabScrollState[tab ?? currentTab] ?? null;
}
```

### novelStore.ts

同理，小说 Feed 的滚动状态也改为 `{ snapshot, offset, version }`。

### 验证

- `pnpm check` 通过
- 交互 Tab 恢复正常

---

## Phase 5：删除旧代码 + 更新测试

### 删除的文件

```
primitives/createVirtualScroll.ts
primitives/computeMasonryLayout.ts
primitives/createMasonryWorker.ts
primitives/masonryWorker.ts
primitives/createScrollRestoration.ts
primitives/createTextListLayout.ts
```

### 删除的测试文件

```
tests/browser/createVirtualScroll.browser.test.ts
tests/browser/createMasonryWorker.browser.test.ts
tests/unit/primitives/computeMasonryLayout.test.ts
tests/browser/createTextListLayout.browser.test.ts
tests/unit/primitives/createTextListLayout.test.ts
```

### LayoutEngine.tsx 清理

`LayoutEngine.tsx` 移除：
- Worker 相关代码（`getMasonryWorker`、`workerLayout` signal、createEffect）
- `appendToLayout` import
- 如果 `createLayout` 不再被任何文件引用，整个文件可以删除

检查引用：
```bash
grep -r "createLayout\|LayoutEngine" src/ --include="*.ts" --include="*.tsx"
```

如果仍有引用（如 `UserWorksFeed.tsx`），保留 `createLayout` 但去掉 Worker 部分。

### primitives/types.ts 清理

移除不再使用的类型：
```
MasonryLayout (interface)
MasonryItemLayout (interface)
ScrollWindow (interface)
```

保留：
```
LayoutMode (type) — 仍在 uiStore 和组件中使用
```

### 验证

- `pnpm check` 通过
- `pnpm test` 全部通过
- `pnpm dev` 启动后 3 个消费页面均正常
- 构建产物无 TypeScript 错误

---

## 完整性检查清单

### 功能验证

- [ ] 作品 Feed（recommended / following）正常滚动，瀑布流/单列/网格三种模式正确
- [ ] 小说 Feed 正常滚动，list/textList/coverWall 三种模式正确
- [ ] 小说正文正常滚动，阅读进度保存/恢复正确
- [ ] Tab 切换滚动位置恢复正确
- [ ] 从详情页返回 Feed 时滚动位置恢复正确
- [ ] 小说正文搜索高亮正常工作
- [ ] 下拉刷新功能正常

### 代码质量

- [ ] `pnpm check` 无 TypeScript 错误
- [ ] `pnpm test` 全部通过
- [ ] `pnpm lint` 无新增 warning
- [ ] `pnpm fmt` 通过
- [ ] 所有删除的文件已从 git 中移除
- [ ] 没有未使用的 import

### 性能关注点

- [ ] VirtualFeed 快速滚动时无空白闪烁（overscan 2 足够则保留，不够则调大）
- [ ] 小说长文（1000+ 段）时滚动流畅
