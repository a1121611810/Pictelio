// ─── 小说 API（复用现有 app 端点 + 正文提取逻辑） ───
import {
  extractNovelDataFromHtml,
  extractNovelTextFromHtml,
  type NovelImagesMap,
  type SeriesNavigation,
} from "@pictelio/novel-export"
import { apiClient } from "./client"
import type {
  PixivNovelListResponse,
  PixivNovelDetailResponse,
  NovelSeriesDetailResponse,
  WatchlistNovelListResponse,
} from "./types"

// 正文/系列导航/内嵌图片提取统一走共享包 @pictelio/novel-export（ADR-0154 D1）。
// 原本地 extractNovelTextFromHtml 实现已迁入共享包，此处 re-export 保持既有 import 可用。
export { extractNovelDataFromHtml, extractNovelTextFromHtml }

export function loadRecommendedNovels(signal?: AbortSignal): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(
    "/v1/novel/recommended",
    { filter: "for_ios" },
    signal,
  )
}

export function loadFollow(
  restrict: "public" | "private" = "public",
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  // 关注小说（P0-T5）：MVP 默认 public（对齐主项目默认）
  return apiClient.get<PixivNovelListResponse>("/v1/novel/follow", { restrict }, signal)
}

export function loadNovelDetail(novelId: number): Promise<PixivNovelDetailResponse> {
  return apiClient.get<PixivNovelDetailResponse>("/v2/novel/detail", {
    novel_id: String(novelId),
  })
}

export function loadNovelNext(url: string, signal?: AbortSignal): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(url, undefined, signal)
}

export function loadUserNovels(userId: number, signal?: AbortSignal): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(
    "/v1/user/novels",
    { user_id: String(userId), filter: "for_ios" },
    signal,
  )
}

export function loadBookmarks(
  userId: number,
  restrict: "public" | "private" = "public",
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  // 收藏列表（P0-T6）：MVP 默认 public（对齐主项目默认）；「非公开」tab 后置
  return apiClient.get<PixivNovelListResponse>("/v1/user/bookmarks/novel", {
    user_id: String(userId),
    restrict,
  }, signal)
}

// ─── 小说系列追更（issue #220 / spec app-lynx-novel-series-watchlist §US1） ───
// 端点与字段逐字对齐 Pixiv-Shaft：AppApi.kt（add/delete）+ loxia/API.kt（列表）+ Models.kt（字段）。

/** 系列详情（含追更状态 watchlist_added、是否完结 is_concluded） */
export function loadNovelSeries(
  seriesId: number,
  signal?: AbortSignal,
): Promise<NovelSeriesDetailResponse> {
  return apiClient.get<NovelSeriesDetailResponse>(
    "/v2/novel/series",
    { series_id: String(seriesId) },
    signal,
  )
}

/** 追更系列（POST form: series_id） */
export function addNovelWatchlist(seriesId: number): Promise<void> {
  return apiClient.post<void>("/v1/watchlist/novel/add", { series_id: String(seriesId) })
}

/** 取消追更（POST form: series_id） */
export function deleteNovelWatchlist(seriesId: number): Promise<void> {
  return apiClient.post<void>("/v1/watchlist/novel/delete", { series_id: String(seriesId) })
}

/** 追更列表首页（无 query 参数，对齐 Shaft getWatchlistNovel） */
export function loadWatchlistNovels(signal?: AbortSignal): Promise<WatchlistNovelListResponse> {
  return apiClient.get<WatchlistNovelListResponse>("/v1/watchlist/novel", undefined, signal)
}

/** 追更列表翻页：透传服务端 next_url（保留 query） */
export function loadWatchlistNovelsNext(
  url: string,
  signal?: AbortSignal,
): Promise<WatchlistNovelListResponse> {
  return apiClient.get<WatchlistNovelListResponse>(url, undefined, signal)
}

/**
 * 加载小说正文纯文本（/webview/v2/novel 返回 HTML 而非 JSON）。
 * 双模式由 apiClient.requestRaw 统一处理：
 * - web 模式：rewriteUrl → /pixiv-api 代理路径 + Bearer 头（fetch 返回原始文本）；
 * - 原生模式：NativeModules.PictelioApi.request 转发 Java（JS 零知 access_token，
 *   PixivApiCore 对非 JSON 响应原样返回 data 字符串）。
 */
export async function fetchNovelText(novelId: number): Promise<string> {
  const html = await apiClient.requestRaw('GET', '/webview/v2/novel', { id: String(novelId) })
  const text = extractNovelTextFromHtml(html)
  if (!text) throw new Error("小说正文提取失败")
  return text
}

/**
 * 加载小说正文 + 系列导航 + 内嵌图片映射（与 app api/novel.ts fetchNovelData 同语义）。
 * 复用共享包 extractNovelDataFromHtml；补齐 lynx 侧缺失的 images 提取。
 */
export async function fetchNovelData(novelId: number): Promise<{
  text: string
  navigation: SeriesNavigation
  images: NovelImagesMap
}> {
  const html = await apiClient.requestRaw('GET', '/webview/v2/novel', { id: String(novelId) })
  return extractNovelDataFromHtml(html)
}
