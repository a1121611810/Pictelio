import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/native/PixivApi", () => ({
  PixivApi: {
    prefetchImage: vi.fn(() => Promise.resolve({ cached: false })),
    request: vi.fn(),
    syncToken: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: vi.fn(() => ({
    saveImage: vi.fn().mockResolvedValue({}),
    getImage: vi.fn().mockResolvedValue({}),
    getCachedKeys: vi.fn().mockResolvedValue({ keys: [] }),
    clearCache: vi.fn(),
  })),
}));

describe("loadImage on native platform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefetches image via PixivApi and returns proxy path", async () => {
    const { PixivApi } = await import("@/native/PixivApi");
    const { loadImage } = await import("@/utils/imageLoader");
    const result = await loadImage("https://i.pximg.net/img.jpg");

    // Native 路径先检查 ImageCache 磁盘缓存（未命中），然后调用 PixivApi.prefetchImage
    expect(PixivApi.prefetchImage).toHaveBeenCalledTimes(1);
    expect(PixivApi.prefetchImage).toHaveBeenCalledWith({ url: "https://i.pximg.net/img.jpg" });

    // LoadImage 返回代理 URL
    expect(result.url).toMatch(/^\/pixiv-img\//u);
  });
});
