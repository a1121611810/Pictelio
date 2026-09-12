// 集中日期格式化层（B10）：locale 感知。主端走 Intl（WebView ≥85 全量支持，
// Segmenter 除外——选型票 #494）；相对时间走 time.* 字典（i18n 响应式）。
import { currentLocale, t } from "@/i18n";

/** 绝对日期：zh `YYYY/M/D`；en `M/D/YYYY`（与原 toLocaleDateString("zh-CN") 输出对齐） */
export function formatDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  const localeTag = currentLocale() === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

/** 相对时间：<1min 刚刚 / <60min N分钟前 / <24h N小时前 / <30d N天前，之后落绝对日期 */
export function formatRelativeTime(dateStr: string, now: Date = new Date()): string {
  const d = new Date(dateStr);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (diffMin < 1) return t("time.justNow");
  if (diffMin < 60) return t("time.minutesAgo", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("time.hoursAgo", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return t("time.daysAgo", { count: diffDay });
  return formatDate(d);
}
