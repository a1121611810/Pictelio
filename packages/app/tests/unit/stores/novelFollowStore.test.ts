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

function queryKeyToLookupKey(qk: readonly unknown[]): string {
  if (qk[0] === "novel") return String(qk[1]);
  return "unknown";
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
              return getQ(queryKeyToLookupKey(currentOpts().queryKey)).data;
            },
            enumerable: true,
          },
          isFetching: {
            get() {
              return getQ(queryKeyToLookupKey(currentOpts().queryKey)).isFetching;
            },
            enumerable: true,
          },
          error: {
            get() {
              return getQ(queryKeyToLookupKey(currentOpts().queryKey)).error;
            },
            enumerable: true,
          },
          hasNextPage: {
            get() {
              return getQ(queryKeyToLookupKey(currentOpts().queryKey)).hasNextPage;
            },
            enumerable: true,
          },
          fetchNextPage: {
            get() {
              return getQ(queryKeyToLookupKey(currentOpts().queryKey)).fetchNextPage;
            },
            enumerable: true,
          },
          refetch: {
            get() {
              return getQ(queryKeyToLookupKey(currentOpts().queryKey)).refetch;
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
  loadFollow: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => ({
  get currentTab() {
    return () => "follow";
  },
  setCurrentTab: vi.fn(),
  showR18: () => false,
  showR18G: () => false,
  contentType: () => "novel",
}));

vi.mock("@/utils/r18Filter", () => ({
  filterNovels: (novels: PixivNovel[]) => novels,
}));

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
  const store = await import("@/stores/novelFollowStore");
  store.activate();
  return store;
}

describe("novelFollowStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("novels() returns public follow when followTab is public", async () => {
    setQueryData("follow_public", [createNovel(1, "2026-07-01T12:00:00+09:00")], null);
    const store = await loadStore();
    store.setNovelFollowTab("public");
    expect(store.novels().map((n: PixivNovel) => n.id)).toEqual([1]);
  });

  it("novels() returns private follow when followTab is private", async () => {
    setQueryData("follow_private", [createNovel(2, "2026-07-01T12:00:00+09:00")], null);
    const store = await loadStore();
    store.setNovelFollowTab("private");
    expect(store.novels().map((n: PixivNovel) => n.id)).toEqual([2]);
  });

  it("novels() merges public+private when followTab is all", async () => {
    setQueryData("follow_public", [createNovel(1, "2026-07-01T12:00:00+09:00")], null);
    setQueryData("follow_private", [createNovel(2, "2026-07-01T10:00:00+09:00")], null);
    const store = await loadStore();
    store.setNovelFollowTab("all");
    expect(store.novels().map((n: PixivNovel) => n.id)).toEqual([1, 2]);
  });

  it("fetchMore only fetches from single active source when followTab=public", async () => {
    setQueryData("follow_public", [createNovel(1, "2026-07-01T12:00:00+09:00")], "next-pub");
    setQueryData("follow_private", [createNovel(2, "2026-07-01T10:00:00+09:00")], null);
    getQ("follow_public").hasNextPage = true;

    const store = await loadStore();
    store.setNovelFollowTab("public");
    await store.fetchMore();
    expect(getQ("follow_public").fetchNextPage).toHaveBeenCalled();
    expect(getQ("follow_private").fetchNextPage).not.toHaveBeenCalled();
  });

  it("loading reflects isFetching", async () => {
    getQ("follow_public").isFetching = true;
    const store = await loadStore();
    expect(store.loading()).toBe(true);
  });

  it("loading is false when not fetching", async () => {
    const store = await loadStore();
    expect(store.loading()).toBe(false);
  });

  it("error is null for partial failure in 'all' mode (allMustFail)", async () => {
    getQ("follow_public").error = { type: ApiErrorType.SERVER, message: "public 源错误" };
    getQ("follow_public").data = {
      pages: [{ novels: [], next_url: null }],
      pageParams: [undefined],
    };
    setQueryData("follow_private", [createNovel(2, "2026-07-01T10:00:00+09:00")], null);

    const store = await loadStore();
    store.setNovelFollowTab("all");
    expect(store.error()).toBeNull();
    expect(store.novels().map((n: PixivNovel) => n.id)).toEqual([2]);
  });

  it("error is set when both sources fail in 'all' mode", async () => {
    getQ("follow_public").error = { type: ApiErrorType.SERVER, message: "public 源错误" };
    getQ("follow_private").error = { type: ApiErrorType.RATE_LIMIT, message: "private 源错误" };

    const store = await loadStore();
    store.setNovelFollowTab("all");
    expect(store.error()).not.toBeNull();
  });

  it("error reflects query error", async () => {
    getQ("follow_public").error = { type: ApiErrorType.SERVER, message: "err" };
    const store = await loadStore();
    store.setNovelFollowTab("public");
    expect(store.error()?.type).toBe(ApiErrorType.SERVER);
  });

  it("refresh calls refetch on active query", async () => {
    setQueryData("follow_public", [createNovel(1, "2026-07-01T12:00:00+09:00")], null);
    const store = await loadStore();
    store.setNovelFollowTab("public");
    await store.refresh();
    expect(getQ("follow_public").refetch).toHaveBeenCalled();
  });

  it("isNovelFollowCached returns true when data exists", async () => {
    setQueryData("follow_public", [createNovel(1, "2026-07-01T12:00:00+09:00")], null);
    const store = await loadStore();
    store.setNovelFollowTab("public");
    expect(store.isNovelFollowCached()).toBe(true);
  });

  it("ensureLoaded is a function returning a promise", async () => {
    const store = await loadStore();
    expect(typeof store.ensureLoaded).toBe("function");
    expect(store.ensureLoaded()).toBeInstanceOf(Promise);
  });

});
