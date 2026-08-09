# 卡片化设置页与个人中心术语表（Cardized UI Glossary）

本术语表统一"设置页卡片化分组（A2 选定）"与"个人中心（/me）沿用"两处落地中使用的视觉设计术语。相关决策见 `ADR-0069-cardized-settings-and-personal-center.md`。

| 术语 | 定义 |
|------|------|
| **卡片化分组（Cardized sections）** | 把语义相关的设置/功能区块各自呈现为一张独立卡片（含区块内多行），卡片间大间距分隔的布局方式。区别于"每项一张小卡片"（碎片化，见 ADR-0069 反模式）。 |
| **A2 视觉语言（A2 visual language）** | 项目统一卡片体系（**基于 Win11 / Fluent 2 官方规范**，ADR-0074 修正）：卡片 = **8px 圆角（`--borderRadiusXLarge`）+ 1px 细边框（`--colorNeutralStroke1`）+ 背景分层（卡片 `--colorNeutralBackground1` / 页面 `--colorNeutralBackground2`）+ 无阴影**；控件（按钮/segmented/行）4px 圆角（`--borderRadiusMedium`）；浮层/抽屉 16px。依据：Win11 Geometry（8px 顶层容器 / 4px 页内控件）、Fluent 2 Shapes（"Border 标识未填充形状的边界，如卡片"）。源自设置页 UI 原型变体 A2，用户按 Win11 做法确认修正。 |
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
| **Feed 卡片 A2 化（Feed card A2）** | Feed 图片卡片（`ImageCard`，`image-card` shortcut）应用 A2 卡片视觉：**8px 圆角 + 1px 细边框（`--colorNeutralStroke1`）+ 背景分层 + 无阴影**（ADR-0074 修正）。注意 `ImageCard` 被所有列表页共用，A2 化影响面全局（ADR-0070）。 |
| **顶部区域 A2 化（Header A2）** | 首页顶部栏（头像/名字 + 插画/小说切换器）从 `surface-appbar` 毛玻璃改为 A2 简洁风格（弱化边框、对齐 Neutral 表面与间距令牌）。 |
| **A2 segmented 切换器** | 插画/小说等二元切换控件使用 A2 视觉：`--colorNeutralBackground2` 容器 + 激活项 `--colorNeutralBackground1` 浮起（`--elevation2`），延续现状 segmented 交互语义、视觉对齐 A2 语言。 |
| **详情页 A2 化（Detail A2）** | 作品详情页（`/illust`、`/novel`）的顶部栏/图片展示区/信息区应用 A2 语言：顶部栏 A2 卡片式（同首页）、图片卡片化（大圆角 2XLarge 柔和阴影）、信息区卡片分组（作者/统计/收藏/标签）。浮层（查看器/评论）入口样式一并对齐（ADR-0071）。 |
| **小说阅读器 A2 化（Novel reader A2）** | 小说详情页（`/novel`）的封面信息区/阅读工具条/底部导航应用 A2 语言：封面信息区改为 A2 卡片（封面图通边 + 标题/作者/标签/统计在卡内，圆角 2XLarge + `--elevation2`）、顶部栏 A2 卡片式、底部导航 A2 卡片条；正文长文不套卡片（阅读区保持纯净排版）（ADR-0072）。 |
| **内容域（Content domain）** | `/home` 首页由底部导航 Tab（推荐/关注/收藏/历史）× 内容类型 contentType（插画/小说）组合出的内容区域，共 7 个：推荐-插画、推荐-小说、关注-插画、关注-小说、收藏-插画、收藏-小说、历史。插画域走 `VirtualFeed`（`image-card`），小说域走小说 Feed（`NovelCard`），历史域走 `HistoryFeed` 条目卡。 |
| **首页内容域 A2 统一（Home content A2）** | `/home` 全部内容域统一到 A2 视觉语言（ADR-0073，ADR-0075 更新）：首页采用 **C 框架**（侧边导航列）+ **L5 固定布局**——插画单列大图（16:10 全宽卡）、小说单列行卡（56px 封面）、历史 A2 行卡；滚动分页；设置页布局模式设置（layoutMode）移除，插画/小说布局固定不再可配。 |
| **首页 C 框架（Home C shell）** | 首页导航结构（ADR-0075 选定）：左侧固定 icon 导航列（搜索 + 推荐/关注/收藏/历史 + 底部设置/我的，选中项 BrandBackground2 圆角高亮块）+ 右侧内容区（页面大标题 + contentType 切换器）。Win11 设置式，替代底部 NavBar 在首页的导航角色（NavBar 保留于其他页面）。 |
| **固定布局 L5（Fixed layout L5）** | 首页内容固定布局（用户选定组合）：插画=单列 16:10 大图卡（图片优先 + ★收藏）；小说=单列行卡（56px 封面 + 标题/作者/★统计）。两套均配滚动分页（IntersectionObserver 哨兵 → nextUrl/fetchMore）。不再由设置页 layoutMode 控制。 |
| **滚动分页哨兵（Feed pagination sentinel）** | 列表底部 1px 高哨兵元素，IntersectionObserver（rootMargin 300px）进入视口且存在下一页时触发 `fetchMore` 自动加载更多。 |
| **下拉刷新（Pull-to-refresh）** | 首页 6 个 Feed 面板（推荐/关注/收藏 × 插画/小说）的下拉刷新手势（ADR-0076）：`touchstart`（scrollTop=0 时记录起点）→ `touchmove` 阻尼计算下拉距离 → 超阈值进入 ready → 松手触发 `store.refresh()`（refetch 第一页）。历史 Tab 不启用。 |
| **下拉相位（Pull phase）** | 下拉手势状态机（`createPullToRefresh` 原语）：`idle → pulling → ready → refreshing`。`ready` = 下拉超过阈值（60px）待松手；`refreshing` = 松手后回弹并执行刷新，期间忽略重复下拉。 |
| **刷新遮罩（Refresh overlay）** | A1 清空重载的 UI 实现（ADR-0076）：`refreshing` 期间 FeedPanel 渲染骨架列表**替换**旧列表（store 数据不清空、保留至新数据到达），实现"清空 → 骨架 → 新数据"的可见刷新过程。 |
| **A2 行卡（A2 row card）** | 列表型条目的卡片形态（历史条目、小说卡列表形态等）：无边框 + 大圆角 + `--elevation2`，内部保持「缩略图 + 标题 + 次要信息 + 行尾操作」的紧凑行布局。是 A2 视觉语言在列表条目上的延伸。 |

## 相关链接

- ADR: `docs/adr/ADR-0069-cardized-settings-and-personal-center.md`
- 归档原型: 分支 `prototype/settings-ui-cards`（设置页 A/A2/A3/B/C 完整集）
