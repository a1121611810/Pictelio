import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PixivIllust, PixivNovel } from "@/api/types";

// ── Mock TanStack Query ──
// Two createInfiniteQuery calls: illust (first) and novel (second)
let callCount = 0;

type MockInfiniteData<T> = {
  pages: T[];
  pageParams: unknown[];
};

// Shared mock state for illust query
let mockIllustData:
  | MockInfiniteData<{ illusts: PixivIllust[]; next_url: string | null }>
  | undefined;
let mockIllustFetching = false;
let mockIllustFetchingNext = false;
let mockIllustError: Error | null = null;
let mockIllustHasNext = false;
const mockIllustFetchNext = vi.fn();
const mockIllustRefetch = vi.fn();

// Shared mock state for novel query
let mockNovelData: MockInfiniteData<{ novels: PixivNovel[]; next_url: string | null }> | undefined;
let mockNovelFetching = false;
let mockNovelFetchingNext = false;
let mockNovelError: Error | null = null;
let mockNovelHasNext = false;
const mockNovelFetchNext = vi.fn();
const mockNovelRefetch = vi.fn();

vi.mock("@tanstack/solid-query", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createInfiniteQuery: (..._args: unknown[]) => {
      const isIllust = callCount === 0;
      callCount++;
      if (isIllust) {
        return {
          data: mockIllustData,
          isFetching: mockIllustFetching,
          isFetchingNextPage: mockIllustFetchingNext,
          error: mockIllustError,
          hasNextPage: mockIllustHasNext,
          fetchNextPage: mockIllustFetchNext,
          refetch: mockIllustRefetch,
        };
      }
      return {
        data: mockNovelData,
        isFetching: mockNovelFetching,
        isFetchingNextPage: mockNovelFetchingNext,
        error: mockNovelError,
        hasNextPage: mockNovelHasNext,
        fetchNextPage: mockNovelFetchNext,
        refetch: mockNovelRefetch,
      };
    },
  };
});

// Mock API
const mockLoadUserIllusts = vi.fn();

vi.mock("@/api/illust", () => ({
  loadUserIllusts: (...args: unknown[]) => mockLoadUserIllusts(...args),
}));

const mockLoadUserNovels = vi.fn();

vi.mock("@/api/novel", () => ({
  loadUserNovels: (...args: unknown[]) => mockLoadUserNovels(...args),
}));

vi.mock("@/utils/r18Filter", () => ({
  filterFeedIllusts: (illusts: PixivIllust[]) => illusts,
  filterNovels: (novels: PixivNovel[]) => novels,
}));

