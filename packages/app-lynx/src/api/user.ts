// ─── 用户 API（对齐主项目 api/user.ts + api/illust.ts 的关注方法） ───
import { apiClient } from "./client"
import type { UserId } from "./id"
import type { PixivUserDetailResponse, PixivUserFollowingResponse } from "./types"

export function getUserDetail(userId: UserId): Promise<PixivUserDetailResponse> {
  return apiClient.get<PixivUserDetailResponse>("/v1/user/detail", {
    user_id: String(userId),
    filter: "for_ios",
  })
}

export function getUserFollowing(
  userId: UserId,
  offset?: number,
): Promise<PixivUserFollowingResponse> {
  const params: Record<string, string> = { user_id: String(userId), restrict: "public" }
  if (offset !== undefined) params.offset = String(offset)
  return apiClient.get<PixivUserFollowingResponse>("/v1/user/following", params)
}

export function getUserFollowers(userId: UserId, offset?: number): Promise<PixivUserFollowingResponse> {
  const params: Record<string, string> = { user_id: String(userId) }
  if (offset !== undefined) params.offset = String(offset)
  return apiClient.get<PixivUserFollowingResponse>("/v1/user/follower", params)
}

/** 关注/粉丝列表分页（next_url 是完整 URL） */
export function loadUserListNext(url: string): Promise<PixivUserFollowingResponse> {
  return apiClient.get<PixivUserFollowingResponse>(url)
}

// ─── 关注/取关（P0-T2/T3，对齐主项目 api/illust.ts followUser/unfollowUser） ───
export function followUser(userId: UserId, restrict: "public" | "private" = "public"): Promise<void> {
  return apiClient.post("/v1/user/follow/add", {
    user_id: String(userId),
    restrict,
  })
}

export function unfollowUser(userId: UserId): Promise<void> {
  return apiClient.post("/v1/user/follow/delete", {
    user_id: String(userId),
  })
}