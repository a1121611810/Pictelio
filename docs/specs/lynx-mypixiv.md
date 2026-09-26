# Spec: lynx 好P友列表（MyPixiv）

> 架构决策：ADR-0193（app-lynx 好P友列表——D1 端点封装 / D2 页面复用 / D3 入口与验证 / D4 范围排除）；统一术语：`docs/adr/glossary-lynx-four-features.md`（**好P友（MyPixiv）**／**用户预览（UserPreview）**／**UserRow（用户行）**／**PageTopBar**／**EmptyState**／**FeedListFooter** 逐字以术语表为准；「好友／朋友／相互关注列表」等别称禁用，"互关"仅限口语）。
> 组件与机制先例：ADR-0194（公共组件层——UserRow / PageTopBar / EmptyState / FeedListFooter）、ADR-0150（页级首载三态 deriveFirstLoadView）、ADR-0188（Me 页功能入口卡区）、ADR-0136（benchNav 验证钩子）、ADR-0037（PixivApiPlugin 网关——Java 零改动前提）。

## Problem Statement

用户在 Pictelio 用户主页能看到自己的好P友**计数**（`total_mypixiv_users`），却没有任何入口看到计数背后的「人」。好P友（MyPixiv）是 Pixiv 的**双向**社交关系（双方互相关注才成立），与单向的关注/粉丝不同族，官方 App 有独立的好P友页；Pictelio lynx 端完全没有该能力——user API 模块只有 `getUserFollowing` / `getUserFollowers`（单向关系族）封装，没有 mypixiv 端点。用户既看不到谁与自己互关，也无法在列表内快捷管理这段关系。

## Solution

新增好P友列表页：路由 `/mypixiv`（登录可达），消费 `GET /v1/user/mypixiv` 返回的 `user_previews`（UserPreview 形状）+ `next_url` 续页。页面 = PageTopBar（返回变体）+ UserRow 行列表（头像 + 用户名 + 关注/取关按钮，`is_followed` 驱动）+ RefreshableList（下拉刷新）+ FeedListFooter（分页三态）+ deriveFirstLoadView 页级首载三态（骨架 / 错误 / 空态 / 内容）。入口 = Me 页「好P友」行；benchNav 场景 `mypixiv` 注册供模拟器/真机验证直达。本批 lynx-only。

## User Stories

1. As a lynx 用户, I want 在「我」页看到「好P友」入口行, so that 我能找到自己的好P友列表（计数数字背后的人首次可达）
2. As a 用户, I want 打开好P友页看到与我互关的用户列表（头像 / 昵称 / @账号）, so that 我知道自己的好P友都是谁
3. As a 用户, I want 点行的头像或昵称进入该用户主页, so that 我能继续浏览 TA 的作品
4. As a 用户, I want 在列表行内直接关注/取关该用户, so that 不必进主页就能管理这段关系
5. As a 用户, I want 列表滚动到底自动加载更多, so that 长列表无需手动翻页
6. As a 用户, I want 加载更多失败时在列表尾看到重试入口且已加载内容不丢, so that 网络抖动不毁掉本次浏览
7. As a 用户, I want 下拉刷新回到服务端最新真值, so that 列表与我账号的好P友关系保持同步
8. As a 用户, I want 首载期间看到骨架而不是白屏, so that 页面响应可感知（先渲染后加载）
9. As a 用户, I want 还没有好P友时看到明确的空态提示（互相关注即可成为好P友）, so that 我知道空列表不是页面坏了
10. As a 用户, I want 首载失败看到错误态与重试按钮, so that 失败可恢复而不是卡死
11. As a 未登录访客, I want 直接访问 /mypixiv 被守卫重定向登录页, so that 未登录不可达（与全站行为一致）
12. As a 用户, I want 行内关注/取关即时生效（服务端成功才翻转按钮；失败给出提示且状态不误翻）, so that 我不会误判关系状态（禁静默降级）
13. As a 用户, I want 浏览途中（翻页追加、进出用户主页再回来）列表内同一用户不出现两种关注态, so that 同屏状态始终自洽
14. As a 用户, I want 从用户主页返回好P友列表时列表保持原数据与浏览位置、不重新走首载, so that 返回不闪屏、不重复请求
15. As a 用户, I want 被静音的用户仍出现在好P友列表, so that 列表与服务端真值一致（本地不做静音过滤）
16. As a 开发者/验收者, I want benchNav 场景 mypixiv 深链直达 /mypixiv, so that 模拟器/真机验证免手导航、零额外脚本
17. As a 开发者, I want 端点封装与页面文案有 CI 内单测/双字典防线, so that 契约与文案回归在合入前被拦住

## Implementation Decisions

