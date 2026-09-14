// ─── 插画 API（复用现有 app 端点） ───
import { apiClient } from "./client"
import type {
  PixivBookmarkDetailResponse,
  PixivIllustListResponse,
  PixivIllustDetailResponse,
  PixivUgoiraMetadata,
  PixivUgoiraMetadataResponse,
  PixivUserBookmarkTagsResponse,
  RestrictType,
} from "./types"

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

// ─── 相关作品（spec docs/specs/related-injection.md）───
// 注意是 v2——/v1/illust/related 实测 404（端点不存在），/v2/illust/related 实测 200（模拟器 2026-09-12）
export function loadRelated(illustId: number, signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v2/illust/related",
    { illust_id: String(illustId), filter: "for_ios" },
    signal,
  )
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

// ─── 收藏（默认公开；T3 收藏加标签，spec docs/specs/bookmark-tags.md） ───
/**
 * 收藏插画（可带可见性与收藏标签）。
 *
 * oracle（pixivpy3 aapi.py `illust_bookmark_add`，六实现差分互证见
 * docs/research/bookmark-tags-similar-clients.md §7.1）：tags 序列化为多个标签空格
 * join 的单值、字面量字段名 `tags[]`；空标签集不发 tags 字段。
 *
 * 覆盖式编辑（spec D2 / ADR-0160 D2）：对已收藏作品直接重发本请求即整体覆盖该收藏的
 * 标签集与可见性——服务端无 edit 端点，不先 delete（避免收藏状态闪断）。
 */
export function addBookmark(
  illustId: number,
  restrict: RestrictType = "public",
  tags?: string[],
): Promise<void> {
  const body: Record<string, string> = {
    illust_id: String(illustId),
    restrict,
  }
  if (tags && tags.length > 0) {
    body["tags[]"] = tags.join(" ")
  }
  return apiClient.post("/v2/illust/bookmark/add", body)
}

/**
 * 书签详情（预填链路，spec D6）：判断是否已收藏 + 当前可见性 + 已有标签。
 * 响应形状见 PixivBookmarkDetailResponse（bookmark_detail 可空、字段宽容解析）。
 */
export function loadBookmarkDetail(
  illustId: number,
  signal?: AbortSignal,
): Promise<PixivBookmarkDetailResponse> {
  return apiClient.get<PixivBookmarkDetailResponse>(
    "/v2/illust/bookmark/detail",
    { illust_id: String(illustId) },
    signal,
  )
}

/**
 * 用户收藏标签库（面板候选，spec D4/D6）：标签库按公开性分库（restrict 分库）。
 * user_id 显式传参——与同模块 loadBookmarks(userId, restrict) 先例一致，
 * 由调用方（T4 面板数据层）从 authStore 解析当前用户 id。
 */
export function loadUserBookmarkTags(
  userId: number,
  restrict: RestrictType = "public",
  offset?: number,
  signal?: AbortSignal,
): Promise<PixivUserBookmarkTagsResponse> {
  const params: Record<string, string> = {
    user_id: String(userId),
    restrict,
  }
  if (offset !== undefined) {
    params["offset"] = String(offset)
  }
  return apiClient.get<PixivUserBookmarkTagsResponse>("/v1/user/bookmark-tags/illust", params, signal)
}

export function deleteBookmark(illustId: number): Promise<void> {
  return apiClient.post("/v1/illust/bookmark/delete", {
    illust_id: String(illustId),
  })
}
