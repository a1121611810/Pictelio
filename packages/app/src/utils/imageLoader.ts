import { Capacitor } from "@capacitor/core";
import { ImageCache, type ImageCachePlugin } from "../native/ImageCache";
import { PixivApi } from "../native/PixivApi";
import { isImageHostEnabled } from "../stores/imageHostStore";
import { getEffectiveImageUrl, getRaceCandidateUrls } from "../services/imageHostService";


const isNative = Capacitor.isNativePlatform();

// 定时器 ID —— 必须在模块顶层调用之前声明，避免 let/const 暂时性死区（TDZ）
let gcTimerId: ReturnType<typeof setInterval> | undefined;

/** 最大条目数（Pixiv 原图 URL ~100 字符，1 万条约 1-2MB 字符串内存） */
const MAX_CACHE_ENTRIES = 10_000;
/** GC 阈值：条目数超过此值时触发定时淘汰 */
const GC_THRESHOLD = 8_000;
/** GC 间隔（毫秒）：每 5 分钟检查一次 */
const GC_INTERVAL_MS = 300_000;
/** GC 淘汰比例：每次淘汰最旧条目的比率 */
const GC_EVICT_RATIO = 0.2;

// 模块加载时自动启动定时 GC（测试环境下不启动）
if (typeof setInterval !== "undefined" && typeof process !== "object") {
  schedulePeriodicGC();
}

// ─── 惰性加载 ImageCache 插件（避免在测试/Web 环境下误注册） ───
let imageCacheImpl: ImageCachePlugin | null = null;

function getImageCache(): ImageCachePlugin | null {
  if (!imageCacheImpl) {
    imageCacheImpl = ImageCache;
  }
  return imageCacheImpl;
}

// ─── LRU 已加载标记集合 ───
//
// 设计说明（三层缓存中的 L1）：
//   L1 本集合 —— 只记"URL 已加载过"，不持有 Blob 本体。
//   L2 浏览器/WebView HTTP 缓存 —— <img> 实际渲染走 /pixiv-img/ 代理 URL，位图由 WebView 管理。
//   L3 Android 磁盘缓存（ImageCachePlugin）—— 跨进程存活，冷启动预热本集合的 key。
//
// 历史上 L1 曾缓存 200MB Blob + blobUrl，但所有消费方都只拿代理 URL，
// Blob 本体从未被读取，纯属内存驻留（含重复写入泄漏）。因此退化为纯 key 集合。

/** key → 插入序号。Map 迭代序即插入序，重复 set 不挪位，需 delete+set 刷新。 */
const loadedKeys = new Map<string, number>();
let insertCounter = 0;

/** 写入/刷新一个 key，并将其挪到最新位置；超上限时淘汰最旧条目 */
function cacheSet(key: string) {
  if (loadedKeys.has(key)) {
    loadedKeys.delete(key);
  } else if (loadedKeys.size >= MAX_CACHE_ENTRIES) {
    // Map 迭代序即插入序，第一个 key 就是最旧的
    const oldestKey = loadedKeys.keys().next().value;
    if (oldestKey !== undefined) {
      loadedKeys.delete(oldestKey);
    }
  }
  loadedKeys.set(key, ++insertCounter);
}

// ─── 定时 GC ───

/**
 * 启动定时 GC。每 GC_INTERVAL_MS 检查一次缓存大小，
 * 超过 GC_THRESHOLD 时淘汰最旧 GC_EVICT_RATIO 比例的条目。
 */
export function schedulePeriodicGC(): void {
  if (gcTimerId !== undefined) return;
  gcTimerId = setInterval(() => {
    if (loadedKeys.size > GC_THRESHOLD) {
      const evictCount = Math.ceil(loadedKeys.size * GC_EVICT_RATIO);
      const keys = [...loadedKeys.keys()];
      for (let i = 0; i < evictCount && i < keys.length; i++) {
        loadedKeys.delete(keys[i]);
      }
    }
  }, GC_INTERVAL_MS);
}

