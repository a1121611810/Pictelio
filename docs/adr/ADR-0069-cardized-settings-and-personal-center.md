# 设置页与个人中心卡片化视觉统一（Cardized Settings & Personal Center）

Status: accepted

设置页（`/settings`）原为扁平区块 + `fluent-divider` 分隔的长列表；个人中心（`/me`）为 `--pageCard*` 令牌的卡片风格，两者视觉语言不一致。经设置页 UI 原型五选一（A 卡片分组 / A2 精修 / A3 清爽 / B 分类 Tab / C 搜索索引，`?variant=` 切换 + 底部切换条对比，用户实测选定），决定：

- **设置页**采用 **A2 视觉语言**落地为正式布局（commit `61556bd`）：每设置区块浮起为独立卡片——**无边框、大圆角（`--borderRadius2XLarge`）、单级柔和阴影（`--elevation2`）**，卡片表面 `--colorNeutralBackground1`，卡片间间距 `--spacingVerticalXL`、不使用分隔线；危险操作（退出登录）独立 `danger` 色调卡片，不与普通设置同卡。
- **个人中心（`/me` 及 `/user/:id` 根路由）**沿用 A2 视觉语言做全页重构，替换 `--pageCard*` 令牌体系，与设置页形成统一设计体系。

理由：

1. **统一性**：设置页刚确立 A2 卡片体系，/me 仍用旧的 pageCard 卡片，两页相邻（设置入口在 /me 内）风格割裂，用户实测后明确要求统一。
2. **可扫描性**（NN/g cards-component）：语义分组卡片 + 组头小字标签，卡片边界形成"共同区域"，比扁平列表更易扫描；区块级卡片而非每项一卡，避免碎片化。
3. **克制**：少线条原则（Linear design refresh 同类决策）——A2 无边框、无行内分隔线、单级阴影，避免结构性噪音与过度装饰（Fluent 圆角两档 8/16px、elevation 层级有限）。
4. **危险操作隔离**：退出/清除等破坏性操作独立 danger 卡片，降低误触。

Considered Options（设置页 UI 原型五选一）：

- **A（卡片分组基线）**：`surface-card-elevated`（边框 + `--elevation4` + 小圆角 `--borderRadiusMedium`）。被否：边框与阴影双重装饰、圆角档位过小，视觉偏重。
- **A2（精修版）**：去边框、大圆角、单级 `--elevation2` 柔和阴影。**选定**（Windows 11 / Fluent 设置模式）。
- **A3（清爽版）**：细边框 `--colorNeutralStroke1` + 无阴影 + 卡片内行间 1px 分割线（iOS inset grouped）。备选，未选（与设置页行间已有 hover 反馈的少线条方向相悖）。
- **B（分类 Tab）**：顶部 sticky 分段栏，一次一屏。被否：设置项总量尚不需要分段导航，且多一次点击。
- **C（搜索索引）**：搜索框 + 区块 chip 过滤。被否：功能上可行但当前设置项规模下过度设计。

Consequences:

- 后续新增设置区块 / 个人中心入口，一律复用 `SettingsCard`（`tone="elevated" | "danger"`）与 A2 视觉语言令牌；「为什么设置页/个人中心是 A2 卡片而 Feed 卡片/详情页不是」以本文档为准，避免后续被误"统一"。
- `/me` 全页迁移后移除 `--pageCard*` 令牌使用（令牌本身暂保留，待全局无引用后清理）。
- 完整原型集（A/A2/A3/B/C + 切换条）归档于 throwaway 分支 `prototype/settings-ui-cards`（commit `4be43ff`），术语见 `docs/adr/glossary-ui-cards.md`。
