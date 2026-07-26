import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { apiClient, getAccessToken } from "./client";
import { PIXIV_USER_AGENT } from "./userAgent";
import { createDedupedRequest } from "@/utils/createDedupedRequest";
import type {
  PixivNovelListResponse,
  PixivNovelDetailResponse,
  PixivNovel,
  PixivUser,
  RestrictType,
  SeriesNavigation,
} from "./types";

const isNative = Capacitor.isNativePlatform();

// ─── 小说内嵌图片类型 ───

export type NovelImageSize = "240mw" | "480mw" | "1200x1200" | "128x128" | "original";

export type NovelImageUrls = Record<NovelImageSize, string>;

export interface NovelImageItem {
  novelImageId: string;
  sl: string;
  urls: NovelImageUrls;
}

export type NovelImagesMap = Record<string, NovelImageItem>;

/**
 * 按大括号平衡从 HTML 中提取指定 key 对应的 JSON 对象。
 * 会跳过字符串内部的引号和转义字符，能处理任意层嵌套。
 */
function extractBalancedObject(html: string, key: string): unknown {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\{`, "u");
  const match = pattern.exec(html);
  if (!match) {
    return undefined;
  }

  const start = html.indexOf("{", match.index);
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          const [parseErr, parsed] = trySync(() => JSON.parse(html.slice(start, i + 1)));
          if (parseErr) return undefined;
          return parsed;
        }
      }
    }
  }

  return undefined;
}

/**
 * 从 /webview/v2/novel 返回的 HTML 中提取小说正文。
 * 正文数据藏在 <script> 标签的 window.pixiv.novel.text 中。
 */
export function extractNovelTextFromHtml(html: string): string {
  // 匹配 window.pixiv = { ..., novel: { ..., "text": "...", ... }, ... }
  const match = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/u);
  if (!match) {
    return "";
  }
  // 解义 JSON 转义序列
  const [parseErr, parsed] = trySync(() => JSON.parse(`"${match[1]}"`) as string);
  if (parseErr) {
    return match[1].replace(/\\n/gu, "\n").replace(/\\r/gu, "").replace(/\\t/gu, " ");
  }
  return parsed;
}

/**
 * 获取小说正文纯文本。
 * 内部调用 /webview/v2/novel 获取 HTML，再从中提取 text 字段。
 */
export async function fetchNovelText(novelId: number): Promise<string> {
  const html = await loadText(novelId);
  const text = extractNovelTextFromHtml(html);
  if (!text) {
    throw new Error("小说正文提取失败");
  }
  return text;
}

/**
 * 从 /webview/v2/novel 返回的 HTML 中提取正文 + 系列导航数据。
 */
export function extractNovelDataFromHtml(html: string): {
  text: string;
  navigation: SeriesNavigation;
  images: NovelImagesMap;
} {
  // 复用已有的 text 提取
  const text = extractNovelTextFromHtml(html);

  // 单独提取 seriesNavigation（简单对象结构，用正则即可）
  let navigation: SeriesNavigation = {};
  const navMatch = html.match(/"seriesNavigation"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})/u);
  if (navMatch) {
    const [navErr, parsed] = trySync(() => JSON.parse(navMatch[1]));
    if (!navErr) {
      navigation = {
        nextNovel: parsed.nextNovel ?? null,
        prevNovel: parsed.prevNovel ?? null,
      };
    }
  }

  // 提取内嵌图片映射
  const images = (extractBalancedObject(html, "images") as NovelImagesMap | undefined) ?? {};

  return { text, navigation, images };
}

/**
 * 获取正文 + 系列导航数据 + 内嵌图片映射。
 */
export async function fetchNovelData(novelId: number): Promise<{
  text: string;
  navigation: SeriesNavigation;
  images: NovelImagesMap;
}> {
  const html = await loadText(novelId);
  return extractNovelDataFromHtml(html);
}

export function loadRecommended(): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/novel/recommended", {
    filter: "for_ios",
  });
}

export function loadBookmarks(
  userId: number,
  restrict: RestrictType = "public",
): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/user/bookmarks/novel", {
    user_id: String(userId),
    restrict,
  });
}

const detailDeduper = createDedupedRequest<number, PixivNovelDetailResponse>((novelId) =>
  apiClient.get<PixivNovelDetailResponse>("/v2/novel/detail", {
    novel_id: String(novelId),
  }),
);

export function loadDetail(novelId: number): Promise<PixivNovelDetailResponse> {
  return detailDeduper.request(novelId);
}

/**
 * 返回小说正文 HTML 的原始实现（不带去重）。
 * 此 endpoint 位于 app-api.pixiv.net（与 apiClient 同一域名），接受 OAuth Bearer token。
 * 参数名是 id（非 novel_id），返回 HTML 而非 JSON，因此手动实现。
 */
async function loadTextRaw(novelId: number): Promise<string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "User-Agent": PIXIV_USER_AGENT,
    Referer: "https://app-api.pixiv.net/",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const params = new URLSearchParams({ id: String(novelId) });

  if (!isNative) {
    // Web 模式：走已有的 /pixiv-api 代理（已指向 app-api.pixiv.net）
    const res = await fetch(`/pixiv-api/webview/v2/novel?${params}`, { headers });
    if (!res.ok) {
      throw new Error(`小说正文加载失败 (HTTP ${res.status})`);
    }
    return res.text();
  }

  // Native 模式：CapacitorHttp 直连
  const res = await CapacitorHttp.request({
    method: "GET",
    url: `https://app-api.pixiv.net/webview/v2/novel?${params}`,
    headers,
  });
  if (res.status >= 400) {
    throw new Error(`小说正文加载失败 (HTTP ${res.status})`);
  }
  return res.data as string;
}

const textDeduper = createDedupedRequest<number, string>((novelId) => loadTextRaw(novelId));

export function loadText(novelId: number): Promise<string> {
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
  seriesId: number,
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
export function loadUserNovels(userId: number): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>("/v1/user/novels", {
    user_id: String(userId),
    filter: "for_ios",
  });
}

export function addBookmark(novelId: number, restrict: RestrictType = "public"): Promise<void> {
  return apiClient.post("/v2/novel/bookmark/add", {
    novel_id: String(novelId),
    restrict,
  });
}

export function deleteBookmark(novelId: number): Promise<void> {
  return apiClient.post("/v1/novel/bookmark/delete", {
    novel_id: String(novelId),
  });
}