/** 停止定时 GC */
export function stopPeriodicGC(): void {
  if (gcTimerId !== undefined) {
    clearInterval(gcTimerId);
    gcTimerId = undefined;
  }
}

// ─── 上下文感知淘汰 ───

/**
 * 清除满足过滤条件的缓存条目。
 * @param filter 返回 true 的 key 将被清除
 */
export function clearCacheWithFilter(filter: (key: string) => boolean): void {
  for (const key of loadedKeys.keys()) {
    if (filter(key)) {
      loadedKeys.delete(key);
    }
  }
}

/**
 * 清除指定前缀的所有缓存条目。
 * @param keyPrefix URL 前缀，例如 "/pixiv-img/12345"
 */
export function clearCacheForPrefix(keyPrefix: string): void {
  for (const key of loadedKeys.keys()) {
    if (key.startsWith(keyPrefix)) {
      loadedKeys.delete(key);
    }
  }
}

export interface CacheMemoryStats {
  totalEntries: number;
  maxEntries: number;
  gcThreshold: number;
  estimatedBytes: number;
  gcRunning: boolean;
}

/**
 * 获取当前缓存状态统计。
 */
export function getMemoryUsage(): CacheMemoryStats {
  const estimatedBytes = [...loadedKeys.keys()].reduce((sum, key) => sum + key.length * 2, 0);
  return {
    totalEntries: loadedKeys.size,
    maxEntries: MAX_CACHE_ENTRIES,
    gcThreshold: GC_THRESHOLD,
    estimatedBytes,
    gcRunning: gcTimerId !== undefined,
  };
}

/** 同步检查图片是否已加载过（不触发加载），命中时返回代理 URL 并刷新 LRU 位置。
 * 代理 URL 走浏览器 HTTP 缓存（0ms，不产生 blob: 条目），
 * 而 blob: URL 需 0.5ms 的 createObjectURL + 跨语言边界解码开销。 */
export function checkImageCache(originalUrl: string): string | undefined {
  if (loadedKeys.has(originalUrl)) {
    cacheSet(originalUrl); // 刷新到最新位置，避免热图被 FIFO 误淘汰
    return resolveImageUrl(originalUrl);
  }
  return undefined;
}

/**
 * 公开 API：标记某个 URL 的图片已在磁盘缓存中存在。
 * 用于 warmCacheFromDisk 启动预热——只登记 key，不再把 Blob 解码进内存。
 */
export function injectCacheEntry(key: string): void {
  cacheSet(key);
}

/** 清空已加载标记（"清除本地数据"时调用） */
export function clearImageCache() {
  loadedKeys.clear();
  insertCounter = 0;
}

/** 获取缓存条目数 */
export function getCacheSize(): number {
  return loadedKeys.size;
}

/** 测试专用：返回当前 LRU 顺序（最旧在前，frozen 防外部修改）。生产代码请勿使用。 */
export function getLruOrderForTest(): readonly string[] {
  return Object.freeze([...loadedKeys.keys()]);
}

// ─── URL 尺寸解析 ───

/**
 * 从 Pixiv CDN URL 中提取图片裁剪尺寸。
 *
 * Pixiv CDN URL 格式示例：
 *   /c/600x1200_90/img-master/img/2026/06/30/13/50/51/146641178_p0_master1200.jpg
 *   /c/250x250_80/a.jpg
 *   /custom/600x1200/xxx.jpg
 *
 * 返回 { width, height }，无尺寸前缀则返回 null。
 * 纯函数，O(1) 正则匹配，不涉及网络/IO。
 */
export function parsePixivUrlDimensions(url: string): { width: number; height: number } | null {
  if (!url) {
    return null;
  }
  const match = url.match(/\/(?:c|custom)\/(\d+)x(\d+)/u);
  if (!match) {
    return null;
  }
  const w = parseInt(match[1], 10);
  const h = parseInt(match[2], 10);
  if (w <= 0 || h <= 0) {
    return null;
  }
  return { width: w, height: h };
}

// ─── URL 转换 ───

/**
 * 将 i.pximg.net 的原始 URL 转换为代理路径。
 */
