# Spec: app-lynx 统一「图片三态」—— 深 `CoverImage` 模块（RecommendedCover / SkeletonImage 收敛）

- 状态：draft（决策已定，ADR-0117 accepted；本阶段仅产出 spec，不写代码）
- 日期：2026-08-28
- 关联：`docs/adr/ADR-0117-app-lynx-cover-image-deep-module.md`（决策记录，本文档承载功能规格）、`docs/specs/app-lynx-recommended-carousel-image-fab-polish.md`（**前一轮「图片三态」spec**——当时的方案是各组件自写三态；本 spec 把它从「组件自写三态」重构为「深 `CoverImage` 承载」）、`packages/app-lynx/CONTEXT.md`（「图片三态」词条）、`packages/app-lynx/src/utils/coverImage.ts` + `coverImage.test.ts`、`packages/app-lynx/src/components/RecommendedCover.vue`、`packages/app-lynx/src/components/SkeletonImage.vue`、`packages/app-lynx/src/components/skeletonStyle.ts`
- 前置：本 spec 是「图片三态」的**收敛 / 重构**——不改变三态语义、不迁移 `SkeletonImage` 现有调用点、不改图片数据层（`coverSrc` / 代理 URL / feed）。

## Problem Statement

同一套「图片三态状态机 + 渲染模板」在 `RecommendedCover` / `SkeletonImage` 各写一遍（Shotgun Surgery）。

具体来说，app-lynx 目前有两处**彼此独立、语义相同**的「骨架 → 图片 → 失败 + 重试」加载状态机 + 模板：

1. **`RecommendedCover`**（推荐轮播的沉浸全 bleed 封面，前一轮「图片三态」的产物）：自持 `loaded` / `failed` ref、`watch(src)` 复位、空 src 直接置 failed、`onLoad` / `onError`、`retry()`（经 `deriveRetryState` 从干净 src 重建防 `&retry` 累积），渲染 `<image mode="aspectFill">` + shimmer 骨架 + 失败 overlay + 重试按钮。纯逻辑虽已抽到 `src/utils/coverImage.ts`（`deriveCoverState` / `withRetryQuery` / `deriveRetryState`，node 单测），**但状态机接线与渲染模板仍内嵌于组件**。
2. **`SkeletonImage`**（列表图片级**盒**骨架屏）：自持另一套 `loaded` / `failed` ref + `onLoad` / `onError`，渲染 `<image>` + shimmer + 「图片加载失败」文字（无重试按钮）。容器尺寸经 `resolveSkeletonStyle(height / aspectRatio / minH)` 解析。

两处状态机的**纯逻辑**虽已共享（`coverImage.ts`），但**行为层**（ref 接线、`watch(src)` 复位、空 src→failed、`retry` 重建、模板渲染、容器处理）仍各写一遍。后果：

- **改一处易漏一处**：任何三态行为变更（新增失败提示态、改失败文案、改 `aspectFill` 之外的渲染、补空 src 兜底、补 src 复位）都必须在两个组件各改一遍；漏改其一即漂移成「同一概念两套行为」。
- **无法保证非静默降级一致**：`RecommendedCover` 对空 src 已做「直接 failed」兜底，`SkeletonImage` 无此兜底（空 src 下 `<image src="">` 可能不触发 `@error` → 无限 shimmer）。
- **收敛度低，易再抄**：二者都各自内嵌「自己那一份」模板——后续任何新的图片组件大概率再抄一遍状态机 + 模板。
- **可演进性差**：将来统一图片加载行为（如全局失败重试、占位图渐显）时无处集中落地，只能逐组件改。

## Solution

新建**深模块 `CoverImage`** 组件——把「图片三态」的大行为藏在小接口后；`RecommendedCover` 与 `SkeletonImage` 收敛为 `CoverImage` 的**薄调用 / 薄盒适配器**。

- **`CoverImage`** = 深模块（seam）。三态状态机（`deriveCoverState`）+ `watch(src)` 复位 + 空 src→failed + `onLoad` / `onError` + `retry`（`deriveRetryState` 干净 src 重建）+ 渲染（`<image mode="aspectFill">` + shimmer 骨架 + 失败 overlay + 重试按钮）+ 容器（full-bleed `absolute inset-0` vs `resolveSkeletonStyle` 盒子）+ `lazyLoad`，全部藏在该模块内；对外仅暴露 4 个主 prop + 3 个 box 尺寸 prop。
- **`RecommendedCover` → `CoverImage` 的全 bleed 调用者**：`<CoverImage :src layout="full" retry />`；其自持的状态机 + 模板整体移除，退化为薄调用。
- **`SkeletonImage` → `CoverImage` 的薄盒适配器**：`layout="box"` 便捷封装（透传 `src` / `height` / `aspectRatio` / `minH` / `lazy-load`）；现有调用点零改动。
- **纯逻辑核心保留**：`deriveCoverState` / `withRetryQuery` / `deriveRetryState` 继续留在 `src/utils/coverImage.ts`（已有 node 单测），不外泄进组件模板。

