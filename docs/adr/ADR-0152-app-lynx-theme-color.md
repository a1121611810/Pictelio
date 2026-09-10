# ADR-0152: app-lynx 选择主题色（静态 M3 色板 + 根类切换）

- 状态：accepted
- 日期：2026-09-11
- 关联：ADR-0139（Pinia setup store——本决策沿用 settingsStore 模式）、ADR-0103（`PrefsStorage` seam）、`docs/specs/app-lynx-theme-color.md`、`packages/app-lynx/CONTEXT.md`（新增词条：主题色）、`docs/research/pictelio-feature-gap-vs-third-party.md`
- 来源：目标「app-lynx，增加一个选择主题色的功能」

## 背景

app-lynx 的 M3 色板是单套固定值：`src/styles/tokens.css` 的 `page` 选择器写死 seed Sky #1a6fa8 的一整组 `--md-*` 颜色角色。所有页面/组件通过 Tailwind M3 语义类（`bg-primary` / `text-surface-on` …）消费这些变量，因此「换主题色」在数据流上是「换一组 CSS 变量」。

功能差距调研（对比第三方 Pixiv 客户端）把「自定义主色」登记为差距；目标要求补齐。

## 决策

1. **静态预生成色板，而非运行时算色**：每个非默认主题在 `tokens.css` 生成一个 `.theme-*` 类，覆盖从该 seed 经 M3 `SchemeTonalSpot` 导出的整组颜色角色（含 surface 中性色、outline、inverse、fixed、state layer）。`on*Container` 取 tone 10，与基础 `page` 色板既有风格一致。
2. **根 `<page>` 类切换**：`App.vue` 绑定 `themeColorClass(settings.themeColor)`；CSS 变量沿渲染树继承，所有既有令牌引用自动换色，零页面改动。
3. **默认 `sky` 复用 `.theme-sky`**：`.theme-sky` 与基础 `page` 色板共用同一条 CSS 规则（选择器列表），默认视觉零回归；显式类同时让色块预览可复用它（否则选中其它主题后默认色块会继承页面主色而漂移）。
4. **设备级持久化**：settingsStore 复用 `PrefsStorage` seam（native `PictelioPrefs` / dev IndexedDB），键 `settings_theme_color`；`loadSettings` 先于 uid 判定读取（未登录也恢复）；非法值 `console.warn` + 维持默认。
5. **单一事实源**：`src/utils/themeColor.ts` 维护可选 id / class 映射 / 校验；色板值与类名由该清单经一次性生成脚本产出到 `tokens.css`。

## 被考虑的方案

- **运行时 `@material/material-color-utilities` 算色 + 动态写 CSS 变量**：需把颜色库打进 Lynx bundle；更关键的是 Lynx 的动态样式/CSS 变量写入支持面窄（`setStyleProperty` 属 MTS 且行为未实证），双端不可靠；否决。
- **内联 style 写 `--md-*`**：同样是动态 CSS 变量，Lynx 支持不确定；否决。
- **只覆盖 `--md-primary` / brand 令牌**：secondary-container（分段控件/标签）、surface 中性色、outline、state layer 不同步会「串色」，观感廉价；否决。
- **账号级键（`settings_theme_color_\${uid}`）**：外观是设备级偏好，登出不应重置，且未登录也应可选；否决。
- **暗色/亮暗跟随一并做**：超出「选择主题色」范围，且需要第二套完整色板 + 系统监听，另行立项；否决。

## 后果

**正面**：一次接线覆盖全部页面/组件；双端（web-core 预览 + 原生 LynxView）行为一致且可离线；色板为构建期静态值，零运行时开销；id/校验/class 映射单一事实源，根类绑定与持久化校验不会与清单漂移。
**负面 / 代价**：`tokens.css` 体积随色板数线性增长（每色板约 50 行声明）；颜色变更需重新生成（非用户可自定义任意色）。
