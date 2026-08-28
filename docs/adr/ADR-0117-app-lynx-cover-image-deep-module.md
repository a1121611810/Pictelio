# ADR-0117: app-lynx 深模块 CoverImage 统一「图片三态」（RecommendedCover / SkeletonImage 收敛）

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0115（推荐轮播；RecommendedCover 是其「图片三态」产物，本轮收敛其实现）、`packages/app-lynx/CONTEXT.md`（新增「图片三态」词条）、`packages/app-lynx/src/components/RecommendedCover.vue`、`packages/app-lynx/src/components/SkeletonImage.vue`、`packages/app-lynx/src/utils/coverImage.ts`、`packages/app-lynx/src/components/skeletonStyle.ts`
- 来源：S2 code-smell 清理——`RecommendedCover.vue` 与 `SkeletonImage.vue` **重复实现「图片三态」**（骨架 / 图片 / 失败+重试）状态机 + 渲染模板。深模块方案经确认后采用（本文档只记录决策与术语，不写代码）。

## 背景

app-lynx 有两处各自独立的「图片三态」实现：

1. **`RecommendedCover.vue`**（推荐轮播的沉浸封面，ADR-0115 产物）——自持 `loaded` / `failed` ref、`watch(src)` 复位、空 src 直接置 failed、`onLoad` / `onError`、`retry()`（经 `deriveRetryState` 从干净 src 重建防 `&retry` 累积），渲染 `<image mode="aspectFill">` + shimmer 骨架 + 失败 overlay + 重试按钮。纯逻辑已抽到 `src/utils/coverImage.ts`（`deriveCoverState` / `withRetryQuery` / `deriveRetryState`，node 单测），**但模板仍内嵌于组件**。
2. **`SkeletonImage.vue`**（列表图片级骨架屏）——自持另一套 `loaded` / `failed` ref + `onLoad` / `onError`，渲染 `<image>` + shimmer + 「图片加载失败」文字（无重试按钮）。容器尺寸经 `resolveSkeletonStyle(height / aspectRatio / minH)` 解析。它是 7 个文件、9 处 `<SkeletonImage>` 消费的公共列表组件。

两者本质上做同一件事（骨架 → 图片 → 失败 + 重试的加载状态机 + 渲染），但 `RecommendedCover` 是「全 bleed 沉浸」形态、`SkeletonImage` 是「盒」形态。该重复构成 code-smell：三态状态机与渲染模板散落两处，且都各自内嵌「自己那一份」——后续任何新的图片组件还会再抄一遍。

**方案决策（已确认）**：新建深模块 `CoverImage`，把「图片三态」大行为藏在小接口后；`RecommendedCover` 收敛为 `layout="full"` 的调用方，`SkeletonImage` 收敛为 `layout="box"` 的薄盒适配器。

## 决策

1. **新建深模块 `CoverImage`**（`packages/app-lynx/src/components/CoverImage.vue`）——把「图片三态」大行为藏在小接口后：
   - **对外接口**：`src: string`（必填）、`layout: 'full' | 'box'`、`retry?: boolean`、`lazyLoad?: boolean`；`layout="box"` 模式另接受尺寸 prop（`height?` / `aspectRatio?` / `minH?`）。
   - **实现（深 / 内部）**：三态机（`deriveCoverState`）、`watch(src)` 复位、空 src→failed（避免 `<image src="">` 不触发 `@error` 而无限骨架）、`onLoad` / `onError`、`retry`（`deriveRetryState` 从干净 src 重建防 `&retry` 累积）、渲染（`<image mode="aspectFill">` + shimmer 骨架 + 失败 overlay + 重试按钮）、容器处理（full-bleed `absolute inset-0` vs `resolveSkeletonStyle` 盒子）、`lazyLoad`。
2. **`RecommendedCover` → `CoverImage` 的调用者**：`<CoverImage :src layout="full" retry />`（推荐轮播全 bleed 封面）。`RecommendedCover.vue` 自持的三态状态机 + 渲染模板整体移除，退化为薄调用。
3. **`SkeletonImage` → 薄盒适配器**：`CoverImage` 的 `layout="box"` 便捷封装（透传 `src` / `height` / `aspectRatio` / `minH` / `lazy-load`），现有 7 个文件、9 处调用零改动（现有调用不传 `retry`，故盒模式不新增重试按钮，行为保持）。
4. **纯逻辑核心保留**：`deriveCoverState` / `withRetryQuery` / `deriveRetryState` 保留在 `src/utils/coverImage.ts`（已有单测），不外泄进组件模板。
5. **样式遵循 M3 + Tailwind-first**：不新增手写 scoped CSS（遵循 app-lynx 样式硬性约定）。

## 被考虑的方案

- **浅 composable `useImageState`**：只收敛状态机（loaded / failed / state / onLoad / onError / retry / reset / src，接口 8 成员），**漏掉模板重复**——每个调用方仍需自写 `<image>` + 骨架 + 失败 overlay 的渲染模板。仍未消除 code-smell 的模板部分。否决。
- **共享 `<ImageState>` 组件**：把容器也强制收敛，但「full-bleed（`absolute inset-0`）」与「盒子（`resolveSkeletonStyle` 尺寸）」两种容器语义不同，fusing 容器会引入复杂的分支/融合逻辑，接口变大。否决。
- **把 fullBleed / retry 合并进 `SkeletonImage`**：在现有 9 处消费的公共列表组件上新增 `layout`/`retry` 分支，**blast radius 大**（所有列表调用方都要重验，且列表图区与全 bleed 封面的容器语义混叠到一个组件里）。否决。
- **接受现状**：双组件各自三态，code-smell 持续，后续新图片组件仍会再抄一遍。否决。

## 后果

**正面**：
- **locality**：三态逻辑 + 渲染模板集中到单一 `CoverImage`，一张图的状态机/模板只存在一处；
- **leverage**：小接口（`src` / `layout` / `retry` / `lazyLoad`，box 加尺寸），大行为（状态机、重试 URL 重建、容器处理）藏于模块内；
- **可测性**：纯逻辑（`deriveCoverState` / `withRetryQuery` / `deriveRetryState`）留在 `coverImage.ts`，node 单测即可覆盖，无需 web-core / 真机；容器 / 渲染行为归验证闭环；
- **收敛**：`RecommendedCover` 与 `SkeletonImage` 都成为 `CoverImage` 的调用 / 封装层，消除模板散落。

**负面**：
- 新增一个深模块（`CoverImage`）及其 `layout` 分支；`SkeletonImage` 转包一层，需确认对现有列表调用（7 文件 / 9 处）**无行为回归**；
- 渲染面为 web-core + 真机验证范畴：需确认 `<image mode="aspectFill">` 原生不变形、`lazy-load` 引擎级懒加载在原生生效、`retry` 重建（`:key` + cache-bust src）在原生渲染正确——属「深模块渲染行为」的既有验证通道（web-core 预览 + 模拟器 + 真机）。