「接口小、行为藏内」的深度权衡：调用方只需学习一个 `src` + 一个 `layout`（外加可选的 `retry` / `lazyLoad` / box 尺寸），即可获得完整三态 + 重试 URL 重建 + 容器处理。删除 `CoverImage` 时，这套状态机 + 模板会重新散落到 N 个调用方（而不是消失）——deletion test 证明它在「挣它的位置」。

## User Stories

编号列表（As a … I want … so that …）：

1. **As a 页面开发者**, I want 一个 `CoverImage` 组件承载完整图片三态（骨架/图片/失败+重试）, so that 我不再在 `RecommendedCover` / `SkeletonImage` 里各抄一遍状态机与模板。
2. **As a 页面开发者**, I want `CoverImage` 提供 `layout: 'full' | 'box'` 两种容器, so that 全 bleed 封面与列表/详情盒图都能用一个组件表达，无需自写两种容器。
3. **As a 维护者**, I want 三态状态机 + 渲染模板集中在单一 `CoverImage`, so that 一张图的状态机/模板只存在一处（locality）——改一处即两处修复，不再漏改漂移。
4. **As a 用户**, I want 全 bleed 封面（推荐轮播）图片加载失败时显示「重试」按钮, so that 我能单独重载该图而不必整页刷新（回归当前行为）。
5. **As a 用户**, I want 盒图（列表/详情）图片加载失败时至少显示明确「图片加载失败」提示, so that 失败不静默、不空白（保持 `SkeletonImage` 现状：盒模式无重试按钮）。
6. **As a 用户**, I want 空图片 src 直接被判定为失败态, so that 不会因 `<image src="">` 不触发 `@error` 而无限骨架（非静默降级；本 spec 统一到 `CoverImage`，也顺带覆盖盒模式）。
7. **As a 页面开发者**, I want `CoverImage` 在 `src` 变化时自动复位到骨架（或空 src→失败）, so that 轮播复用同一实例换图 / 复用卡片时不残留旧态（image/failed）。
8. **As a 用户**, I want 图片以等比 `aspectFill` 渲染, so that 封面/盒图不变形（Lynx 原生 `mode`，替代 CSS `object-fit` —— 后者在 LynxView 不生效会拉变形）。
9. **As a 页面开发者**, I want `CoverImage` 支持 `lazyLoad`, so that 列表/盒图走引擎级懒加载，避免 web-core 预览下清单全量渲染引发图片加载风暴（回归 `SkeletonImage` 的「图片级骨架 + 显式 height + lazy-load」约定）。
10. **As a 用户**, I want 重试按钮触控目标 ≥48dp（M3 触控规范）, so that 触控准确、不误触（仅 `layout="full"` + 开 `retry` 时存在该按钮）。
11. **As a 维护者**, I want 失败态文案 / 状态优先级 / 空 src 兜底语义收紧在 `CoverImage` 一处, so that 三态语义不再在两个组件间漂移（三态语义不变，只收敛承载）。
12. **As a 维护者 / 测试**, I want `deriveCoverState` / `withRetryQuery` / `deriveRetryState` 留在可 node 测的纯逻辑模块, so that 三态推导与重试 URL 语义可被单元测试锁定（oracle = spec/URL 语义），避免 oracle gap。

## Implementation Decisions

> 本节描述模块/接口/抽象边界（**不含具体文件路径与实现代码**），接口形状内联并注明来源（ADR-0117 决策 + 前一轮 spec 原型）。

### 决策核心：深 `CoverImage` 的对外接口

接口必须**小**、行为藏内。形状如下（来自 ADR-0117 决策 / 前一轮 spec 原型）：

```ts
type CoverImageProps = {
  /** 图片 URL（已过代理）；空串视为失败 */
  src: string
  /** 布局：full = 全 bleed（absolute inset-0 填满容器）；box = 按盒占位 */
  layout: 'full' | 'box'
  /** 失败时显示「重试」按钮（默认 false → 仅失败提示文字，保持盒模式现状） */
  retry?: boolean
  /** 懒加载（默认 false；列表/盒图传 true） */
  lazyLoad?: boolean
  // 仅 layout='box' 生效：
  /** 显式容器高度（vw 字符串；规避 aspect-ratio 容器内 image 百分比高度为 0） */
  height?: string
  /** 容器宽高比（如 "1 / 1"、"${w} / ${h}"） */
  aspectRatio?: string
  /** min-height 兜底（防 aspect-ratio 失效时高度塌陷） */
  minH?: string
}
```