**D1 端点封装（ADR-0193 D1）**：user API 模块新增 `getMyPixivUsers(userId, offset?)` → `GET /v1/user/mypixiv`，返回 `Promise<PixivUserFollowingResponse>`。参数跟随同模块既有 user 列表端点惯例（与 `getUserFollowing` 同风格）：`user_id` 必带（字符串化）、`offset` 可选（存在时字符串化展开）；filter 跟随同模块既有 user 列表端点惯例——`getUserFollowing` / `getUserFollowers` 均不携带 filter，mypixiv 同样**不引入**（好P友无 `restrict` 维度，不新增任何多余参数）。响应 `{ user_previews, next_url }` **复用** `PixivUserFollowingResponse` 承载（同构复用而非新类型——不新建 `PixivMyPixivResponse`，防双类型漂移）；`next_url` 续页复用既有 `loadUserListNext(url)`（完整 URL 透传，既有函数零改动）。`user_previews` 元素复用既有 `PixivUserPreview` 类型（UserPreview 形状 = `{ user, illusts, novels, is_muted }`）；lynx 侧类型**补齐 `novels` 字段**对齐 webview 同形（本批页面不消费 `novels`，字段对齐防解析面分叉）。

**D2 页面 `/mypixiv`（ADR-0193 D2）**：路由表新增 `/mypixiv`（name `mypixiv`，页面 MyPixiv.vue，`meta.requiresAuth: true`——未登录由全局守卫重定向 /login，与全站一致）。列表行复用公共组件 **UserRow**（头像 + 用户名 + 关注/取关按钮，信息密度与 FollowList 行对齐）：按钮由 `is_followed` 真值驱动；关注/取关与 lynx FollowList 的 `toggleFollow` 同款——**单飞锁**（busy 互斥防重入）+ **服务端成功后翻转**（非乐观，状态从未翻转即天然"失败回滚"）+ 失败走内联错误条（ADR-0104 槽位分离，禁静默吞错）。`is_followed === undefined` **不播种**：好P友语境不存在 FollowList 对 following 列表的播种特判（following 列表天然已关注），按字段真值渲染（缺失 → falsy → 渲染「关注」可点）。命中区域分离：头像/昵称区导航 `/user/:id`（与 FollowList 同导航语义），按钮区动作，两区不嵌套（真机 hit-testing 教训，ADR-0123 家族）。容器 = **RefreshableList**（下拉刷新，刷新状态机内收、页面零自持刷新态）+ **FeedListFooter**（加载中 / 分页错误重试 / 到底三态）+ **PageTopBar**（‹返回 + 标题「好P友」返回变体）；空态 = **EmptyState**；页级首载三态 = **deriveFirstLoadView**（ADR-0150：骨架/错误/空/内容互斥单链，初始未落定即骨架——先渲染后加载，数据请求不阻塞页面框架）。`is_muted` 保留展示不过滤（服务端已下发标记，本地过滤与官方 App 行为不一致——ADR-0193 已否决）。

**D3 数据获取与竞态防护**：沿用既有列表页数据模式（与 FollowList 同款：页面持有列表状态、错误槽分流——首屏失败走三态错误分支、有数据时的刷新/分页失败走内联错误条；允许以仓库 Vue Query 无限分页先例（通知中心）承载，语义不变量不放宽）。**generation/abort 竞态防护不回退**（工作区硬约束）：刷新重建会话用 generation（在飞旧响应落地即作废）或 AbortController 等效机制；分页在飞锁 + 双防抖（FollowList 同款）。**返回不重复请求**：MyPixiv 进 KeepAlive 白名单（组件注册 name `mypixiv`，ADR-0049 机制），从用户主页返回不重挂载、不重置三态、不重发首载；刷新仅由显式动作触发。跨页关注变化（在用户主页取关后返回）的一致性边界如实声明：返回不自动重拉（避免「返回即请求」反模式），以下一次显式刷新回归服务端真值。

**D4 入口（ADR-0193 D3）**：Me 页功能入口卡区新增「好P友」行（i18n 键 `me.mypixiv`，文案「好P友」；行序邻位对齐 bookmarks/watchlist 行），点击导航 `/mypixiv`。

**D5 benchNav 场景注册（ADR-0136 模式）**：router benchNav TARGETS 静态表新增 `pictelioBenchNavMyPixiv: '/mypixiv'`（场景名 `mypixiv`；先例 `pictelioBenchNavWatchlist`；仅 BENCH_NAV 构建生效、生产整块消除），模拟器/真机验证免手导航。

**D6 i18n**：页面自有文案统一 `mypixiv.*` 前缀（标题 / 空态标题与提示 / 重试 / 列表尾三态等），zh-CN（源语言）+ en 双字典全量对齐；Me 入口行用 `me.mypixiv`；关注/取关按钮文案与 FollowList 共用既有词汇，不另起同义键。过 noDeadKeys 与 hardcode-gate 门禁（死键 / 硬编码文案零容忍）。

