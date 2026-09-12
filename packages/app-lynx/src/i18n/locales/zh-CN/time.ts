// 相对时间域（副端，B10 日期层消费）。zh 值 = 存量文案逐字快照。
const zhTime = {
  "time.justNow": "刚刚",
  "time.minutesAgo": "{{count}}分钟前",
  "time.hoursAgo": "{{count}}小时前",
  "time.daysAgo": "{{count}}天前",
} as const;

export default zhTime;
export type TimeKey = keyof typeof zhTime;
