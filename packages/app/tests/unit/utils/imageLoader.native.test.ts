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

describe("isImagePrefetching（native 桥路径）", () => {
  // oracle：loadImageInner native 分支真实桥契约（PixivApiPlugin.prefetchImage resolve 载荷
  // { cached, path, size? }：已缓存 cached=true 提前返回，新下载 cached=false + path + size，
  // 失败 call.reject → JS 侧 throw "Prefetch failed"）+ spec round4 §A 三态表：
  // inflight 在途 = true；完成（loadImageInner cacheSet 登记 L1）后 false；失败（不 cacheSet）后 false。
  // 成功/失败双路径按 IO 边界测试硬约束成对覆盖（Web 侧相反的失败登记语义由 imageLoader.test.ts 覆盖）。

  /** 受控 deferred：模拟 Java 侧 prefetchImage 的异步完成时机（挂起 → resolve/reject） */
  function deferredPrefetch() {
    let resolve!: (v: { cached: boolean; path: string; size?: number }) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<{ cached: boolean; path: string; size?: number }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearImageCache } = await import("@/utils/imageLoader");
    clearImageCache();
  });

  it("prefetchImage 挂起期间 isImagePrefetching=true；resolve 后 false 且 checkImageCache 命中", async () => {
    const { PixivApi } = await import("@/native/PixivApi");
    const { loadImage, isImagePrefetching, checkImageCache } = await import("@/utils/imageLoader");

    const d = deferredPrefetch();
    vi.mocked(PixivApi.prefetchImage).mockReturnValue(d.promise);

    const url = "https://i.pximg.net/native/inflight.jpg";
    const p = loadImage(url);

    // 在途：ImageCache 磁盘查询未命中（mock 空对象）→ 进入 prefetchImage 等待窗口
    expect(isImagePrefetching(url)).toBe(true);
    expect(checkImageCache(url)).toBeUndefined(); // L1 未登记（未完成）

    // Java 侧下载+写盘完成（真实桥契约：新下载 resolve { cached:false, path, size }）
    d.resolve({ cached: false, path: "/data/cache/pictelio-images/abc", size: 1024 });
    await p;

    // 完成后：inflight 已被 .finally 清除；loadImageInner 已 cacheSet 登记 L1
    expect(isImagePrefetching(url)).toBe(false);
    expect(checkImageCache(url)).toMatch(/^\/pixiv-img\//u);
  });

  it("prefetchImage 失败：loadImage reject、isImagePrefetching=false 且 L1 不登记（不误标）", async () => {
    // native 失败语义（loadImageInner prefetchErr 分支）：不 cacheSet，让调用方重试——
    // 与 Web 失败降级（也标记 L1）相反，此处断言 L1 保持未登记
    const warnSpy = vi.spyOn(console, "warn");
    const { PixivApi } = await import("@/native/PixivApi");
    const { loadImage, isImagePrefetching, checkImageCache } = await import("@/utils/imageLoader");

    const d = deferredPrefetch();
    vi.mocked(PixivApi.prefetchImage).mockReturnValue(d.promise);

    const url = "https://i.pximg.net/native/inflight-fail.jpg";
    const p = loadImage(url);
    expect(isImagePrefetching(url)).toBe(true);

    d.reject(new Error("Prefetch failed: connection reset"));
    await expect(p).rejects.toThrow("Prefetch failed");

    // 失败落定后：inflight 同样经 .finally 清除；L1 未登记
    expect(isImagePrefetching(url)).toBe(false);
    expect(checkImageCache(url)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled(); // 失败路径有 warn（非静默）
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
