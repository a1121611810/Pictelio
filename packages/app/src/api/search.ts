import { apiClient } from "./client";
import type {
  PixivIllustListResponse,
  PixivNovelListResponse,
  SearchSort,
  SearchTarget,
  PixivAutocompleteResponse,
} from "./types";

/** 验证 next_url 只指向 Pixiv API 域名（防御 SSRF） */
function assertPixivUrl(url: string, fnName: string): void {
  // 允许本地代理路径
  if (url.startsWith("/pixiv-api")) return;
  // 验证绝对 URL 的 hostname
  const [urlErr, parsed] = trySync(() => new URL(url));
  if (!urlErr && parsed.hostname === "app-api.pixiv.net") return;
  throw new Error(`${fnName}: invalid next_url — must point to app-api.pixiv.net`);
}

export function searchIllust(
  word: string,
  sort: SearchSort = "date_desc",
  searchTarget: SearchTarget = "partial_match_for_tags",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/search/illust",
    { word, sort, search_target: searchTarget, filter: "for_ios" },
    signal,
  );
}

export function searchNovel(
  word: string,
  sort: SearchSort = "date_desc",
  searchTarget: SearchTarget = "partial_match_for_tags",
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(
    "/v1/search/novel",
    { word, sort, search_target: searchTarget, filter: "for_ios" },
    signal,
  );
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
