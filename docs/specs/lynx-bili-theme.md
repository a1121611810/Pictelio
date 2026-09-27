# Spec：app-lynx bili 主题（第 7 支主题色，bilibili 品牌色 L2 手工映射）

> 状态：ready-for-agent
> 日期：2026-09-27
> ADR：[ADR-0198](../adr/ADR-0198-app-lynx-bili-theme.md)（档位/primary/暗色管道/范围拍板）
> 术语：[glossary-lynx-bili-theme.md](../adr/glossary-lynx-bili-theme.md)
> 输入：`docs/research/bilibili-theme-feasibility-app-lynx-2026-09.md` + `bilibili-theme-tokens-full-2026-09.md`（bili-theme v12 官方令牌一手数据）

## Problem Statement

app-lynx 目前提供 6 支主题色（sky/violet/pink/green/orange/teal），全部由 M3 TonalSpot 从锚点生成，用户无法选择 bilibili 风格的配色；作为 Pixiv 第三方客户端， bilibili 配色是用户呼声明确的熟悉视觉语言。

## Solution

在设置页「外观」组新增第 7 支主题色「哔哩粉」（id `bili`）。色板取 bilibili 官方 v12 主题包真实色值，逐角色手工映射到既有 48 个 M3 亮色角色；暗色板沿用既有「锚点 → 生成脚本」管道自动派生。点击色块即时切换，与三态暗色模式正交组合（共 21 种组合），持久化行为与既有 6 支完全一致。

## User Stories

1. As a app-lynx user, I want a「哔哩粉」theme option in 设置 → 外观, so that I can give the app a bilibili-style look.
2. As a app-lynx user, I want tapping the bili swatch to recolor the whole app immediately, so that I can preview the theme without leaving the settings page.
3. As a app-lynx user, I want my theme choice persisted across app restarts, so that I don't re-select it every launch.
4. As a app-lynx user, I want the bili swatch to render in my current dark/light mode (WYSIWYG), so that the preview matches what I'll see.
5. As a app-lynx user in dark mode, I want the bili theme to have a generated dark palette consistent with the other 6 themes' dark look, so that dark mode stays visually coherent.
6. As a app-lynx user, I want the bili theme's primary color to keep white button text readable (≥ 4.5:1), so that buttons/links stay accessible.
7. As a screen-reader user, I want the bili swatch to expose an accessibility label（「主题色哔哩粉」）, so that I can identify it without seeing color.
8. As a Chinese-locale user, I want the swatch labeled「哔哩粉」, so that I recognize the theme by its familiar name.
9. As an English-locale user, I want the swatch labeled "Bilibili Pink", so that I understand the theme's identity.
10. As a app-lynx user, I want an accurate hint text for the theme picker（「选择主题色」）, so that I'm not misled by a claim that all palettes are Material Design 3 generated.
11. As a developer, I want the palette generator's theme list and tokens.css kept in lockstep by the drift test, so that adding/updating a theme can't half-land.
12. As a developer, I want the role-set invariant test to cover the bili palette automatically, so that a partial palette (e.g. missing outline) fails CI.
13. As a developer, I want the WCAG contrast assertions to cover the bili palette, so that inaccessible color choices fail CI.
14. As a QA engineer, I want the theme selectable on the emulator with visible before/after screenshots, so that the visual result is verified beyond unit seams.

## Implementation Decisions

（完整 rationale 见 ADR-0198；此处只列实现口径。）

