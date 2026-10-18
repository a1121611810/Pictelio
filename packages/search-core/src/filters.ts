/**
 * 筛选状态规范类型与常量（spec docs/specs/search-advanced-filters.md §3.1）。
 *
 * 本包是单端（app-lynx）单点事实源（#480 拍板：共享包单点，替代 ADR-0132 逐字镜像约定）。
 * 所有函数零 IO——请求构建/换算的副作用（fetch、路由跳转）归 app-lynx 传输层。
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

/**
 * 搜索目标档位（用户可选）。注意与 Pixiv API 的 search_target **原始值**不是一回事：
 * partial 在两端映射到不同的「是否显式发送」——见 spec docs/specs/search-target-mode.md §4 表。
 */
export type SearchTargetMode = "partial" | "exact" | "title_and_caption";

export interface SearchFilters {
  period: SearchPeriod;
  bookmark: BookmarkBand | null;
  ratio: RatioPattern | null;
  /** 分辨率下限（px）：官方预设档即宽度与高度同值（研究文档 §1.2） */
  minPixels: number | null;
  aiOverride: AiOverride;
  /** 搜索目标档位；默认 partial（= 维持现状，见 spec search-target-mode §5 行为变更） */
  target: SearchTargetMode;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  period: { kind: "any" },
  bookmark: null,
  ratio: null,
  minPixels: null,
  aiOverride: "follow",
  target: "partial",
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

/** 激活筛选维数（搜索栏入口徽标；#476 Q6：无值即默认，不计「显式不过滤」态） */
export function countActiveFilters(f: SearchFilters): number {
  let n = 0;
  if (f.period.kind !== "any") n += 1;
  if (f.bookmark !== null) n += 1;
  if (f.ratio !== null) n += 1;
  if (f.minPixels !== null) n += 1;
  if (f.aiOverride !== "follow") n += 1;
  if (f.target !== "partial") n += 1;
  return n;
}
