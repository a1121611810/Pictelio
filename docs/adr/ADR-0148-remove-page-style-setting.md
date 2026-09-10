# ADR-0148: 移除「页面风格」设置并固定为 Fluent（Remove Page Style Setting）

- 状态：accepted
- 日期：2026-09-10
- 关联：ADR-0069（`--pageCard*` 挂账来源）、ADR-0029（themeStore 主题归属）、ADR-0097（机器防线治理）、`docs/specs/remove-page-style-setting.md`

## 背景

`/settings` 的「主题与风格」区块长期提供两个**相互独立**的维度：

- **页面风格**：`fluent`（默认） / `card`，键 `page_style_theme`，以 `<html class="page-card">` 落地一组令牌覆盖（配色、圆角、品牌色、阴影、状态色，并在 `base.css` 里把 `surface-appbar` 从毛玻璃改为实心）。
- **明暗主题**：`light` / `system` / `dark`，键 `theme`，以 `<html class="dark">` 落地。

页面风格带来的维护面远大于其价值：

1. **视觉双轨**：`card` 覆盖面横跨配色、圆角、品牌色、阴影与顶栏形态，两套观感都要回归验证。
2. **令牌挂账**：ADR-0069 已完成 `/me` 的 A2 迁移，`--pageCard*` 令牌族成为遗留物（原文「令牌本身暂保留，待全局无引用后清理」）；`docs/adr/glossary-ui-cards.md` 亦将「页卡令牌」列为应弃用术语。
3. **与 Fluent 2 基线相悖**：项目强制遵循 Fluent Design System 2，`card` 是自定义变体而非规范档位。
4. **用户价值有限**：该开关对绝大多数用户无用。

## 决策

- **移除页面风格维度，固定为 `fluent`**（原默认值）。
- 删除 `stores/themeStore.ts` 中 `page_style_theme` 的 registry 定义，以及 `PageStyleThemeId` / `PAGE_STYLE_THEME_IDS` / `pageStyleTheme` / `setPageStyleTheme`。
- 删除 `utils/themeApplier.ts` 的 `applyPageStyleClass`；保留 `applyDarkClass`。
- 删除 `styles/tokens.css` 的 `html.page-card` / `html.page-card.dark` 覆盖块，以及 `styles/base.css` 的 `html.page-card .surface-appbar` 覆盖。
- **一次性清算 `--pageCard*` 令牌族**（兑现 ADR-0069 挂账）：`.surface-card` 及 `FollowListPage` / `UserIllusts` 的引用内联为**当前有效渲染值**——`--colorNeutralBackground1`、`--borderRadiusXLarge`（8px）、`--elevation4`、`--colorNeutralForeground1` / `--colorNeutralForeground3`；6 个零消费者令牌（`Bg` / `Border` / `SearchBg` / `SearchText` / `Gap` / `Padding`）直接删除。
- `ThemeSelector` 只保留明暗主题；设置页标题改为「明暗主题」。
- `docs/adr/glossary-ui-cards.md` 删除「页卡令牌」行；`docs/storage-architecture-proposal.md` 相关处标注废弃。
- **机器防线（锚 ADR-0097）**：接口删除由 `pnpm check`（tsc strict）兜底；CSS 自定义属性与运行时 class 无类型可依，故新增 `tests/unit/styles/pageStyleRemoval.test.ts` 静态断言 `src` + `uno.config.ts` + `index.html` 零 `--pageCard*` / `page-card` / `page_style_theme` / `pageStyle*` 引用，并在 `tests/unit/components/ThemeSelector.test.tsx` 断言「页面风格选择」组不存在。

### 明确不做

- **不做存储键主动清理 / 迁移，不加过渡提示**：存量 `page_style_theme` 孤儿键原样留存（不读、不写、不校验，无害）。
- **不把 `.surface-card` 对齐 A2 规范值**：本次是纯删除类重构，`fluent` 最终渲染结果与改动前一致，避免夹带视觉变化。
- 不改 `app-lynx`（无页面风格概念）、次级 Feed 布局模式设置，以及 `surface-appbar` 的毛玻璃 shortcut 本身。

## 后果

- **正面**：视觉单轨，回归面减半；`--pageCard*` 遗留令牌清零；与强制 Fluent 2 基线一致。
- **负面（行为变化）**：曾选择「卡片式」的用户下次启动会经历**一次静默的配色切换**（冷白大圆角 + 实心顶栏 → 暖纸色 `fluent`）。判定可接受，不做提示。
- **无关项**：`<html class="dark">` 与明暗主题全流程不变。

## 关联

- `docs/adr/ADR-0069-cardized-settings-and-personal-center.md`（`--pageCard*` 挂账来源）
- `docs/adr/glossary-ui-cards.md`（「页卡令牌」术语）
- `docs/adr/ADR-0029-eliminate-store-circular-ref.md`（themeStore 主题归属）
- spec：`docs/specs/remove-page-style-setting.md`
