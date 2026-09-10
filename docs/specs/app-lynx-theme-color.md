# Spec: app-lynx 选择主题色（M3 动态配色）

- 状态：implemented
- 日期：2026-09-11
- 关联：ADR-0152（决策记录）、`docs/research/pictelio-feature-gap-vs-third-party.md`（「亮暗主题/自定义主色」差距行）、`packages/app-lynx/CONTEXT.md`（新增词条：主题色）、`src/styles/tokens.css`（色板值）、`src/utils/themeColor.ts`（单一事实源）
- 来源：目标「app-lynx，增加一个选择主题色的功能」
- 范围：仅 `packages/app-lynx`；不改 webview（`packages/app`）、不改共享包、不改原生 Java。

## Problem Statement

app-lynx 此前只有一套固定的 M3 亮色板（seed Sky #1a6fa8，写死在 `tokens.css` 的 `page` 选择器）。用户无法更换主题色；竞品（PixShaft 的 Material You+主色、pixiv-viewer 的暗色+主题色、Pix-EzViewer 的 M2/M3 自定义主题）普遍支持自定义主色，这是功能对比矩阵中已登记的差距。

## Solution

在「我的 → 外观」提供主题色选择；选择立即整树生效、跨启动持久化。实现走**静态预生成 M3 色板 + 根类切换**：

- 每个主题对应 `tokens.css` 中一个 `.theme-*` 类（默认 `sky` 与基础 `page` 共用规则），覆盖该 seed 的整组 `--md-*` 颜色角色（primary/secondary/tertiary、surface 中性色、outline、inverse、fixed、state layer）。
- 根 `<page>` 绑定所选色板类（`themeColorClass(settings.themeColor)`）；CSS 变量向下继承，所有既有 Tailwind/M3 令牌引用自动换色，无需改任何页面/组件。
- 默认 `sky` 使用 `.theme-sky` 类——它与基础 `page` 色板共用同一条 CSS 规则（同一份值），页面观感零变化；同时色块预览可显式复用它（否则选中其它主题后默认色块会错误继承当前页面主色）。
- 选择持久化为设备级键 `settings_theme_color`（native → `PictelioPrefs` 共享 SharedPreferences；dev/web-core → IndexedDB），未登录也恢复。

## User Stories

1. As a app-lynx 用户, I want 在「我的」页选择主题色, so that 界面主色符合我的偏好。
2. As a 用户, I want 选择后立即整体换色（含卡片/分段控件/开关/状态层）, so that 不是只有按钮变色。
3. As a 用户, I want 重启应用后仍保留我的选择, so that 不必每次重选。
4. As a 用户, I want 主题色是设备级偏好——登出或未登录重开时仍恢复我的选择, so that 外观偏好不因账号状态丢失。（选择入口在已登录的「我的」页；未登录不提供选择入口，只保证持久化恢复。）
5. As a 用户, I want 默认主题就是原来的天蓝, so that 不选择时观感不变。
6. As a 无障碍用户, I want 每个色块有独立可访问性标注, so that 读屏能区分并选择色板。
7. As a 开发者, I want 可选色板的 id/校验/class 映射有单一事实源（`themeColor.ts`）, so that 持久化校验与根类绑定不会与清单漂移（色板值仍由生成脚本产出到 `tokens.css`；Me 页色块与 a11y label 因无障碍注册表完整性防线而显式列出）。
8. As a 开发者, I want 非法持久化值维持默认并 console.warn, so that 契约破坏可见、不静默降级。

## Implementation Decisions

- **单一事实源**：`src/utils/themeColor.ts` 导出 `THEME_COLOR_IDS` / `ThemeColorId` / `DEFAULT_THEME_COLOR` / `THEME_COLOR_OPTIONS` / `isThemeColorId` / `themeColorClass`。色板值本身在 `tokens.css`（静态、可构建期生成）。
- **色板生成**：M3 `SchemeTonalSpot`（`@material/material-color-utilities`）从 seed 生成；`on*Container` 取 tone 10（对齐基础 `page` 色板的旧 M3 风格）。当前 5 个非默认 seed：violet #6750a4、pink #b3426f、green #2e7d32、orange #b26a00、teal #00696d。注意：列出的 hex 是 **seed 输入**，生成后的 `--md-primary` 是派生的 tone-40 色（如 violet seed #6750a4 → `--md-primary` #65558f），两者不等属正常 M3 行为。
- **应用方式**：根 `<page>` 类绑定（`themeColorClass(settings.themeColor)`）；默认 sky 返回 `theme-sky`（与基础 `page` 同规则，观感不变）。**不做**运行时颜色计算或动态写 CSS 变量（Lynx 动态样式支持面窄）。
- **持久化**：`settingsStore` 复用既有 `PrefsStorage` seam（`prefs()`），键 `settings_theme_color`；`loadSettings` 中先于 uid 判定读取（设备级）；非法值 `console.warn` 后维持默认；写入失败 `console.warn`。
- **UI**：Me 页新增「外观」卡片，6 个色块；色块本身加对应 `.theme-*` 类 + `bg-primary` 预览该色板主色；选中态 `border-primary` + ✓。每个色块在 `ME_A11Y_LABELS` 注册独立标注（`themeColorSky/Violet/Pink/Green/Orange/Teal`）。
- **不做**：暗色主题（本次只做「主题色/主色」，非亮暗模式）；账号级同步；运行时 Material You 取色。

## Acceptance

- `pnpm check:app-lynx`、`pnpm test:app-lynx`、`pnpm build:app-lynx` 通过。
- `themeColor` 契约测试：从基础 `page` 提取「可主题角色集」，断言每个色板类（含 `.theme-sky`）覆盖同一整套角色（防只覆盖 primary 造成串色）；`themeColorClass` 纯函数映射与清单一致；App.vue 接线到根 `<page>`；Me.vue 提供全部色板入口且 class 走 `themeColorClass`（防 class 双写漂移）。
- store 测试：默认 sky；setter 经 prefs seam 持久化；未登录也能恢复；非法值 warn + 维持默认；读取/写入 IO 失败均 warn 且维持可用状态（硬约束 #1/#3）；native 模式经 `PictelioPrefs` 写入。
- 色板值为生成脚本产物（M3 TonalSpot）；本次未把生成脚本入库，契约测试以「结构完整（全角色覆盖）」为防线；整树换色的渲染行为仍以真机/预览为准（node 环境无法断言渲染，见既有 a11y 测试注释）。
- 每条 a11y 注册表项都被 Me.vue 消费且配套 `accessibility-element`（既有完整性测试）。

## Out of Scope

- 暗色 / 亮暗跟随（app-lynx 当前仍为单亮色板）。
- 从用户图片运行时提取 seed（Material You）。
- webview 客户端同步主题色。