**D7 范围口径（ADR-0193 D4）**：本批交付严格 = 双向好P友关系的**用户列表**；申请/审批流与插画/小说好P友作品流端点均不做（见 Out of Scope）。lynx-only（webview 端对等实现不在本批；类型/端点封装形态已对齐 webview 惯例，后续移植零障碍）。

## Testing Decisions

- **只测外部行为**：请求 path/参数字面量、响应解析结果、页面可观测渲染（三态分支、错误文案、空态）与交互（导航回调、按钮提交），不测内部调用编排。
- **seam（三层）**：
  1. **api 层单测**：mock transport，成功 + 失败双路径（IO 边界硬约束 #1：HTTP 非 2xx、响应缺字段均覆盖）；响应 fixture 用**真实样例形状**（先例 = 既有 user api 测试与 user_previews fixtures；ADR-0193 风险节要求落地时以真实账号抓包 fixture 钉 schema），禁止手写自洽字段（硬约束 #2）。
  2. **页面 template 快照测试**（先例 = 既有 `*.template.test.ts`）：PageTopBar 返回变体 + 首载三态分支 + UserRow 行 + FeedListFooter + EmptyState。
  3. **路由注册守卫测试**（先例 = 既有路由 guards / router shim 测试）：`/mypixiv` 注册进路由表、`meta.requiresAuth` 拦截未登录、benchNav 目标 `pictelioBenchNavMyPixiv` 注册。
- **用例矩阵**：
  1. **响应解析**：path = `/v1/user/mypixiv`；参数 = `user_id` 必带 + `offset`（存在时字符串化、缺省不出现）；无 filter/`restrict` 冗余参数；响应映射为 `PixivUserFollowingResponse`（含 lynx `novels` 字段宽容解析）。
  2. **offset 续页**：`next_url` 非 null 时经 `loadUserListNext` 透传取下页；新页按 user id 去重合并，`next_url` 耗尽后列表尾进入「到底」态。
  3. **空列表**：`user_previews = []` 且已落定 → EmptyState 空态（非骨架/非错误）。
  4. **错误路径**：首载失败 → 错误三态 + 重试可恢复；分页失败 → FeedListFooter 分页错误态且已加载数据保留、重试续传；刷新失败有数据 → 内联错误条。
  5. **is_followed 缺失**：按钮渲染「关注」且**不播种**字段真值；点击走 `followUser` 提交对应用户 id。
  6. **行导航**：头像/昵称区点击 → `/user/:id`；按钮区点击不触发行导航（命中区域分离）。
  7. **守卫**：未登录（会话清除）导航 `/mypixiv` → 重定向 `/login`。

## Out of Scope

- 好P友**申请/审批流**：端点存在性无可靠来源（六客户端交叉验证未覆盖写操作）——**未求证，不做**，明确挂账待端点取证后立项
- `/v2/illust/mypixiv`、`/v1/novel/mypixiv` 好P友**作品流**（插画/小说 feed 面，独立信息架构，另行立项）
- 好P友作品聚合 feed
- webview 端对等页面（本批 lynx-only；四功能范围约定）
- `is_muted` 本地过滤（ADR-0193 已否决）；FollowList 加第三 mode（已否决——单向/双向语义与端点双分叉）
- 用户主页 `total_mypixiv_users` 计数的点击直达入口

## Further Notes

- **seam 决策声明（无人值守）**：本 spec 产出于无人值守会话，测试 seam 沿用仓库当前最高可用 seam 惯例（api 层 mock-transport 单测 + template 快照测试 + 路由注册守卫测试，未引入新测试基建），供事后审阅。
- **端点证据来源注记**：`GET /v1/user/mypixiv`（参数 `user_id` + 可选 `offset`，响应 `{ user_previews, next_url }`，元素为 UserPreview 形状）经 pixivpy / skana_pix / Pixora 等六个独立客户端交叉验证；网传 `/v1/mypixiv/users` 路径**不存在**（正确路径为 `/v1/user/mypixiv`）。该端点为跨客户端交叉验证结论而非本仓抓包实证——实现落地时以真实账号抓包 fixture 钉 schema，字段出入按宽容解析处置。
- **与 ADR/术语表双锚**：领域语言锚 `docs/adr/glossary-lynx-four-features.md`（好P友（MyPixiv）／用户预览（UserPreview）／UserRow（用户行）逐字对齐；「MyPixiv ≠ Following/Follower」辨析见术语表 #5）；决策锚 ADR-0193。本文与 ADR/源码不一致时，以 ADR/源码为准绳。
- **与 FollowList 的复用边界**：复用**表现层**（UserRow、UserPreview 形状、刷新/分页容器、toggleFollow 单飞锁模式），不复用页面容器语义——好P友是双向关系（无 `restrict` 维度、无 following 列表 `is_followed` 播种特判），塞进 FollowList 第三 mode 已被 ADR-0193 否决。
