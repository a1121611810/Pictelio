import type { NovelImagesMap } from "@/api/novel";
import { getImageSizeWorker } from "@/primitives/createImageSizeWorker";
import type { ImageSizeInput, ImageSizeOutput } from "@/primitives/imageSize.worker";
import { loadImage, resolveImageUrl } from "@/utils/imageLoader";

export type NovelImageDimensions = Record<string, { width: number; height: number } | null>;

const MEASURE_TIMEOUT_MS = 5000;

/**
 * 为小说内嵌图片预加载真实宽高。
 *
 * 流程：
 * 1. 用 128x128 缩略图调用 loadImage() 拿到 Blob URL（命中缓存则零网络）。
 * 2. 从 Blob URL fetch Blob。
 * 3. 批量交给 Web Worker，通过 createImageBitmap 测量尺寸。
 * 4. Worker 失败或不支持时，降级到主线程 new Image() 逐个测量。
 * 5. 任一图片失败不影响其他，失败的 id 在结果中映射为 null。
 */
export async function loadNovelImageDimensions(
  images: NovelImagesMap,
): Promise<NovelImageDimensions> {
  const entries = Object.entries(images);
  if (entries.length === 0) {
    return {};
  }

  const results: NovelImageDimensions = {};

  // 1. 并行加载缩略图 Blob
  const loadedBlobs = await Promise.allSettled(
    entries.map(async ([id, item]): Promise<ImageSizeInput> => {
      const thumbUrl = resolveImageUrl(item.urls["128x128"]);
      const loaded = await loadImage(thumbUrl);
      if (!loaded.url) {
        throw new Error(`Failed to load thumbnail for ${id}`);
      }

      const response = await fetch(loaded.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      return { id, blob };
    }),
  );

  const items: ImageSizeInput[] = [];
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i][0];
    const settled = loadedBlobs[i];
    if (settled.status === "fulfilled") {
      items.push(settled.value);
    } else {
      results[id] = null;
    }
  }

  if (items.length === 0) {
    return results;
  }

  // 2. 优先使用 Worker 批量测量
  const workerOutputs: ImageSizeOutput[] = [];
  const worker = await getImageSizeWorker();
  if (worker) {
    const [workerErr, workerResults] = await tryAsync(worker.measureImages(items));
    if (workerErr) {
      console.warn(
        "[novelImageDimensions] Worker measurement failed, fallback to main thread",
        workerErr,
      );
    } else {
      workerOutputs.push(...workerResults);
    }
  }

  // 3. Worker 未成功测量的项，降级到主线程 new Image()
  const measuredIds = new Set(
    workerOutputs
      .filter((o): o is { id: string; width: number; height: number } => "width" in o)
      .map((o) => o.id),
  );
  const fallbackItems = items.filter((item) => !measuredIds.has(item.id));

  if (fallbackItems.length > 0) {
    const fallbackResults = await Promise.allSettled(
      fallbackItems.map((item) => measureWithImageElement(item)),
    );
    for (let i = 0; i < fallbackItems.length; i++) {
      const id = fallbackItems[i].id;
      const settled = fallbackResults[i];
      if (settled.status === "fulfilled") {
        workerOutputs.push({ id, ...settled.value });
      } else {
        workerOutputs.push({ id, error: true });
      }
    }
  }

  // 4. 汇总结果
  for (const output of workerOutputs) {
    if ("error" in output) {
      results[output.id] = null;
    } else {
      results[output.id] = { width: output.width, height: output.height };
    }
  }

  return results;
}

function measureWithImageElement(item: ImageSizeInput): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(item.blob);
    const img = new Image();

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Image dimension measurement timeout"));
    }, MEASURE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
    }

    img.addEventListener(
      "load",
      () => {
        cleanup();
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      },
      { once: true },
    );

    img.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Image dimension measurement failed"));
      },
      { once: true },
    );

    img.src = url;
  });
}
