# 首页全页 A2 化（Home Cardized — A2 Visual Language）

Status: accepted

设置页（ADR-0069）与个人中心（/me）已落地 A2 卡片化视觉语言（无边框 + 大圆角 `--borderRadius2XLarge` + 单级 `--elevation2` 柔和阴影）。首页 `/home` 作为应用门面仍为旧视觉：顶部栏 `surface-appbar` 毛玻璃、插画/小说切换器普通 segmented、Feed 图片卡片（`image-card`）带细边框与中圆角。经 Grill 澄清（用户确认动机 = 顶部栏 A2 化 + Feed 卡片 A2 化，范围 = 全页，风格 = A2 卡片语言），决定：

- **顶部栏 A2 化**：头像/名字 + 插画/小说切换器从毛玻璃 appbar 改为 A2 简洁风格，切换器用 A2 segmented（`--colorNeutralBackground2` 容器 + 激活项浮起 `--elevation2`）。
- **Feed 卡片 A2 化**：`ImageCard` 由 `image-card` shortcut（边框 + 中圆角）改为 A2 卡片（去边框、`--borderRadius2XLarge`、`--elevation2` 柔和阴影）。
- **页面背景统一**：`--colorNeutralBackground3`，与设置页/me 一致。

理由：

1. **统一性**：设置页与 /me 已确立 A2 语言，首页是用户每日首屏，视觉割裂感最强；用户实测前两页后明确要求首页沿用 A2。
2. **一致性风险已评估**：`ImageCard` 被推荐/关注/收藏/历史/搜索/用户作品等全部列表页共用，Feed 卡片 A2 化是全局性变更——故先以 `/home` 为宿主做 UI 原型（`?variant=` 三版对比）验证视觉，选定后再统一落地，避免未经对比直接改动全局组件。
3. **性能**：A2 卡片仅改 border/radius/shadow 令牌，不引入 backdrop-filter 等重效果（对比玻璃全量方案，见下）。

Considered Options：

- **玻璃视觉统一（顶部切换器/子 Tab 用 GlassTabBar 玻璃语言）**：与 ADR-0044 玻璃族一致，但用户选定 A2 语言，且 Feed 大面积玻璃叠在滚动列表上有性能风险——否决。
- **A2 卡片语言（顶部栏 + Feed 卡片 + 背景全 A2）**：**选定**。
- **混合（玻璃 Tab + A2 Feed 卡片）**：两种视觉语言并存，系统一致性差——否决。

Consequences:

- `/home` 原型验证通过后，`ImageCard` 的 A2 化将同步影响搜索页、用户作品页等全部列表页（预期一致效果，无需逐页调整）。
- 顶部插画/小说切换器保留 segmented 交互语义（不改为玻璃胶囊），仅视觉对齐 A2。
- 术语见 `docs/adr/glossary-ui-cards.md`（Feed 卡片 A2 化 / 顶部区域 A2 化 / A2 segmented 切换器）。
