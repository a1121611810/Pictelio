# ADR-0129: app-lynx 多图详情改列表（通栏连续大图 + 逐页比例修正，扩展 CoverImage）

- 状态：accepted
- 日期：2026-08-31
- 关联：ADR-0115（推荐轮播，**未复用**其轮播形态）、ADR-0117（CoverImage 深模块）、ADR-0118（封面比例显示）、`packages/app-lynx/CONTEXT.md`（新增「多图详情」3 词条）、`docs/specs/app-lynx-detail-multi-image-list.md`
- 来源：grill-with-docs 会话——用户先提「改轮播（参考推荐页）」，Grill 收敛轮播方案后**用户推翻，改拍板列表形式**（「不要用轮播，改为列表形式显示比较好」）；随后逐项确认（通栏连续/角标/全量渲染/逐页比例/首图占位/点图无动作），并确认「load 后按比例修正」能力必须落地。

## 背景

app-lynx 详情页（`pages/IllustDetail.vue`）多图（`meta_pages.length > 1`）此前是**简易按钮翻页**：单张图 + `‹` / `›` 按钮 + `1 / N` 文本（`currentPage` / `nextPage` / `prevPage`），一次只渲染当前页，无整图浏览流、页与页之间无连续感。用户要求改形态，先比照推荐页（ADR-0115 自研 swipe 轮播）提轮播方案，Grill 收敛后用户推翻，明确：

> 改为**列表形式**显示比较好——所有图片宽度盛满，高度按**图片本身的宽高比例**换算。

## 决策

1. **形态 = 通栏连续大图列表（multi-image detail list）**：
   - 多图作品在详情页 `scroll-view` 内**纵向全量排列**所有页（页间留间距），非轮播、非按钮翻页；
   - 每张图**宽度盛满、高度按自身宽高比**换算（不裁切、不变形，对齐 webview 端 LazyDetailImage 的 `object-contain` 语义）；
   - 无页面级页码指示器，改为**每张图右上角悬浮「n / N」角标**（对齐 webview 端 `LazyDetailImage` 页码角标）；
   - 点图无动作（lynx 无全屏查看器，本轮不引入——另行立项）；
   - **删除** `currentPage` / `nextPage` / `prevPage` 与翻页行。

2. **逐页比例修正（per-page ratio correction）**：
   - 平台事实：Pixiv API `meta_pages` 仅含 `image_urls`，**无每页 width/height**（`PixivIllustMetaPage` 类型实证），无法预计算逐页高度；
   - 平台事实：Lynx `<image>` `mode` 无 `widthFix`，只 `scaleToFill | aspectFit | aspectFill | center`，不会自动撑高；官方 `auto-size` 属性（原生 2.6+）在 **web-core 0.23.1 未实现**（产物源码 0 匹配），仅真机可用，违反项目「web-core 预览 + 原生真机」双环境一致惯例 → **不采用**；
   - 平台事实：Lynx `<image>` `@load` 事件（`LoadEvent`/`ImageLoadEvent`）**携带原始 width/height**（Android/iOS/Clay），且 web-core 的 `x-image` load 事件 `detail` 同样携带 naturalWidth/naturalHeight（web-core 0.23.1 产物源码实证）→ 双环境一致的修正通道；
   - 实现 = 每张图容器先用**首图比例**占位（布局稳定），`@load` 后按该图实际比例**修正**容器高度。

3. **能力承载 = 扩展 CoverImage 深模块**（ADR-0117）：
   - 新增可选能力（默认行为不变，现有调用方（10 处 SkeletonImage 实例 + RecommendedCover）零影响）：「按 load 尺寸修正自身高度」；
   - 保持「三态统一承载」约定——详情页薄调用，不复制状态机；修正能力沉淀到深模块供后续复用；
   - 新增纯函数（如 `pageHeightVw(loadWidth, loadHeight)`）承载高度换算，node 可测。

4. **渲染与加载**：全量渲染所有页 + 首图 eager / 其余 `lazy-load`（与 IllustList/Following 既有模式一致）；质量档位沿用 `detailQuality` + `resolveQualityUrl` + `proxyImageUrl` 现状逻辑。

5. **不动**：`swiperMath.ts` / `CarouselSwiper` / `Recommended` / Ugoira 分支 / 单图分支。

## 被考虑的方案

- **推荐页同款轮播（CarouselSwiper 复用）**：Grill 第一轮已收敛（复组件/无指示器/窗口化 ±1/不封顶/点图无动作），随后**用户推翻**（「不要用轮播」）。否决理由（用户拍板）：多图作品一屏只给一张、无整图浏览流，列表更能体现多图作品的连续内容。轮播代码未动。
- **详情页内自实现三态 + 修正**：不动 CoverImage，但重复状态机，违反 ADR-0117 深模块「避免各组件再各自抄三态」的修复初衷。否决。
- **`auto-size`**：web-core 0.23.1 未实现（产物源码 0 匹配），仅真机可用；且加载前布局不可预测。否决（以上述 @load 修正替代）。
- **统一首图比例 + aspectFill 裁切**：简单但比例不同的页被裁边，违背「高度按图片本身比例」的用户要求。否决。
- **窗口化虚拟渲染**：需滚动位置感知，lynx 渲染层滚动事件粒度/scroll-view 能力有限，实现成本高风险大。否决（列表页既有模式本就是全量渲染 + lazy-load）。

## 后果

**正面**：
- 多图作品有整图浏览流，每图按自身比例完整显示，页码角标保持位置感；
- `bindload` 修正通道在 web-core 与原生真机双环境一致，避免 `auto-size` 的平台分叉；
- CoverImage 深模块的修正能力可被后续「全屏查看器」等场景复用（默认关闭，无 blast radius）。

**风险/验证项**（spec §6）：
- web-core 实际跑通 `@load` detail 携带尺寸 + `lazy-load` 时序（源码证据已有，需实测）；
- 原生/模拟器：逐页修正高度在 scroll-view 中布局稳定；超高图/比例差异大的混排场景；
- CoverImage 默认行为回归（现有调用方零影响，10 处 SkeletonImage 实例 + RecommendedCover）。