export function resolveImageUrl(originalUrl: string): string {
  if (!originalUrl) {
    return "";
  }
  if (originalUrl.startsWith("/pixiv-img/")) {
    return originalUrl;
  }
  // S.pximg.net 是静态资源 CDN（默认头像、印章等），不需要 Referer 验证，直接使用
  if (originalUrl.startsWith("https://s.pximg.net/")) {
    return originalUrl;
  }

  const parts = originalUrl.split("/");
  const path = parts.slice(3).join("/");
  return `/pixiv-img/${path}`;
}

/**
 * 将第三方图床 URL 转换为 Web 模式下可用的本地代理路径。
 *
 * - i.pixiv.re → /pixiv-re/
 * - i.pixiv.nl → /pixiv-nl/
 * - 其他（含 i.pximg.net）→ /pixiv-img/ 代理
 * - 已是代理路径的 URL 直接返回
 */
export function toWebProxyUrl(url: string): string {
  if (!url || url.startsWith("/")) {
    return url;
  }
  if (url.startsWith("https://i.pixiv.re/")) {
    return url.replace("https://i.pixiv.re", "/pixiv-re");
  }
  if (url.startsWith("https://i.pixiv.nl/")) {
    return url.replace("https://i.pixiv.nl", "/pixiv-nl");
  }
  return resolveImageUrl(url);
}

// ─── 飞行中请求去重 ───

/** 正在加载中的请求，用于并发去重 — 同一 URL 只发一个真实 HTTP 请求 */
const inflightRequests = new Map<string, Promise<LoadedImage>>();

// ─── 带缓存的图片加载 ───

export interface LoadedImage {
  url: string;
  cleanup: () => void;
}

/**
 * 加载 Pixiv 图片（带 LRU 缓存 + 飞行中请求去重）。
 *
 * 缓存命中时返回代理 URL（走浏览器 HTTP 缓存，0ms，无 blob: 条目）；
 * 未命中时下载 → 存入 LRU → 返回代理 URL。
 *
 * - 命中缓存：直接返回代理 URL，浏览器在 HTTP 缓存中已有解码结果
 * - 未命中但已有同一 URL 正请求中：复用该 Promise，不发重复请求
 * - 未命中且无飞行中请求：发起 HTTP 请求 → 存入 LRU → 返回代理 URL
 *
 * 返回 { url, cleanup }。
 * cleanup() 为兼容保留，实际是 no-op。
 */
export function loadImage(originalUrl: string): Promise<LoadedImage> {
  if (!originalUrl) {
    return Promise.resolve({ url: "", cleanup: () => {} });
  }

  // 1. 检查缓存 — 无需异步操作，直接代理 URL 走浏览器缓存
  if (loadedKeys.has(originalUrl)) {
    return Promise.resolve({ url: resolveImageUrl(originalUrl), cleanup: () => {} });
  }

  // 2. 检查是否已有相同 URL 正在加载中 — 复用 Promise，避免重复请求
  const inflight = inflightRequests.get(originalUrl);
  if (inflight) {
    return inflight;
  }

  // 3. 创建加载 Promise 并注册到飞行中 Map
  const promise = loadImageInner(originalUrl).finally(() => {
    inflightRequests.delete(originalUrl);
  });
  inflightRequests.set(originalUrl, promise);

  return promise;
}

