# 术语表：通知中心（Notification Center）

> 状态：Accepted ｜ 日期：2026-09-26 ｜ 关联：ADR-0188、`docs/specs/notification-center.md`
> 来源调研：Pixiv AppAPI 真实抓包（2026-09-26，`/v1/notification/list` + `/v1/notification/view-more`，脱敏 fixture 落测试文件）；Pixiv-Shaft 一手实现（`API.kt:542-556`、`NotificationResponse.kt`）；本仓先例（ADR-0037 PixivApiPlugin 网关、ADR-0036 错误元组、ADR-0049 lynx KeepAlive）。

## 核心术语

| 术语 | 定义 | Avoid（避免混用） |
| --- | --- | --- |
| **通知（notification）** | Pixiv 服务端 `/v1/notification/list` 下发的一条条目（`NotificationItem`） | 「消息」「私信」（DM 是另一能力，本仓未做） |
| **通知中心（notification center）** | 应用内通知列表页（`/notifications` 路由，双端），含分页、组头展开、点击路由 | 「推送」（push 指系统级推送，v1 非目标） |
| **组头（group header）** | `view_more` 非空的条目（如「フォローされた」「すき！された」），点击经 view-more 端点摊平加载子列表 | 「折叠条」（实现上就是一条普通通知行 + 可展开） |
| **摊平子列表（flattened list）** | `/v1/notification/view-more?notification_id=` 返回的同类结构（`view_more: null` 的子条目 + `older_than` 游标分页） | — |
| **本地已读记忆（local read memory）** | 设备级时间戳键 `notifications_last_read_time`：用户最近一次查看通知中心的本地时间 | 「已读上报」（服务端**无** mark-read 端点；响应 `is_read` 字段只读不写） |
| **未读（unread）** | `created_datetime` 晚于本地已读记忆的条目（客户端推导，非服务端字段权威） | 「`is_read` 字段」（服务端字段与本地推导口径不同，两者独立存在） |
| **角标（badge）** | 入口上的未读提示：webview = SideNavShell 铃铛 + `fluent-badge` 圆点；lynx = Me 入口行圆点 | 「红点组件」（lynx 无现成 badge，需新做纯 CSS 圆点） |
| **系统推送（system push）** | Android 通知栏/FCM/WorkManager 后台周期检查——**v1 非目标**（ADR-0188 D1 挂账 Phase 2） | 勿把本功能统称「推送」 |

## 与既有概念的边界

- **vs Pixiv 官方推送**：官方 App 的 FCM 推送依赖 Pixiv 自有 Firebase 项目与服务端，第三方客户端无接入通道；Shaft/pixez 亦为拉取式。本功能本质是「拉取式通知页」。
- **vs 站内信/私信（DM）**：`/v1/chat` 私信是独立 API 域，v1 不涉及（差距清单 P3 挂账）。
- **vs 运营公告**：Shaft 另有 `/v1/info/latest` 公告面（与个人通知平行的独立 API）；本功能 v1 不做公告页。
- **vs 通知文本**：`content.text` 是含 `<b>` 的 HTML 片段（日文为主），v1 **剥标签为纯文本**渲染（不翻译、不做富文本）。

## 送达通道（Phase 2 / 导航 spec P2）专用词条

> 2026-10-06 随 [ADR-0220](./ADR-0220-notification-delivery-channel-probe.md) 补入。
> **本节即 ADR-0188 D1 挂账的 Phase 2**，也是 `docs/specs/app-lynx-navigation-dimension-restructure.md`
> §4「P2 · 送达通道」所指的**同一件工作**——两处曾各写一遍且互不引用，现已在 ADR-0220 对齐。

| 术语 | 定义 | Avoid（避免混用） |
| --- | --- | --- |
| **系统通知（system notification）** | Android 通知栏里的一条本地通知。由**设备本地轮询**产生，**无服务端参与**（决策 6：服务端推送明确不做）。 | 推送（见下方歧义 #3）、消息提醒 |
| **送达通道（delivery channel）** | 「能不能不打开 App 就知道有更新」这整件事的**总称**——含系统通知 + 角标 + 已读记忆三层。导航 spec 的 P2 用的就是这个词。 | 通知中心（那是**应用内**的拉取面，已交付）、推送 |
| **触达探测（delivery probe）** | 本仓对「送达通道」这次**实验**的自称。它**不是**一个功能名：目的是拿到「用户想不想要这个回执」的单点信号，**不是**交付可用功能。 | 通知功能、推送功能（会让人以为在交付功能） |
| **静默期（quiet period）** | 触发轮询前必须先经过的「用户没在主动看」时长。形态：进入前台后静默 N 秒才轮询。⚠️ Lynx 侧**没有窗口 focus 事件**（`queryClient` 已因此关闭 `refetchOnWindowFocus`），故「前台」只能用生命周期事件近似，**静默期是近似值不是精确判定**。 | 冷却时间（易与限流退避的退避期混）、防抖 |
| **发出样本（sent sample）** | 一次「本可以发通知但发了」的事件计数。是**打开率的分母**。⚠️ 汇总形态下**一次拉取 = 一个样本**，不管那批有几条更新。 | 通知数（逐条形态的叫法，汇总形态下会误导）、推送数 |
| **点击样本（clicked sample）** | 用户点开那条系统通知的计数。**分子**。 | 打开率（那是**比值**不是计数）、点击数（未说明单位） |
| **单轮探测（probe round）** | 从清零 `sent`/`clicked` 到判定为止的一段。`startedAt` **跨轮保留**，故多轮的时间线连得上。 | 实验轮次、会话 |

### 与既有词的边界（补）

- **系统通知 ≠ 通知中心条目**：前者是**设备**产出、走系统通知栏；后者是 **Pixiv 服务端**下发、在 `/notifications` 页展示。一个是「我们自己造的提醒」，一个是「上游给的消息」。
- **发通知 ≠ 标记已读**：`本地已读记忆` 只在用户**真的看过**时推进。系统通知弹出不推进已读记忆——否则用户没点通知也会被标成已读，**角标与未读数随即失真**。

## 歧义记录

1. 「通知/推送」在需求语境混用——ADR-0187 系列口径：**通知＝应用内拉取面**（v1 交付物）、**推送＝系统级后台投递**（Phase 2 挂账）。
2. 未读判定基于本地时间戳而非服务器 `is_read`：服务器在 view-more 展开后会把组头置 `is_read: true`（抓包实证），但无主动上报通道，跨设备不同步——本地推导是有意取舍（ADR-0188 D5）。

3. 「推送」一词在本仓有**三种**含义，须分清：① Pixiv 官方 App 的 FCM 推送（**无接入通道**，第三方客户端做不到）；② 本仓 Phase 2 的**本地系统通知**（ADR-0220，设备轮询产出）；③ 泛称。ADR-0188 D1 已把 ① 排除、② 挂账 Phase 2；ADR-0220 落地 ② 的**首次 Grill 结论**。本表其余各处提及「推送」时，一律指 ①。
