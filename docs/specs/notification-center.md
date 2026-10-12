# Spec：通知中心（Notification Center）

> 状态：implemented（2026-09-26，双端落地 + code-review 三轮闭环零阻塞）｜ 日期：2026-09-26 ｜ 依据：ADR-0188 + `docs/adr/glossary-notification-center.md`
> 双端范围：webview（packages/app）+ lynx（packages/app-lynx）｜ API oracle：2026-09-26 真实抓包（脱敏 fixture 随测试落库）+ Pixiv-Shaft 一手实现交叉

## Problem Statement

Pictelio 无任何通知能力（关注/收藏/评论等事件用户不可感知），差距清单 P1。Pixiv 无第三方推送通道，竞品 Shaft 为拉取式通知页（pixez 未实现）。

## Solution

拉取式应用内通知中心：双端 `/notifications` 路由页 + `GET /v1/notification/list`（分页）+ `GET /v1/notification/view-more`（组头摊平）+ 入口角标（本地已读记忆推导未读）。系统推送挂账 Phase 2。

## User Stories

1. 作为用户，我从侧栏铃铛（webview）/Me 入口行（lynx）进入通知页，看到关注、すき！等事件列表。
2. 作为用户，我点击「フォローされた」组头，就地展开其子列表并可继续翻页。
3. 作为用户，我点击一条指向作品的通知，直达作品详情；指向用户的直达用户页。
4. 作为用户，我看完通知后返回，入口角标消失；再来新通知时角标重新出现。
5. 作为用户，图片加载失败的通知行仍可读（纯文本 + 相对时间）。

## 数据流

```
[入口角标] → loadNotifications()（首屏 1 页）
   → 未读数 = notifications.filter(created_datetime > notifications_last_read_time).length
   → webview: SideNavShell fluent-badge；lynx: Me 行尾圆点
   → 刷新时机：webview = 通知页挂载 + appStateChange 前台恢复（≥5min 节流）
              lynx = 通知页挂载 + Me 页挂载
[通知页] → useInfiniteQuery(["notification","list"]) 分页（next_url 透传）
[组头展开] → loadNotificationChildren(id) → 就地插入子条目；子列表分页走 older_than 游标
[进入通知页拉取成功] → notifications_last_read_time = now
[点击行] → target_url 解析：pixiv://users|illusts|novels/{id} → 端内路由；
          http(s) → 系统浏览器；其它 scheme → 忽略
```

## 状态变化

| 状态 | 触发 | 结果 |
| --- | --- | --- |
| idle → loading | 页面挂载 / 组头展开 / 加载更多 | 骨架/spinner；失败 → 内联错误 + 重试（ApiError 透传） |
| 组头折叠 → 展开 | 点击组头行 | 拉子列表（独立 query 键 `["notification","children",id]`），子条目就地插入组头之后 |
| 未读 > 0 → 0 | 通知页拉取成功 | 更新本地已读时间戳；入口角标隐藏 |
| 角标刷新 | 前台恢复/页面挂载 | 静默拉首屏，仅更新计数，不打扰当前页 |

## 边界条件