/** LoadImage 的内部实现 — 不含去重逻辑，由外层 loadImage 统一调度并发 */
async function loadImageInner(originalUrl: string): Promise<LoadedImage> {
  const targetUrl = isImageHostEnabled() ? getEffectiveImageUrl(originalUrl) : originalUrl;

  if (isNative) {
    // 1) 先检查 Android 文件缓存
    const imageCache = getImageCache();
    const [cacheErr, cached] = await tryAsync(imageCache!.getImage({ key: originalUrl }));
    if (!cacheErr && cached?.base64) {
      cacheSet(originalUrl);
      return { url: resolveImageUrl(originalUrl), cleanup: () => {} };
    }

    // 2) 未命中：通过 PixivApi 让 Java 侧下载+缓存（二进制不进 JS 堆）
    const [prefetchErr] = await tryAsync(PixivApi.prefetchImage({ url: targetUrl }));
    if (prefetchErr) {
      // prefetch 失败时不标记 L1，让调用方（LazyDetailImage）重试
      console.warn("[ImageCache] Prefetch failed, caller will retry", prefetchErr);
      throw new Error("Prefetch failed");
    }

    // 3) 登记已加载标记
    cacheSet(originalUrl);
    // 返回代理 URL（shouldInterceptRequest 将从磁盘缓存读取）
    return { url: resolveImageUrl(originalUrl), cleanup: () => {} };
  }

  // Web 模式
  try {
    await fetchWeb(targetUrl, originalUrl);
  } catch (err) {
    console.warn(`[ImageCache] Fetch failed: ${originalUrl}`, err);
    // 也标记 L1，让 checkImageCache 能命中（Web 模式无 shouldInterceptRequest 兜底）
    cacheSet(originalUrl);
    return { url: resolveImageUrl(originalUrl), cleanup: () => {} };
  }
  cacheSet(originalUrl);
  return {
    url: resolveImageUrl(originalUrl),
    cleanup: () => {},
  };
}

// ─── 带进度回调的图片加载 ───

export interface LoadProgress {
  /** 已下载字节数 */
  loaded: number;
  /** 总字节数（Content-Length），为 null 表示未知 */
  total: number | null;
  /** 进度百分比 0-100；total 不可用时为 -1 */
  percent: number;
}

export interface LoadImageResultWithProgress {
  url: string;
  cleanup: () => void;
  /** 下载耗时（毫秒） */
  durationMs: number;
}

/**
 * 带下载进度的图片加载。
 *
 * - 缓存命中：立即回调 percent=100 并返回缓存 Blob URL
 * - 未命中但已有 loadImage（无进度版）正在请求中：等待后从缓存返回，跳过重复请求
 * - 未命中且无飞行中请求：通过 Web ReadableStream 或 Native XHR 实时报告进度
 * - 下载完成后存入 LRU 缓存
 * - 失败时降级返回代理 URL（无缓存）
 *
 * Web 模式使用 fetch + ReadableStream（不阻塞内存，逐 chunk 拼接）
 * Native 模式使用 XMLHttpRequest（CapacitorHttp 不支持 streaming）
 */
export async function loadImageWithProgress(
  originalUrl: string,
  onProgress: (p: LoadProgress) => void,
): Promise<LoadImageResultWithProgress> {
  if (!originalUrl) {
    return { url: "", cleanup: () => {}, durationMs: 0 };
  }

  // 1. 缓存命中 — 直接返回代理 URL（走浏览器 HTTP 缓存，0ms，无 blob: 条目）
  if (loadedKeys.has(originalUrl)) {
    onProgress({ loaded: 0, total: 0, percent: 100 });
    return { url: resolveImageUrl(originalUrl), cleanup: () => {}, durationMs: 0 };
  }

  // 1b. 检查是否有 loadImage（无进度版）正在请求同一 URL
  //     有则等待它完成，缓存中就绪后直接返回，跳过重复 HTTP 请求
  const mainInflight = inflightRequests.get(originalUrl);
  if (mainInflight) {
    await mainInflight;
    onProgress({ loaded: 0, total: 0, percent: 100 });
    return { url: resolveImageUrl(originalUrl), cleanup: () => {}, durationMs: 0 };
  }

  const startTime = performance.now();

  const [progressErr, progressResult] = await tryAsync(
    (async () => {
      // 2. 解析目标 URL（图床代理 / 原生 URL）
      const targetUrl = isImageHostEnabled() ? getEffectiveImageUrl(originalUrl) : originalUrl;

      // 3. 带进度下载（统一走 WebView 代理）
      const proxyUrl = toWebProxyUrl(targetUrl);
      const blob = await loadWithProgressWeb(proxyUrl, onProgress);

      // 4. 登记已加载标记
      cacheSet(originalUrl);

      const durationMs = Math.round(performance.now() - startTime);

      // 5. 最终 100% 回调
      onProgress({ loaded: blob.size, total: blob.size, percent: 100 });

      return { url: resolveImageUrl(originalUrl), cleanup: () => {}, durationMs };
    })(),
  );
  if (progressErr) {
    console.warn(`[ImageCache] LoadWithProgress failed: ${originalUrl}`, progressErr);
    onProgress({ loaded: 0, total: 0, percent: -1 });
    return { url: resolveImageUrl(originalUrl), cleanup: () => {}, durationMs: 0 };
  }
  return progressResult;
}

