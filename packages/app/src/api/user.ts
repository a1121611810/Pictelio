import { apiClient } from "./client";
import type { PixivUserDetailResponse, PixivUserFollowingResponse, RestrictType } from "./types";
import type { UserId } from "./id";

export function getUserDetail(userId: UserId): Promise<PixivUserDetailResponse> {
  return apiClient.get<PixivUserDetailResponse>("/v1/user/detail", {
    user_id: String(userId),
    filter: "for_ios",
  });
}

export function getUserFollowing(
  userId: UserId,
  restrict: RestrictType = "public",
  offset?: number,
): Promise<PixivUserFollowingResponse> {
  const params: Record<string, string> = {
    user_id: String(userId),
    restrict,
  };
  if (offset !== undefined) {
    params.offset = String(offset);
  }
  return apiClient.get<PixivUserFollowingResponse>("/v1/user/following", params);
}

export function getUserFollowers(
  userId: UserId,
  offset?: number,
): Promise<PixivUserFollowingResponse> {
  const params: Record<string, string> = {
    user_id: String(userId),
  };
  if (offset !== undefined) {
    params.offset = String(offset);
  }
  return apiClient.get<PixivUserFollowingResponse>("/v1/user/follower", params);
}