1. **档位 L2**：bilibili 真实色值手工映射亮色 48 角色；暗色 65 角色由生成脚本从锚点派生，不手调。
2. **锚点**：`lightPrimaryAnchor: '#d03171'`（Pi7）——同时是亮色 `--md-primary` 与暗色 SchemeTonalSpot seed。
3. **机制零改动**：根 `<page>` 类切换、零运行时算色、Tailwind `colors → var(--md-*)`、Java 原生、settingsStore 校验均不动。
4. **接线清单**：生成脚本 `THEMES[]` +1；tokens.css 新增 `.theme-bili`（亮色 48 条，手写、置于既有 5 个亮色覆盖块之后、自动生成段之前）+ `.theme-bili.dark`（脚本生成）；`THEME_COLOR_OPTIONS` +1（顺序：teal 之后追加 bili）；Me.vue +1 色块（同构手写模板）；i18n `me.appearance.colorBili` zh/en +1、hint 文案改中性；a11y labels +1。
5. **bili 亮色板 48 角色映射表**（value ← bilibili 原语，出处列引用 v12 官方令牌名）：

   | M3 角色 | 值 | bilibili 出处 |
   |---|---|---|
   | `--md-primary` | `#d03171` | Pi7（粉阶梯过 4.5:1 的品牌档） |
   | `--md-on-primary` | `#ffffff` | Wh0 / `text_white` |
   | `--md-primary-container` | `#ffecf1` | Pi1（`brand_pink_thin`） |
   | `--md-on-primary-container` | `#3f0723` | Pi10 |
   | `--md-secondary` | `#4d5d7c` | Si8（蓝灰族 muted） |
   | `--md-on-secondary` | `#ffffff` | `text_white` |
   | `--md-secondary-container` | `#f5f7fa` | Si1 |
   | `--md-on-secondary-container` | `#191e2b` | Si10 |
   | `--md-tertiary` | `#00699d` | Lb7（`text_link`，品牌蓝 DNA） |
   | `--md-on-tertiary` | `#ffffff` | `text_white` |
   | `--md-tertiary-container` | `#dff6fd` | Lb1（`brand_blue_thin`） |
   | `--md-on-tertiary-container` | `#001627` | Lb10 |
   | `--md-surface` | `#ffffff` | Wh0（`bg1`，bilibili 页面即纯白） |
   | `--md-on-surface` | `#18191c` | Ga10（`text1`） |
   | `--md-surface-variant` | `#f1f2f3` | Ga1（`bg3`） |
   | `--md-on-surface-variant` | `#61666d` | Ga7（`text2`/`graph_icon`） |
   | `--md-outline` | `#797f87` | Ga6（对比 4.0:1；Ga5 `#9499a0` 2.87:1 不达标故弃用） |
   | `--md-outline-variant` | `#e3e5e7` | Ga2（`line_regular`） |
   | `--md-surface-container-lowest` | `#ffffff` | Wh0 |
   | `--md-surface-container-low` | `#f6f7f8` | Ga0 |
   | `--md-surface-container` | `#f1f2f3` | Ga1 |
   | `--md-surface-container-high` | `#e3e5e7` | Ga2 |
   | `--md-surface-container-highest` | `#d6d9dc` | Ga2/Ga3 中点内插（Ga3 `#c9ccd0` 对输入框/开关轨道过深） |
   | `--md-inverse-surface` | `#2f3238` | Ga9 |
   | `--md-inverse-on-surface` | `#f1f2f3` | Ga1 |
   | `--md-inverse-primary` | `#ff6699` | Pi5（**品牌粉本体**，暗底反色面亮品牌粉；对 inverse-surface 4.65:1） |
   | `--md-surface-dim` | `#e3e5e7` | Ga2 |
   | `--md-surface-bright` | `#ffffff` | Wh0 |
   | `--md-primary-fixed` | `#ffecf1` | Pi1 |
   | `--md-on-primary-fixed` | `#3f0723` | Pi10 |
   | `--md-primary-fixed-dim` | `#ffb3ca` | Pi3 |
   | `--md-on-primary-fixed-variant` | `#771141` | Pi9 |
   | `--md-secondary-fixed` | `#f5f7fa` | Si1 |
   | `--md-on-secondary-fixed` | `#191e2b` | Si10 |
   | `--md-secondary-fixed-dim` | `#c3d0df` | Si4 |
   | `--md-on-secondary-fixed-variant` | `#323d54` | Si9 |
   | `--md-tertiary-fixed` | `#dff6fd` | Lb1 |
   | `--md-on-tertiary-fixed` | `#001627` | Lb10 |
   | `--md-tertiary-fixed-dim` | `#80daf6` | Lb3 |
   | `--md-on-tertiary-fixed-variant` | `#004b76` | Lb8 |
   | `--md-surface-tint` | `#d03171` | = primary（既有模式） |
   | `--md-state-pressed-primary` | `#b72b63` | primary × 0.88（12% 黑混合，既有公式） |
   | `--md-state-pressed-on-surface` | `#d03171` | = primary（既有模式） |
   | `--md-state-pressed-surface` | `#e3e5e7` | = container-high（既有模式） |
   | `--md-state-layer-pressed-primary` | `rgba(208, 49, 113, 0.12)` | primary 12% alpha（既有公式） |
   | `--md-state-layer-pressed-on-surface` | `rgba(24, 25, 28, 0.12)` | on-surface 12% alpha |
   | `--md-state-disabled-container` | `rgba(24, 25, 28, 0.12)` | on-surface 12% alpha |
   | `--md-state-disabled-on-surface` | `rgba(24, 25, 28, 0.38)` | on-surface 38% alpha |

