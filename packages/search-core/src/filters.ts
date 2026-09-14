/**
 * 筛选状态规范类型与常量（spec docs/specs/search-advanced-filters.md §3.1）。
 *
 * 本包是双端单点事实源（#480 拍板：共享包单点，替代 ADR-0132 逐字镜像约定）。
 * 所有函数零 IO——请求构建/编解码/换算的副作用（fetch、路由跳转）归各端传输层。
 */

/** 期间预设档：1d=今天 / 1w=最近 7 天含今天 / 1m·6m·1y=日历回退 */
export type PeriodPreset = "1d" | "1w" | "1m" | "6m" | "1y";

export type SearchPeriod =
  | { kind: "any" }
  | { kind: "preset"; preset: PeriodPreset }
  | { kind: "custom"; start: string; end: string };

/** 收藏数带宽：闭区间，max=null 表示无上界（UI 标签「1000+」） */
export interface BookmarkBand {
  min: number;
  max: number | null;
}

export type RatioPattern = "landscape" | "portrait" | "square";

/** AI 覆盖（#479）：follow=听账号级设置；all/hide=本次搜索覆盖（不写回设置） */
export type AiOverride = "follow" | "all" | "hide";

export interface SearchFilters {
  period: SearchPeriod;
  bookmark: BookmarkBand | null;
  ratio: RatioPattern | null;
  /** 分辨率下限（px）：官方预设档即宽度与高度同值（研究文档 §1.2） */
  minPixels: number | null;
  aiOverride: AiOverride;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  period: { kind: "any" },
  bookmark: null,
  ratio: null,
  minPixels: null,
  aiOverride: "follow",
};

/**
 * 收藏数七档带宽 = 官方 iOS 8.7.3 抓包 `/v1/search/options` bookmark_ranges 下发值
 * （oracle：docs/research/pixiv-appapi-search-filter-params.md §1.2 Shaft SearchFilterV3.kt
 * L163-183 注释；`*` = 不限端）。硬编码常量，动态拉取列为增强（spec §3.1）。
 */
export const BOOKMARK_BANDS: readonly BookmarkBand[] = [
  { min: 10, max: 29 },
  { min: 30, max: 49 },
  { min: 50, max: 99 },
  { min: 100, max: 299 },
  { min: 300, max: 499 },
  { min: 500, max: 999 },
  { min: 1000, max: null },
];

const PERIOD_PRESETS: readonly PeriodPreset[] = ["1d", "1w", "1m", "6m", "1y"];
const RATIO_PATTERNS: readonly RatioPattern[] = ["landscape", "portrait", "square"];
const AI_OVERRIDES: readonly AiOverride[] = ["follow", "all", "hide"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateString(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}

export function isDefaultFilters(f: SearchFilters): boolean {
  return (
    f.period.kind === "any" &&
    f.bookmark === null &&
    f.ratio === null &&
    f.minPixels === null &&
    f.aiOverride === "follow"
  );
}

/** 激活筛选维数（搜索栏入口徽标；#476 Q6：无值即默认，不计「显式不过滤」态） */
export function countActiveFilters(f: SearchFilters): number {
  let n = 0;
  if (f.period.kind !== "any") n += 1;
  if (f.bookmark !== null) n += 1;
  if (f.ratio !== null) n += 1;
  if (f.minPixels !== null) n += 1;
  if (f.aiOverride !== "follow") n += 1;
  return n;
}

/**
 * 归一化：URL 等**不可信输入**逐字段校验，非法一律回默认（spec §6.3「非法值一律忽略」）。
 * 此处不做时钟相关校验（end ≤ 今天在 period.resolvePeriodRange 构建时判定）。
 */
export function normalizeFilters(raw: {
  period?: unknown;
  bookmark?: unknown;
  ratio?: unknown;
  minPixels?: unknown;
  aiOverride?: unknown;
}): SearchFilters {
  // ── period ──
  let period: SearchPeriod = { kind: "any" };
  const p = raw.period as { kind?: unknown; preset?: unknown; start?: unknown; end?: unknown } | undefined;
  if (p && p.kind === "preset" && PERIOD_PRESETS.includes(p.preset as PeriodPreset)) {
    period = { kind: "preset", preset: p.preset as PeriodPreset };
  } else if (
    p &&
    p.kind === "custom" &&
    isDateString(p.start) &&
    isDateString(p.end) &&
    (p.start as string) <= (p.end as string)
  ) {
    period = { kind: "custom", start: p.start as string, end: p.end as string };
  }

  // ── bookmark：接受带宽序号（URL fb）或带宽对象（store 内部） ──
  let bookmark: BookmarkBand | null = null;
  const b = raw.bookmark;
  if (typeof b === "number" && Number.isInteger(b) && b >= 0 && b < BOOKMARK_BANDS.length) {
    bookmark = { ...BOOKMARK_BANDS[b] };
  } else if (
    b &&
    typeof b === "object" &&
    typeof (b as BookmarkBand).min === "number" &&
    ((b as BookmarkBand).max === null || typeof (b as BookmarkBand).max === "number")
  ) {
    bookmark = { min: (b as BookmarkBand).min, max: (b as BookmarkBand).max };
  }

  // ── ratio ──
  const r = raw.ratio;
  const ratio: RatioPattern | null = RATIO_PATTERNS.includes(r as RatioPattern)
    ? (r as RatioPattern)
    : null;

  // ── minPixels：正整数（px 下限） ──
  const w = raw.minPixels;
  const minPixels: number | null =
    typeof w === "number" && Number.isInteger(w) && w > 0 ? w : null;

  // ── aiOverride ──
  const a = raw.aiOverride;
  const aiOverride: AiOverride = AI_OVERRIDES.includes(a as AiOverride)
    ? (a as AiOverride)
    : "follow";

  return { period, bookmark, ratio, minPixels, aiOverride };
}