**接口契约（调用方必须知道的全部事实）**：

| 契约 | 语义 |
|------|------|
| `src` 必填；空串 → 失败态 | 避免 `<image src="">` 不触发 `@error` 而无限骨架（非静默降级）。 |
| `layout` 必填 | `full` 忽略 `height`/`aspectRatio`/`minH`；`box` 用 `resolveSkeletonStyle` 定容器。 |
| `retry` 默认 false | true → 失败 show 重试按钮 + 提示文字；false → 仅提示文字。故盒模式（不传 `retry`）不新增按钮，行为不变。 |
| `lazyLoad` 默认 false | 透传给 `<image :lazy-load>`；列表/盒图传 true。 |
| 状态互斥 | `deriveCoverState(loaded, failed)` 恰好映射到 `skeleton/image/failed` 之一；failed 优先级高于 image（`(true,true)` → failed）。 |
| 复位不变量 | `src` 变化 → 复位到骨架（或空 src → failed）；不残留旧态。 |
| 重试不变量 | `deriveRetryState(src)` 从**干净 base src** 重建（`withRetryQuery` 追加 cache-bust），避免 `&retry` 累积；`retry` 后回到骨架。 |

**深度与 seam**：接口 7 个有语义 prop（4 主 + 3 box），隐藏的实现是三态状态机、`watch(src)` 复位、空 src 兜底、重试 URL 重建、容器处理、模板渲染——小而深。seam 位置设在 `CoverImage`（外部 seam）。`RecommendedCover`（`layout="full"`）与 `SkeletonImage`（`layout="box"`）是两个适配器，都满足同一接口——**两个适配器 → 真实 seam**（one-adapter-hypothetical / two-adapters-real-seam 判据）。

### 纯逻辑保留在可 node 测的模块

`deriveCoverState` / `withRetryQuery` / `deriveRetryState` **不**内联进组件模板，保留在独立纯逻辑模块（现 `src/utils/coverImage.ts`，已有单测）。这是 `CoverImage` 外部的**内部 seam**——组件渲染行为归 web-core/真机验证，而这部分纯逻辑做 node 单测兜底，避免 oracle gap。三态推导的优先级/互斥、重试 URL 的 cache-bust 语义由这些纯函数锁定。

### 收敛为薄适配器

- **全 bleed 调用者（`RecommendedCover`）**：退化为 `<CoverImage :src layout="full" retry />`；其自持状态机 + 渲染模板整体移除。
- **薄盒适配器（`SkeletonImage`）**：`CoverImage` 的 `layout="box"` 便捷封装（透传 `src` / `height` / `aspectRatio` / `minH` / `lazy-load`），**不传 `retry`**（盒模式保持「仅提示文字」）。经核对，现有 `SkeletonImage` 消费点为 **7 个文件、9 处 `<SkeletonImage>` 直用**（Following / Bookmarks / IllustList / UserHome / FollowList / IllustDetail / CommentItem；另含 import / 注释引用）——**全部零改动**。

### 变形契约与样式约定

- **等比不变形**：用 Lynx 原生 `<image mode="aspectFill">`，**不用** CSS `object-fit`（在 LynxView 不原生生效 → 变形）。这是前一轮已固化的行为，本 spec 将其统一收敛到 `CoverImage`。
- **容器语义**：`full` = `absolute inset-0`（填满父容器，沉浸式）；`box` = `relative` + `resolveSkeletonStyle(height / aspectRatio / minH)`（盒占位，规避原生 LynxView 下 aspect-ratio 容器内 image 百分比高度为 0 的问题）。
- **样式遵循 M3 + Tailwind-first**：骨架 shimmer / 失败占位 / 按钮用现有 M3 令牌（如 `--md-surface-container-high`、`--md-outline`、`--md-shape-full` 等，无新令牌）与 Tailwind utility，**不新增手写 scoped CSS**（遵循 app-lynx 样式硬性约定）。重试按钮触控 ≥48dp。

## Testing Decisions

**只测外部行为 / 接口，不测内部。** app-lynx 组件渲染面不可 node 直测（Vue + Lynx XElement），沿用「纯逻辑 node 单测 + 组件渲染 web-core/真机」分层：

