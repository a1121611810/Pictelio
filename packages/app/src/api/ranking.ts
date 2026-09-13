import { apiClient } from "./client";
import { buildRankingRequest, type RankingQuery } from "@pictelio/ranking-core";
import type { PixivIllustListResponse } from "./types";
import { assertPixivUrl } from "./urlGuard";

/**
 * 排行榜请求传输层（薄）：端点 / mode / date / filter 规则单点在 @pictelio/ranking-core
 * （spec docs/specs/ranking.md §6.1）。本文件只做 GET 与 next_url 域名断言。
 */
export function fetchRanking(
  query: RankingQuery,
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  const req = buildRankingRequest(query);
  return apiClient.get<PixivIllustListResponse>(req.path, req.params, signal);
}

export function fetchRankingNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  assertPixivUrl(url, "fetchRankingNext");
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal);
}
