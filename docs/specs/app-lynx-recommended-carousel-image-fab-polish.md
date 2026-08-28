# Spec: app-lynx 推荐轮播 图片三态（骨架/失败/重试）+ FAB 刷新图标与动画细化

- 状态：draft（Grill 已收敛，2026-08-30）
- 关联：`docs/adr/ADR-0115-app-lynx-recommended-carousel.md`（轮播，已含「T5 主线程不可用→后台线程」修订）、`packages/app-lynx/src/pages/Recommended.vue`、`packages/app-lynx/src/components/CarouselSwiper.vue`、`packages/app-lynx/src/components/SkeletonImage.vue`、`docs/research/vue-lynx-swiper-tutorial.md`
- 前置：本轮是**已有推荐轮播的细化**（图片态 + FAB 图标/动效），不改轮播滑动/数据层。

## 1. 背景与根因

推荐轮播上一版（ADR-0115）已上线单卡 swipe。真机/web 发现 4 个体验问题：

1. **图片加载期无占位**：滑页卡 `<image class="absolute ... object-cover">` 直接渲染，加载中无骨架 → 空白/白屏。
2. **图片失败无兜底**：无 `@error` 处理 → 失败时白屏（标题/作者白字叠白底不可见）。
3. **可能变形**：用的是 CSS `object-cover`（`object-fit`），而原生 Lynx `<image>` 用**自己的 `mode` 属性**（`aspectFill`/`aspectFit`/`contain`…）。`object-fit` 在 Lynx 渲染引擎上可能不生效，导致封面被拉变形。
4. **刷新动画丑**：FAB 的 `⟳` + `animate-spin`（1s/圈、`linear` 无限转）视觉不佳；且 `⟳` 为 unicode 字形（Lynx 无图标字体，字形渲染是未验证平台面）。

## 2. 产品行为

### 2.1 图片三态（每张滑页独立）

- **加载中（skeleton）**：封面图未加载好之前，整张滑页显示**全 bleed 骨架**（shimmer 微光），标题/作者/徽章等 scrim 文案照常显示（叠于骨架之上）。
- **加载成功（image）**：图片就位后显示封面，骨架消失。
- **加载失败（failed）**：图片区显示**纯文字占位**「图片加载失败」+ **重试按钮**（`md-outline` 描边 M3 按钮，触控≥48dp）。不显示 emoji（Lynx 原生 emoji 渲染不可靠）。
- **重试**：点击「重试」→ **仅重载该图 src**（`src` 追加 cache-bust 参数，如 `?retry=<timestamp>`，强制重新请求）→ 回到「加载中」骨架。**不做整页刷新**（整页刷新已有 FAB）。

### 2.2 FAB 刷新图标（unicode `↻`，P5 回退自 I4）

> P5 真机发现：原定 I4「双弧刷新」经 SVG data-URI 在原生 LynxView **不渲染**、透明 PNG 又难生成（见 §3.2），**回退为 unicode `↻`**。

- 刷新按钮图标 = **unicode `↻`**（比 `⟳` 干净的单箭头，Lynx 无图标字体，unicode 为可靠渲染面）。
- 落地方式：Lynx `<image>` 内嵌 **tiny SVG data-URI**（`data:image/svg+xml,...`，深色 `on-primary-container` 描边）。⚠️ **需真机验证 SVG data-URI 在 LynxView 是否渲染**；若不支持，回退纯 CSS 边框弧图标或 `↻` unicode（记录）。

### 2.3 FAB 刷新动画（C：图标→圆环）

- 刷新进行中（`refreshing=true`）：**I4 图标淡出**（约 180ms）→ **M3 圆形 spinner 转起**（纯 CSS 圆环：`border` 3px 半透明 + `border-top-color` 主色 + `animate-spin`）→ 刷新完成：spinner 淡出、I4 图标淡入。
- 不无限自转（弃 `linear 1s`），用缓动 + 状态切换，突出"进行中而非持续转"。

## 3. 技术设计

### 3.1 图片三态组件（每滑页独立）

新建 `packages/app-lynx/src/components/RecommendedCover.vue`（沉浸全 bleed 封面，复用 SkeletonImage 的三态思路但去卡片框）：

```ts
const props = defineProps<{ src: string; alt?: string }>()
const imageSrc = ref(props.src)          // 重试时换 cache-bust src
const loaded = ref(false)
const failed = ref(false)
function onLoad() { loaded.value = true; failed.value = false }
function onError() { loaded.value = false; failed.value = true }
function retry() {
  failed.value = false
  loaded.value = false
  imageSrc.value = props.src + '?retry=' + Date.now()   // 仅重载该图
}
```

模板：
- `<image :src="imageSrc" :mode="'aspectFill'" :key="imageSrc" @load="onLoad" @error="onError" />` —— **用 Lynx `mode="aspectFill"`（fill+crop 不变形），替换 `object-cover`**；`:key` 保证重试换 src 后触发重新加载。
- `v-if="!loaded && !failed"` → 全 bleed shimmer 骨架（`bg-surface-container-highest` + 微光动画）。
- `v-if="failed"` → 灰底 + 「图片加载失败」text + 重试按钮（`bg-surface-container-high`、`text-outline`、`rounded-[var(--md-shape-small)]`、触控≥48dp）。
- 外层 `absolute inset-0`（全 bleed）。

`Recommended.vue` 滑页卡把 `<image ... object-cover>` 换成 `<RecommendedCover :src="coverSrc(item.data)" />`（scrim 文案层保持在其上）。