1. **空列表**：首屏 `notifications: []` → 空态插画/文案（「暂无通知」），非错误。
2. **content null / 字段缺失**：宽容解析（全 optional）；`content` 为 null 的行渲染为「（无内容通知）」占位文本，可点击路由（target_url 仍有效）。
3. **next_url null**：列表尽头，加载更多 affordance 隐藏。view-more 的 `older_than` 游标同理。
4. **HTML 剥离**：`<b>…</b>` 保留内文；其它标签剔除；实体（`&amp;` 等）解码；结果 trim。禁止把 HTML 注入 DOM（innerHTML 禁用）。
5. **图片代理**：`content.left_image`/`right_image`（`i.pximg.net` 内容缩略图）**与** `content.*_icon`（`s.pximg.net` 公共图标）**经同一条图片交付链**（当前唯一运行时 = lynx 图片服务；webview 侧随 ADR-0203 整包删除，历史实现 `resolveImageUrl` 曾显式豁免 `s.pximg.net` 不改写）。lynx 侧放行判据是 `PictelioImageService.canParseUrl()` 的 `url.startsWith("http")`，任意 Pixiv 域名的绝对 URL 均放行，故 `s.pximg.net` 图标同样获得两层缓存与 Referer/UA 注入。两者的**差异只在 JS 层 URL 形态**：`proxyImageUrl` 把 `i.pximg.net` 改写成 `/pixiv-img/` 相对路径，`s.pximg.net` 命中信任白名单后原样返回——形态归一，不是绕过管道（见 `PixivImageLoader.cacheKey` 上方 #980 注释「形态归一 ≠ 换源」）。

   **图床换源（`ImageHostConfig.resolve`）在图床开启时同样作用到这两类 URL**——该方法只判 `http` 前缀、无域名闸门。但**能否取到字节取决于镜像覆盖面**：竞品 **Pixiv-Shaft**（`ceui.lisa`，`ImageHostManager.kt`）实测——`s.pixiv.*` 为 NXDOMAIN、`i.pixiv.*` 对 `/common/images/*` 返 404，即镜像**可能不服务 `s.pximg.net` 路径**（证据见 `docs/research/competitor-direct-connect-and-ai-2026-09.md` §1.2.4「镜像域名」，原文引竞品仓库 issue #1152，**非本仓 issue**）。命中该情形时 `PixivImageLoader.download` 记 `Log.w` 并回退官方一次：功能不丢，但多一次往返。**本仓镜像对 `s.pximg.net` 的覆盖面未验证**（两台测试设备均未配置镜像，无样本）。

   > ⚠️ **本条曾有一句失真陈述，已于 2026-10-12 订正**（挂账票 #734 随之按「已实现」关闭、`wontfix`）：当时的措辞把 `s.pximg.net` 描述为「沿用直通行为」，并把原因归给「代理通道目标写死为 `i.pximg.net`」。该归因不成立——`OAuthConfig.IMAGE_CDN_URL` 的两个生产消费点里，**只有** `PixivImageLoader.rewriteUrl()` 参与 URL 反查且**仅对含 `/pixiv-img/` 的路径生效**（另一个消费点是 `NetDiagProbe` 的网络自检探针 baseUrl，与图片加载链路无关）；它**不是域名闸门**。「`s.pximg.net` 无 Referer 防盗链」属实（2026-10-12 实测：无 Referer 返 200；对照 `i.pximg.net` 无 Referer 返 403），但与「是否进管道」无关。行为锚：`PictelioImageServiceTest`（JVM 行为）与 `Notifications.iconProxyContract.test.ts`（跨端 + 本文档措辞门禁）；任一侧漂移即红灯。

   加载失败 → 隐藏图区（不占位、不重试风暴）。
6. **未读时间比较**：`created_datetime`（+09:00 ISO）与本地时间戳比较统一转毫秒（`Date.parse`）；解析失败该条不计未读（warn）。
7. **R18 内容缩略图**：通知缩略图不做 R18 遮罩（v1 简化，通知面非浏览面；挂账）。
8. **401**：走 client 既有自动刷新 + 单飞重试，无新逻辑。
9. **组头展开后再折叠**：v1 展开为单向（不提供收起），避免插入区状态管理复杂度。
10. **重复进入**：进入页已读时间戳更新在拉取**成功后**（失败不推进，保证未读不丢）。

## Implementation Decisions

- **webview**：
  - `api/types.ts` 追加 `PixivNotificationListResponse`/`PixivNotificationItem`/`PixivNotificationContent`/`PixivNotificationViewMore`（全 optional 宽容）；
  - `api/notification.ts`：`loadNotifications(nextUrl?)` / `loadNotificationChildren(id, nextUrl?)`（GET、next_url 透传、tryAsync → ApiError）；
  - `stores/notificationStore.ts`：`useInfiniteQuery`（queryKeys `["notification","list"]` / `["notification","children",id]`），rankingStore 形态；
  - `utils/notificationText.ts`：HTML 剥离纯文本纯函数；
  - `routes/Notifications.tsx` + `router.tsx` 路由 + `SideNavShell` 铃铛入口（fluent-badge）+ 未读检查 store 动作（`appStateChange` 节流 5min，形态对齐 otaService）；
  - i18n 新域 `notifications`（zh/en）。
