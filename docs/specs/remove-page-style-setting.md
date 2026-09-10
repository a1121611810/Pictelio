# 移除「页面风格」设置并固定为 Fluent —— 功能规格

> 来源：grill-with-docs 会话（Q1–Q10 全部确认）
> 状态：ready-for-implement（tickets 见 `docs/specs/remove-page-style-setting-tickets.md`）
> 日期：2026-09-10
> 关联：ADR-0148（新增）、ADR-0069（`--pageCard*` 清理挂账）、ADR-0029（themeStore 主题归属）

## 1. 背景与目标

`/settings` 的「主题与风格」区块提供两个**相互独立**的维度：

- **页面风格**：`fluent`（默认） / `card`，键 `page_style_theme`，以 `<html class="page-card">` 落地一组令牌覆盖（配色 / 圆角 / 品牌色 / 顶栏实心化）。
- **明暗主题**：`light` / `system` / `dark`，键 `theme`，以 `<html class="dark">` 落地。

目标：**移除页面风格维度，固定为 `fluent`**，并一次性清算 `--pageCard*` 令牌族（ADR-0069 挂账的遗留物）。明暗主题保留。

硬约束：**纯删除类重构，`fluent` 的最终渲染结果与改动前一致**——不得夹带 A2 对齐、圆角/阴影调整等任何视觉变更。

两种风格现状差异（供存档）：

| 维度 | `fluent`（保留） | `card`（删除） |
|---|---|---|
| 落地方式 | 不加类，走 `:root` 基础令牌 | `<html class="page-card">` |
| 浅色表面 | `#fefcf8` / `#f7f4ee`（暖纸色） | `#ffffff` / `#f5f6f8`（冷中性） |
| 品牌色 | `#2b579a` | `#4a7db5` |
| 圆角 | Medium 4 / Large 6 / XLarge 8 | Medium 12 / Large 16 |
| 顶栏 `surface-appbar` | 半透明毛玻璃（UnoCSS shortcut） | 实心 `--colorNeutralBackground1` + 底边框 |

## 2. 非目标（Out of Scope）

- 不改 `app-lynx`（其无页面风格概念）。
- 不改次级 Feed 的布局模式设置（瀑布流/单列/网格，另一套体系）。
- 不改 `surface-appbar` 的 `fluent` 毛玻璃 shortcut 本身，只删 `page-card` 覆盖。
- 不做存储键主动清理 / 迁移，不加过渡提示（孤儿键原样留存）。
- 不把 `.surface-card` 对齐到 A2 规范值（圆角/阴影/边框严格保持现状）。
- 不改 `openwiki/`（生成物）、`ADR-0069`、`docs/design-variants/ports-adapters-interface.md`（历史文档）。
- 不误伤语义无关的「风格」表述（`ImageCacheSettings.tsx` 注释、`LoadingSpinner.tsx` 注释）。
- 不新增「`page-card` 永不被应用」式回归测试（测一个已不存在的概念属迎合式测试）。

## 3. 设计

### 3.1 固定样式契约（视觉不变量）

- `<html>` 只可能带 `.dark`，**永不**出现 `page-card`。
- `:root` / `:root.dark` 的 Fluent 令牌取值原样保留。
- `.surface-card`：`--colorNeutralBackground1` + `--borderRadiusXLarge`（8px）+ `--elevation4`，无边框。
- `surface-appbar`：UnoCSS 毛玻璃 shortcut（`--colorNeutralBackgroundAlpha` + blur 30px + saturate 125% + 底边框）。
- 文本令牌：`--colorNeutralForeground1` / `--colorNeutralForeground3`。

### 3.2 状态层（`stores/themeStore.ts`）

删除：`PageStyleThemeId`、`PAGE_STYLE_THEME_IDS`、`pageStyleHandle`（`settings.define` 块，含 `apply: applyPageStyleClass`）、`pageStyleTheme()`、`setPageStyleTheme()`，以及 `applyPageStyleClass` 的 import。