6. **对比度已验算**（白底）：primary 4.81 / secondary 6.59 / tertiary 5.99 / on-surface-variant 5.79 / outline 4.04 —— 全部 ≥ 4.5:1（outline 按 UI 组件 ≥ 3:1 口径亦达标）。
7. **测试计数**：`palettes-drift.test.ts` `EXPECTED_THEME_COUNT` 6→7；`appearanceClasses.test.ts` 主题清单计数断言 6→7（及注释同步）。

## Testing Decisions

全部复用**既有 seam**，零新增 seam：

1. **漂移锁**（`palettes-drift.test.ts`，既有）：(a) tokens.css 自动生成段 ≡ 脚本 `--stdout`；(b) 脚本锚点 ≡ 亮色 `--md-primary`。扩到 7 支后，忘改任一侧直接红。
2. **角色集不变量**（`unit.test.ts` 主题色契约，既有）：`for (const option of THEME_COLOR_OPTIONS)` 逐主题断言 48 角色全覆盖——bili 自动进循环，缺角色即红。
3. **暗色块存在性 + WCAG 对比度**（`appearanceClasses.test.ts`）：逐主题断言 `.theme-X.dark` 存在；on-角色对底色 ≥ 4.5:1 的绝对比值断言**由本 effort 按 ADR-0198 D7 新增**（此前仅有相对序 luma 断言）——亮/暗双循环，bili 自动覆盖；计数断言 6→7。
4. **themeColor 纯函数**（既有）：`themeColorClass`/`isThemeColorId` 对新 id 的行为由清单驱动自动覆盖；未知 id 回退 + warn 路径保持既有断言。
5. **模拟器验收**（人工 seam）：设置页切换 bili → 截图取证（亮/暗两态 + 至少一个内容页），对照映射表主色目视核验；7 色块行换行行为确认。

好测试标准：只断言外部可见行为（类名输出、tokens.css 内容、对比度数值），不断言内部实现；oracle 取自真实源文件（tokens.css / 脚本源码），禁手写自洽值。

## Out of Scope

- webview 端（`packages/app`）的任何主题改动（用户明示；Fluent 2 无 accent 主题概念）。
- Me.vue 色块 v-for 收敛重构（「实施范围不扩散」；挂账给未来重构票）。
- 暗色板手调 bili 暗值（ADR-0198 D3 否决）。
- bilibili 字体/圆角/动效体系的引入（那是一次换设计体系的独立工程）。
- `ErrorPagePreview.vue`（errorPrototype）的 6 处硬编码 hex 处理。

## Further Notes

- bilibili 站内 7 套设计血脉、`--bili-*` 前缀不存在等一手事实 → 别名约束见术语表「Flagged ambiguities」。
- 7 色块同行布局（`justify-between`）在窄屏的换行行为待模拟器确认；若挤压，属实现阶段修复项。
- 漂移锁对脚本 header 注释「覆盖 6 主题暗色版」等文案数字不敏感（只锁锚点与输出），但注释准确性顺手同步。
