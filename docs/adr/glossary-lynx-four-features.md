# Lynx 四功能统一术语表（稍后看 · 下载命名 · 好P友 · 公共组件层）

> 范围：`packages/app-lynx`（vue-lynx / Material Design 3）本批四个功能的统一领域语言：**稍后看**、**下载命名模板 / 按作者建目录**、**好P友列表**、**公共组件层抽取**。架构决策见 ADR-0191（稍后看）、ADR-0192（下载命名）、ADR-0193（好P友）、ADR-0194（公共组件层）。本表只定义领域语言与术语红线，不写实现细节；与既有术语表的关系：保存/下载链详 [glossary-image-save.md](./glossary-image-save.md)，收藏详 [glossary-bookmark-tags.md](./glossary-bookmark-tags.md)。

## 核心术语

| 术语 | 定义 | _Avoid_（须规避的别称） |
|------|------|------------------------|
| **稍后看（WatchLater）** | **本地**暂存作品列表：插画与小说双类型（见「作品类型」），纯客户端能力，**无任何服务端对应物**（Pixiv 无"稍后观看"端点）。存储单元为**快照条目**，账号级键持久化，**容量上限** 500 条。 | 稍后阅读、待看、收藏夹暂存（三个别称全部禁用——代码/路由/i18n/UI 文案统一用「稍后看」/ WatchLater） |
| **追更（Watchlist）** | **既有**能力（勿改语义）：**服务端**小说**系列**追更列表，端点 `/v1/watchlist/novel` 族（`GET /v1/watchlist/novel`、`POST /v1/watchlist/novel/add` / `delete`，`series_id` 维度），页面 `Watchlist.vue`、路由 `/watchlist`。⚠️ **与 WatchLater 严格区分——本批最重要的术语红线**：Watchlist 是服务端、小说系列维度、既有功能；WatchLater 是本地、插画+小说双类型、本批新功能。两者无任何数据或联动关系。 | 把 WatchLater 称作 "watchlist"、把追更称作"稍后看"（双向混淆均禁止，见「易混术语辨析」#1） |
| **收藏（Bookmark）** | **既有**能力（勿改语义）：Pixiv **服务端**收藏记录，双轨 public/private 可见性（ADR-0160）。与 WatchLater 完全独立：收藏有服务端可见性语义，稍后看没有。详 [glossary-bookmark-tags.md](./glossary-bookmark-tags.md)。 | 用收藏当稍后看（"先私密收藏回头再看"是语义污染，ADR-0191 D4 已否决）；加喜欢、like、星标 |
| **快照条目（Snapshot Item）** | WatchLater 的存储单元。字段固定：`{ kind, id, title, coverUrl, userId, userName, addedAt }`。加入时从**已有页面数据**直接构造（不重复拉取详情）；列表展示用快照，点击进**实时详情页**。 | 快照（单独使用时必须带"条目"或明确指 WatchLater 语境）、缓存条目、离线条目 |
| **作品类型（WorkKind）** | `'illust' \| 'novel'` 二值枚举：快照条目的类型维度，也是去重键的一半（去重键 = `(WorkKind, id)`）。 | 类型（裸用——必须限定是作品类型，与 UI 主题"外观模式"、下载"导出格式"区分）、mediaType |
| **容量上限（Capacity Cap）** | WatchLater 的硬上限 = **500 条**。超出时丢**最旧**条目并 `console.warn`（模块前缀，禁静默降级）。 | 容量限制、配额、max items（文档统一"容量上限"） |
| **下载命名模板（Download File Template）** | 设置键 `download_file_template`（**设备级**），默认 `Pictelio_{id}`。占位符集合：`{id}` `{title}` `{author}` `{p}`（`p` = 多页 0-based 页号，单页不出现）。生成的是**文件名段**；目录段由「按作者建目录 / 相对目录」决定。模板解析**只在 JS**（沿袭 ADR-0145 单一事实源）。 | 文件名模板（口语可用，正式文档用"命名模板"）、命名规则、自定义文件名 |
| **按作者建目录（Author Directory）** | 布尔设置键 `download_by_author_dir`（**设备级**，默认**关**）。开启后**相对目录**追加净化后的作者名段。只影响**目录段**，不影响文件名。 | 作者文件夹、按作者分组、作者子目录（"作者目录段"可用） |
| **相对目录（Relative Path）** | MediaStore `RELATIVE_PATH` 的目录段。**基座恒为各落盘链既有常量**：图片链 = `Pictures/Pictelio`（`GallerySaver.RELATIVE_PATH`），下载队列非图片导出链（ugoira/小说文档）= `Downloads/Pictelio`；**作者目录是追加段，不改变基座**。 | 绝对路径、任意子目录（用户不能指定任意路径，只有固定基座 + 可选作者段） |
| **文件名单一事实源（JS single source，沿袭 ADR-0145）** | 文件名与目录段一律 **JS 侧生成**（`utils/galleryDownload.ts`），Java 只做**防御性净化**（`GallerySaver.sanitizeFileName`：路径分隔符/控制字符 → `_`）；**模板解析不进 Java**。本批所有命名/目录改动必须维持此边界。 | 双端各算一遍、Java 侧补模板逻辑 |
| **好P友（MyPixiv）** | Pixiv **双向**"好P友"关系的用户列表（双方互相关注才成立的关系，与单向 following/follower 不同）。端点 `GET /v1/user/mypixiv`。 | 好友、朋友、相互关注列表（"互关"口语可用，正式文档用"好P友"）、mypixiv friends |
| **用户预览（UserPreview）** | `{ user, illusts, novels, is_muted }`，复用既有类型 `PixivUserPreview`（webview 侧已含 `novels`；lynx 侧补齐同形字段）。FollowList 与 MyPixiv 共用同一形状。 | 用户卡片、用户摘要行 |
| **作品（Work）** | 插画与小说的**统称**（插画含动图 ugoira）。快照条目、稍后看列表均按此口径。 | 内容、媒体（禁用） |
| **保存 vs 下载（既有辨析，重申）** | **保存** = 单存相册（gallerySave 链：`gallerySaver.ts` → `PictelioGalleryModule.saveImage` → `GallerySaver.save` → 相册）；**下载** = 下载队列（download queue 链：`downloadQueueCore` → `PictelioDownloaderModule.start`）。**命名模板与按作者建目录两者皆生效**。详 [glossary-image-save.md](./glossary-image-save.md)「易混淆概念辨析」。 | 混称"存图/下图"指代具体链路（说"保存"还是"下载"必须明确） |

