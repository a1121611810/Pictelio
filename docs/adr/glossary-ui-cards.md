# 卡片化设置页与个人中心术语表（Cardized UI Glossary）

本术语表统一"设置页卡片化分组（A2 选定）"与"个人中心（/me）沿用"两处落地中使用的视觉设计术语。相关决策见 `ADR-0069-cardized-settings-and-personal-center.md`。

| 术语 | 定义 |
|------|------|
| **卡片化分组（Cardized sections）** | 把语义相关的设置/功能区块各自呈现为一张独立卡片（含区块内多行），卡片间大间距分隔的布局方式。区别于"每项一张小卡片"（碎片化，见 ADR-0069 反模式）。 |
| **A2 视觉语言（A2 visual language）** | 项目统一卡片体系：**无边框 + 大圆角（`--borderRadius2XLarge`）+ 单级柔和阴影（`--elevation2`）**，卡片表面 `--colorNeutralBackground1`，卡片间间距 `--spacingVerticalXL`。源自设置页 UI 原型变体 A2（Windows 11 / Fluent 风格），用户选定后成为正式布局。 |
| **SettingsCard** | 卡片容器组件（`components/settings/SettingsCard.tsx`），`tone` 二选一：`elevated`（A2 视觉语言卡片）、`danger`（危险操作卡片）。 |
| **危险操作卡（Danger card）** | 破坏性/不可逆操作（如退出登录）使用的独立卡片：`tone="danger"`，背景 `--colorStatusDangerBackground2` + 同色边框（行 hover 时保持内容区与卡片边界区分）。危险操作**不与普通设置同卡**混排。 |
| **卡片头（Card header）** | 卡片顶部的小字分组标签（如"显示与交互"）。由区块子组件自带，A2 不额外添加图标标题行（少线条原则）。 |
| **统一设置行模板（Settings row）** | 每行 = 图标 + 标题 + 可选描述，动作控件（switch/按钮/chevron）右对齐；行高约 48px；行间分隔线**宁可少用**。 |
| **原型变体（Variant）** | UI 原型流程中，同一路由上结构互异的候选布局（A / A2 / A3 / B / C 等）。变体间必须结构不同（布局/信息层级/主交互），不允许仅换色换文案。 |
| **?variant= 参数** | 原型切换的 URL search 参数（如 `/me?variant=B`），使变体可分享、刷新稳定。仅开发模式生效。 |
| **原型切换条（PrototypeSwitcher）** | 底部居中浮动切换条（左/右箭头 + 变体标签），点击箭头或 `←`/`→` 方向键循环切换变体，生产构建不渲染。 |
| **原型容器（PrototypeSettings）** | 开发模式按 `?variant=` 分发变体的容器组件，通过 `import.meta.env.DEV ? lazy(import(...)) : null` 隔离，生产零残留。 |
| **页卡令牌（pageCard token）** | 旧 `/me` 页面使用的 `--pageCard*` 令牌组（`--pageCardSurface/Radius/Shadow/Border/Bg` 等）。作为 A2 视觉语言落地的一部分，`/me` 迁移后不再使用 pageCard 令牌，改用 Fluent 令牌（`--colorNeutralBackground1`、`--borderRadius2XLarge`、`--elevation2`）。 |
| **throwaway 分支（Prototype branch）** | UI 原型流程收尾时，完整原型集（全部变体 + 切换条 + 原型测试）归档的独立 git 分支（如 `prototype/settings-ui-cards`），不进交付分支，作为 primary source 留存。 |

## 相关链接

- ADR: `docs/adr/ADR-0069-cardized-settings-and-personal-center.md`
- 归档原型: 分支 `prototype/settings-ui-cards`（设置页 A/A2/A3/B/C 完整集）
