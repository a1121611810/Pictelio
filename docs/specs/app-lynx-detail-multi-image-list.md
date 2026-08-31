# Spec: app-lynx 多图详情改列表（通栏连续大图 + 逐页比例修正）

- 状态：implemented（Grill 收敛 → ADR-0129 → spec → tickets #287/#288/#289 → T1+T2 实现完成，2026-08-31；T3 回归建单跟进）
- 日期：2026-08-31
- 关联：`docs/adr/ADR-0129-app-lynx-detail-multi-image-list.md`、ADR-0117（CoverImage 深模块）、`packages/app-lynx/CONTEXT.md`（新增「多图详情」3 词条）
- 前置：已有详情页（`pages/IllustDetail.vue`）多图按钮翻页现状（`currentPage`/`nextPage`/`prevPage`/`‹ 1/N ›` 行、`pages`/`currentImage` computed、`SkeletonImage` 单图渲染）；**不改数据层**（loadDetail / meta_pages 结构不变）、不动其它页面、不动轮播相关（`swiperMath.ts` / `CarouselSwiper` / `Recommended`）。

## 1. 背景与根因

详情页多图此前是**简易按钮翻页**：单张图 + `‹` / `›` 按钮 + `1 / N` 文本，一次只渲染当前页。问题：

1. **无浏览流**：多图作品（漫画/长条）看不出整体内容，页与页之间靠点击切换、无连续感；
2. **位置感弱**：只有单个数字，切换无动画、无预览；
3. **翻页按钮低效**：大内容量作品逐页点击成本高。

用户拍板（Grill 确认，先提轮播后推翻）：

> 不要用轮播，改为**列表形式**显示比较好——所有图片宽度盛满，高度按照图片本身的宽高比例来换算。

## 2. 产品行为

### 2.1 形态：通栏连续大图列表

- 多图作品（`meta_pages.length > 1`）在详情页 `scroll-view` 内**纵向全量排列**所有页；
- 每张图**宽度盛满**、**高度按该图自身宽高比**换算（不裁切、不变形，对齐 webview 端 `LazyDetailImage` 的 `object-contain` 语义）；
- 页与页之间留**间距**（M3 语义间距）；
- 视觉沿用现状大图样式：通栏无圆角、`bg-surface-container-highest` 背景（与现有详情大图连续）。

### 2.2 页码角标

- 每张图**右上角悬浮「n / N」胶囊角标**（对齐 webview 端 `LazyDetailImage`）；
- 角标为页面级元素叠加（不进 CoverImage 深模块内部）。

### 2.3 逐页比例修正（per-page ratio correction）

- API 事实：`meta_pages` 元素仅含 `image_urls`，**无每页 width/height**（`PixivIllustMetaPage` 类型实证）；
- 因此每张图容器高度**先用首图比例占位**（`detailImageHeightVw(illust.width, illust.height)`，布局稳定、防 0 高/跳动），图片 `@load` 后按**该图实际比例**修正容器高度；
- `@load` 修正数据来源：Lynx `LoadEvent`/`ImageLoadEvent`（携带原始 width/height，Android/iOS/Clay；web-core `x-image` load 事件 `detail` 携带 naturalWidth/naturalHeight——web-core 0.23.1 产物源码实证）；
- 「load 后修正」能力**承载于 CoverImage 深模块扩展**（默认行为不变，详情页薄调用）。

### 2.4 渲染与加载

- **全量渲染**所有页（列表内 v-for）；
- **首图 eager**（首屏即需、不 lazy-load），**其余页 `lazy-load`**（与 IllustList/Following 既有模式一致）；
- 质量档位沿用现状：`detailQuality`（medium/large/original）+ `resolveQualityUrl` + `proxyImageUrl`，逐页解析。

### 2.5 交互边界

- **点图无动作**（lynx 无全屏查看器，本轮不引入）；
- 单图作品（`page_count === 1`）**保持现状**（无角标、无列表化）；
- Ugoira（`illust.type === 'ugoira'`）**保持现状**（`UgoiraViewer` 分支不动）；
- **删除**翻页三件套：`currentPage` ref、`nextPage()`、`prevPage()` 与 `‹ 1/N ›` 模板行。

### 2.6 无障碍

- 跟随现状（推荐页轮播同级），不额外加图级 a11y 标注。

## 3. 数据流

