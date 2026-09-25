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

## 歧义记录

1. 「通知/推送」在需求语境混用——ADR-0187 系列口径：**通知＝应用内拉取面**（v1 交付物）、**推送＝系统级后台投递**（Phase 2 挂账）。
2. 未读判定基于本地时间戳而非服务器 `is_read`：服务器在 view-more 展开后会把组头置 `is_read: true`（抓包实证），但无主动上报通道，跨设备不同步——本地推导是有意取舍（ADR-0188 D5）。
