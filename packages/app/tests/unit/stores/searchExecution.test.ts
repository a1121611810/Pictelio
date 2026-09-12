import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { createSearchStore } from "@/stores/searchStore";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "@pictelio/search-core";

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

/**
 * SolidJS 2.0 语义：createRoot body 属 owned scope，同步写 signal 会 throw
 * （REACTIVE_WRITE_IN_OWNED_SCOPE）。store 在 root 内创建（内部 memo 需要 owner），
 * 写操作与断言在 root 外执行。
 */
function setup(): { store: ReturnType<typeof createSearchStore>; dispose: () => void } {
  let dispose!: () => void;
  const store = createRoot((d) => {
    dispose = d;
    return createSearchStore();
  });
  return { store, dispose };
}

describe("searchStore executeSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets error on API failure", async () => {
    mockSearchIllust.mockRejectedValue(new Error("网络错误"));
    const { store, dispose } = setup();
    store.setScope("illust");
    store.setKeyword("test");
    await store.executeSearch();

    expect(mockSearchIllust).toHaveBeenCalled();
    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBe(false);

    dispose();
  });

  it("calls searchIllust with scope=illust", async () => {
    mockSearchIllust.mockResolvedValue({ illusts: [], next_url: null });
    const { store, dispose } = setup();
    store.setScope("illust");
    store.setKeyword("test");
    await store.executeSearch();

    expect(mockSearchIllust).toHaveBeenCalled();
    expect(mockSearchNovel).not.toHaveBeenCalled();

    dispose();
  });

  it("calls searchNovel with scope=novel", async () => {
    mockSearchNovel.mockResolvedValue({ novels: [], next_url: null });
    const { store, dispose } = setup();
    store.setScope("novel");
    store.setKeyword("test");
    await store.executeSearch();

    expect(mockSearchNovel).toHaveBeenCalled();
    expect(mockSearchIllust).not.toHaveBeenCalled();

    dispose();
  });

  it("calls both APIs with scope=all", async () => {
    mockSearchIllust.mockResolvedValue({ illusts: [], next_url: null });
    mockSearchNovel.mockResolvedValue({ novels: [], next_url: null });
    const { store, dispose } = setup();
    store.setScope("all");
    store.setKeyword("test");
    await store.executeSearch();

    expect(mockSearchIllust).toHaveBeenCalled();
    expect(mockSearchNovel).toHaveBeenCalled();

    dispose();
  });

  it("skips re-entrant executeSearch with the same params (abort race guard)", async () => {
    let resolveIllust!: (v: unknown) => void;
    const pending = new Promise((r) => (resolveIllust = r));
    mockSearchIllust.mockReturnValue(pending);

    const { store, dispose } = setup();
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

  it("marks loadMore failure as paginationError and keeps results", async () => {
    mockSearchIllust.mockResolvedValue({
      illusts: [{ id: 1, create_date: "2026-01-01T00:00:00+09:00" }],
      next_url: "https://app-api.pixiv.net/v1/search/illust?word=test&offset=30",
    });
    const { store, dispose } = setup();
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

  it("AI 覆盖 hide：客户端隐藏 AI 作品（#479 面板覆盖注入，aiOverride 不进请求）", async () => {
    mockSearchIllust.mockResolvedValue({
      illusts: [
        { id: 1, create_date: "2026-01-01T00:00:00+09:00", illust_ai_type: 2, total_bookmarks: 10 },
        { id: 2, create_date: "2026-01-02T00:00:00+09:00", illust_ai_type: 0, total_bookmarks: 10 },
      ],
      next_url: null,
    });
    const { store, dispose } = setup();
    store.setScope("illust");
    store.setKeyword("ai-override-hide");
    store.setFilters({ ...DEFAULT_SEARCH_FILTERS, aiOverride: "hide" });
    await store.executeSearch();

    // 账号设置为默认 show（uid=null 回退），覆盖 hide → mask 语义 → AI 作品被移除
    expect(store.results().map((r) => r.entity.id)).toEqual([2]);
    // 覆盖参数不进请求（search_ai_type 永不发送）
    const args = mockSearchIllust.mock.calls[0] as unknown[];
    expect(JSON.stringify(args[3])).not.toContain("search_ai_type");
    dispose();
  });

  it("收藏数客户端兜底：非热门路径按 total_bookmarks 本地过滤（spec §7）", async () => {
    mockSearchIllust.mockResolvedValue({
      illusts: [
        { id: 1, create_date: "2026-01-01T00:00:00+09:00", total_bookmarks: 50 },
        { id: 2, create_date: "2026-01-02T00:00:00+09:00", total_bookmarks: 5000 },
      ],
      next_url: null,
    });
    const { store, dispose } = setup();
    store.setScope("illust");
    store.setKeyword("bookmark-fallback-check");
    store.setFilters({ ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[6]! });
    await store.executeSearch();

    expect(store.results().map((r) => r.entity.id)).toEqual([2]);
    dispose();
  });

  it("热门路径收藏数不兜底（#478 置灰语义：请求不带参数，本地也不过滤）", async () => {
    mockSearchIllust.mockResolvedValue({
      illusts: [
        { id: 1, create_date: "2026-01-01T00:00:00+09:00", total_bookmarks: 50 },
        { id: 2, create_date: "2026-01-02T00:00:00+09:00", total_bookmarks: 5000 },
      ],
      next_url: null,
    });
    const { store, dispose } = setup();
    store.setScope("illust");
    store.setSort("popular_desc");
    store.setKeyword("popular-bookmark-check");
    store.setFilters({ ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[6]! });
    await store.executeSearch();

    expect(store.results()).toHaveLength(2);
    dispose();
  });
});
