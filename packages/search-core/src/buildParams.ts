/**
 * 筛选状态 → 端点请求构建（spec §3.3 参数映射 + §3.4 热门矩阵 + §6.1 契约变更）。
 *
 * 真值 oracle：docs/research/pixiv-appapi-search-filter-params.md（Pixiv-Shaft 对齐
 * iOS 官方 8.6.5-8.7.3 抓包）。关键规则：
 * - `search_target` 由**用户可选档位**决定（spec docs/specs/search-target-mode.md §4，两端不对称）：
 *   illust 端 partial → **整个参数不传**（显式传 partial 会转严格标签匹配并忽略
 *   merge_plain_keyword_results，Shaft #906）；novel 端 partial → **显式发**（不传退化为纯字面
 *   匹配、同义词不展开，#1038）。novel 端不识别 title_and_caption（该端点不消费，UI 置灰）。
 * - 恒发 `merge_plain_keyword_results=true` / `include_translated_tag_results=true`
 *   （iOS/Shaft/pixez 一致）。`include_potential_violation_works` 维持不传（iOS 默认 false
 *   会隐藏部分作品）。`search_ai_type` 不接入（#479 裁决）。
 * - 热门矩阵（#478）：popular → popular-preview 端点，无 `sort`、无分页参数、
 *   **不携带收藏数区间**（服务端忽略），期间/比例/分辨率照常透传。
 * - scope 适用性（#476 Q4）：比例/分辨率仅进插画路（scope=novel 时即使状态残留也不发）；
 *   期间/收藏数双路携带（收藏数受热门排除约束）。
 * - 用户搜索（#1019 / spec docs/specs/search-user-scope.md §5.1）：`/v1/search/user` 一手实测，
 *   参数只有 word + filter + sort 三项——merge/include 两 bool 与 search_target 均**未发**且
 *   第三方实现（pixez / Mako）同款；该端点无 popular-preview 对应物，三档 sort 一律直发。
 */
import { resolvePeriodRange } from "./period";
import type { SearchFilters, SearchTargetMode } from "./filters";

export type SearchScope = "all" | "illust" | "novel" | "user";
export type SearchSort = "date_desc" | "date_asc" | "popular_desc";

export type SearchEndpointPath =
  | "/v1/search/illust"
  | "/v1/search/novel"
  | "/v1/search/user"
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

/**
 * 档位 → `search_target` 原始值映射（spec search-target-mode §4）。**两端不对称，别写反。**
 * `null` = 该端点不发送此参数。
 */
const ILLUST_TARGET_PARAMS: Record<SearchTargetMode, string | null> = {
  partial: null,
  exact: "exact_match_for_tags",
  title_and_caption: "title_and_caption",
};

const NOVEL_TARGET_PARAMS: Record<SearchTargetMode, string | null> = {
  partial: "partial_match_for_tags",
  exact: "exact_match_for_tags",
  // 小说端不识别该档（spec §4 证据强度：Mako 枚举只有 partial/exact/text/keyword），置灰不发送
  title_and_caption: null,
};

function applyTarget(
  params: Record<string, string>,
  table: Record<SearchTargetMode, string | null>,
  mode: SearchTargetMode,
): void {
  const value = table[mode];
  if (value !== null) params.search_target = value;
}

/** 期间段：popular-preview 同样接受期间（透传）；收藏数段见 applyBookmark（#478） */
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
  applyTarget(params, ILLUST_TARGET_PARAMS, filters.target);
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
  applyTarget(params, NOVEL_TARGET_PARAMS, filters.target);
  applyPeriod(params, filters, now);
  applyBookmark(params, filters, popular);
  // 比例/分辨率是插画专属维度：小说路**永不携带**（即使状态残留——#476 置灰不清值 + #475 §2）
  return { endpoint, params };
}

/**
 * 用户搜索（#1019）。不走 `baseParams`：merge/include 两 bool 与 `search_target` 实测未发，
 * 端点亦不消费期间/收藏数/比例/分辨率/AI 类型（spec §5.1）。
 * 用户端点无 popular-preview 对应物，`popular_desc` 同样直发 `/v1/search/user`。
 */
export function buildUserSearchRequest(input: {
  word: string;
  sort: SearchSort;
}): BuiltSearchRequest {
  return {
    endpoint: "/v1/search/user",
    params: { word: input.word, filter: "for_ios", sort: input.sort },
  };
}
