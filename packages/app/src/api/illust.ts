import { apiClient } from "./client";
import {
  unzipFrames,
  parseZipEocd,
  parseZipCentralDir,
  computeFrameOffsetFromLocal,
  deflateInflate,
  type UgoiraZipEntry,
} from "@pictelio/ugoira";
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

/** 动图取帧模式：fflate 全量解压（默认）/ range 流式取帧 */
export type UgoiraExtractMode = "fflate" | "range";

/** Range 请求（206 Partial Content），返回字节；校验返回长度与请求一致（防截断 206 静默损坏） */
async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const resp = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (resp.status !== 206) {
    throw new Error(`ugoira: Range 请求失败 HTTP ${resp.status}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const expected = end - start + 1;
  if (bytes.length !== expected) {
    throw new Error(`ugoira: Range 返回长度不符 (${bytes.length}/${expected})`);
  }
  return bytes;
}

/**
 * Range 流式取帧（方案 A，官方 zip_player 做法）：
 * 探测总长 → 尾部 30KB 解析 EOCD → 中央目录 → 按帧偏移逐帧 Range 取字节（load-ahead）。
 * store 条目直接切片；deflate 条目由 deflateInflate fallback。
 *
 * 总长探测用 GET + Range bytes=0-0 + Content-Range 解析（ADR-0126）：
 * Android WebView 拦截器对 HEAD 响应头不透明（Content-Length 对 fetch 不可见），
 * 与 lynx 侧 §7.1「HEAD 拒绝」同源——官方规避路径。
 */
async function extractRange(
  zipUrl: string,
  meta: { frames: { file: string; delay: number }[] },
  onProgress?: (pct: number) => void,
): Promise<{ frames: UgoiraFrame[]; blobUrls: string[] }> {
  // 1. GET + Range bytes=0-0 探测总长（Content-Range "bytes 0-0/TOTAL" 解析）
  onProgress?.(5);
  const probe = await fetch(zipUrl, { headers: { Range: "bytes=0-0" } });
  if (probe.status !== 206) {
    throw new Error(`ugoira: Range 探测失败 HTTP ${probe.status}`);
  }
  const contentRange = probe.headers.get("content-range") ?? "";
  const totalMatch = /\/\s*(\d+)\s*$/.exec(contentRange);
  const total = totalMatch ? parseInt(totalMatch[1]!, 10) : 0;
  if (!total) {
    throw new Error("ugoira: 拿不到 zip 长度（Range 模式需要）");
  }

  // 2. 尾部 30KB → EOCD（cdOffset 为文件绝对偏移，用 fileSize 校验）
  onProgress?.(10);
  const tailStart = Math.max(0, total - 30_000);
  const tail = await fetchRange(zipUrl, tailStart, total - 1);
  const eocd = parseZipEocd(tail, { fileSize: total });

  // 3. 中央目录（片段从 0 开始解析）
  onProgress?.(20);
  const cdBytes = await fetchRange(zipUrl, eocd.cdOffset, eocd.cdOffset + eocd.cdSize - 1);
  const entries = parseZipCentralDir(cdBytes, 0, eocd.cdSize);
  const byName = new Map<string, UgoiraZipEntry>(entries.map((e) => [e.name, e]));

  // 4. 逐帧取（每帧 2 次小 Range：本地头 → 数据；load-ahead 预取下一帧本地头）
  const fileOrder = meta.frames.map((f) => f.file);
  const extracted: UgoiraFrame[] = [];
  const blobUrls: string[] = [];
  let nextLocal: Promise<{ entry: UgoiraZipEntry; local: Uint8Array }> | null = null;
  for (let i = 0; i < fileOrder.length; i++) {
    const entry = byName.get(fileOrder[i]!);
    if (!entry) throw new Error(`ugoira: zip 缺少帧文件 ${fileOrder[i]}`);
    // 本地头（load-ahead 已预取则直接用）
    const local = nextLocal
      ? (await nextLocal).local
      : await fetchRange(zipUrl, entry.offset, entry.offset + 29);
    const dataOff = computeFrameOffsetFromLocal(local);
    const dataPromise = fetchRange(
      zipUrl,
      entry.offset + dataOff,
      entry.offset + dataOff + entry.compSize - 1,
    );
    // 预取下一帧本地头（与当前帧数据请求并行）
    const nextEntry = i + 1 < fileOrder.length ? byName.get(fileOrder[i + 1]!) : undefined;
    nextLocal = nextEntry
      ? (async () => ({
          entry: nextEntry,
          local: await fetchRange(zipUrl, nextEntry.offset, nextEntry.offset + 29),
        }))()
      : null;
    const bytes = await dataPromise;
    if (bytes.length !== entry.compSize) {
      throw new Error(`ugoira: Range 帧数据长度不符 (${bytes.length}/${entry.compSize})`);
    }
    // store 直接切片；deflate 用 fflate inflateSync fallback
    const frameBytes = entry.compMethod === 0 ? bytes : deflateInflate(bytes);
    const url = URL.createObjectURL(new Blob([new Uint8Array(frameBytes)]));
    blobUrls.push(url);
    extracted.push({ url, delay: meta.frames[i]!.delay });
    onProgress?.(20 + Math.round(((i + 1) / fileOrder.length) * 80));
  }
  if (extracted.length === 0) {
    throw new Error("No frames found in ZIP");
  }
  return { frames: extracted, blobUrls };
}

/**
 * 下载 ugoira ZIP 并解压为帧列表。
 * @param illustId - 作品 ID
 * @param onProgress - 进度回调 (0-100)，可选
 * @param mode - 取帧模式：fflate（默认，全量解压）/ range（Range 流式取帧）
 * @returns 解压后的帧列表（blob URL，调用方负责释放）
 */
export async function downloadAndExtractUgoira(
  illustId: number,
  onProgress?: (pct: number) => void,
  mode: UgoiraExtractMode = "fflate",
): Promise<{ frames: UgoiraFrame[]; blobUrls: string[] }> {
  // 1. 获取元数据
  onProgress?.(5);
  const meta = await loadUgoiraMetadata(illustId);
  const zipUrl = `/pixiv-img/${meta.zip_urls.medium.split("/").slice(3).join("/")}`;

  // range 模式：探测总长 + 尾部目录 + 按帧偏移取字节（不走全量下载）
  // ADR-0126：失败（非 206 / 长度不符 / 网络错 / 拦截层截断）→ warn + 降级 fflate 全量，
  // 与 lynx 侧 downloadUgoiraFrames 语义对称（禁止静默降级：warn 是契约）。
  if (mode === "range") {
    try {
      return await extractRange(zipUrl, meta, onProgress);
    } catch (err) {
      console.warn("[ugoira] range 取帧失败，降级 fflate:", (err as Error).message);
    }
  }

  // 2. 流式下载 ZIP（5%-80%）
  const zipResp = await fetch(zipUrl);
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
    const url = URL.createObjectURL(new Blob([new Uint8Array(frameBytes[fi]!)]));
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
