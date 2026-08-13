import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { createSearchStore } from "@/stores/searchStore";

const mockSearchIllust = vi.fn();
const mockSearchNovel = vi.fn();
const mockSearchIllustNext = vi.fn();
const mockSearchNovelNext = vi.fn();

vi.mock("@/api/search", () => ({
  searchIllust: (...args: unknown[]) => mockSearchIllust(...args),
  searchNovel: (...args: unknown[]) => mockSearchNovel(...args),
  searchIllustNext: (...args: unknown[]) => mockSearchIllustNext(...args),
  searchNovelNext: (...args: unknown[]) => mockSearchNovelNext(...args),
}));

describe("searchStore executeSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets error on API failure", async () => {
    mockSearchIllust.mockRejectedValue(new Error("网络错误"));
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      store.setScope("illust");
      store.setKeyword("test");
      await store.executeSearch();

      expect(mockSearchIllust).toHaveBeenCalled();
      expect(store.error()).toBeTruthy();
      expect(store.loading()).toBe(false);

      dispose();
    });
  });

  it("calls searchIllust with scope=illust", async () => {
    mockSearchIllust.mockResolvedValue({ illusts: [], next_url: null });
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      store.setScope("illust");
      store.setKeyword("test");
      await store.executeSearch();

      expect(mockSearchIllust).toHaveBeenCalled();
      expect(mockSearchNovel).not.toHaveBeenCalled();

      dispose();
    });
  });

  it("calls searchNovel with scope=novel", async () => {
    mockSearchNovel.mockResolvedValue({ novels: [], next_url: null });
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      store.setScope("novel");
      store.setKeyword("test");
      await store.executeSearch();

      expect(mockSearchNovel).toHaveBeenCalled();
      expect(mockSearchIllust).not.toHaveBeenCalled();

      dispose();
    });
  });

  it("calls both APIs with scope=all", async () => {
    mockSearchIllust.mockResolvedValue({ illusts: [], next_url: null });
    mockSearchNovel.mockResolvedValue({ novels: [], next_url: null });
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      store.setScope("all");
      store.setKeyword("test");
      await store.executeSearch();

      expect(mockSearchIllust).toHaveBeenCalled();
      expect(mockSearchNovel).toHaveBeenCalled();

      dispose();
    });
  });

  it("skips re-entrant executeSearch with the same params (abort race guard)", async () => {
    let resolveIllust!: (v: unknown) => void;
    const pending = new Promise((r) => (resolveIllust = r));
    mockSearchIllust.mockReturnValue(pending);

    await createRoot(async (dispose) => {
      const store = createSearchStore();
      store.setScope("illust");
      store.setKeyword("reentrant-guard-check");

      const p1 = store.executeSearch();
      // 第二次同参数调用在飞行中直接跳过，不发起新请求、不 abort 第一个
      const p2 = store.executeSearch();
      expect(mockSearchIllust).toHaveBeenCalledTimes(1);

      resolveIllust({
        illusts: [{ id: 1, create_date: "2026-01-01T00:00:00+09:00" }],
        next_url: "https://app-api.pixiv.net/v1/search/illust?word=test&offset=30",
      });
      await Promise.all([p1, p2]);
      expect(store.results()).toHaveLength(1);
      expect(store.loading()).toBe(false);
      expect(store.hasMore()).toBe(true);

      dispose();
    });
  });

  it("marks loadMore failure as paginationError and keeps results", async () => {
    mockSearchIllust.mockResolvedValue({
      illusts: [{ id: 1, create_date: "2026-01-01T00:00:00+09:00" }],
      next_url: "https://app-api.pixiv.net/v1/search/illust?word=test&offset=30",
    });
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      store.setScope("illust");
      store.setKeyword("pagination-error-check");
      await store.executeSearch();
      expect(store.results()).toHaveLength(1);
      expect(store.paginationError()).toBe(false);

      // 第二页失败 → paginationError=true，已加载结果保留
      mockSearchIllustNext.mockRejectedValue(new Error("network down"));
      await store.loadMore();
      expect(store.error()).toBeTruthy();
      expect(store.paginationError()).toBe(true);
      expect(store.results()).toHaveLength(1);

      // 重新搜索 → paginationError 复位
      mockSearchIllust.mockResolvedValue({
        illusts: [{ id: 2, create_date: "2026-01-02T00:00:00+09:00" }],
        next_url: null,
      });
      await store.executeSearch();
      expect(store.paginationError()).toBe(false);
      expect(store.error()).toBeNull();

      dispose();
    });
  });
});