`settings.define` 不再注册 `page_style_theme`。`theme` 相关（`themeHandle` / `currentResolved` / `getTheme` / `getResolvedTheme` / `setTheme` / `setThemePersisted` / matchMedia 监听）**零改动**。

### 3.3 工具层（`utils/themeApplier.ts`）

删除 `applyPageStyleClass` 与 `PageStyleThemeId` 类型 import；保留 `applyDarkClass`（含 `typeof document === "undefined"` SSR 守卫）。文件头注释改为只描述 `<html>` 的 `.dark` 类。

### 3.4 设置 UI

- `components/ThemeSelector.tsx`：删除 `PAGE_STYLE_OPTIONS` 常量、页面风格小节（含 `role="group" aria-label="页面风格选择"`）及 `pageStyleTheme` / `setPageStyleTheme` / `PageStyleThemeId` import；只保留明暗主题 3 按钮网格，并**去掉内部「明暗主题」小标题**（标题上提到外层）。组件名与文件名不变。
- `components/settings/SettingsAppearance.tsx`：外层标题「主题与风格」→「明暗主题」；删除说明句「卡片风格提供更大的圆角和白色卡片容器；明暗主题在所有风格下均可用」；注释「主题与风格选择器」→「明暗主题选择器」。

### 3.5 样式层（纯重构映射，严格保持有效渲染值）

| 位置 | 现状 | 改后 |
|---|---|---|
| `tokens.css :root` | 9 个 `--pageCard*` 定义 + 注释头 | 全部删除 |
| `tokens.css html.page-card {…}` | 令牌覆盖块（287–390） | 删除 |
| `tokens.css html.page-card.dark {…}` | 暗色覆盖块（393–481） | 删除 |
| `base.css .surface-card` background | `var(--pageCardSurface, var(--colorNeutralBackground1))` | `var(--colorNeutralBackground1)` |
| `base.css .surface-card` border-radius | `var(--pageCardRadius, var(--borderRadiusLarge))` | `var(--borderRadiusXLarge)` |
| `base.css .surface-card` box-shadow | `var(--pageCardShadow, var(--elevation2))` | `var(--elevation4)` |
| `base.css html.page-card .surface-appbar {…}` | 实心顶栏覆盖（298–302） | 删除 |
| `uno.config.ts` `surface-card` shortcut | `shadow-[var(--pageCardShadow,var(--elevation2))]` | `shadow-[var(--elevation4)]` |
| `FollowListPage.tsx` ×3 | `var(--pageCardTextPrimary/Secondary)` | `var(--colorNeutralForeground1/3)` |
| `UserIllusts.tsx` ×1 | `var(--pageCardTextPrimary)` | `var(--colorNeutralForeground1)` |

取值依据：`:root` 中 `--pageCardSurface → --colorNeutralBackground1`、`--pageCardRadius → --borderRadiusXLarge`、`--pageCardShadow → --elevation4`、`--pageCardTextPrimary/Secondary → --colorNeutralForeground1/3`（`:root.dark` 未重定义 `--pageCard*`，但重定义了被引用的 `--colorNeutral*` / `--elevation4`，故内联后暗色行为不变）。

死令牌（零消费者，直接删）：`--pageCardBg`、`--pageCardBorder`、`--pageCardSearchBg`、`--pageCardSearchText`、`--pageCardGap`、`--pageCardPadding`。

### 3.6 注释清理

`main.tsx:41`、`startup.ts:4`、`settings/backends/mirrored.ts:4`、`base.css` `.surface-card` 上方注释、`tokens.css` 删除块的注释头——去掉 `page_style_theme` / `page-card` / 页面风格表述。

### 3.7 文档