## 公共层术语

| 术语 | 定义 | _Avoid_（须规避的别称） |
|------|------|------------------------|
| **公共层（Common Layer）** | `packages/app-lynx/src/components/` 下被多页复用的组件集合。是**包内目录惯例**，**非独立 npm 包**（否决 `@pictelio/lynx-ui`，ADR-0194 D2）。 | 组件库、UI 框架、design system 包 |
| **PageTopBar（页级顶栏）** | 页级顶栏组件，两个变体：**居中标题**变体（无返回键的一级页）与 **‹返回 + 标题 + 右动作**变体（二级页）。收口各页手写返回头。 | 顶部导航、AppBar、Header、NavBar |
| **SubTabBar（二级 tab 切换条）** | 二级 tab 切换条（一级 tab = `NavigationBar` / 放射 FAB，勿混淆）。收口各页手写的分段/胶囊切换。 | SegmentedTab、顶部选项卡 |
| **EmptyState（空态）** | 图标 + 标题 + 提示文案的三段式空态。 | 空页面、placeholder、no-data |
| **FeedListFooter（列表尾）** | 列表尾三态组件：**加载中** / **分页错误**（重试）/ **到底**。 | 加载更多、Footer、无限滚动提示 |
| **BottomSheet（底部弹层壳）** | 底部弹层**壳**组件：全屏层（`v-if`）+ scrim（`@tap` 关闭）+ 80vh 面板（`@tap.stop`）+ 标题栏 + × 关闭。命中测试语义原样保留 ADR-0123/0147（ADR-0194 D5）。业务弹层（如 `PagePickerSheet`、`NovelExportSheet`）基于壳组装。 | 弹窗、Dialog、Modal、Drawer |
| **UserRow（用户行）** | 用户行组件：头像 + 用户名 + 可选动作按钮（如关注/取关）。被 FollowList 与 MyPixiv 复用（ADR-0193 D2）。 | 用户卡片、UserItem、UserCell |

## 易混术语辨析

0. **⚠️ 本表之外还有第四条独立轴：「继续读」**（ADR-0219 引入，本表**不含**其词汇）：
   继续读是**本地**、**系统观察**（打开作品即记录，非用户主动添加）的回访列表，
   **同段同页装两类条目**：小说话级阅读位置 + 插画浏览历史（票 #926 / #927 均已落地）。
   与本表的稍后看并存且**互不知道对方存在**。词汇与完整辨析见
   [glossary-lynx-continue-reading.md](./glossary-lynx-continue-reading.md)——
   **判别口诀：谁主动？** 用户主动 → 本表三者；系统从行为观察 → 继续读。
1. **WatchLater ≠ Watchlist ≠ Bookmark（本批最重要红线）**：
   - **WatchLater（稍后看）**：本地、账号级键存本机、插画+小说双类型、无服务端、可随时删除不通知任何人。
   - **Watchlist（追更）**：服务端、小说**系列**维度、`/v1/watchlist/novel` 族端点、路由 `/watchlist`。
   - **Bookmark（收藏）**：服务端、有 public/private 可见性、带收藏标签体系（ADR-0160）。
   - 判别口诀：**换手机还在吗？** 收藏/追还在（服务端），稍后看不在（本地账号级键，随设备/清理丢失，WebDAV 备份可迁）。代码红线：WatchLater 全链路命名（route `/later`、组件 `WatchLater.vue`、i18n 前缀 `later.*`、store/工具 `watchLater*`）**不得**出现 `watchlist` 字样，反之亦然。
