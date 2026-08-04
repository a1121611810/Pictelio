// ─── 插画 API（复用现有 app 端点） ───
import { apiClient } from "./client"
import type { PixivIllustListResponse, PixivIllustDetailResponse, PixivUgoiraMetadata, PixivUgoiraMetadataResponse } from "./types"

export function loadRecommended(signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/illust/recommended",
    { content_type: "illust", filter: "for_ios" },
    signal,
  )
}

export function loadFollow(
  restrict: "public" | "private" = "public",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  // 关注 Feed（P0-T4）：MVP 默认 public（对齐主项目默认）；「全部」视图过滤后置
  return apiClient.get<PixivIllustListResponse>("/v2/illust/follow", { restrict }, signal)
}

export function loadBookmarks(
  userId: number,
  restrict: "public" | "private" = "public",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  // 收藏列表（P0-T6）：MVP 默认 public（对齐主项目默认）；「非公开」tab 后置
  return apiClient.get<PixivIllustListResponse>(
    "/v1/user/bookmarks/illust",
    { user_id: String(userId), restrict },
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

export function loadUgoiraMetadata(illustId: number): Promise<PixivUgoiraMetadata> {
  return apiClient
    .get<PixivUgoiraMetadataResponse>("/v1/ugoira/metadata", { illust_id: String(illustId) })
    .then((r) => r.ugoira_metadata)
}

export function loadNext(url: string, signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal)
}

export function loadUserIllusts(
  userId: number,
  type: "illust" | "manga" = "illust",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/user/illusts",
    { user_id: String(userId), type },
    signal,
  )
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
