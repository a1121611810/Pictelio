// 集中日期格式化层（B10）：Lynx 运行时无 Intl（选型票 #494）——绝对日期手写；
// 相对时间走 time.* 字典（module ref 响应式）。
import { locale, SOURCE_LOCALE, t } from "../i18n"

/** 绝对日期：zh `YYYY/M/D`；en `M/D/YYYY`（与原 toLocaleDateString('zh-CN') 输出对齐） */
export function formatDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return locale.value === SOURCE_LOCALE ? `${y}/${m}/${day}` : `${m}/${day}/${y}`
}

/** 相对时间：<1min 刚刚 / <60min N分钟前 / <24h N小时前 / <30d N天前，之后落绝对日期 */
export function formatRelativeTime(dateStr: string, now: Date = new Date()): string {
  const d = new Date(dateStr)
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000)
  if (diffMin < 1) return t("time.justNow")
  if (diffMin < 60) return t("time.minutesAgo", { count: diffMin })
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return t("time.hoursAgo", { count: diffHour })
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return t("time.daysAgo", { count: diffDay })
  return formatDate(d)
}
