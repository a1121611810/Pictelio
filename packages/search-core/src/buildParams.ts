/**
 * 筛选状态 → 端点请求构建（spec §3.3 参数映射 + §3.4 热门矩阵 + §6.1 契约变更）。
 *
 * 真值 oracle：docs/research/pixiv-appapi-search-filter-params.md（Pixiv-Shaft 对齐
 * iOS 官方 8.6.5-8.7.3 抓包）。关键规则：
 * - `search_target` 修复（spec §6.1，Shaft #906/#1038）：illust 端单词标签**不传**该参数
 *   （不传 ≡ partial 且并入标题命中；显式传 partial 反而做严格 tag 匹配并忽略 merge 参数）；
 *   novel 端**恒显式传**（不传退化为纯字面匹配、同义词不展开）；含空格多标签两端都传
 *   `exact_match_for_tags`。
 * - 恒发 `merge_plain_keyword_results=true` / `include_translated_tag_results=true`
 *   （iOS/Shaft/pixez 一致）。`include_potential_violation_works` 维持不传（iOS 默认 false
 *   会隐藏部分作品）。`search_ai_type` 不接入（#479 裁决）。
 * - 热门矩阵（#478）：popular → popular-preview 端点，无 `sort`、无分页参数、
 *   **不携带收藏数区间**（服务端忽略），期间/比例/分辨率照常透传。
 * - scope 适用性（#476 Q4）：比例/分辨率仅进插画路（scope=novel 时即使状态残留也不发）；
 *   期间/收藏数双路携带（收藏数受热门排除约束）。
 */
import { resolvePeriodRange } from "./period";
import type { SearchFilters } from "./filters";

export type SearchScope = "all" | "illust" | "novel";
export type SearchSort = "date_desc" | "date_asc" | "popular_desc";

export type SearchEndpointPath =
  | "/v1/search/illust"
  | "/v1/search/novel"
  | "/v1/search/popular-preview/illust"
  | "/v1/search/popular-preview/novel";

export interface BuiltSearchRequest {
  endpoint: SearchEndpointPath;
  params: Record<string, string>;
}

export interface BuildSearchRequestInput {
  word: string;
  sort: SearchSort;
  filters: SearchFilters;
  /** 注入时钟（期间换算用）；缺省取当前时间 */
  now?: Date;
}

function isPopular(sort: SearchSort): boolean {
  return sort === "popular_desc";
}

/** 基础参数：word + 客户端姿态 + 恒发两个 bool（研究文档 §1.2 bool 行） */
function baseParams(word: string): Record<string, string> {
  return {
    word,
    filter: "for_ios",
    merge_plain_keyword_results: "true",
    include_translated_tag_results: "true",
  };
}

/** 插画端匹配方式：单词标签 → 不传（undefined 语义）；多标签 → exact（spec §6.1） */
function illustTargetParam(word: string): string | null {
  return word.includes(" ") ? "exact_match_for_tags" : null;
}

/** 小说端匹配方式：恒显式传（不传 = 纯字面匹配，#1038） */
function novelTargetParam(word: string): string {
  return word.includes(" ") ? "exact_match_for_tags" : "partial_match_for_tags";
}

/** 期间与收藏数公共段（两者都受热门矩阵约束的期间除外——期间热门透传） */
function applyPeriod(
  params: Record<string, string>,
  filters: SearchFilters,
  now: Date | undefined,
): void {
  const range = resolvePeriodRange(filters.period, now);
  if (range) {
    params.start_date = range.start;
    params.end_date = range.end;
  }
}

function applyBookmark(
  params: Record<string, string>,
  filters: SearchFilters,
  popular: boolean,
): void {
  // 热门矩阵：popular-preview 服务端忽略收藏数区间 → 干脆不携带（#478 置灰语义）
  if (popular || !filters.bookmark) return;
  params.bookmark_num_min = String(filters.bookmark.min);
  if (filters.bookmark.max !== null) params.bookmark_num_max = String(filters.bookmark.max);
}

export function buildIllustSearchRequest(input: BuildSearchRequestInput): BuiltSearchRequest {
  const { word, sort, filters, now } = input;
  const popular = isPopular(sort);
  const endpoint = popular ? "/v1/search/popular-preview/illust" : "/v1/search/illust";
  const params = baseParams(word);
  if (!popular) params.sort = sort;
  const target = illustTargetParam(word);
  if (target !== null) params.search_target = target;
  applyPeriod(params, filters, now);
  applyBookmark(params, filters, popular);
  if (filters.ratio !== null) params.ratio_pattern = filters.ratio;
  if (filters.minPixels !== null) {
    params.width_min = String(filters.minPixels);
    params.height_min = String(filters.minPixels);
  }
  return { endpoint, params };
}

export function buildNovelSearchRequest(input: BuildSearchRequestInput): BuiltSearchRequest {
  const { word, sort, filters, now } = input;
  const popular = isPopular(sort);
  const endpoint = popular ? "/v1/search/popular-preview/novel" : "/v1/search/novel";
  const params = baseParams(word);
  if (!popular) params.sort = sort;
  params.search_target = novelTargetParam(word);
  applyPeriod(params, filters, now);
  applyBookmark(params, filters, popular);
  // 比例/分辨率是插画专属维度：小说路**永不携带**（即使状态残留——#476 置灰不清值 + #475 §2）
  return { endpoint, params };
}