- **lynx**：
  - `api/types.ts` / `api/notification.ts` 同构（client 形态对齐 `api/illust.ts`）；
  - `stores/notificationStore.ts`（Vue Query `useApiInfiniteQuery`，queryKeys `['pictelio','notifications',…]`）；
  - `utils/notificationText.ts` 同语义纯函数（双端各自实现，differential 测试）；
  - `pages/Notifications.vue` + `router.ts` 路由（requiresAuth）+ `Me.vue` 功能入口卡区行（行尾未读圆点，挂载时刷新）；
  - i18n `pages.ts`/`misc.ts`（zh/en）。
- Java 零改动（两端 request 桥无白名单）。
- 键名：`notifications_last_read_time` 双端逐字一致；不进备份域（设备级体验数据）。

## Testing Decisions

- **契约测试（真实样例）**：fixture = 2026-09-26 抓包脱敏样本（`/tmp/notif-fixture-list.json`、`/tmp/notif-fixture-viewmore.json`，实施时落 `tests/unit/api/fixtures/`），断言字段结构逐字（notifications/next_url/id/created_datetime/type/content.text/view_more/target_url/is_read）+ 端点路径 + view-more 的 older_than 游标透传。
- **API 单测**：成功（调用形状逐参）+ 失败（ApiError 透传）双路径；mock 模式复制 `tests/unit/api/illust.test.ts`。
- **纯函数**：`notificationText` 双端 differential（`<b>` 保留/嵌套标签/实体解码/空串/null）。
- **未读推导**：时间戳比较边界（新/旧/等值/解析失败）真值表。
- **路由解析**：pixiv:// 三 scheme + http(s) + 未知 scheme 忽略。
- **store**：分页 accumulate、组头插入、错误重试、已读时间戳推进条件（成功才推进）。
- IO 边界硬约束：全部网络读取函数成功+失败双路径。

## Out of Scope

- 系统推送 / WorkManager 后台检查 / POST_NOTIFICATIONS（Phase 2 独立 Grill）
  → 📌 **该 Grill 已完成（2026-10-06），形态决策见
  [ADR-0220](../../adr/ADR-0220-notification-delivery-channel-probe.md)**。结论要点：
  定为「补生命周期事件 + 进入前台 + 静默期后轮询」的**触达探测**（非通知功能），
  **不是**本条原措辞的「WorkManager 后台检查」；只拿定性信号、**不设统计阈值**（单用户样本量不足）。
  同一件工作在 `app-lynx-navigation-dimension-restructure.md` §4 称「P2 · 送达通道」，三处已互相引用。
- 富文本渲染、通知文本翻译
- 公告面（`/v1/info/latest`）
- 服务端 is_read 消费、已读跨设备同步
- R18 缩略图遮罩、组头收起
- 设置开关
- lynx 前台恢复原生事件通道（挂账 ADR-0188 后果节）
  → 📌 ADR-0220 D2 决定**补**该通道（作为「静默期」判定的基础），此项随 ADR-0220 一并落地

## Further Notes

- 真实样例探针脚本（一次性、凭据不落盘）：`/tmp/pixiv-notif-probe.sh`、`/tmp/pixiv-viewmore-probe.sh`（不入库）。
- fixture 脱敏规则：用户名→假名、≥6 位数字 id→假 id（保持类型/URL 形状/HTML 结构不变）；`is_read`/`view_more`/枚举值原样保留。
- 真机验收批次（tracking #736）：通知图片代理链路（i.pximg 经代理）、组头展开真数据流（ADR-0162 结构规避——子列表内嵌组头 item 内条件段——的设备取证）、角标刷新时机（webview 前台恢复节流；lynx Me onActivated 重入刷新），发版前按 checklist 执行。
