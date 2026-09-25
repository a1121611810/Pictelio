# ADR-0188：通知中心（拉取式应用内通知）

- 状态：Accepted
- 日期：2026-09-26
- 关联：`docs/adr/glossary-notification-center.md`（术语表）、`docs/specs/notification-center.md`（规格）、ADR-0036（错误元组）、ADR-0037（PixivApiPlugin 网关）、ADR-0103（跨引擎键契约）、ADR-0161（原生 POST 表单体——本功能无 POST，仅备注）

## 背景

差距清单 P1 项（2026-09-25 复验）：Pictelio 无任何通知系统（grep `notification` 双端零命中），官方 App 以通知/推送作为核心留存能力。第三方客户端的现实约束：Pixiv 无面向第三方的推送通道（FCM 依赖官方 Firebase 项目与服务端），pixez 未实现通知，Shaft 为拉取式通知页。

现状事实（一手取证，2026-09-26）：

- **端点实证（本机 refresh_token 真实抓包，HTTP 200）**：
  - `GET /v1/notification/list` → `{ notifications: NotificationItem[], next_url: string | null }`
  - `GET /v1/notification/view-more?notification_id={id}` → 同构 envelope；子条目 `view_more: null`；`next_url` 携带 `older_than` 游标（`?notification_id=…&limit=30&older_than=…`），单页 30 条
  - `NotificationItem = { id: number; created_datetime: string(+09:00 ISO); type: number; content: { text: string(含 <b> HTML); left_icon?: string; left_image?: string; right_icon?: string; right_image?: string } | null; view_more: { unread_exists: boolean; title: string } | null; target_url: string(pixiv:// scheme); is_read: boolean }`
  - `type` 实测样本：7（すき！/收藏类）、8（フォロー/关注类）；Shaft 注释证实渲染应完全依赖 `content.text`，`type` 仅作 hint
  - **无 mark-read 端点**；`is_read` 为服务端下发（view-more 展开后组头翻转为 true），客户端只读
  - 图片字段 URL 形态：`s.pximg.net`（公共图标）与 `i.pximg.net`（内容缩略图）——`i.pximg.net` 按仓库硬约束必须走 `/pixiv-img/` 代理（webview）/图片服务重写（lynx），禁直连；`s.pximg.net` 公共图标 v1 沿用仓库既有直通行为（代理通道硬编码 `i.pximg.net` 目标，多域承载需 Java 改动，挂账 follow-up；s.pximg 无 Referer 防盗链，直连为本仓全线既有行为）
- Java 侧零改动可行：`PixivApiPlugin.request()`（webview flavor）与 `PictelioApiModule.request()`（lynx flavor）均为 path 直拼、无白名单。
- 数据层：webview `createTQFeedStore` 的 `TItem extends { id; create_date }` 约束与 `created_datetime` 字段名不匹配，且单列表场景其 tab/merge 能力全部闲置；轻量先例是 `rankingStore`（`useInfiniteQuery` + queryKeys 工厂 + flatten）。
- 导航挂点：webview `SideNavShell.tsx` 顶列（搜索按钮→四 tab→设置/我），有 `fluent-badge` 组件先例；lynx `Me.vue` 功能入口卡区（bookmarks/watchlist/downloads/networkCheck 四行先例），无 badge 先例、无前台恢复钩子（webview 有 `appStateChange` 先例 ×2：authStore、otaService）。

## 调研结论

1. API oracle 单源（Shaft）+ 本仓真实抓包双确认，schema 可钉；但 `type` 枚举仅两个样本值，**必须**按「渲染看 text、type 仅 hint、字段 optional 宽容解析」姿态实现，未来新增类型不破。
2. 拉取式是竞品一致形态，v1 做应用内通知中心即可对齐差距；系统推送需自建后台基础设施，独立立项。
3. 前台刷新双端不对称：webview 有成熟 `appStateChange` 先例，lynx 无——v1 接受不对称（lynx 靠页面挂载刷新），原生 onResume 事件通道挂账。
4. 未读只能本地推导（无上报端点），设备级时间戳是最小正确模型。

## 决策

**D1 范围——v1 = 拉取式应用内通知中心；系统推送非目标。**
交付：通知列表页（双端）+ 分页 + 组头展开 + 点击路由 + 入口角标。挂账 Phase 2：WorkManager 周期后台检查 + Android 系统通知（需 `POST_NOTIFICATIONS` 权限声明、NotificationChannel、 lynx/webview flavor 落点评估）；FCM 不可行（无通道）。否决「v1 即做系统通知」：无推送通道的前提下后台轮询的电量/配额/权限面属独立 Grill 议题，避免范围扩散。

**D2 API 契约——按抓包 schema 钉类型，宽容解析。**
双端 `api/types.ts` 各自追加 `PixivNotificationListResponse` / `PixivNotificationItem` / `PixivNotificationContent` / `PixivNotificationViewMore`（字段如背景节，全 optional 宽容，对齐 `PixivBookmarkDetail` 先例）；`api/notification.ts` 各自实现 `loadNotifications(nextUrl?)` 与 `loadNotificationChildren(id, nextUrl?)`（GET + next_url 透传，形态对齐 `api/illust.ts`；错误经 tryAsync → `ApiError`）。**真实抓包脱敏 fixture**（2026-09-26 探针，双端点）落测试文件，满足测试硬约束 #2。Java 零改动。
否决共享包：类型双端字面量重复是该仓一贯形态（`PixivIllustTag` 等），无纯逻辑可抽。

