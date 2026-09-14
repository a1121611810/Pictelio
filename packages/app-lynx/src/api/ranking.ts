// ─── 排行榜 API（薄传输层；spec docs/specs/ranking.md §6.1） ───
// 端点 / mode / date / filter 规则单点在 @pictelio/ranking-core，本文件只做 GET。
import { apiClient } from "./client"
import { buildRankingRequest, type RankingQuery } from "@pictelio/ranking-core"
import type { PixivIllustListResponse } from "./types"

export function loadRanking(
  query: RankingQuery,
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  const req = buildRankingRequest(query)
  return apiClient.get<PixivIllustListResponse>(req.path, req.params, signal)
}

/** 翻页：直接 GET 服务端下发的 next_url（与 loadNext 同策略） */
export function loadRankingNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal)
}
