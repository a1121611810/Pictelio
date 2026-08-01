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

// ─── 收藏（对齐主项目，默认收藏到 public） ───
export function addBookmark(illustId: number): Promise<void> {
  return apiClient.post("/v2/illust/bookmark/add", {
    illust_id: String(illustId),
    restrict: "public",
  })
}

export function deleteBookmark(illustId: number): Promise<void> {
  return apiClient.post("/v1/illust/bookmark/delete", {
    illust_id: String(illustId),
  })
}
