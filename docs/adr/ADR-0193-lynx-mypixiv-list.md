# ADR-0193：app-lynx 好P友列表（MyPixiv）

- 状态：Accepted（已采纳）
- 日期：2026-09-27
- 关联：`docs/adr/glossary-lynx-four-features.md`（术语表——好P友/UserPreview/UserRow）、`docs/specs/lynx-mypixiv.md`（规格，随 /to-spec 产出）、ADR-0194（公共组件层——UserRow 复用）、ADR-0150（页级首载三态 deriveFirstLoadView）、ADR-0136（benchNav 验证钩子）、ADR-0188（Me 页功能入口卡区先例）、ADR-0037（PixivApiPlugin 网关——Java 零改动前提）

## 背景

好P友（MyPixiv）是 Pixiv 的**双向**社交关系（双方互相关注才成立），官方 App 有独立的好P友页。Pictelio 现状（file:line 实证）：

- **仅存在计数字段**：`PixivProfile.total_mypixiv_users`（`packages/app-lynx/src/api/types.ts:190`，optional；webview `packages/app/src/api/types.ts:266`）——用户主页能**看到数字**，却没有任何入口看到**人**。
- **无列表能力**：双端 `api/user.ts` 只有 `getUserFollowing` / `getUserFollowers`（单向关系族），无 mypixiv 端点封装。
- **端点经六独立客户端交叉验证**：`GET /v1/user/mypixiv`，参数 `user_id` + 可选 `offset`，响应 `{ user_previews, next_url }`，元素为 `PixivUserPreview` 形状（`{ user, illusts, novels, is_muted }`）——与 following/follower 响应同构，分页机制可直接复用。
- **Java 零改动可行**：lynx 数据通道 `PictelioApiModule.request()`（与 webview `PixivApiPlugin.request()`）均为 path 直拼、无白名单（ADR-0188 已验证同一前提）。

## 调研结论

1. 响应形状与 following/follower **完全同构**（`user_previews[]` + `next_url`）→ 数据层可整体复用 `loadUserListNext` 续页管道，新代码只剩一个首端点封装。
2. 页面骨架与 FollowList 同族（用户行列表 + 关注按钮 + 下拉刷新 + 分页），但**语义不同族**（双向关系 vs 单向关系、无 `restrict` 维度）——复用表现层组件（UserRow，ADR-0194 抽取），不复用页面容器语义。
3. lynx 侧 `PixivUserPreview` 现缺 `novels` 字段（webview 版含 `novels: unknown[]`），`/v1/user/mypixiv` 响应含该字段——类型需补齐对齐（本批页面不消费 `novels`，字段对齐防解析面分叉）。
4. 入口与验证基建就绪：Me 页功能入口卡区是既定挂点（ADR-0188 先例）；benchNav 场景注册（ADR-0136 模式，先例 `pictelioBenchNavWatchlist: '/watchlist'`）让真机/模拟器验证零额外脚本。

## 决策

**D1 端点封装——`api/user.ts` 新增 `getMyPixivUsers(userId, offset?)`，续页复用既有管道。**
`getMyPixivUsers(userId: UserId, offset?: number): Promise<PixivUserFollowingResponse>`（响应形状复用 `PixivUserFollowingResponse`——同构复用而非新类型；响应元素经 `PixivUserPreview`，lynx 类型补齐 `novels` 字段）。请求参数风格跟随仓库既有 user 端点惯例、与 `getUserFollowing` 一致：`user_id` 必带、`offset` 可选字符串化展开、无多余参数（mypixiv 无 `restrict` 维度，**不引入** filter）；`next_url` 续页直接复用 `loadUserListNext(url)`（完整 URL 透传，既有函数零改动）。类型追加 `PixivMyPixivResponse` 不另起——同构形状直接以 `PixivUserFollowingResponse` 承载，避免双类型漂移。

