// 相对时间域（评论等场景，B10 日期层消费）。zh 值 = 存量文案逐字快照。
const zhTime = {
  "time.justNow": "刚刚",
  "time.minuteAgo": "1分钟前",
  "time.hourAgo": "1小时前",
  "time.dayAgo": "1天前",
  "time.minutesAgo": "{{count}}分钟前",
  "time.hoursAgo": "{{count}}小时前",
  "time.daysAgo": "{{count}}天前",
} as const;

export default zhTime;
export type TimeKey = keyof typeof zhTime;
