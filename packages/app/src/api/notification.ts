// ─── 通知 API（ADR-0188 D2 / spec docs/specs/notification-center.md）───
// 端点 = 2026-09-26 真实抓包实证（HTTP 200）：
//   GET /v1/notification/list                        → 首屏列表（next_url 翻页）
//   GET /v1/notification/view-more?notification_id=  → 组头摊平子列表（next_url 携带 older_than 游标）
// 形态对齐 api/illust.ts：client GET、next_url 透传（绝对 URL 由 client.rewriteUrl 剥域/代理重写）、
// 错误上抛（HTTP 非 2xx 由 client 归一为 ApiError，401 走既有自动刷新 + 单飞重试）。
// Java 零改动（PixivApiPlugin.request 为 path 直拼、无白名单，ADR-0188 背景）。
import { apiClient } from "./client";
import type { PixivNotificationListResponse } from "./types";

/** 通知列表：nextUrl 缺省发首屏端点；提供时透传服务端 next_url（含 query） */
export function loadNotifications(
  nextUrl?: string,
  signal?: AbortSignal,
): Promise<PixivNotificationListResponse> {
  if (nextUrl) {
    return apiClient.get<PixivNotificationListResponse>(nextUrl, undefined, signal);
  }
  return apiClient.get<PixivNotificationListResponse>("/v1/notification/list", undefined, signal);
}

/** 组头摊平子列表：notification_id 必传；nextUrl（older_than 游标）提供时原样透传 */
export function loadNotificationChildren(
  id: number,
  nextUrl?: string,
  signal?: AbortSignal,
): Promise<PixivNotificationListResponse> {
  if (nextUrl) {
    return apiClient.get<PixivNotificationListResponse>(nextUrl, undefined, signal);
  }
  return apiClient.get<PixivNotificationListResponse>(
    "/v1/notification/view-more",
    { notification_id: String(id) },
    signal,
  );
}
