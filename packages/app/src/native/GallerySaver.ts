import { registerPlugin } from "@capacitor/core";
import { toWebProxyUrl } from "../utils/imageLoader";

// ─── 保存到相册桥（spec docs/specs/image-save-download.md §3 D3）───
// Native：GallerySaverPlugin.java（webview 引擎，GallerySaver.java 深模块）。
// Web：blob + <a download> 浏览器下载（开发便利回退，非产品路径）。

export interface GallerySaverPlugin {
  /** 保存一张图到系统相册（native）/ 触发浏览器下载（web）。失败 reject（消息可读）。 */
  saveImage(options: { url: string; fileName: string }): Promise<{ uri: string }>;
}

/**
 * Web 回退实现（类导出仅为可测）：代理 URL 取 blob → 临时 <a download> 点击。
 * blob URL 延迟释放，避免部分内核点击前回收。
 */
export class GallerySaverWeb implements GallerySaverPlugin {
  async saveImage(options: { url: string; fileName: string }): Promise<{ uri: string }> {
    const res = await fetch(toWebProxyUrl(options.url));
    if (!res.ok) {
      throw new Error(`下载失败 (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = options.fileName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // 点击触发的下载已拿到引用；延时回收避免立即 revoke 打断下载
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    }
    return { uri: options.fileName };
  }
}

export const GallerySaver = registerPlugin<GallerySaverPlugin>("GallerySaver", {
  web: new GallerySaverWeb(),
});
