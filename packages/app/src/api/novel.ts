import { Capacitor } from "@capacitor/core";
import { apiClient, getAccessToken } from "./client";
import { PIXIV_USER_AGENT } from "./userAgent";
import { createDedupedRequest } from "@/utils/createDedupedRequest";
import { PixivApi } from "@/native/PixivApi";
import {
  extractNovelDataFromHtml,
  extractNovelTextFromHtml,
  type NovelImageUrls,
  type NovelImagesMap,
} from "@pictelio/novel-export";
import type {
  PixivNovelListResponse,
  PixivNovelDetailResponse,
  PixivNovel,
  SeriesNavigation,
  PixivUser,
  RestrictType,
} from "./types";
import type { NovelId, SeriesId, UserId } from "./id";

// ─── 小说内嵌图片 / 正文提取：共享包 @pictelio/novel-export（消费方零改动） ───
// 原实现已迁入共享包；此处 re-export 保持既有 import 路径可用（ADR-0154 D1）。
export { extractNovelTextFromHtml, extractNovelDataFromHtml };
export type { NovelImageUrls, NovelImagesMap };

const isNative = Capacitor.isNativePlatform();

/**
 * 获取正文 + 系列导航数据 + 内嵌图片映射。
 */
export async function fetchNovelData(novelId: NovelId): Promise<{
  text: string;
  navigation: SeriesNavigation;
  images: NovelImagesMap;
}> {
  const html = await loadText(novelId);
  // novel-export 包的 SeriesNavigation 用 raw `number`（与本包 NovelId
  // 结构同形，运行时相同）；在此桥接边界处类型层 cast。
  // 待 novel-export 升级为 Branded 后移除此 cast。
  return extractNovelDataFromHtml(html) as unknown as {
    text: string;
    navigation: SeriesNavigation;
    images: NovelImagesMap;
  };
}

export function loadRecommended(): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/novel/recommended", {
    filter: "for_ios",
  });
}

export function loadBookmarks(
  userId: UserId,
  restrict: RestrictType = "public",
): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/user/bookmarks/novel", {
    user_id: String(userId),
    restrict,
  });
}

const detailDeduper = createDedupedRequest<NovelId, PixivNovelDetailResponse>((novelId) =>
  apiClient.get<PixivNovelDetailResponse>("/v2/novel/detail", {
    novel_id: String(novelId),
  }),
);

export function loadDetail(novelId: NovelId): Promise<PixivNovelDetailResponse> {
  return detailDeduper.request(novelId);
}

/**
 * 返回小说正文 HTML 的原始实现（不带去重）。
 * 此 endpoint 位于 app-api.pixiv.net（与 apiClient 同一域名），接受 OAuth Bearer token。
 * 参数名是 id（非 novel_id），返回 HTML 而非 JSON，因此手动实现。
 */
async function loadTextRaw(novelId: NovelId): Promise<string> {
  const params = new URLSearchParams({ id: String(novelId) });

  if (!isNative) {
    // Web 模式：走已有的 /pixiv-api 代理（已指向 app-api.pixiv.net）
    const token = getAccessToken();
    const headers: Record<string, string> = {
      "User-Agent": PIXIV_USER_AGENT,
      Referer: "https://app-api.pixiv.net/",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(`/pixiv-api/webview/v2/novel?${params}`, { headers });
    if (!res.ok) {
      throw new Error(`小说正文加载失败 (HTTP ${res.status})`);
    }
    return res.text();
  }

  // Native 模式：走 PixivApiPlugin 网关（access_token 仅在 Java 堆，JS 零知——
  // 由 Java 侧注入 Authorization 并处理 401 自动刷新；不能再用 CapacitorHttp
  // 直连：JS 拿不到 token，直连会被 Pixiv 400 invalid_request 拒绝，导致正文
  // 静默空白。PixivApiCore.executeRequest 对非 JSON 响应直接返回原始 body 字符串）。
  const res = await PixivApi.request({
    method: "GET",
    path: "/webview/v2/novel",
    params: { id: String(novelId) },
  });
  if (res.status >= 400) {
    throw new Error(`小说正文加载失败 (HTTP ${res.status})`);
  }
  return res.data;
}

const textDeduper = createDedupedRequest<NovelId, string>((novelId) => loadTextRaw(novelId));

export function loadText(novelId: NovelId): Promise<string> {
  return textDeduper.request(novelId);
}

export interface NovelSeriesDetailResponse {
  novel_series_detail: {
    id: number;
    title: string;
    caption?: string;
    user: PixivUser;
    create_date: string;
    total_character_count: number;
    display_text_count: number;
  };
  novels: PixivNovel[];
  next_url: string | null;
}

export function loadSeries(
  seriesId: SeriesId,
  lastOrder?: number,
): Promise<NovelSeriesDetailResponse> {
  const params: Record<string, string> = { series_id: String(seriesId) };
  if (lastOrder != null) {
    params.last_order = String(lastOrder);
  }
  return apiClient.get<NovelSeriesDetailResponse>("/v2/novel/series", params);
}

export function loadSeriesNext(url: string): Promise<NovelSeriesDetailResponse> {
  return apiClient.get<NovelSeriesDetailResponse>(url);
}

export function loadNext(url: string): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(url);
}

/**
 * 关注用户的新小说列表。
 * Pixiv App-API: GET /v1/novel/follow
 * @param restrict "public" | "private"
 */
export function loadFollow(restrict: RestrictType = "public"): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/novel/follow", { restrict });
}

/**
 * 获取指定用户的全部小说。
 * Pixiv App-API: GET /v1/user/novels
 * @param userId 目标用户 ID
 */
export function loadUserNovels(userId: UserId): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/user/novels", {
    user_id: String(userId),
    filter: "for_ios",
  });
}

export function addBookmark(novelId: NovelId, restrict: RestrictType = "public"): Promise<void> {
  return apiClient.post("/v2/novel/bookmark/add", {
    novel_id: String(novelId),
    restrict,
  });
}

export function deleteBookmark(novelId: NovelId): Promise<void> {
  return apiClient.post("/v1/novel/bookmark/delete", {
    novel_id: String(novelId),
  });
}
