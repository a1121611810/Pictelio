# app-lynx 收藏按钮 chip 配色与容器尺寸（方案 E「Dark Glass」）—— 功能规格

> 来源：原型对照页 `packages/app-lynx/prototype/prototype-bookmark-color.html`（6 套配色 × 3 种底图，方案 F = 现状对照）；用户在对照中选定 **方案 E**；Grill 结论 = 「心形/计数在任意底图上都必须可读」
> 状态：implemented（2026-09-21，`packages/app-lynx`）
> 本 spec 同时是 `components/BookmarkButton.vue` 与 `components/BookmarkButton.template.test.ts` 中 `spec docs/specs/bookmark-color.md §E「Dark Glass」` 引用的落地文档（期望值溯源锚点）

## Problem Statement

`components/BookmarkButton.vue` 被 7 处宿主复用（推荐轮播、插画列表、关注、收藏、用户主页、插画详情、小说简介）。原实现把心形直接画在底图上：

1. **底图对比度不可控**：未收藏 = `text-outline` 灰、已收藏 = `text-error` 红，都直接压在作品图上。亮图/暖色图下灰心淡、红心混（用户实测反馈：「图片盛满并且跟收藏颜色接近时，收藏按钮看不清」；图片未铺满时下方过渡偏黑，与红色心形同样低对比）。
2. **加 chip 底色后暴露容器尺寸缺陷**：为配色加 chip 后，chip 被父容器横向撑满成「长条」而非胶囊（用户反馈「会拉的很长」）。两轮误修（加大 `py`/`gap`；加 `inline-flex` 类名 / 在 `<style>` 里声明 `display: inline-flex`）均无效。

## Solution

1. **方案 E「Dark Glass」配色**：chip 用 M3 实色底 + 单色前景，把可读性与底图解耦——未收藏 = `inverse-surface` 深底 + `inverse-on-surface` 心形；已收藏 = `tertiary` 底 + `on-tertiary` 心形 + `tertiary-container` 计数（chip 内部两层层次）。环颜色随 chip 状态 cascade（不做内联 class 绑定，避免开关错位）。
2. **chip 容器 hug content**：`self-start`（= `align-self: flex-start`），使 chip 作为 flex item 不再被父容器横向拉伸。

## Implementation Decisions

### 配色（方案 E「Dark Glass」，实色版）

| 状态 | chip 底 | 心形 | 计数 | 环 |
|---|---|---|---|---|
| 未收藏 | `--md-inverse-surface` | `--md-inverse-on-surface` | `--md-inverse-on-surface` | `--md-inverse-on-surface` |
| 已收藏 | `--md-tertiary` | `--md-on-tertiary` | `--md-tertiary-container` | `--md-on-tertiary` |

- **不采用原型的 rgba + backdrop-filter**：Lynx 原生无 `backdrop-filter`（平台事实，与 `--md-scrim-overlay` 同族结论），半透底会把可读性重新交回底图 —— 与「脱离底图自由度」的目标冲突。取实色底。
- **不再用 error 色表达「已收藏」**：红色的语义是「危险/错误」，与「喜欢」错位（原实现遗留）。
- 深色主题自动反相（`inverse-surface` 派生为浅色、`tertiary` 派生为浅色 accent），chip 主线齿牙始终与背景拉反差，不需要额外反色逻辑。

### chip 尺寸（hug content）

| 事实 | 证据（2026-09-21，web-core / 原生 Lynx 实测） |
|---|---|
| Lynx 的 `view` 默认 `display:flex` / `flex-direction:column` / `align-items:normal`(≈stretch) | web-core computed style：chip 父容器 `mt-5` = `display:flex, flex-direction:column` |
| chip 作为 flex item 被横向 stretch 到父宽 | 修复前 chip 宽 1116px == 父宽 1116px（视口 1280）；用户真机截图同形（横贯整屏的长条） |
| `display: inline-flex` 无法阻止拉伸 | flex item 的 `display` 会被 blockify 成 `flex`（CSS Flexbox §4.1）。实测 computed `display: "flex"`、宽度仍 1116px —— 它**不可能**修好本案（前一轮误修即此坑） |
| `self-start`（`align-self: flex-start`）有效 | 由 `@lynx-js/tailwind-preset` 的 `alignSelf` 核心插件提供，构建产物含 `.self-start { align-self: flex-start }`；实测 150px（1280 视口）/ 93.9px（400 视口）= 内容宽 |
| 不用 `width: fit-content`（`w-fit`） | web-core 有效（150px），但原生 Lynx 对 `fit-content` 取值无实证；`align-self` 在 preset 支持清单内且仓库已有先例（`pages/NovelIntro.vue` AI 徽章用 `self-start` 挡 scrim 内同款拉伸） |

