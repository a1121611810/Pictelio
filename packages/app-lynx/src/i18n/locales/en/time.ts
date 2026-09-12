// 相对时间域（en）——按 docs/style-guides/ui-copy.md（Apple HIG 基线）。
import type { TimeKey } from "../zh-CN/time";

const enTime = {
  "time.justNow": "Now",
  "time.minutesAgo": "{{count}} minutes ago",
  "time.hoursAgo": "{{count}} hours ago",
  "time.daysAgo": "{{count}} days ago",
} as const satisfies Record<TimeKey, string>;

export default enTime;
