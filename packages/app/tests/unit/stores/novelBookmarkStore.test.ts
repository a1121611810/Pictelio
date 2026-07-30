import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiErrorType, type PixivNovel, type ApiError } from "@/api/types";

type MockInfiniteData = {
  pages: { novels: PixivNovel[]; next_url: string | null }[];
  pageParams: unknown[];
};

interface QueryMock {
  data: MockInfiniteData | undefined;
  isFetching: boolean;
  error: ApiError | null;
  hasNextPage: boolean;
  fetchNextPage: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
}

const queryMocks: Record<string, QueryMock> = {};

function getQ(key: string): QueryMock {
  if (!queryMocks[key]) {
    queryMocks[key] = {
      data: undefined,
      isFetching: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  }
  return queryMocks[key];
}

vi.mock("@tanstack/solid-query", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createInfiniteQuery: vi.fn(
      (optsAccessor: () => { queryKey: readonly unknown[]; enabled: boolean }) => {
        const mock = {} as Record<string, unknown>;
        function currentOpts() {
          return optsAccessor();
        }
        Object.defineProperties(mock, {
          data: {
            get() {
              if (currentOpts().enabled === false) return undefined;
              return getQ("bookmarks").data;
            },
            enumerable: true,
          },
          isFetching: {
            get() {
              if (currentOpts().enabled === false) return false;
              return getQ("bookmarks").isFetching;
            },
            enumerable: true,
          },
          error: {
            get() {
              if (currentOpts().enabled === false) return null;
              return getQ("bookmarks").error;
            },
            enumerable: true,
          },
          hasNextPage: {
            get() {
              if (currentOpts().enabled === false) return false;
              return getQ("bookmarks").hasNextPage;
            },
            enumerable: true,
          },
          fetchNextPage: {
            get() {
              return getQ("bookmarks").fetchNextPage;
            },
            enumerable: true,
          },
          refetch: {
            get() {
              return getQ("bookmarks").refetch;
            },
            enumerable: true,
          },
          isFetchingNextPage: { get: () => false, enumerable: true },
        });
        return mock;
      },
    ),
  };
});

vi.mock("@capacitor/core", async () => {
  const actual = await vi.importActual<typeof import("@capacitor/core")>("@capacitor/core");
  return {
    ...actual,
    Capacitor: { getPlatform: vi.fn(() => "web"), isNativePlatform: vi.fn(() => false) },
  };
});

vi.mock("@/api/novel", () => ({
  loadBookmarks: vi.fn(),
}));

let mockUserId: number | null = 1;

vi.mock("@/stores/authStore", () => ({
  get user() {
    return () => (mockUserId ? { id: mockUserId, name: "Test", account: "test" } : null);
  },
}));

vi.mock("@/stores/uiStore", () => ({
  get currentTab() {
    return () => "bookmarks";
  },
  setCurrentTab: vi.fn(),
  showR18: () => false,
  showR18G: () => false,
  contentType: () => "novel",
}));

vi.mock("@/utils/r18Filter", () => ({
  filterNovels: (novels: PixivNovel[]) => novels,
}));

import { scrollRestoreGlobal } from "@/primitives/createScrollRestore";

function createNovel(id: number, createDate: string): PixivNovel {
  return {
    id,
    title: `novel-${id}`,
    user: { id: 1, name: "u", account: "u", profile_image_urls: {} },
    image_urls: {},
    tags: [],
    x_restrict: 0,
    create_date: createDate,
    text_length: 1000,
    page_count: null,
    series: null,
    is_bookmarked: false,
    total_bookmarks: 0,
    total_view: 0,
  } as PixivNovel;
}

function resetQueryMocks() {
  for (const key of Object.keys(queryMocks)) delete queryMocks[key];
}

function setQueryData(key: string, novels: PixivNovel[], next_url: string | null) {
  const q = getQ(key);
  q.data = { pages: [{ novels, next_url }], pageParams: [undefined] };
  q.hasNextPage = next_url !== null;
}

async function loadStore() {
  vi.resetModules();
  const store = await import("@/stores/novelBookmarkStore");
  store.activate();
  return store;
}

describe("novelBookmarkStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
    mockUserId = 1;
    scrollRestoreGlobal.clearAll();
  });

  it("novels() returns bookmarked novels", async () => {
    setQueryData("bookmarks", [createNovel(1, "2026-07-01T12:00:00+09:00")], "next-b");
    const store = await loadStore();
    expect(store.novels().map((n: PixivNovel) => n.id)).toEqual([1]);
    expect(store.nextUrl()).toBe("next-b");
  });

  it("bookmarkRestrict switches between public/private", async () => {
    const store = await loadStore();
    expect(store.bookmarkRestrict()).toBe("public");
    store.setBookmarkRestrict("private");
    expect(store.bookmarkRestrict()).toBe("private");
  });

  it("returns UNAUTHORIZED error when user is not logged in", async () => {
    mockUserId = null;
    const store = await loadStore();
    await store.ensureLoaded();
    expect(store.error()).not.toBeNull();
    expect(store.error()!.type).toBe(ApiErrorType.UNAUTHORIZED);
    expect(store.error()!.message).toContain("未登录");
  });

  it("loading reflects isFetching", async () => {
    getQ("bookmarks").isFetching = true;
    const store = await loadStore();
    expect(store.loading()).toBe(true);
  });

  it("loading is false when not fetching", async () => {
    const store = await loadStore();
    expect(store.loading()).toBe(false);
  });

  it("error reflects query error", async () => {
    getQ("bookmarks").error = { type: ApiErrorType.SERVER, message: "err" };
    const store = await loadStore();
    expect(store.error()?.type).toBe(ApiErrorType.SERVER);
  });

  it("refresh calls refetch", async () => {
    setQueryData("bookmarks", [createNovel(1, "2026-07-01T12:00:00+09:00")], null);
    const store = await loadStore();
    await store.refresh();
    expect(getQ("bookmarks").refetch).toHaveBeenCalled();
  });

  it("fetchMore calls fetchNextPage when hasNextPage", async () => {
    setQueryData("bookmarks", [createNovel(1, "2026-07-01T12:00:00+09:00")], "next-b");
    getQ("bookmarks").hasNextPage = true;
    const store = await loadStore();
    await store.fetchMore();
    expect(getQ("bookmarks").fetchNextPage).toHaveBeenCalled();
  });

  it("isNovelBookmarkCached returns false when no data", async () => {
    const store = await loadStore();
    expect(store.isNovelBookmarkCached()).toBe(false);
  });

  it("isNovelBookmarkCached returns true when data exists", async () => {
    setQueryData("bookmarks", [createNovel(1, "2026-07-01T12:00:00+09:00")], null);
    const store = await loadStore();
    expect(store.isNovelBookmarkCached()).toBe(true);
  });

  it("scroll positions save/restore correctly", async () => {
    (globalThis as any).window = { scrollY: 100 };
    const store = await loadStore();
    store.saveTabScroll("bookmarks");
    expect(store.getFeedScrollY("bookmarks")).toBe(100);
  });

  it("saveNovelScrollState / getNovelScrollState persist VirtualItem state", async () => {
    (globalThis as any).window = { scrollY: 0 };
    const store = await loadStore();
    const state = { snapshot: [] as any[], offset: 50, version: 1 };
    store.saveNovelScrollState("bookmarks", state);
    expect(store.getNovelScrollState("bookmarks")).toEqual(state);
  });
});