### 3.2 FAB 图标 + 动画（`Recommended.vue`）

> **⚠️ P5 真机发现（2026-08-30）**：原定的 I4「双弧刷新」用 **SVG data-URI**（`<image :src="data:image/svg+xml,...">`）在**原生 LynxView 不渲染**（浏览器正常、FAB 空白）；透明 PNG 又难生成。**故回退为 unicode `↻`**（Lynx 无图标字体，unicode 字形为可靠渲染面，ADR-0115 已记录该取舍）。

- 图标 = **unicode `↻`**（比 `⟳` 干净的单箭头），`text-primary-on-container`；`refreshing` 时 `opacity-0`。
- 圆环：`<view class="absolute inset-0 ... rounded-full border-[3px] border-[var(--md-outline-variant)] border-t-[var(--md-on-primary-container)] animate-spin" />`（纯 CSS 圆环）。
- 状态切换：`refreshing ? 'show ring + hide icon' : 'show icon'`；用 `opacity`/`transition-duration-[180ms]`。
- 样式用 Tailwind utility（不再手写全局 `<style>`，违 ADR 约定）。

### 3.3 令牌（`tokens.css`）

- 骨架 shimmer 底色：复用 `--md-surface-container-highest` / `--md-surface-container-high`（无新令牌）。
- 失败占位底色：`--md-surface-container-high` + `--md-outline` 文字（无新令牌）。
- 图标/圆环主色：`--md-primary-container` / `--md-on-primary-container`（现有）。

### 3.4 约束（沿用 AGENTS）

- 先渲染后加载、竞态防护（每张图片状态独立，重试/换 src 不污染其它滑页）。
- 非静默降级：`@error` → 显式失败态（非静默）；若需日志可 `console.warn('[recommendedCover] 图片加载失败', ...)`。
- 触控目标：重试按钮 ≥48×48dp。

## 4. 测试

### 单测（node，新增/修改）

| 用例 | 断言（oracle） |
|------|----------------|
| 重试 URL 生成：`withRetryQuery(src)` 追加 `?retry=<ts>`，且同 src 重复调用不产生两个 `?` | 纯函数；`src?x=1` → `src?x=1&retry=...`（oracle = URL 语义） |
| 图片三态判定纯函数：`deriveCoverState(loaded, failed)` → `skeleton/image/failed` | 状态表（未加载→skeleton / 加载成功→image / 加载失败→failed / retry 复位→skeleton——性质：状态互斥且可自恢复） |

（注：`<RecommendedCover>` 组件渲染行为（骨架/失败/重试交互）属 Lynx 渲染，node 无法直接测 → 归 web-core + 真机验证，见验证闭环；纯逻辑（URL、状态推导）抽函数单测兜底，避免 oracle gap。）

### 验证闭环

- `pnpm check:app-lynx` + `vitest`（新增用例全绿）。
- **web-core 预览实测**：骨架显示→图片@load→骨架消失；断网/坏 URL → 失败态+重试按钮；点重试回到骨架并能二次加载；封面不变形（aspectFill）。
- **模拟器+真机**：`aspectFill` 等比不变形、SVG data-URI 图标渲染、spinner 圆环、`⟳→圆环` 动画、重试按钮触控≥48dp。真机确认通过前不得宣称完成（沿用既有闭环）。

## 5. 验收条件

- 每张滑页图片加载中有全 bleed 骨架；加载成功显示封面（**等比不变形**）；加载失败显示「图片加载失败」+ 重试按钮。
- 点「重试」只重载该图 src（回到骨架，重新请求），不触发整页刷新/不重置滚动位置。
- FAB 刷新图标为 unicode `↻`（P5 回退，非 SVG I4 / 未用 `⟳`）；刷新中图标淡出、M3 圆环 spinner 转起、完成后恢复。
- FAB 无无限自转动画（改状态切换式）；动效用 Fluent/M3 缓动。
- 其余行为不变（滑动/吸附/点卡进详情/受限跳过/单刷新 FAB 语义）。

## 6. 排除项（本轮不做）

- 图左/右边的更多默认占位图库/逐尺寸占位——本轮仅单态占位（文字+重试）。
- 全局图片加载失败重试队列 / 自动重试退避——本次只手动「重试」。
- 图片加载进度条 / 占位图渐显过渡 → 本轮做 fade-in 轻过渡（可选项）。
- 指示器（spec §6 既有排除）。
- I4 图标的图标字体化 / SVG 外置资源 → 本轮内嵌 data-URI（小体积）。

## 7. Ticket 拆解（to-tickets）

| # | Ticket | 内容 | 前置 | 波次 |
|---|--------|------|------|------|
| P1 | 图片三态组件 | `RecommendedCover.vue`（aspectFill/骨架/失败+重试/重试 cache-bust） | 无 | 波 1 |
| P2 | FAB 图标+动画 | unicode `↻` + 刷新态「图标→圆环」动画（Tailwind，不手写全局 style） | 无 | 波 1 |
| P3 | 接入 Recommended.vue | 滑页卡换 RecommendedCover；FAB 换 I4+动画；tokens 复用 | P1,P2 | 波 2 |
| P4 | 单测 | 重试 URL 纯函数 + 三态推导纯函数 | P1 | 波 1 |
| P5 | 验证闭环 | 单测 + check + web-core + 模拟器/真机（aspectFill、SVG 图标、动画、重试） | P3,P4 | 波 3 |

并发策略：波 1 = P1 / P2 / P4 并行；波 2 = P3；波 3 = P5。每 ticket 走 TDD + 自测 + code-review。
