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

- **设备 oracle 与配色耦合（issue #709；2026-10-17 复核订正，见下）**：
  1. `scripts/lynx-flow-check.sh` 用「**红像素增量**」判定收藏生效，新配色不再产生红色 → 会输出「⚠️ 收藏未生效」假告警。**2026-10-17 复核：仍然成立**（脚本自 8-07 未改动），且心形定位与收藏确认是**双双重判据**，两者在当前配色下均失效；定位器还可能命中推荐内容的红色插画，导致点错位置后再报「未生效」。
  2. `packages/android-host/tests/android-e2e/specs/lynx-bookmark-tags.spec.ts`（设备验收，`#536/#538`）——**本条已于 2026-10-17 订正，原描述作废**：原文记「`findHeartGlyph` 找红/暗色小方块、新配色下返回 `null`；`heartFilled` 以红像素占比判、恒 `false`」。这两个函数已随 commit `dacc9023`（**2026-09-29**，晚于本条登记日 8 天）重写为两段式心形定位 + **青色判据**（绿红差与蓝红差同时为正、绿通道低于上限），原文所述判据在当前代码里**已不存在**。
     ⇒ 但**残余风险换了一种形态且并未解除**：青色判据只在 **7 主题 × 明暗 = 14 组合中的 3 个**成立（sky/light、green/light、bili/light）。**7 个暗色板全部失效**，亮色板的 violet / pink / orange / teal 亦失效（红通道大于绿通道）。当前设备验收所用的主题恰好落在成立的组合内 ⇒ **换色板即再次假阴性，且在现有 e2e 里完全看不出来**。

> **2026-10-17 修复收口（#709 实施期结论）**：上面两条残余风险**均已解除**，且**未做真机/模拟器实跑**（需编 APK，被本轮铁律挡住）——以下结论全部建立在「源码契约 + 对 `tokens.css` 的确定性枚举 + 合成帧」上，不依赖实跑。
>
> 1. **`lynx-screen-analyze.py` 新增 `bookmark-chip` 子命令**（新增 `read_chip_tokens` / `bookmark_chip`），`packages/app-lynx/scripts/lynx-flow-check.sh` §2 改用它：定位与确认都读**胶囊底色对应的 M3 令牌**（运行时解析 `packages/app-lynx/src/styles/tokens.css`，脚本内不硬编码任何色值），不再有「红像素 + 白色邻域」定位，也不再有「红像素增量」确认。判不出时输出「本轮未验证」并给原因，**不再输出确定性的「⚠️ 收藏未生效」**；末尾汇总行也不再把收藏步并列进「全部通过」。`SETTINGS_ONLY` 旁路保留（并修掉一处会让它因 `set -u` 直接 exit 的新接线问题：`FAV_*` 三个变量必须声明在守卫之外）。
> 2. **新增 `packages/android-host/tests/android-e2e/bookmark-chip.ts`**（令牌表解析 + 分类 + 采样），`lynx-bookmark-tags.spec.ts` 的 `heartFilled` 改为 `heartBookmarkState`：采样窗（±19×±22、步长 4 = 120 点）与占比阈值 **0.15 逐字沿用旧实现**，所以本 spec §Verification 记的 2026-09-29 设备实测（已收藏 37/120 = 0.308 / 未收藏 0/120 / 空白对照 0/120）**仍然成立**——改动只换「怎么分类」，不换「在哪采样」。
> 3. **新证据（表驱动，14 组合逐个代入算术，非抽样）**：对 `tokens.css` 全部 14 个 `--md-tertiary` 逐个代入旧青度判据，成立的恰好 **3 个**（sky / green / bili 的**亮色板**），失效 **11 个**（7 个暗色板全部失效 + violet / pink / orange / teal 亮色板）——与 triage 的证明式枚举**结论一致**。跨状态最近色对距离实测 **50**（`.theme-sky.dark` 的 tertiary ↔ 同主题 inverse-surface），容差取 **24** ⇒ 两族可分且留 2 倍余量；判不出（`unknown`）时**绝不静默返回「未收藏」**。
> 4. **新增两道随 CI 跑的门禁**（设备级脚本此前零自动化防线，这正是它长期失效而不被发现的原因）：`unit/bookmarkChip.test.ts`（14 组合表驱动 + 旧判据失效面演示 + 令牌表由 `tokens.css` 运行时解析）与 `unit/flowCheckBookmarkOracle.test.ts`（合成 PNG 驱动 python 子命令 + flow-check 脚本的旁路/措辞契约）。
> 5. **仍未解除的一项**：**没有真机实跑证据**。上述改动只经过源码契约、令牌枚举与合成帧三层；**首次设备跑必须复核**：① `lynx-bookmark-tags.spec.ts` 在 **14 个组合里至少各跑一次**（尤其 7 个暗色板 —— 暗色板下 chip 是**浅色**胶囊，`findHeartGlyph` 的「深色胶囊」两段式定位同样是按亮色板校准的，本轮**按票面范围未改动**，它若在暗色板失效应另开票）；② `lynx-flow-check.sh` 的 chip 定位容差与占比下限（本轮沿用 `bookmark-chip.ts` 同族的 24 / 0.15，**同样只经合成帧验证**）。
>
> 上面第 5 条与本节上一条「深色主题未逐 palette 目视」是**同一个盲区**：记的是「没在设备上看过」。本轮把判据的**逻辑**补齐了，但没有补上**目视**。
- **已修复的同类缺陷（token 名）**：环色曾写成 `var(--md-on-inverse-surface)`——该名**全仓未定义**（tokens.css 定义的是 `--md-inverse-on-surface`），无 fallback 的 `var()` 让整条声明静默失效（border-color 退为 currentColor），而单测/类型检查/构建全绿。已修正并新增源级守卫 `tests/mdTokenRefs.test.ts`（src 内每个 `var(--md-*)` 必须命中 tokens.css；抽取器带非空与数量下界断言，防空转恒真）。
- **深色主题未逐 palette 目视**：令牌在 dark 主题下自动反相，逻辑上仍拉反差，但未对每个 dark palette 截图确认。⚠️ **与上一条的暗色板失效是同一个盲区**：这条记的是「没看过」，上一条记的是「看了也会判错」。

> **2026-10-17 订正说明**：本节原记「两处设备 oracle **永久失效**」，其中第 2 处已于 8 天后被修复（原文未跟踪），第 1 处仍然成立。同时原文引用的 `packages/app/tests/...` 路径随 ADR-0203 整包删除已无载体，真实位置在 `packages/android-host/tests/android-e2e/specs/`。行号锚已按本轮锚点政策移除——本仓并行改文档下行号必然漂移，改引小节与文件名。订正依据：#709 的 triage 验证（源码契约 + 令牌枚举证明式代入，未做设备实跑）。
