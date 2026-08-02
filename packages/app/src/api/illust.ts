import { apiClient } from "./client";
import { unzipFrames } from "@pictelio/ugoira";
import type {
  PixivIllustListResponse,
  PixivIllustDetailResponse,
  PixivUgoiraMetadataResponse,
  ContentType,
  RestrictType,
} from "./types";

export function loadRecommended(
  contentType: ContentType = "illust",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/illust/recommended",
    {
      content_type: contentType,
      filter: "for_ios",
    },
    signal,
  );
}

export function loadMangaRecommended(signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return loadRecommended("manga", signal);
}

export function loadFollow(
  restrict: RestrictType = "public",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>("/v2/illust/follow", { restrict }, signal);
}

export function loadDetail(
  illustId: number,
  signal?: AbortSignal,
): Promise<PixivIllustDetailResponse> {
  return apiClient.get<PixivIllustDetailResponse>(
    "/v1/illust/detail",
    { illust_id: String(illustId) },
    signal,
  );
}

export function loadNext(url: string, signal?: AbortSignal): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal);
}

export function loadBookmarks(
  userId: number,
  restrict: RestrictType = "public",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/user/bookmarks/illust",
    { user_id: String(userId), restrict },
    signal,
  );
}

export async function loadUgoiraMetadata(
  illustId: number,
  signal?: AbortSignal,
): Promise<PixivUgoiraMetadataResponse["ugoira_metadata"]> {
  const res = await apiClient.get<PixivUgoiraMetadataResponse>(
    "/v1/ugoira/metadata",
    { illust_id: String(illustId) },
    signal,
  );
  return res.ugoira_metadata;
}

// ─── Ugoira 帧类型（与 UgoiraViewer 共享） ───

export interface UgoiraFrame {
  url: string;
  delay: number;
}

/**
 * 下载 ugoira ZIP 并解压为帧列表。
 * @param illustId - 作品 ID
 * @param onProgress - 进度回调 (0-100)，可选
 * @returns 解压后的帧列表（blob URL，调用方负责释放）
 */
export async function downloadAndExtractUgoira(
  illustId: number,
  onProgress?: (pct: number) => void,
): Promise<{ frames: UgoiraFrame[]; blobUrls: string[] }> {
  // 1. 获取元数据
  onProgress?.(5);
  const meta = await loadUgoiraMetadata(illustId);
  const zipUrl = meta.zip_urls.medium;

  // 2. 流式下载 ZIP（5%-80%）
  const zipResp = await fetch(`/pixiv-img/${zipUrl.split("/").slice(3).join("/")}`);
  if (!zipResp.ok) {
    throw new Error(`ZIP download failed: HTTP ${zipResp.status}`);
  }
  const contentLength = zipResp.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  const reader = zipResp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) {
      onProgress?.(Math.round((loaded / total) * 75) + 5);
    }
  }
  const zipBlob = new Blob(chunks as BlobPart[]);
  onProgress?.(80);

  // 3. 解压帧（80%-99%）：共享包 @pictelio/ugoira（fflate，替代 JSZip）
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const fileOrder = meta.frames.map((f) => f.file);
  const frameBytes = unzipFrames(zipBytes, fileOrder);
  const extracted: UgoiraFrame[] = [];
  const blobUrls: string[] = [];
  for (let fi = 0; fi < frameBytes.length; fi++) {
    const url = URL.createObjectURL(new Blob([frameBytes[fi]!]));
    blobUrls.push(url);
    extracted.push({ url, delay: meta.frames[fi]!.delay });
    onProgress?.(80 + Math.round(((fi + 1) / frameBytes.length) * 19));
  }

  if (extracted.length === 0) {
    throw new Error("No frames found in ZIP");
  }

  onProgress?.(100);
  return { frames: extracted, blobUrls };
}

export function addBookmark(illustId: number, restrict: RestrictType = "public"): Promise<void> {
  return apiClient.post("/v2/illust/bookmark/add", {
    illust_id: String(illustId),
    restrict,
  });
}

export function deleteBookmark(illustId: number): Promise<void> {
  return apiClient.post("/v1/illust/bookmark/delete", {
    illust_id: String(illustId),
  });
}

export function followUser(userId: number, restrict?: "public" | "private"): Promise<void> {
  return apiClient.post("/v1/user/follow/add", {
    user_id: String(userId),
    restrict: restrict ?? "public",
  });
}

export function unfollowUser(userId: number): Promise<void> {
  return apiClient.post("/v1/user/follow/delete", {
    user_id: String(userId),
  });
}

export function loadUserIllusts(
  userId: number,
  type: ContentType = "illust",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/user/illusts",
    { user_id: String(userId), type },
    signal,
  );
}