```
loadDetail(id) → illust (PixivIllust)
  → pages computed（现有）: meta_pages.map(image_urls) | [image_urls]
  → slideSrcs computed（新增）: pages 逐页 resolveQualityUrl(page, detailQuality, meta_single_page.original_image_url) + proxyImageUrl → string[]
  → 模板 v-for over slideSrcs:
      view（w-full，高度 = 首图比例占位 detailImageHeightVw(illust.width, height)）
        CoverImage（layout="box"、src=slideSrcs[i]、lazyLoad=(i>0)、修正能力 on）
           └ @load → 按 detail.width/height 修正容器高度
           └ 三态（骨架/图片/失败）由 CoverImage 承载（ADR-0117）
      overlay: 「i+1 / N」角标（absolute 右上角）
```

状态变化：`detailQuality` 设置变化 → `slideSrcs` 重算（响应式）；`@load` 修正只影响该图容器高度，不影响其它页。

## 4. 实现决策

1. **CoverImage 深模块扩展**（ADR-0129 决策 3）：
   - 新增可选能力「按 load 尺寸修正自身高度」（`correctHeightOnLoad` prop，code-review 定稿命名；默认 false = 现状不变）；
   - **默认行为不变**：现有调用方（10 处 SkeletonImage 实例 + RecommendedCover 直接调用）零影响；
   - 新增纯函数承载高度换算：如 `pageHeightVw(loadWidth, loadHeight)`（非法输入防御——沿用 `detailImageHeightVw` 的校验/回退语义，node 单测）；
   - 三态（骨架/图片/失败+重试）仍由 CoverImage 统一承载，不在详情页复制状态机。
2. **IllustDetail.vue 改动**：
   - 多图分支（`page_count > 1`）替换为列表 v-for；删除 `currentPage`/`nextPage`/`prevPage`/翻页行；
   - `pages` 保留；新增 `slideSrcs` computed（逐页解析 + 代理）；
   - 每张图容器：`w-full` + 首图比例占位高度 + `bg-surface-container-highest overflow-hidden` + 右上角 `n / N` 角标；
   - 单图分支 / Ugoira 分支不动。
3. **不做**：轮播复用（已否决）、窗口化虚拟渲染（已否决）、`auto-size`（web-core 不支持，已否决）、全屏查看器（另行立项）。

## 5. 测试决策

- **纯函数单测**（就近，node 环境）：
  - `pageHeightVw`（或命名等价）——正常比例 / 0 / 负 / NaN / Infinity / 字段缺失 → 回退语义（oracle：`detailImageHeightVw` 既有测试语义）；
  - `slideSrcs` 解析逻辑若抽纯函数（如 `resolvePageSrcs`）——medium/large/original 档位映射 + original 兜底（oracle：`resolveQualityUrl` 既有测试语义）。
- **组件行为**：CoverImage 深模块扩展的渲染行为（角标/修正高度/占位）归 web-core/真机验证闭环（既有惯例：三态渲染行为归验证闭环，纯逻辑归单测）。
- **红线测试**：`packages/app-lynx/tests/unit.test.ts` 现有断言（RefreshableList 结构、IllustTypeBadgeRow 绑定等）确认无 IllustDetail 翻页相关断言（已查，无破坏）。
- **回归**：CoverImage 默认行为回归（现有调用方零影响）；`pnpm check:app-lynx` / `pnpm lint:app-lynx` / `pnpm test:app-lynx`。

## 6. 验证清单（web-core + 模拟器/真机）

- [ ] web-core：多图作品列表化渲染、逐张 `@load` 修正高度、角标位置正确；
- [ ] web-core：`lazy-load` + `@load` 时序（首图 eager 正常、其余懒加载正常）；
- [ ] 原生/模拟器：scroll-view 内逐页修正高度布局稳定（无跳动/无 0 高）；
- [ ] 原生/模拟器：超高图（纵向长条）与比例差异大的混排场景；
- [ ] 原生/模拟器：多页作品比例各异（横图+竖图混排）修正正确；
- [ ] 回归：单图作品、Ugoira 作品详情不受影响；
- [ ] 回归：推荐页轮播/CarouselSwiper 不受影响（未改动，冒烟即可）。

## 7. Out of Scope

- 全屏图片查看器（点图放大/双指缩放）——另行 Grill + spec；
- 轮播形态（CarouselSwiper 复用）——已否决；
- `auto-size` 属性——已否决（web-core 不支持）；
- 窗口化虚拟渲染——已否决；
- 页面级页码指示器/指示条——已否决（改每图角标）；
- 图级 a11y 标注——跟随现状，不额外加。

## 8. Further Notes

- 术语已在 `packages/app-lynx/CONTEXT.md` 落库：「多图详情列表」「详情翻页（废弃）」「逐页比例修正」；
- 决策记录见 ADR-0129（含被否决方案的否决理由）；
- 实现顺序建议（tickets）：T1 CoverImage 深模块扩展（默认行为不变）→ T2 IllustDetail 列表化接线 → T3 全量回归 + 验证清单。
