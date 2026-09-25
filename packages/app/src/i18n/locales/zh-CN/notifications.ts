// notifications 域（源语言）—— 通知中心（ADR-0188 / spec docs/specs/notification-center.md）。
// 覆盖：通知页三态、行文案占位、组头展开、入口铃铛与角标 a11y。
const zhNotifications = {
  // ── 通知页（/notifications）──
  "notifications.page.title": "通知",
  "notifications.page.back": "返回",
  "notifications.empty": "暂无通知",
  "notifications.noContent": "（无内容通知）",

  // ── 组头行（view_more 非空，点击就地展开子列表，单向不收起）──
  "notifications.header.expandAria": "展开「{{title}}」的详细通知",

  // ── 行可达性标签（未读/已读语义 + 主体文本组合）──
  "notifications.a11y.unread": "未读",
  "notifications.a11y.read": "已读",
  "notifications.a11y.openItem": "打开通知：",

  // ── 侧栏铃铛入口（SideNavShell，ADR-0188 D7）──
  "notifications.sidenav.bellAria": "通知",
  "notifications.sidenav.unreadAria": "通知（有未读）",
} as const;

export default zhNotifications;
export type ZhNotificationsKey = keyof typeof zhNotifications;