function makeIllust(id: number): PixivIllust {
  return {
    id,
    title: `w-${id}`,
    type: "illust",
    user: { id: 1, name: "u", account: "u", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 0,
    tags: [],
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00+00:00",
    meta_pages: [],
    meta_single_page: {},
  } as PixivIllust;
}

function makeNovel(id: number): PixivNovel {
  return {
    id,
    title: `n-${id}`,
    user: { id: 1, name: "u", account: "u", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 1000,
    is_bookmarked: false,
    total_bookmarks: 0,
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00+00:00",
  };
}

async function loadStore() {
  vi.resetModules();
  return import("@/stores/userIllustsStore");
}

describe("userIllustsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callCount = 0;
    mockIllustData = { pages: [{ illusts: [], next_url: null }], pageParams: [undefined] };
    mockIllustFetching = false;
    mockIllustFetchingNext = false;
    mockIllustError = null;
    mockIllustHasNext = false;
    mockNovelData = { pages: [{ novels: [], next_url: null }], pageParams: [undefined] };
    mockNovelFetching = false;
    mockNovelFetchingNext = false;
    mockNovelError = null;
    mockNovelHasNext = false;
  });

  describe("initial state", () => {
    it("starts with empty illusts and no error", async () => {
      const { illusts, loading, error, nextUrl } = await loadStore();
      expect(illusts()).toEqual([]);
      expect(loading()).toBe(false);
      expect(error()).toBeNull();
      expect(nextUrl()).toBeNull();
    });

    it("starts with empty novels", async () => {
      const { novels } = await loadStore();
      expect(novels()).toEqual([]);
    });
  });

  describe("novel data", () => {
    it("loads novels and exposes them via novels()", async () => {
      mockNovelData = {
        pages: [{ novels: [makeNovel(1), makeNovel(2)], next_url: null }],
        pageParams: [undefined],
      };
      const store = await loadStore();
      store.load(42, "novel");
      expect(store.contentType()).toBe("novel");
      expect(store.novels()).toHaveLength(2);
      expect(store.novels()[0].id).toBe(1);
      expect(store.novels()[1].id).toBe(2);
    });

    it("exposes nextUrl for novel", async () => {
      mockNovelData = {
        pages: [{ novels: [makeNovel(1)], next_url: "page2" }],
        pageParams: [undefined],
      };
      mockNovelHasNext = true;
      const store = await loadStore();
      store.load(42, "novel");
      expect(store.nextUrl()).toBe("page2");
    });

    it("returns empty illusts when type is novel", async () => {
      mockNovelData = {
        pages: [{ novels: [makeNovel(1)], next_url: null }],
        pageParams: [undefined],
      };
      const store = await loadStore();
      store.load(42, "novel");
      expect(store.illusts()).toEqual([]);
    });
  });

  describe("loadMore", () => {
    it("does nothing when hasNextPage is false (illust)", async () => {
      mockIllustHasNext = false;
      const store = await loadStore();
      await store.loadMore();
      expect(mockIllustFetchNext).not.toHaveBeenCalled();
    });

    it("loads next page when hasNextPage is true (illust)", async () => {
      mockIllustData = {
        pages: [{ illusts: [makeIllust(1)], next_url: "page2" }],
        pageParams: [undefined],
      };
      mockIllustHasNext = true;
      const store = await loadStore();
      mockIllustFetchNext.mockResolvedValue(undefined as never);
      await store.loadMore();
      expect(mockIllustFetchNext).toHaveBeenCalled();
    });

    it("does nothing when isFetchingNextPage (illust)", async () => {
      mockIllustFetchingNext = true;
      const store = await loadStore();
      await store.loadMore();
      expect(mockIllustFetchNext).not.toHaveBeenCalled();
    });

    it("loads next page for novel type", async () => {
      mockNovelData = {
        pages: [{ novels: [makeNovel(1)], next_url: "novel-page2" }],
        pageParams: [undefined],
      };
      mockNovelHasNext = true;
      const store = await loadStore();
      store.load(42, "novel");
      mockNovelFetchNext.mockResolvedValue(undefined as never);
      await store.loadMore();
      expect(mockNovelFetchNext).toHaveBeenCalled();
    });

    it("does nothing for novel when isFetchingNextPage", async () => {
      mockNovelFetchingNext = true;
      const store = await loadStore();
      store.load(42, "novel");
      await store.loadMore();
      expect(mockNovelFetchNext).not.toHaveBeenCalled();
    });
  });

  describe("switchType", () => {
    it("changes content type to illust without triggering fetch", async () => {
      const store = await loadStore();
      expect(store.contentType()).toBe("illust");
      store.switchType("manga");
      expect(store.contentType()).toBe("manga");
      expect(mockLoadUserIllusts).not.toHaveBeenCalled();
    });

    it("changes content type to novel without triggering fetch", async () => {
      const store = await loadStore();
      store.switchType("novel");
      expect(store.contentType()).toBe("novel");
      expect(mockLoadUserIllusts).not.toHaveBeenCalled();
      expect(mockLoadUserNovels).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns null when no error", async () => {
      const { error } = await loadStore();
      expect(error()).toBeNull();
    });

    it("maps error message", async () => {
      mockIllustError = new Error("Network failure");
      const { error } = await loadStore();
      expect(error()).not.toBeNull();
      expect(error()!.message).toContain("Network failure");
    });

    it("maps error message for novel type", async () => {
      mockNovelError = new Error("Novel failure");
      const store = await loadStore();
      store.load(42, "novel");
      expect(store.error()).not.toBeNull();
      expect(store.error()!.message).toContain("Novel failure");
    });
  });

  describe("load", () => {
    it("sets contentType from parameter", async () => {
      const store = await loadStore();
      store.load(42, "manga");
      expect(store.contentType()).toBe("manga");
    });

    it("sets contentType to novel from parameter", async () => {
      const store = await loadStore();
      store.load(42, "novel");
      expect(store.contentType()).toBe("novel");
    });
  });
});
