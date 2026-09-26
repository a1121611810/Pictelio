// notifications 域（源语言）—— 通知中心（ADR-0188 / spec docs/specs/notification-center.md）。
// 覆盖：通知页三态、行文案占位、入口铃铛与角标 a11y。
// （组头展开为就地插入点击行为，无独立 aria 文案；行标签不消费服务端 is_read——review SF3）
const zhNotifications = {
  // ── 通知页（/notifications）──
  "notifications.page.title": "通知",
  "notifications.page.back": "返回",
  "notifications.empty": "暂无通知",
  "notifications.noContent": "（无内容通知）",

  // ── 行可达性标签（打开语义 + 主体文本组合）──
  "notifications.a11y.openItem": "打开通知：",

  // ── 侧栏铃铛入口（SideNavShell，ADR-0188 D7）──
  "notifications.sidenav.bellAria": "通知",
  "notifications.sidenav.unreadAria": "通知（有未读）",
} as const;

export default zhNotifications;
export type ZhNotificationsKey = keyof typeof zhNotifications;
