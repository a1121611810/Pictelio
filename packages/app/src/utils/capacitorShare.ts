// ─── 系统分享（webview 引擎：Capacitor 插件桥，spec docs/specs/download-manager.md §4.1）───
// 纯注入工厂（零 @capacitor/core 依赖，node 可测）；生产接线在 native/downloadSharer.ts。
export interface PictelioShareNative {
  share(options: { uris: string[]; mime?: string }): Promise<void>;
}

/** 把 Capacitor 分享插件适配为 downloadStore 的 sharer（uris → Promise<void>）。 */
export function createCapacitorSharer(
  native: PictelioShareNative,
): (uris: readonly string[]) => Promise<void> {
  return async (uris) => {
    if (uris.length === 0) {
      throw new Error("没有可分享的文件");
    }
    await native.share({ uris: [...uris] });
  };
}
