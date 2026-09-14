/**
 * 期间 → 请求日期区间换算（spec §3.3：预设档换算成 start_date/end_date 直发，
 * 不发 duration——对齐 iOS 8.6.6 行为；oracle：研究文档 §1.1/§1.2 duration 行）。
 *
 * 日期以**日本时区当天**为界（研究文档 §1.1 start_date/end_date 行：Mako JapanTime 校验；
 * pixiv 服务端语义）。日本无夏令时，固定 UTC+9。
 */
import type { SearchPeriod } from "./filters";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface PeriodRange {
  start: string;
  end: string;
}

/** 日本时区「今天」的 YYYY-MM-DD */
function jstToday(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * 期间 → 闭区间；不可用期间返回 null（调用方省略参数，**禁止静默降级为半区间**）：
 * - any → null
 * - custom 格式非法 / start > end / end > 今天 → null（服务端会 400，提前拦下）
 * - 未知预设档 → null
 *
 * 预设档窗口语义为 **UI 约定**（官方未承诺换算细节）：end=今天（JST）；
 * start：1d=今天；1w=今天-6 天（最近 7 天含今天）；1m/6m/1y=日历回退 1/6/12 个月。
 */
export function resolvePeriodRange(period: SearchPeriod, now: Date = new Date()): PeriodRange | null {
  if (period.kind === "any") return null;
  const end = jstToday(now);
  if (period.kind === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end)) {
      return null;
    }
    if (period.start > period.end || period.end > end) return null;
    return { start: period.start, end: period.end };
  }
  if (period.preset === "1d") return { start: end, end };
  if (period.preset === "1w") return { start: shiftDays(end, -6), end };
  const months = period.preset === "1m" ? -1 : period.preset === "6m" ? -6 : period.preset === "1y" ? -12 : null;
  if (months === null) return null;
  return { start: shiftMonths(end, months), end };
}