**D3 数据层——各端轻量 infinite query，不用 createTQFeedStore。**
webview：`stores/notificationStore.ts`，`useInfiniteQuery` + queryKeys `["notification", "list"]` / `["notification", "children", id]`（rankingStore 形态；flatten 处兼容 `p.notifications`）。lynx：`useApiInfiniteQuery` + queryKeys `['pictelio', 'notifications', 'list'|'children', …]`（generation-gate 内建）。否决 createTQFeedStore：字段约束不符 + 能力闲置（调研 §3.1）。

**D4 渲染——text 剥 HTML 为纯文本；图片走代理。**
`content.text` 经标签剥离（`<b>`→内容保留、其余标签剔除、HTML 实体解码）渲染为纯文本行；不做富文本（lynx 无 HTML 渲染能力 + webview 注入面风险；bold 语义损失接受，富文本挂账）。`left_image`/`left_icon`/`right_*` 缩略图：URL 重写走图片代理通道（webview `/pixiv-img/`、lynx 图片服务），加载失败降级为无图（不占位卡）。行信息架构：缩略图（有则显示）+ 文本两行内 + 相对时间；组头行加「展开」 affordance，展开后**就地插入**子条目（子列表分页继续用 older_than 游标）。

**D5 未读模型——本地已读记忆（设备级）。**
键 `notifications_last_read_time`（双端逐字同键、设备级、ISO 时间戳字符串，ADR-0103 共享存储介质；不做账号级——已读体验无跨设备同步价值，v1 从简）。规则：进入通知中心页成功拉取后更新为当前时刻；角标数 = 首页首屏拉取结果中 `created_datetime` 晚于该键的条目数。服务器 `is_read` 字段 v1 不消费（本地推导已覆盖核心场景；两套口径混用反而引入歧义）。
否决「按 id 集合记录已读」：集合无界增长；否决「消费 is_read」：无上报通道，语义半吊子。

**D6 点击路由——pixiv:// scheme 映射 + 兜底。**
`pixiv://users/{id}` → `/user/{id}`；`pixiv://illusts/{id}` → `/illust/{id}`；`pixiv://novels/{id}` → `/novel/{id}`；`http(s)://` → 系统浏览器；其它 scheme 静默忽略（不抛错，Shaft 同语义）。双端各自实现（webview useNavigate；lynx router.push）。

**D7 入口——webview 侧栏铃铛 + lynx Me 入口行，独立 `/notifications` 路由。**
webview：`SideNavShell` 顶列搜索按钮下方加铃铛按钮（40×40 触控目标，未读时 `fluent-badge` 圆点），`router.tsx` 加 `/notifications`（requiresAuth 语义随端现状）。lynx：`Me.vue` 功能入口卡区加「通知」行（行尾未读圆点），`router.ts` 加 `/notifications`（`meta.requiresAuth: true`）。角标刷新时机：webview = 页面挂载 + `appStateChange` 前台恢复节流拉取（对齐 otaService 节流先例，阈值 5 分钟）；lynx = 通知页/Me 页挂载时（无前台通道挂账）。否决 lynx `NAV_TABS` 外环扩第 5 tab：外环 4 tab 是 ADR-0120 放射结构定式，通知非顶级浏览面。

**D8 v1 不做设置开关。**
通知不侵入 Feed（与 `ranking_entry`/`related_injection` 的入口开关动机不同），无耗电面（纯拉取）；Phase 2 引入后台检查时再评估开关。

## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| v1 做系统推送/WorkManager | 无第三方推送通道；后台轮询属独立 Grill（权限/电量/flavor 落点） |
| createTQFeedStore 承载列表 | `create_date` 约束不符；tab/merge 能力闲置 |
| 富文本/HTML 渲染 | lynx 无能力；webview 注入面；v1 纯文本信息无损 |
| 服务端 is_read 做未读 | 无上报端点，只读字段与本地行为脱节 |
| 账号级已读时间戳 | 已读无跨设备价值，设备级足够 |
| NAV_TABS 外环扩容 | 破坏放射 4 tab 定式 |

## 后果

- 正面：对齐 P1 差距；双端各一个页面 + 一个 API 模块，Java 零改动；fixture 真实样例满足契约测试硬约束。
- 取舍（已接受）：未读跨设备不同步；日文通知文本不翻译；lynx 角标无前台自动刷新（挂账原生 onResume 通道）；`type` 覆盖面仅 7/8 两样本（宽容解析兜底）；s.pximg 公共图标 v1 直连（多域代理扩展挂账）；组头展开采用 ADR-0162 结构规避（子列表内嵌组头 item 内条件段），真机展开取证挂发版前批次；行级 a11y 标签不消费服务端 is_read（与 D5 本地口径一致）。
- 后续候选（不在本期）：系统通知（WorkManager 周期 + NotificationChannel + POST_NOTIFICATIONS）、富文本渲染、公告面（`/v1/info`）、运营活动型通知的深度链接微调、lynx 前台恢复事件通道。