- **宿主正交性**：`align-self` 只在 column flex 父容器里改变横向尺寸；详情页/小说简介是 row flex 宿主（`mt-2 / mt-4 flex flex-row items-center`），**由宿主显式覆盖回居中**（`class="self-center"`，产物中 `.self-center` 位于 `.self-start` 之后，同级后者胜，不靠 `!important`）。同槽位滑动不跳动与 row 宿主居中两项在设备上均已目视（见 `docs/verification/app-lynx-recommended-novel-bookmark-emulator-2026-09-21.md`）。
- **禁止回流**（由 `BookmarkButton.template.test.ts` 反向锁 + oracle 注释）：① `display: inline-flex` 兜底；② 模板里加 `inline-flex` 类名（preset 无此 utility，等于空类）；③ `.bookmark-chip` 规则内任何 `display` 声明。

## Verification（2026-09-21）

| 环境 | 手段 | 结果 |
|---|---|---|
| web-core 400×790（用户视口） | playwright-cli 量指定元素 | 推荐页 chip 93.9px（父 348.8px），`align-self: flex-start` |
| web-core 1280×720 | 修复前后对照 | 1116px（=父宽）→ 150px（=内容宽） |
| web-core 插画详情（row 宿主，**未加 self-center 前**） | 量 chip 与父容器 | 该行 chip 恰为最高元素 → `centerOffset 0` |
| 原生 Lynx（emulator-5554 / `LynxActivity`） | `assembleLynxDebug` → `adb install -r` → 截图 | 推荐页左下为**单颗深色胶囊**；**已收藏态探针**：点 ♥ 后胶囊底色变 tertiary（`#3b6470`）+ 心形转 `on-tertiary` 浅色 → **复合/后代选择器（`.bookmark-chip.is-bookmarked` / `.bookmark-chip .bookmark-ring-*`）在原生 Lynx 确实生效**（否则底色不会变） |
| 原生 Lynx 同次观测 | 点 ♥ 两下 | 计数 115 → 116 → 115（乐观 + 服务端确认 + 还原），页面始终停在推荐（`@tap.stop` 生效） |
| 单测 | `pnpm test:app-lynx` | 全绿（含本轮新增的源级守卫、token 完整性守卫） |

## 残余风险 / 跟进

- **两处设备 oracle 被本次配色改动永久失效（已挂账 issue #709）**：
  1. `scripts/lynx-flow-check.sh:90-149` 用「**红像素增量**」判定收藏生效（新配色不再产生红色）→ 会输出「⚠️ 收藏未生效」假告警（脚本自称回归项、不阻断）。
  2. `packages/app/tests/android-e2e/specs/lynx-bookmark-tags.spec.ts`（设备验收，`#536/#538`）整套驱动基于颜色：`findHeartGlyph`（`:252-315`）找的是**红/暗色小方块**（`w∈[34,60]`、`h∈[38,64]`），新配色下 ♥ 是**深色 chip 胶囊内的浅色字形**→ 部件宽度远超窗口 → 返回 `null`；`heartFilled`（`:317-333`）以红像素占比判「已收藏」→ 新配色下恒 `false`。**修复方向与验收见 #709**（2026-09-21 code-review 查出，此前只登记了第 1 处）。
- **已修复的同类缺陷（token 名）**：环色曾写成 `var(--md-on-inverse-surface)`——该名**全仓未定义**（tokens.css 定义的是 `--md-inverse-on-surface`），无 fallback 的 `var()` 让整条声明静默失效（border-color 退为 currentColor），而单测/类型检查/构建全绿。已修正并新增源级守卫 `tests/mdTokenRefs.test.ts`（src 内每个 `var(--md-*)` 必须命中 tokens.css；抽取器带非空与数量下界断言，防空转恒真）。
- **深色主题未逐 palette 目视**：令牌在 dark 主题下自动反相，逻辑上仍拉反差，但未对每个 dark palette 截图确认。
