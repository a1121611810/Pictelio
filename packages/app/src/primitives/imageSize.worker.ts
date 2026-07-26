import * as Comlink from "comlink";

export interface ImageSizeInput {
  id: string;
  blob: Blob;
}

export type ImageSizeOutput =
  | { id: string; width: number; height: number }
  | { id: string; error: true };

/**
 * 在 Worker 中使用 createImageBitmap 测量图片原始尺寸。
 * 读取后立即 close() 释放位图内存。
 */
function measureImages(items: ImageSizeInput[]): Promise<ImageSizeOutput[]> {
  return Promise.all(
    items.map(async (item): Promise<ImageSizeOutput> => {
      const [err, bitmap] = await tryAsync(createImageBitmap(item.blob));
      if (err) {
        return { id: item.id, error: true };
      }
      const { width, height } = bitmap;
      bitmap.close();
      return { id: item.id, width, height };
    }),
  );
}

const api = {
  measureImages,
};

Comlink.expose(api);

export type ImageSizeWorkerAPI = typeof api;
