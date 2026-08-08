# ADR-0073: 首页内容域 A2 视觉统一（Home Content A2 Unification）

- 状态：accepted（UI 原型 3 变体选定后定稿）
- 日期：2026-08-08
- 关联：ADR-0069（A2 视觉语言）、ADR-0070（Feed 卡片 A2 化）、ADR-0071（详情页 A2 化）、ADR-0072（小说阅读器 A2 化）、ADR-0044（glass NavBar）、glossary-ui-cards.md

## 背景

A2 视觉语言已按页面逐步落地（设置页 → /me → /home 顶栏 → /illust → /novel）。但 `/home` 首页的**内容域**并未统一到位：盘点发现小说域与历史域仍残留旧 `surface-card` 边框卡：

| 内容域 | 卡片载体 | 现状 |
|--------|---------|------|
| 推荐-插画 / 关注-插画 / 收藏-插画 | `ImageCard`（`image-card` shortcut） | ✅ 已 A2（ADR-0070 去边框 + 2XLarge） |
| 推荐-小说 / 关注-小说 / 收藏-小说 | `NovelCard` | ❌ `surface-card` 细边框 + 中圆角 |
| 历史 | `HistoryFeed` 条目 | ❌ `surface-card` 细边框 |
| 网格模式 | `GridCard` | ⚠️ `image-card` + `surface-card` 叠加残留 |

同一页面上插画卡无边框大圆角、小说卡/历史卡细边框小圆角并存，视觉割裂。

## 决策

`/home` 全部内容域统一到 A2 视觉语言：

1. **小说卡 A2 化**：`NovelCard` 去 `surface-card` 边框 → A2（无边框 + `--borderRadius2XLarge` + `--elevation2`，卡片表面 `--colorNeutralBackground1`）。影响面：推荐小说、关注小说、收藏小说、搜索结果中的小说卡（`NovelCard` 被 `NovelVirtualFeed`/`SearchResults` 共用，与 ADR-0070 ImageCard 同理为全局影响）。
2. **历史条目 A2 化**：`HistoryFeed` 条目行（`surface-card`）→ A2 行卡（无边框 + 大圆角 + `--elevation2`）。
3. **GridCard 清理**：移除与 `image-card` 叠加的 `surface-card` 残留。
4. **圆角统一**：`contentType` 切换器（顶栏内）与 `FollowFeed` 子标签按钮 `roundedSmall` → `roundedMedium`（对齐 A2 segmented）。
5. **例外**：底部 `NavBar`（glass 浮动胶囊）保持 ADR-0044 自身体系，不并入 A2——它是全局导航原语，与 Feed 卡片分属不同视觉族，强行统一破坏其辨识度。

## 被考虑的方案

UI 原型 3 变体（`/home?variant=`，开发模式切换，用户选定后折入）：

- **VariantA — 统一基线**：现状结构不变（底部 NavBar + 4 Tab + contentType 子 Tab），只补全上述 5 项 A2 化。最小风险，行为零变化。
- **VariantB — 内容域同屏分区**：推荐/关注 Tab 内不再靠 contentType 隐藏，插画 + 小说两个 A2 区块卡**同屏展示**（分区滚动），信息层级从"切换"变"可见"。
- **VariantC — 顶栏 Tab 强化**：Tab 从底部 NavBar 上移到顶部 A2 卡片 segmented（推荐/关注/收藏/历史），内容域整页切换；底栏保留搜索中心按钮。

## 后果

- 正面：首页 7 个内容域视觉完全统一；小说卡与插画卡在推荐/关注/收藏 Tab 间切换时视觉连续。
- 负面：`NovelCard` A2 化影响搜索结果页（同卡共用，行为不变仅视觉）；网格模式圆角随 2XLarge 变大。
- 保留：NavBar glass 体系（ADR-0044）与 A2 卡片体系的并存边界，写入术语表"首页内容域 A2 统一"条目，避免后续误统一。
