// ─── 用户 API（对齐主项目 api/user.ts） ───
import { apiClient } from "./client"
import type { PixivUserDetailResponse } from "./types"

export function getUserDetail(userId: number): Promise<PixivUserDetailResponse> {
  return apiClient.get<PixivUserDetailResponse>("/v1/user/detail", {
    user_id: String(userId),
    filter: "for_ios",
  })
}
