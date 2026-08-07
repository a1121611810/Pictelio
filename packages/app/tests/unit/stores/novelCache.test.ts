import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMemoryStore, type IDBStore } from "@/stores/db";
import * as novelCache from "@/stores/novelCache";
import type { PixivNovel } from "@/api/types";
import type { SeriesCacheEntry } from "@/stores/novelCache";

// loadNovelEntry 依赖的 API 层 mock（其余测试不触达网络层）
const mockLoadDetail = vi.fn();
const mockFetchNovelData = vi.fn();
vi.mock("@/api/novel", () => ({
  loadDetail: (...args: unknown[]) => mockLoadDetail(...args),
  fetchNovelData: (...args: unknown[]) => mockFetchNovelData(...args),
}));

function makeNovel(id: number): PixivNovel {
  return {
    id,
    title: `Novel ${id}`,
    user: { id: 1, name: "author", account: "a", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 1000,
    is_bookmarked: false,
    total_bookmarks: 0,
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00Z",
  } as PixivNovel;
}

function makeEntry(id: number): novelCache.CacheEntry {
  return {
    detail: makeNovel(id),
    text: `text ${id}`,
    nav: {},
    images: {},
  };
}

function makeSeriesEntry(id: number): SeriesCacheEntry {
  return {
    detail: {
      id,
      title: `Series ${id}`,
      user: { id: 1, name: "author", account: "a", profile_image_urls: {} },
      create_date: "2026-01-01T00:00:00Z",
      total_character_count: 1000,
      display_text_count: 1000,
    },
    novels: [makeNovel(id)],
    nextUrl: null,
  };
}

describe("novelCache", () => {
  let memStore: IDBStore;

  beforeEach(() => {
    memStore = createMemoryStore();
    novelCache.setTestStore(memStore);
    mockLoadDetail.mockReset();
    mockFetchNovelData.mockReset();
    // Clear hot cache via clearAll
    return novelCache.clearAll();
  });

  // ── Hot cache (sync) ──

  describe("peekEntry (hot cache)", () => {
    it("returns undefined for uncached novel", () => {
      expect(novelCache.peekEntry(1)).toBeUndefined();
    });

    it("returns entry after setEntry", async () => {
      const entry = makeEntry(1);
      await novelCache.setEntry(1, entry);
      expect(novelCache.peekEntry(1)).toEqual(entry);
    });

    it("FIFO eviction when over limit", async () => {
      for (let i = 1; i <= 11; i++) {
        await novelCache.setEntry(i, makeEntry(i));
      }
      // 第一篇应被淘汰（FIFO，且 setHotNovel 会提升更新条目到 MRU）
      expect(novelCache.peekEntry(1)).toBeUndefined();
      // 第 11 篇应在缓存中
      expect(novelCache.peekEntry(11)).toEqual(makeEntry(11));
      // 第 2 篇也应在（第 2 篇是第 11 篇插入后剩下的最旧篇之一）
      expect(novelCache.peekEntry(2)).toBeDefined();
    });
  });

  // ── IndexedDB persistence ──

  describe("getEntry / setEntry", () => {
    it("getEntry returns undefined for uncached novel", async () => {
      const result = await novelCache.getEntry(1);
      expect(result).toBeUndefined();
    });

    it("setEntry then getEntry returns the entry", async () => {
      const entry = makeEntry(1);
      await novelCache.setEntry(1, entry);
      const result = await novelCache.getEntry(1);
      expect(result?.detail.id).toBe(1);
      expect(result?.text).toBe("text 1");
    });

    it("getEntry hydrates hot cache from IDB", async () => {
      // Write directly to IDB (simulate cold start)
      await memStore.put("novels", { id: 1, ...makeEntry(1), cachedAt: Date.now() });
      // PeekEntry should miss (hot cache is empty)
      expect(novelCache.peekEntry(1)).toBeUndefined();
      // GetEntry should read from IDB and hydrate hot cache
      const result = await novelCache.getEntry(1);
      expect(result).toBeDefined();
      // Now peekEntry should hit
      expect(novelCache.peekEntry(1)).toBeDefined();
    });

    it("setEntry updates existing entry", async () => {
      await novelCache.setEntry(1, makeEntry(1));
      await novelCache.setEntry(1, { ...makeEntry(1), text: "updated" });
      const result = await novelCache.getEntry(1);
      expect(result?.text).toBe("updated");
    });
  });

  // ── Series cache ──

  describe("series cache", () => {
    it("peekSeries returns undefined for uncached series", () => {
      expect(novelCache.peekSeries(1)).toBeUndefined();
    });

    it("setSeries then getSeries works", async () => {
      const entry = makeSeriesEntry(1);
      await novelCache.setSeries(1, entry);
      const result = await novelCache.getSeries(1);
      expect(result?.detail.id).toBe(1);
    });

    it("getSeries hydrates hot cache from IDB", async () => {
      const entry = makeSeriesEntry(1);
      await memStore.put("series", { id: 1, ...entry, cachedAt: Date.now() });
      expect(novelCache.peekSeries(1)).toBeUndefined();
      const result = await novelCache.getSeries(1);
      expect(result).toBeDefined();
      expect(novelCache.peekSeries(1)).toBeDefined();
    });
  });

  // ── clearAll ──

  describe("clearAll", () => {
    it("clears both hot cache and IDB", async () => {
      await novelCache.setEntry(1, makeEntry(1));
      await novelCache.setSeries(1, makeSeriesEntry(1));
      await novelCache.clearAll();
      expect(novelCache.peekEntry(1)).toBeUndefined();
      expect(await novelCache.getEntry(1)).toBeUndefined();
      expect(novelCache.peekSeries(1)).toBeUndefined();
      expect(await novelCache.getSeries(1)).toBeUndefined();
    });
  });

  // ── IDB limit enforcement ──

  describe("IDB limit enforcement", () => {
    it("keeps novels under MAX_NOVELS (200)", async () => {
      // Insert 210 entries
      for (let i = 1; i <= 210; i++) {
        await novelCache.setEntry(i, makeEntry(i));
      }
      // Should be ≤ 200
      const count = await memStore.count("novels");
      expect(count).toBeLessThanOrEqual(200);
    });

    it("keeps series under MAX_SERIES (100)", async () => {
      for (let i = 1; i <= 110; i++) {
        await novelCache.setSeries(i, makeSeriesEntry(i));
      }
      const count = await memStore.count("series");
      expect(count).toBeLessThanOrEqual(100);
    });
  });

  describe("loadNovelEntry（正文加载失败不静默，bug 3 修复）", () => {
    it("正文加载失败时 console.warn + 抛错（不再把 text 置空静默吞错）", async () => {
      mockLoadDetail.mockResolvedValue({ novel: makeNovel(1) });
      mockFetchNovelData.mockRejectedValue(new Error("小说正文加载失败 (HTTP 400)"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        await expect(novelCache.loadNovelEntry(1)).rejects.toThrow("HTTP 400");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("[novelCache]"),
          expect.any(Error),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("详情失败时抛详情错误（原有语义保持）", async () => {
      mockLoadDetail.mockRejectedValue(new Error("detail failed"));
      mockFetchNovelData.mockResolvedValue({ text: "hello", navigation: {}, images: {} });

      await expect(novelCache.loadNovelEntry(1)).rejects.toThrow("detail failed");
    });

    it("成功时返回 entry 并写入热缓存", async () => {
      mockLoadDetail.mockResolvedValue({ novel: makeNovel(1) });
      mockFetchNovelData.mockResolvedValue({ text: "hello", navigation: {}, images: {} });

      const entry = await novelCache.loadNovelEntry(1);
      expect(entry.detail.id).toBe(1);
      expect(entry.text).toBe("hello");
      expect(novelCache.peekEntry(1)?.text).toBe("hello");
    });
  });
});
