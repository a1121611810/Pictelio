/**
 * 筛选状态 → 端点请求构建（spec §3.3 参数映射 + §3.4 热门矩阵 + §6.1 契约变更）。
 * 真值 oracle：docs/research/pixiv-appapi-search-filter-params.md（Pixiv-Shaft 对齐 iOS
 * 官方 8.6.5-8.7.3 抓包）。⚠️ 2026-10-17 一轮**绕过本文档**的一手 AppAPI 实测推翻了其中
 * 两条**理由**（§11.1 / §11.3），**但映射全部保持不变**（保守选择，不依赖被推翻的理由）；
 * 改的只是理由与置信度，采样明细与复跑入口一律以该文档 §11 为准：
 * - `search_target`（用户可选档位，两端不对称，spec search-target-mode.md §4）：illust 端
 *   partial → **不传**（#906「显式传会转严格标签匹配」**未复现**，§11.1）；novel 端 partial
 *   → **显式发**（方向可信、机制未证实，§11.5）；novel 端 `title_and_caption`
 *   **实测被拒（HTTP 400）** ⇒ 置灰保值不放宽（spec §4 表）；user 端**必须不发**——枚举校验、
 *   任何取值皆 400（§11.3），「不消费」是危险措辞。
 * - 恒发两 bool 的理由**已下调**（`merge_plain_keyword_results` 三端无可观测效果，§11.2）⇒ 只因
 *   无害 + 对齐第三方而保留；`include_potential_violation_works` 不传、`search_ai_type` 不接入
 *   （#479）。热门矩阵（#478）/ scope 适用性（#476）/ 用户端三档 sort 逐位相同见 §11.3-§11.4。
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
  // 小说端 title_and_caption 实测被拒（HTTP 400，非「不识别」）⇒ 置灰保值不发；
  // 放宽它会让每一次小说搜索直接失败。spec §4 + verify-novel-title-target.sh
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
