/**
 * 榜单日期工具（spec docs/specs/ranking.md §6.1）：校验 / 按天加减 / 展示分段。
 *
 * 设计约束：
 * - 展示格式化**不依赖 Intl**、也**不经本地时区**——Lynx 运行时无 Intl，且
 *   `new Date(iso)` 在负时区会把 YYYY-MM-DD 漂到前一天（「日期串天」）。两端共用本模块。
 * - 非法输入显式抛 `RangeError`（禁止静默降级返回错误日期）。
 * - 「今日」以日本时区（UTC+9，无夏令时）为界，对齐全项目其它日期换算（search-core/period.ts）。
 * - 日期运算一律走 `setUTCFullYear` 而非 `Date.UTC`/`new Date(y,…)`：后者会把 0-99 年
 *   重映射到 1900-1999（`Date.UTC(99,…)` = 1999），使低年份校验/加减出错。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 展示分段：对齐 i18n key `ranking.dateLong` 的 {{year}}/{{month}}/{{day}} 插值槽 */
export interface RankingDateParts {
  year: number;
  month: number;
  day: number;
}

/** 以 UTC 字段构造日期，不做两位数年份重映射（year 按字面值） */
function utcDate(year: number, monthIndex: number, day: number): Date {
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(year, monthIndex, day);
  return d;
}

/** 输出 YYYY-MM-DD；结果年份超出 0000-9999 时抛错，避免产生非 4 位年份的伪日期 */
function toIsoDate(d: Date): string {
  const year = d.getUTCFullYear();
  // !Number.isFinite 覆盖 Date 范围溢出后的 Invalid Date（getUTCFullYear() 为 NaN）
  if (!Number.isFinite(year) || year < 0 || year > 9999) {
    throw new RangeError("ranking-core: date out of supported 0000-9999 range");
  }
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${month}-${day}`;
}

/** 日本时区「今天」的 YYYY-MM-DD（注入 now 便于测试） */
export function jstToday(now: Date = new Date()): string {
  return toIsoDate(new Date(now.getTime() + JST_OFFSET_MS));
}

/** 公历该年该月的天数（month 为 1-12；monthIndex=month, day=0 即本月最后一天） */
function daysInMonth(year: number, month: number): number {
  return utcDate(year, month, 0).getUTCDate();
}

/** 严格校验：`YYYY-MM-DD` 且为真实存在的日历日 */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** 校验并解析为展示分段；非法输入抛 RangeError */
function parseDate(iso: string): RankingDateParts {
  if (!isDateString(iso)) {
    throw new RangeError(`ranking-core: invalid date string "${iso}"`);
  }
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

/**
 * 按天加减（跨月/跨年/闰年/世纪正确）。基于 UTC 日历运算，避免本地时区参与。
 * @throws RangeError 输入非合法日期串、deltaDays 非整数、或结果超出 0000-9999
 */
export function shiftDate(iso: string, deltaDays: number): string {
  const { year, month, day } = parseDate(iso);
  if (!Number.isInteger(deltaDays)) {
    throw new RangeError(`ranking-core: deltaDays must be an integer, got ${deltaDays}`);
  }
  return toIsoDate(utcDate(year, month - 1, day + deltaDays));
}

/**
 * 格式化为展示分段（i18n 插值参数），供两端 `t("ranking.dateLong", …)` 直接消费。
 * 手写解析、不经 `new Date(iso)`，保证跨时区不串天。
 * @throws RangeError 输入非合法 YYYY-MM-DD
 */
export function formatRankingDate(iso: string): RankingDateParts {
  return parseDate(iso);
}
