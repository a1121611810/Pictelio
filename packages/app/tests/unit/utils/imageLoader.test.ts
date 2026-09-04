import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 外部依赖 ——

vi.mock("@/stores/imageHostStore", () => ({
  isImageHostEnabled: () => false,
}));

vi.mock("@/services/imageHostService", () => ({
  getEffectiveImageUrl: (url: string) => url,
  getRaceCandidateUrls: () => [],
}));

// ── Helper ——

async function load() {
  return import("@/utils/imageLoader");
}

/**
 * 创建一个受控的 fetch mock：第一次调用返回一个可控的 Promise，
 * 之后按需提供 `resolve()` 来控制何时完成。
 */
function createControlledFetch() {
  let resolveFetch!: (resp: Response) => void;
  let rejectFetch!: (err: Error) => void;

  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
    return new Promise<Response>((resolve, reject) => {
      resolveFetch = resolve;
      rejectFetch = reject;
    });
  });

  const resolve = () => {
    resolveFetch(new Response(new Blob(["fake-image"], { type: "image/jpeg" }), { status: 200 }));
  };

  const reject = (err?: Error) => {
    rejectFetch(err ?? new Error("Network error"));
  };

  return { fetchMock, resolve, reject };
}

// ── Tests ──

describe("toWebProxyUrl", () => {
  it("converts i.pixiv.re URL to /pixiv-re/ proxy path", async () => {
    const { toWebProxyUrl } = await load();
    const result = toWebProxyUrl(
      "https://i.pixiv.re/c/540x540_70/img-master/img/2026/01/01/1_p0_master1200.jpg",
    );
    expect(result).toBe("/pixiv-re/c/540x540_70/img-master/img/2026/01/01/1_p0_master1200.jpg");
  });

  it("converts i.pixiv.nl URL to /pixiv-nl/ proxy path", async () => {
    const { toWebProxyUrl } = await load();
    const result = toWebProxyUrl(
      "https://i.pixiv.nl/c/540x540_70/img-master/img/2026/01/01/1_p0_master1200.jpg",
    );
    expect(result).toBe("/pixiv-nl/c/540x540_70/img-master/img/2026/01/01/1_p0_master1200.jpg");
  });

  it("converts i.pximg.net URL to /pixiv-img/ proxy path", async () => {
    const { toWebProxyUrl } = await load();
    const result = toWebProxyUrl(
      "https://i.pximg.net/c/540x540_70/img-master/img/2026/01/01/1_p0_master1200.jpg",
    );
    expect(result).toBe("/pixiv-img/c/540x540_70/img-master/img/2026/01/01/1_p0_master1200.jpg");
  });

  it("returns already-proxied URLs unchanged", async () => {
    const { toWebProxyUrl } = await load();
    expect(toWebProxyUrl("/pixiv-re/c/1.jpg")).toBe("/pixiv-re/c/1.jpg");
    expect(toWebProxyUrl("/pixiv-img/c/1.jpg")).toBe("/pixiv-img/c/1.jpg");
  });

  it("returns empty string for empty input", async () => {
    const { toWebProxyUrl } = await load();
    expect(toWebProxyUrl("")).toBe("");
  });

  it("handles unknown hosts via resolveImageUrl fallback", async () => {
    const { toWebProxyUrl } = await load();
    const result = toWebProxyUrl("https://cdn.example.com/c/540x540_70/img.jpg");
    expect(result).toMatch(/^\/pixiv-img\//u);
  });
});

describe("pickUnprefetchedUrls", () => {
  // 期望值来源：FeedList 预取调度规格 —— 按列表顺序挑「未预取」的前 limit 个，不重排、不去重、无副作用
  it("按顺序挑出未预取的前 N 个（跳过已预取）", async () => {
    const { pickUnprefetchedUrls } = await load();
    const prefetched = new Set(["b"]);
    expect(pickUnprefetchedUrls(["a", "b", "c", "d"], prefetched, 2)).toEqual(["a", "c"]);
  });

  it("空列表返回空数组", async () => {
    const { pickUnprefetchedUrls } = await load();
    expect(pickUnprefetchedUrls([], new Set(), 12)).toEqual([]);
  });

  it("全部已预取时返回空数组", async () => {
    const { pickUnprefetchedUrls } = await load();
    const prefetched = new Set(["a", "b"]);
    expect(pickUnprefetchedUrls(["a", "b"], prefetched, 12)).toEqual([]);
  });

  it("候选超过 limit 时截断为前 limit 个", async () => {
    const { pickUnprefetchedUrls } = await load();
    expect(pickUnprefetchedUrls(["a", "b", "c", "d", "e"], new Set(), 3)).toEqual(["a", "b", "c"]);
  });

  it("limit 大于未预取数量时返回全部未预取", async () => {
    const { pickUnprefetchedUrls } = await load();
    expect(pickUnprefetchedUrls(["a", "b"], new Set(["b"]), 12)).toEqual(["a"]);
  });
});

describe("loadImage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearImageCache } = await load();
    clearImageCache();
  });

  describe("in-flight 请求去重", () => {
    it("同一 URL 的并发调用只发起一次 HTTP 请求", async () => {
      const { loadImage } = await load();
      const { fetchMock, resolve } = createControlledFetch();
      vi.stubGlobal("fetch", fetchMock);

      // 并发调用 5 次同一 URL
      const promises = Array.from({ length: 5 }, () =>
        loadImage("https://i.pximg.net/test/1_p0_master1200.jpg"),
      );

      // 等待微任务队列处理完，fetch 应该只被调用 1 次
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      // 释放 fetch
      resolve();

      const results = await Promise.all(promises);
      results.forEach((r) => {
        expect(r.url).toBeTruthy();
        expect(typeof r.cleanup).toBe("function");
      });

      // 始终只发起 1 次 fetch
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it("不同 URL 的并发调用各自独立发起请求", async () => {
      const { loadImage } = await load();

      let resolve1!: (r: Response) => void;
      let resolve2!: (r: Response) => void;
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(() => {
          return new Promise((resolve) => {
            resolve1 = resolve;
          });
        })
        .mockImplementationOnce(() => {
          return new Promise((resolve) => {
            resolve2 = resolve;
          });
        });
      vi.stubGlobal("fetch", fetchMock);

      // 两个不同 URL 并发
      const p1 = loadImage("https://i.pximg.net/test/1_p0.jpg");
      const p2 = loadImage("https://i.pximg.net/test/2_p0.jpg");

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      resolve1(new Response(new Blob(["a"], { type: "image/jpeg" }), { status: 200 }));
      resolve2(new Response(new Blob(["b"], { type: "image/jpeg" }), { status: 200 }));

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.url).toBeTruthy();
      expect(r2.url).toBeTruthy();
      expect(r1.url).not.toBe(r2.url); // 不同图片，不同的 blob URL

      vi.unstubAllGlobals();
    });

    it("第一次加载完成后，第二次调用命中缓存不再发起请求", async () => {
      const { loadImage } = await load();
      const { fetchMock, resolve } = createControlledFetch();
      vi.stubGlobal("fetch", fetchMock);

      // 第一次加载
      const p1 = loadImage("https://i.pximg.net/test/1_p0.jpg");
      resolve();
      await p1;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fetchMock.mockClear();

      // 第二次调用同一 URL — 应该命中缓存
      const result = await loadImage("https://i.pximg.net/test/1_p0.jpg");
      expect(result.url).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled(); // 没有新的 fetch

      vi.unstubAllGlobals();
    });

    it("请求失败后，所有并发调用都拿到降级 URL，且不再次请求", async () => {
      const { loadImage } = await load();
      const { fetchMock, reject } = createControlledFetch();
      vi.stubGlobal("fetch", fetchMock);

      const promises = Array.from({ length: 3 }, () =>
        loadImage("https://i.pximg.net/test/fail.jpg"),
      );

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      // Fetch 失败
      reject(new Error("Network error"));

      const results = await Promise.all(promises);
      results.forEach((r) => {
        // 降级为代理 URL（即 fallback 路径）
        expect(r.url).toMatch(/^\/pixiv-img\//u);
        expect(typeof r.cleanup).toBe("function");
      });

      // 只有 1 次 fetch
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe("loadImageWithProgress 交叉复用", () => {
    it("loadImageWithProgress 可等待 loadImage 的飞行中请求完成", async () => {
      const { loadImage, loadImageWithProgress } = await load();
      const { fetchMock, resolve } = createControlledFetch();
      vi.stubGlobal("fetch", fetchMock);

      // LoadImage 先行
      const p1 = loadImage("https://i.pximg.net/test/progress.jpg");

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      // LoadImageWithProgress 随后 — 应交叉复用同一个 inflight 请求，不再发起新请求
      const progressSpy = vi.fn();
      const p2 = loadImageWithProgress("https://i.pximg.net/test/progress.jpg", progressSpy);

      // 此时不应该有新的 fetch
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 释放 fetch
      resolve();

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.url).toBeTruthy();
      expect(r2.url).toBeTruthy();
      // Progress 回调：从缓存中获取后立即 100%
      expect(progressSpy).toHaveBeenCalledWith(expect.objectContaining({ percent: 100 }));

      // 仍然只有 1 次 fetch
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe("边界情况", () => {
    it("空 URL 立即返回空结果，不发起请求", async () => {
      const { loadImage } = await load();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await loadImage("");
      expect(result.url).toBe("");
      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("checkImageCache 同步检查缓存正确", async () => {
      const { loadImage, checkImageCache } = await load();
      const { fetchMock, resolve } = createControlledFetch();
      vi.stubGlobal("fetch", fetchMock);

      // 加载前：缓存无数据
      expect(checkImageCache("https://i.pximg.net/test/cache.jpg")).toBeUndefined();

      const p1 = loadImage("https://i.pximg.net/test/cache.jpg");
      resolve();
      await p1;

      // 加载后：缓存命中
      const cachedUrl = checkImageCache("https://i.pximg.net/test/cache.jpg");
      expect(cachedUrl).toBeTruthy();
      // CheckImageCache 现在返回代理 URL 而非 blob: URL（避免 Network 面板噪声）
      expect(cachedUrl).toMatch(/^\/pixiv-img\//u);

      vi.unstubAllGlobals();
    });

    it("injectCacheEntry 单参调用即可登记 key", async () => {
      const { injectCacheEntry, checkImageCache } = await load();

      injectCacheEntry("https://i.pximg.net/test/warm.jpg");

      expect(checkImageCache("https://i.pximg.net/test/warm.jpg")).toMatch(/^\/pixiv-img\//u);
    });

    it("checkImageCache 命中时刷新 LRU 访问顺序（而非 FIFO）", async () => {
      const { loadImage, checkImageCache, getLruOrderForTest } = await load();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          Promise.resolve(new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200 })),
        );
      vi.stubGlobal("fetch", fetchMock);

      await loadImage("https://i.pximg.net/test/a.jpg");
      await loadImage("https://i.pximg.net/test/b.jpg");

      // 访问 a —— a 应该被挪到最新位置
      checkImageCache("https://i.pximg.net/test/a.jpg");

      expect(getLruOrderForTest()).toEqual([
        "https://i.pximg.net/test/b.jpg",
        "https://i.pximg.net/test/a.jpg",
      ]);

      vi.unstubAllGlobals();
    });

    it("重复写入同一 key 不产生重复条目", async () => {
      const { loadImage, injectCacheEntry, getLruOrderForTest } = await load();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          Promise.resolve(new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200 })),
        );
      vi.stubGlobal("fetch", fetchMock);

      // 模拟预热 + 正常加载写同一 key（修复前 totalBytes 会虚增 2 倍）
      injectCacheEntry("https://i.pximg.net/test/dup.jpg");
      await loadImage("https://i.pximg.net/test/dup.jpg");

      const keys = getLruOrderForTest().filter((k) => k === "https://i.pximg.net/test/dup.jpg");
      expect(keys).toHaveLength(1);

      vi.unstubAllGlobals();
    });

    it("超出 MAX_CACHE_ENTRIES 时淘汰最旧条目", async () => {
      const { injectCacheEntry, checkImageCache, getCacheSize, getLruOrderForTest } = await load();

      // 注：MAX_CACHE_ENTRIES = 10000，全量跑太慢。此测试通过缩小规模验证逻辑。
      // 直接注入 10001 个 key 验证淘汰语义。
      for (let i = 0; i <= 10_000; i++) {
        injectCacheEntry(`https://i.pximg.net/test/evict-${i}.jpg`);
      }

      // 第 0 个应已被淘汰，第 1 个及之后保留
      expect(getCacheSize()).toBe(10_000);
      expect(checkImageCache("https://i.pximg.net/test/evict-0.jpg")).toBeUndefined();
      expect(checkImageCache("https://i.pximg.net/test/evict-10000.jpg")).toBeTruthy();
      // 最旧的是 evict-1
      expect(getLruOrderForTest()[0]).toBe("https://i.pximg.net/test/evict-1.jpg");
    }, 15_000);
  });
});
