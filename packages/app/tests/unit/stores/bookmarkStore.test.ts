import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiErrorType, type PixivIllust, type ApiError } from "@/api/types";

// ── Mock TanStack Query ──
// Mock the full @tanstack/solid-query module and replace createInfiniteQuery
// With a controlled mock that returns plain-property objects mirroring the
// Proxy-based result shape.

type MockInfiniteData = {
  pages: { illusts: PixivIllust[]; next_url: string | null }[];
  pageParams: unknown[];
};

let mockData: MockInfiniteData | undefined = {
  pages: [{ illusts: [], next_url: null }],
  pageParams: [undefined],
};
let mockIsFetching = false;
let mockIsFetchingNextPage = false;
let mockError: ApiError | Error | null = null;
let mockHasNextPage = false;
const mockFetchNextPage = vi.fn();
const mockRefetch = vi.fn();

vi.mock("@tanstack/solid-query", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createInfiniteQuery: (...args: unknown[]) => {
      const optsAccessor = args[0] as () => { enabled?: boolean };
      return {
        get data() {
          const opts = optsAccessor();
          // TQ returns undefined when query is disabled (e.g. user not logged in)
          return mockData;
        },
        isFetching: mockIsFetching,
        isFetchingNextPage: mockIsFetchingNextPage,
        error: mockError,
        hasNextPage: mockHasNextPage,
        fetchNextPage: mockFetchNextPage,
        refetch: mockRefetch,
      };
    },
  };
});

// Mock api/illust (only loadBookmarks is needed now; loadNext is internal to TQ)
const mockLoadBookmarks = vi.fn();

vi.mock("@/api/illust", () => ({
  loadBookmarks: (...args: unknown[]) => mockLoadBookmarks(...args),
}));

// Mock authStore
let mockUserId: number | null = 1;
vi.mock("@/stores/authStore", () => ({
  get user() {
    return () => (mockUserId ? { id: mockUserId, name: "Test", account: "test" } : null);
  },
}));

// Mock r18Filter
vi.mock("@/utils/r18Filter", () => ({
  filterFeedIllusts: (illusts: PixivIllust[]) => illusts,
  filterUserPreviews: (previews: unknown[]) => previews,
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

async function loadStore() {
  vi.resetModules();
  const store = await import("@/stores/bookmarkStore");
  store.activate();
  return store;
}

describe("bookmarkStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserId = 1;
    mockData = { pages: [{ illusts: [], next_url: null }], pageParams: [undefined] };
    mockIsFetching = false;
    mockIsFetchingNextPage = false;
    mockError = null;
    mockHasNextPage = false;
  });

  describe("initial state", () => {
    it("starts with empty illusts and no error", async () => {
      const { illusts, loading, error, nextUrl } = await loadStore();
      expect(illusts()).toEqual([]);
      expect(loading()).toBe(false);
      expect(error()).toBeNull();
      expect(nextUrl()).toBeNull();
    });
  });

  describe("fetchMore", () => {
    it("loads next page when hasNextPage is true", async () => {
      mockData = {
        pages: [{ illusts: [makeIllust(1)], next_url: "page2" }],
        pageParams: [undefined],
      };
      mockHasNextPage = true;

      const store = await loadStore();
      expect(store.nextUrl()).toBe("page2");

      mockFetchNextPage.mockResolvedValue(undefined as never);

      await store.fetchMore();

      expect(mockFetchNextPage).toHaveBeenCalled();
    });

    it("does nothing when hasNextPage is false (no nextUrl)", async () => {
      mockData = {
        pages: [{ illusts: [], next_url: null }],
        pageParams: [undefined],
      };
      mockHasNextPage = false;

      const store = await loadStore();
      expect(store.nextUrl()).toBeNull();

      await store.fetchMore();
      expect(mockFetchNextPage).not.toHaveBeenCalled();
    });

    it("does nothing when isFetchingNextPage is true", async () => {
      mockData = {
        pages: [{ illusts: [makeIllust(1)], next_url: "page2" }],
        pageParams: [undefined],
      };
      mockHasNextPage = true;
      mockIsFetchingNextPage = true;

      const store = await loadStore();
      await store.fetchMore();
      expect(mockFetchNextPage).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns null when no error", async () => {
      const { error } = await loadStore();
      expect(error()).toBeNull();
    });

    it("returns ApiError with UNAUTHORIZED type for 401", async () => {
      mockError = { type: ApiErrorType.UNAUTHORIZED, message: "登录已过期 (HTTP 401)" };
      const { error } = await loadStore();
      expect(error()).not.toBeNull();
      expect(error()!.type).toBe(ApiErrorType.UNAUTHORIZED);
      expect(error()!.message).toContain("登录已过期");
    });

    it("returns ApiError with RATE_LIMIT type for 429", async () => {
      mockError = { type: ApiErrorType.RATE_LIMIT, message: "请求过于频繁，请稍后重试 (HTTP 429)" };
      const { error } = await loadStore();
      expect(error()).not.toBeNull();
      expect(error()!.type).toBe(ApiErrorType.RATE_LIMIT);
    });

    it("returns ApiError with NETWORK type for network errors", async () => {
      mockError = { type: ApiErrorType.NETWORK, message: "网络不可用，请检查连接" };
      const { error } = await loadStore();
      expect(error()).not.toBeNull();
      expect(error()!.type).toBe(ApiErrorType.NETWORK);
    });

    it("falls back to UNKNOWN for non-ApiError objects", async () => {
      mockError = new Error("Something went wrong");
      const { error } = await loadStore();
      expect(error()).not.toBeNull();
      expect(error()!.type).toBe(ApiErrorType.UNKNOWN);
      expect(error()!.message).toContain("Something went wrong");
    });
  });

  describe("setRestrict", () => {
    it("switches restrict value", async () => {
      const { restrict, setRestrict } = await loadStore();
      expect(restrict()).toBe("public");
      setRestrict("private");
      expect(restrict()).toBe("private");
    });

    it("does nothing when same restrict", async () => {
      const { restrict, setRestrict } = await loadStore();
      setRestrict("public");
      expect(restrict()).toBe("public");
    });
  });

  describe("refresh", () => {
    it("calls refetch", async () => {
      const { refresh } = await loadStore();
      await refresh();
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe("ensureLoaded", () => {
    it("is a no-op (TQ handles auto-fetching reactively)", async () => {
      mockData = undefined;
      const { ensureLoaded } = await loadStore();
      ensureLoaded();
      expect(mockRefetch).not.toHaveBeenCalled();
    });

    it("is a no-op on error (TQ handles retries)", async () => {
      mockError = new Error("err");
      const { ensureLoaded } = await loadStore();
      ensureLoaded();
      expect(mockRefetch).not.toHaveBeenCalled();
    });
  });
});
