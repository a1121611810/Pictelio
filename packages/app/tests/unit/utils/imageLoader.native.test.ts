import { describe, it, expect, vi, beforeEach } from "vitest";

// 受控的 ImageCache 插件实例：registerPlugin 返回同一实例，测试可按用例改写 getCachedKeys 返回值
// （字段与真实 ImageCachePlugin 契约一致，见 src/native/ImageCache.ts）
const { imageCachePlugin } = vi.hoisted(() => ({
  imageCachePlugin: {
    saveImage: vi.fn().mockResolvedValue({}),
    getImage: vi.fn().mockResolvedValue({}),
    getCachedKeys: vi.fn().mockResolvedValue({ keys: [] }),
    clearCache: vi.fn(),
  },
}));

vi.mock("@/native/PixivApi", () => ({
  PixivApi: {
    prefetchImage: vi.fn(() => Promise.resolve({ cached: false })),
    request: vi.fn(),
    syncToken: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: vi.fn(() => imageCachePlugin),
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

describe("warmCacheFromDisk", () => {
  // 期望值来源：X2 诊断规格（docs/research/webview-perf-diagnosis.md）——
  // 预热登记上限 WARM_CACHE_KEY_COUNT = 300；getCachedKeys 按「旧 → 新」返回，slice(-300) 保留最后 300 个
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearImageCache } = await import("@/utils/imageLoader");
    clearImageCache();
  });

  it("getCachedKeys 返回超过 300 个 key 时，只登记最近 300 个", async () => {
    // 350 个 key：编号 0 最旧 …… 349 最新
    imageCachePlugin.getCachedKeys.mockResolvedValue({
      keys: Array.from({ length: 350 }, (_, i) => `https://i.pximg.net/warm/${i}.jpg`),
    });

    const { warmCacheFromDisk, getCacheSize, getLruOrderForTest } =
      await import("@/utils/imageLoader");
    await warmCacheFromDisk();

    // 只登记 300 条（而非全部 350 条）
    expect(getCacheSize()).toBe(300);
    const order = getLruOrderForTest();
    // 最旧保留的是编号 50（350 - 300），最新是编号 349；编号 49 应被丢弃
    expect(order[0]).toBe("https://i.pximg.net/warm/50.jpg");
    expect(order[299]).toBe("https://i.pximg.net/warm/349.jpg");
    expect(order).not.toContain("https://i.pximg.net/warm/49.jpg");
  });

  it("getCachedKeys 不超过 300 个时全量登记", async () => {
    imageCachePlugin.getCachedKeys.mockResolvedValue({
      keys: ["https://i.pximg.net/warm/a.jpg", "https://i.pximg.net/warm/b.jpg"],
    });

    const { warmCacheFromDisk, getCacheSize, getLruOrderForTest } =
      await import("@/utils/imageLoader");
    await warmCacheFromDisk();

    expect(getCacheSize()).toBe(2);
    expect(getLruOrderForTest()).toEqual([
      "https://i.pximg.net/warm/a.jpg",
      "https://i.pximg.net/warm/b.jpg",
    ]);
  });
});