| 层 | 测什么 | 怎么测 | oracle 来源 |
|----|--------|--------|------------|
| 纯逻辑（内部 seam） | `deriveCoverState`（三态推导/优先级互斥）、`withRetryQuery`（cache-bust 追加，无重复 `?`）、`deriveRetryState`（干净 base src 重建 + 复位回骨架） | **既有 node 单测**（`coverImage.test.ts`）——本 spec 不改其覆盖，仅确认仍在 `CoverImage` 的纯逻辑路径上 | spec 三态语义（骨架/图片/失败） + URL 语义（`?retry=<ts>` / `&retry=<ts>`）；prior art = `coverImage.test.ts` |
| 组件渲染（外部接口） | 三态渲染（骨架 → 图片 → 失败 overlay + 重试按钮）、`src` 切复位、空 src→失败、`layout` 容器（full vs box）、`aspectFill` 等比、`retry` 重建、`lazyLoad` | **web-core 预览 + 模拟器/真机**（app-lynx 惯例） | 现有 `SkeletonImage` / 列表页真机验证 + 前一轮图片三态的真机验收 |

**要点**：

- **不为 `CoverImage` 新增 node 渲染单测**——组件渲染面不可 node 直测；对组件做「接口测试」会退化为 shallow / 与实现自洽，违反 interface-is-test-surface 与 app-lynx 的验证约定。
- **纯逻辑不改**：`coverImage.ts` 三个纯函数 + 其单测已存在，作为「三态推导/重试 URL」语义的 node 级锁定；`CoverImage` 组件本身不再自造一份状态机。
- **回归风险点集中在盒模式**：`SkeletonImage` 转包一层后，**现有 7 文件 / 9 处调用零改动**，需确认对现有列表调用无行为回归（重点：盒模式不出现重试按钮、`lazy-load` 仍生效、`aspect-ratio`/显式 `height` 容器语义不变、空 src 由「无限骨架」变为「失败提示」——后者是刻意统一到 `CoverImage` 的非静默降级，属行为收敛而非回归）。
- **验证闭环**：`check:app-lynx` + `test:app-lynx`（纯逻辑单测）+ web-core 预览（三态切换 / 失败+重试 / src 复位 / full vs box 容器 / `aspectFill` 等比）+ 模拟器/真机（`aspectFill` 原生不变形、`lazy-load` 引擎级懒加载生效、`retry` 重建在原生渲染正确、重试按钮触控 ≥48dp）。

## Out of Scope

- **不动三态语义**：不新增状态（如加载进度 / 占位渐显态）、不改失败提示文案、不改重试交互形态、不改「failed 优先」优先级——本 spec 只做**收敛承载**，任何三态行为变更都不在本轮。
- **不迁移 `SkeletonImage` 现有调用点**：保留薄盒适配器，现有 7 文件 / 9 处调用**零改动**；不做逐页面内联替换 `CoverImage` 的清理。
- **不引入图标字体**：Lynx 无图标字体，重试按钮为文字（`重试`），不引入外置图标资源。
- **不改图片加载 / 数据层**：`coverSrc` / 代理 URL（`proxyImageUrl`）/ feed / `thumbUrl` 等零改动。
- **不做默认占位图库 / 失败重试队列 / 自动重试退避 / 加载进度条**：沿用前一轮「图片三态」spec 的排除项，本轮仅保留手动「重试」（`layout="full"` + `retry`）。

## Further Notes

- **真机验证 `layout` 容器**：`full`（absolute inset-0 全 bleed 沉浸）与 `box`（盒占位，显式 `height` / `aspectRatio` / `minH`）在原生 LynxView 下宽度 / 高度 / 占位一致，无死区、无拉伸。
- **`aspectFill` 等比**：真机确认原生 `mode="aspectFill"` 等比不变形（替代 CSS `object-fit`），封面与盒图都被正确裁剪而非拉伸。
- **重试触控**：真机确认重试按钮触控目标 ≥48dp（M3），点击仅重载该图 src（cache-bust）并回到骨架，不整页刷新、不重置滚动位置。
- **盒模式回归**：真机确认 `SkeletonImage` 转包后，框内 `lazy-load`、显式 `height`（issue #138 原生 LynxView 下 aspect-ratio 容器内 image 百分比高度为 0 的规避）仍生效，行为与现有列表调用一致。
- **前一轮 spec 的关系**：本 spec 收敛了 `app-lynx-recommended-carousel-image-fab-polish.md` 的「图片三态」实现边界（从组件自写收敛到深 `CoverImage`）；该文档中 FAB 图标/动画等与图片三态无关的部分不受影响。