- 新增 `docs/adr/ADR-0148-*.md`：记录移除开关 / 固定 `fluent` / 老用户一次静默视觉迁移 / 孤儿键不处理 / 兑现 ADR-0069 的 `pageCard` 挂账 / Q6「严格保持渲染值」决策。
- `glossary-ui-cards.md`：删除「页卡令牌（pageCard token）」行（术语已从模型消失，历史由 ADR-0148 承载）。
- `docs/storage-architecture-proposal.md`：把 `page_style_theme` 当示例的相关段落加「（`page_style_theme` 已废弃，见 ADR-0148）」，不重写历史。

## 4. 数据流与状态变化

改动前（启动）：

```
main.tsx bootstrap
  → initializeStartupPreferences()
  → settings.syncInitAll()          // 同步应用 theme + page_style_theme
      → theme.apply(t)              → applyDarkClass(resolved === "dark")
      → pageStyle.apply(id)         → applyPageStyleClass(id) → <html> 加/删 .page-card
```

改动后（启动）：

```
main.tsx bootstrap
  → initializeStartupPreferences()
  → settings.syncInitAll()          // 只应用 theme
      → theme.apply(t)              → applyDarkClass(resolved === "dark")
```

状态变化：

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 首次启动 | 按存储值决定是否加 `page-card` | `page-card` 永不出现，恒定 `fluent` |
| 设置页操作 | 「页面风格」2 按钮 + 「明暗主题」3 按钮 | 只剩「明暗主题」3 按钮 |
| 存量 `card` 用户 | 冷白大圆角 + 实心顶栏 | 暖纸色 `fluent`（一次静默切换，预期行为） |
| 存储中的 `page_style_theme` | 读取 + validate + apply | **不读、不写、不校验**，原样留存 |
| 明暗主题 | 全流程不变 | 全流程不变 |

## 5. 边界条件

- 存储中存在 `page_style_theme`（任意值 / 损坏值）→ 因 key 未注册而不被读取，无 warn、无崩溃。
- SSR / `document` 未定义 → `applyDarkClass` 早退；`applyPageStyleClass` 已不存在。
- `GridCard` / `ImageCard` 同时挂 `image-card surface-card`：两者在 `fluent` 下背景/圆角本就同值（`--colorNeutralBackground1` / `--borderRadiusXLarge`），内联后仍同值。
- 级联顺序：`base.css` 在 `virtual:uno.css` 之前，`.surface-card` 的 `box-shadow` 实际由 uno shortcut 生效；内联后两处同为 `--elevation4`，顺序无关。
- 删除 `--pageCard*` 后确认无残留消费点（全仓 grep `--pageCard` 仅剩 docs 历史）。

## 6. 验收标准

- `pnpm check`、`pnpm test:app`、`pnpm lint`、`pnpm fmt:check` 全绿。
- `packages/app/src` 与 `packages/app/uno.config.ts` 内零 `page-card` / `page_style_theme` / `pageStyle` / `--pageCard` 引用。
- 设置页只剩明暗主题；`/settings` 与 `/home`（Feed 卡片 + 顶栏）视觉与改动前一致（亮/暗各确认一次）。
- 存量 `page_style_theme=card` 的存储不被破坏，应用正常以 `fluent` 渲染。

## 7. 风险

- **视觉回归**：`--pageCard*` 内联若误用 fallback 值（`--elevation2` / `--borderRadiusLarge`）而非有效值（`--elevation4` / `--borderRadiusXLarge`）会静默改观感 → 以 §3.5 映射表为准 + 人工视觉确认兜底。
- **老用户一次静默配色切换**：预期行为，ADR-0148 记录，不做提示。

## 8. 关联

- tickets：`docs/specs/remove-page-style-setting-tickets.md`
- `docs/adr/ADR-0069-cardized-settings-and-personal-center.md`（`--pageCard*` 挂账来源）
- `docs/adr/ADR-0029-eliminate-store-circular-ref.md`（themeStore 主题归属）
- `docs/adr/glossary-ui-cards.md`（「页卡令牌」术语）
