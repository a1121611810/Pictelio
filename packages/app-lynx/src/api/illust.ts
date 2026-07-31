// ─── 插画 API（复用现有 app 端点） ───
import { apiClient } from "./client"
import type { PixivIllustListResponse, PixivIllustDetailResponse } from "./types"

export function loadRecommended(signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/illust/recommended",
    { content_type: "illust", filter: "for_ios" },
    signal,
  )
}

export function loadDetail(illustId: number, signal?: AbortSignal): Promise<PixivIllustDetailResponse> {
  return apiClient.get<PixivIllustDetailResponse>(
    "/v1/illust/detail",
    { illust_id: String(illustId) },
    signal,
  )
}

export function loadNext(url: string, signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal)
}