2. **命名模板占位符 ≠ 相对目录**：`{author}` 占位符进**文件名**（如 `{author}_{id}`）；「按作者建目录」进**目录段**（基座 + 作者段）。两者独立开关、可同时生效；作者名两种场景都经同一净化规则（路径分隔符/控制字符 → `_`）。
3. **`{p}` 占位符 ≠ 页码 UI**：`{p}` 是文件名里的**0-based** 多页页号（`_p0` = 第 1 页，对齐 Pixiv 原始 `_p0` 命名），**单页作品不出现**；UI 展示给用户的页码是 1-based（沿袭 glossary-image-save 页号辨析）。
4. **保存 vs 下载**：见核心术语表末行。命名模板/作者目录同时作用于两条链，但链路的原生落盘通道不同（相册 `GallerySaver.save` vs 队列 `PictelioDownloader`）。
5. **MyPixiv ≠ Following/Follower**：好P友是**双向**关系（端点 `/v1/user/mypixiv`）；关注/粉丝是**单向**关系（`/v1/user/following` / `/v1/user/follower`，带 `restrict`）。三者共用 UserPreview 形状与 UserRow 组件，但端点、语义、页面均不同。
6. **公共层 ≠ 独立包**：Common Layer 只是 `packages/app-lynx/src/components/` 目录惯例；不建 `@pictelio/lynx-ui`（单消费方 + 工具链锚定 `./src/**`，ADR-0194 D2）。
7. **快照条目 ≠ 实时数据**：稍后看列表渲染的是加入时刻的**快照**（标题/封面可能陈旧，可接受）；点击进详情页后看到的才是**实时**数据（作品可能已删除/更名）。

## 关系

- **快照条目**属于 **WatchLater**：一条快照恰属一个稍后看列表，携带一个 **WorkKind**；去重键 = `(WorkKind, id)`；容量上限作用于整个列表。
- **WatchLater / Watchlist / Bookmark 三者相互独立**：无数据同步、无入口联动、无语义包含。
- **命名模板 + 按作者建目录 + 相对目录**构成文件落盘名的完整分段：`[相对目录基座][/作者段]/<模板展开>.<ext>`；净化规则单源于 JS（**文件名单一事实源**），Java 仅防御性净化。
- **保存链与下载队列链**均消费命名模板与作者目录段；两条链的原生薄壳不同（`PictelioGalleryModule.saveImage` vs `PictelioDownloaderModule.start`）。
- **UserRow** 被 FollowList（关注/粉丝）与 MyPixiv（好P友）复用；两者都消费 **UserPreview** 形状数据。
- **公共层六组件**（PageTopBar / SubTabBar / EmptyState / FeedListFooter / BottomSheet / UserRow）由各页消费：稍后看列表页（`WatchLater.vue`）是本批新增消费方（PageTopBar + EmptyState + FeedListFooter；快照卡是作品卡，非 UserRow）。
- **MyPixiv 页**消费 `GET /v1/user/mypixiv` 返回的 `user_previews`（UserPreview 形状）+ `next_url` 续页（`loadUserListNext`）。

## 示例对话

> **Dev:** 用户点了心形收藏，又点了"稍后看"，这条作品到底在几个列表里？
> **领域:** 两个。**收藏（Bookmark）**是服务端记录（public/private 双轨）；**稍后看（WatchLater）**是本地快照条目。它们互不知道对方存在——收藏不变稍后看，稍后看也绝不写服务端。
> **Dev:** 那它跟**追更（Watchlist）**呢？名字听起来最近。
> **领域:** 零关系。Watchlist 是**小说系列**的服务端追更（`/v1/watchlist/novel` 族），路由 `/watchlist`；稍后看的路由是 `/later`、组件 `WatchLater.vue`、i18n 前缀 `later.*`——代码里不许交叉出现这两个词根。这也是为什么别称"待看/稍后阅读/收藏夹暂存"全部禁用：任何含糊都会把三条独立链搅在一起。
> **Dev:** 下载命名模板填 `{author}_{title}{p}`，再打开按作者建目录，最终路径长什么样？
> **领域:** 文件名 = 作者名净化后 + `_` + 标题净化后（多页追加 `_p2` 这样的 0-based 页号，单页没有 `{p}`）；目录 = `Pictures/Pictelio/作者段/`（保存链）或 `Downloads/Pictelio/作者段/`（导出产物链）。**按作者建目录只动目录段，`{author}` 只动文件名段**——两个独立开关，可以只开一个。
> **Dev:** 标题 300 字符全塞进文件名会怎样？
> **领域:** 按段净化 + 截断：`title`/`author` 单段 ≤ 64 字符、最终文件名 ≤ 120 字符；路径分隔符和控制字符先替换成 `_`（镜像 Java `sanitizeFileName`）。模板里写了不认识的占位符（比如 `{date}`）不会被吞——原样保留并 `console.warn`。
> **Dev:** 好P友页面为什么不复用 FollowList 加个第三个 mode？
> **领域:** 因为 **MyPixiv 是另一种关系**：好P友是双向关系、端点是 `GET /v1/user/mypixiv`、没有 `restrict`；FollowList 的语义是 following/follower 单向关系。复用的是**表现层**——`UserRow`（头像 + 名 + 关注按钮）和 UserPreview 形状——而不是页面语义。