**D2 页面 `/mypixiv`——复用 UserRow + RefreshableList + deriveFirstLoadView 三件套。**
新页 `MyPixiv.vue`，路由 `/mypixiv`（`meta.requiresAuth: true`）。用户行复用 ADR-0194 抽取的 **UserRow**（头像 + 用户名 + 关注按钮）：`is_followed` 驱动关注/取关，同 FollowList 的 `toggleFollow` 模式（乐观翻转 + 失败回滚）；注意 FollowList 已有的 `is_followed === undefined` 播种问题（following 列表天然已关注）在 mypixiv 语境**不存在**——好P友双向成立，仍按字段真值渲染，不播种。列表容器 = `RefreshableList`（下拉刷新）+ `loadUserListNext` 分页 + `deriveFirstLoadView` 页级首载三态（ADR-0150：骨架 / 空态 / 内容；空态用 EmptyState）。行点击 → 用户主页 `/user/:id`（与 FollowList 同导航语义）。

**D3 入口与验证——Me 页「好P友」行 + benchNav 场景注册。**
Me 页功能入口卡区新增「好P友」行（i18n key `me.mypixiv`，文案「好P友」；邻位对齐 bookmarks/watchlist 行序）。`meta.requiresAuth: true`（未登录由守卫承接，与全站一致）。router benchNav 场景注册 `pictelioBenchNavMyPixiv: '/mypixiv'`（ADR-0136 模式、`pictelioBenchNavWatchlist` 先例），真机/模拟器 E2E 验证免手导航。

**D4 范围排除——申请/审批流与作品流均不做。**
好P友**申请/审批流**：其端点存在性无可靠来源（六客户端交叉验证未覆盖写操作）——**未求证，不做**，明确挂账；`/v2/illust/mypixiv`、`/v1/novel/mypixiv` 作品流（好P友作品的 feed 面）不在本批（独立信息架构，另行立项）。本批交付严格 = 双向好P友关系**用户列表**。

## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| FollowList 加第三个 mode（following/follower/mypixiv） | FollowList 语义是 following/follower **单向**关系（带 `restrict` 维度、`/v1/user/following|follower` 端点族）；mypixiv 是另一种**双向**关系且端点不同——塞进同页造成语义与端点双分叉，UserRow 组件复用已覆盖全部真实共享面 |
| 新建独立响应类型 `PixivMyPixivResponse` | 与 `PixivUserFollowingResponse` 字段同构，双类型必然漂移；同构复用是本仓惯例 |
| 过滤 `is_muted` 用户 | 服务端已下发静音标记，本地过滤与官方 App 行为不一致；保留展示 + 按钮态即可 |
| Me 入口并入「关注」行展开 | 好P友是独立关系面，折叠进关注行损失可发现性；Me 卡区行式入口是既定信息架构 |
| webview 端同批实现 | 本批 lynx-only（四功能范围约定）；类型/端点封装形态已对齐 webview 惯例，后续移植零障碍 |

## 后果

- 正面：`total_mypixiv_users` 数字背后的列表能力补齐，用户主页数字首次可点达；数据层新增代码仅一个端点封装（续页/分页/三态全复用既有管道）；UserRow 借此完成第二消费方验证（ADR-0194 抽取收益落地）；benchNav 注册让验证成本趋零。
- 取舍（已接受）：`novels` 字段本批不消费（仅类型对齐）；好P友申请/审批流未求证不做（留待端点取证）；`is_muted` 不本地过滤；webview 端暂无对等页面（双端不对称是现状常态）。
- 风险：`/v1/user/mypixiv` 为六客户端交叉验证结论而非本仓抓包实证——spec 落地时以真实账号抓包 fixture 钉 schema（对齐测试硬约束 #2 真实样例要求），字段出入按宽容解析处置。
- 后续候选（不在本期）：好P友申请/审批流（端点取证后立项）、`/v2/illust/mypixiv` / `/v1/novel/mypixiv` 作品流、好P友作品聚合 feed、webview 端对等实现。