/** Web 模式：fetch + ReadableStream 逐 chunk 读取并报告进度 */
async function loadWithProgressWeb(
  proxyUrl: string,
  onProgress: (p: LoadProgress) => void,
): Promise<Blob> {
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = response.headers.get("Content-Length");
  const total = contentLength ? parseInt(contentLength, 10) : null;
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    // eslint-disable-next-line no-await-in-loop — ReadableStream chunks must be read sequentially
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      loaded += value.length;
      const percent = total ? Math.round((loaded / total) * 100) : -1;
      onProgress({ loaded, total, percent });
    }
  }

  const contentType = response.headers.get("Content-Type") || "image/jpeg";
  return new Blob(chunks as BlobPart[], { type: contentType });
}

/** Web 模式：通过 Vite 代理或图床代理获取图片 */
function fetchWeb(targetUrl: string, originalUrl: string): Promise<Blob> {
  const urls = getRaceCandidateUrls(targetUrl);

  if (urls.length > 1) {
    // Web 模式：所有 race 候选 URL 转为本地代理路径，避免 CORS
    const webUrls = urls.map(toWebProxyUrl);
    return raceFetch(webUrls, fetchSingleWeb, toWebProxyUrl(originalUrl));
  }

  return fetchSingleWeb(toWebProxyUrl(targetUrl));
}

async function fetchSingleWeb(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const blob = await resp.blob();
  if (blob.size === 0) {
    throw new Error("Empty response");
  }
  return blob;
}

/**
 * 并发请求多个候选 URL，返回最快成功响应。
 *
 * 所有请求通过 Promise.any 竞速；全部失败时回退到默认代理 URL。
 */
async function raceFetch<T>(
  urls: string[],
  fetcher: (url: string) => Promise<T>,
  fallbackUrl: string,
): Promise<T> {
  const pending = urls.map(async (url): Promise<T> => {
    const [fetchErr, fetchResult] = await tryAsync(fetcher(url));
    if (fetchErr) {
      throw new Error(`Failed: ${url}`);
    }
    return fetchResult;
  });

  const [anyErr, anyResult] = await tryAsync(Promise.any(pending));
  if (anyErr) {
    console.warn(`[ImageCache] All race candidates failed, fallback to ${fallbackUrl}`);
    return fetcher(fallbackUrl);
  }
  return anyResult;
}

// ─── 磁盘缓存预热 ───

/**
 * 启动时从 Android 文件缓存读取最近使用的 key，登记到 L1 已加载集合。
 * 仅在 Native 平台生效；Web 平台无操作。
 *
 * 在 App.tsx onMount 中调用，与 auth 初始化并行执行。
 * 预热失败不影响正常功能（降级为冷启动重新下载）。
 */
export async function warmCacheFromDisk(): Promise<void> {
  if (!isNative) {
    return;
  }

  const [warmErr] = await tryAsync(
    (async () => {
      const imageCache = getImageCache();
      const { keys } = await imageCache!.getCachedKeys();
      if (!keys || keys.length === 0) {
        return;
      }

      // 取最近 50 张，同步登记到 L1（只读 key，不解码图片本体）
      const recentKeys = keys.slice(-50);
      for (const key of recentKeys) {
        injectCacheEntry(key);
      }

      console.log(`[ImageCache] Warmup: registered ${recentKeys.length}/${keys.length} entries`);
    })(),
  );
  if (warmErr) {
    // 预热失败不阻塞启动
    console.warn("[ImageCache] Warmup failed", warmErr);
  }
}
