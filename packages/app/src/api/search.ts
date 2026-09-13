import { apiClient } from "./client";
import { assertPixivUrl } from "./urlGuard";
import {
  buildIllustSearchRequest,
  buildNovelSearchRequest,
  DEFAULT_SEARCH_FILTERS,
  type SearchFilters,
} from "@pictelio/search-core";
import type {
  PixivIllustListResponse,
  PixivNovelListResponse,
  SearchSort,
  PixivAutocompleteResponse,
} from "./types";

/**
 * 搜索请求传输层（薄）：端点路由 / search_target 规则 / 筛选→参数映射全部单点在
 * `@pictelio/search-core`（#480 拍板；ADR-0132 第 8 条修订）。本文件只做 GET 与 next_url 断言。
 */
export function searchIllust(
  word: string,
  sort: SearchSort = "date_desc",
  signal?: AbortSignal,
  filters: SearchFilters = DEFAULT_SEARCH_FILTERS,
): Promise<PixivIllustListResponse> {
  const req = buildIllustSearchRequest({ word, sort, filters });
  return apiClient.get<PixivIllustListResponse>(req.endpoint, req.params, signal);
}

export function searchNovel(
  word: string,
  sort: SearchSort = "date_desc",
  signal?: AbortSignal,
  filters: SearchFilters = DEFAULT_SEARCH_FILTERS,
): Promise<PixivNovelListResponse> {
  const req = buildNovelSearchRequest({ word, sort, filters });
  return apiClient.get<PixivNovelListResponse>(req.endpoint, req.params, signal);
}

export function searchIllustNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  // 安全校验：只允许 Pixiv API 域名的 next_url（预防 SSRF）
  assertPixivUrl(url, "searchIllustNext");
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal);
}

export function searchNovelNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  assertPixivUrl(url, "searchNovelNext");
  return apiClient.get<PixivNovelListResponse>(url, undefined, signal);
}

export function searchAutocomplete(
  word: string,
  signal?: AbortSignal,
): Promise<PixivAutocompleteResponse> {
  return apiClient.get<PixivAutocompleteResponse>(
    "/v1/search/autocomplete",
    { word, merge_dict: "true" },
    signal,
  );
}
