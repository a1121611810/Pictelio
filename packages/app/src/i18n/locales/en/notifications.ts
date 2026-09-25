// notifications 域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// R9：占位符与 zh 完全一致。
import type { ZhNotificationsKey } from "../zh-CN/notifications";

const enNotifications = {
  // ── 通知页（/notifications）──
  "notifications.page.title": "Notifications",
  "notifications.page.back": "Back",
  "notifications.empty": "No notifications",
  "notifications.noContent": "(no content)",

  // ── 组头行（view_more 非空，点击就地展开子列表，单向不收起）──
  "notifications.header.expandAria": 'Expand notifications for "{{title}}"',

  // ── 行可达性标签（未读/已读语义 + 主体文本组合）──
  "notifications.a11y.unread": "unread",
  "notifications.a11y.read": "read",
  "notifications.a11y.openItem": "Open notification:",

  // ── 侧栏铃铛入口（SideNavShell，ADR-0188 D7）──
  "notifications.sidenav.bellAria": "Notifications",
  "notifications.sidenav.unreadAria": "Notifications (unread)",
} as const satisfies Record<ZhNotificationsKey, string>;

export default enNotifications;
