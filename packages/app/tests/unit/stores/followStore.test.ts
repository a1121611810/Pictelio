/**
 * followStore 独立测试。
 *
 * 测试 TQ 版 followStore 的所有公开接口。
 * 测试策略：为 2 个数据源（follow_public, follow_private）
 * 分别设置 mock 数据，验证派生 getter 和 action 函数的正确性。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PixivIllust, ApiError } from "@/api/types";
import { ApiErrorType } from "@/api/types";

// ── Mock TanStack Query ──

type MockInfiniteData = {
  pages: { illusts: PixivIllust[]; next_url: string | null }[];
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
    createInfiniteQuery: vi.fn((optsAccessor: () => { queryKey: string[]; enabled: boolean }) => {
      const mock = {} as Record<string, unknown>;
      function currentOpts() {
        return optsAccessor();
      }
      Object.defineProperties(mock, {
        data: {
          get() {
            return getQ((currentOpts().queryKey as string[])[1]).data;
          },
          enumerable: true,
        },
        isFetching: {
          get() {
            return getQ((currentOpts().queryKey as string[])[1]).isFetching;
          },
          enumerable: true,
        },
        error: {
          get() {
            return getQ((currentOpts().queryKey as string[])[1]).error;
          },
          enumerable: true,
        },
        hasNextPage: {
          get() {
            return getQ((currentOpts().queryKey as string[])[1]).hasNextPage;
          },
          enumerable: true,
        },
        fetchNextPage: {
          get() {
            return getQ((currentOpts().queryKey as string[])[1]).fetchNextPage;
          },
          enumerable: true,
        },
        refetch: {
          get() {
            return getQ((currentOpts().queryKey as string[])[1]).refetch;
          },
          enumerable: true,
        },
        isFetchingNextPage: { get: () => false, enumerable: true },
      });
      return mock;
    }),
  };
});

vi.mock("@capacitor/core", async () => {
  const actual = await vi.importActual<typeof import("@capacitor/core")>("@capacitor/core");
  return {
    ...actual,
    Capacitor: { getPlatform: vi.fn(() => "web"), isNativePlatform: vi.fn(() => false) },
  };
});

vi.mock("@/api/illust", () => ({
  loadFollow: vi.fn(),
}));

// ── mock uiStore ──
vi.mock("@/stores/uiStore", () => ({
  get currentTab() {
    return () => "follow";
  },
  setCurrentTab: vi.fn(),
  showR18: () => false,
  showR18G: () => false,
}));

// Mock r18Filter (pass-through for tests)
vi.mock("@/utils/r18Filter", () => ({
  filterFeedIllusts: (illusts: PixivIllust[]) => illusts,
}));

// ── Helpers ──

function createIllust(id: number, createDate: string): PixivIllust {
  return {
    id,
    title: `work-${id}`,
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
    create_date: createDate,
    meta_pages: [],
    meta_single_page: {},
  } as PixivIllust;
}

function resetQueryMocks() {
  for (const key of Object.keys(queryMocks)) {
    delete queryMocks[key];
  }
}

function setQueryData(key: string, illusts: PixivIllust[], next_url: string | null) {
  const q = getQ(key);
  q.data = { pages: [{ illusts, next_url }], pageParams: [undefined] };
  q.hasNextPage = next_url !== null;
}

async function loadStore() {
  vi.resetModules();
  const store = await import("@/stores/followStore");
  store.activate();
  return store;
}

// ── Tests ──

describe("followStore — sub-tab routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("illusts() returns public follow data when followTab is public", async () => {
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-pub");

    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.illusts().map((i) => i.id)).toEqual([1]);
    expect(store.nextUrl()).toBe("next-pub");
  });

  it("illusts() returns private follow data when followTab is private", async () => {
    setQueryData("follow_private", [createIllust(2, "2026-07-01T12:00:00+09:00")], "next-priv");

    const store = await loadStore();
    store.setFollowTab("private");
    expect(store.illusts().map((i) => i.id)).toEqual([2]);
    expect(store.nextUrl()).toBe("next-priv");
  });

  it("illusts() merges public+private when followTab is all", async () => {
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);
    setQueryData("follow_private", [createIllust(2, "2026-07-01T10:00:00+09:00")], null);
    const store = await loadStore();
    store.setFollowTab("all");
    expect(store.illusts().map((i) => i.id)).toEqual([1, 2]);
  });

  it("illusts() deduplicates merged results by illust id", async () => {
    setQueryData(
      "follow_public",
      [createIllust(1, "2026-07-01T12:00:00+09:00"), createIllust(2, "2026-07-01T11:00:00+09:00")],
      null,
    );
    setQueryData(
      "follow_private",
      [createIllust(2, "2026-07-01T11:00:00+09:00"), createIllust(4, "2026-07-01T10:00:00+09:00")],
      null,
    );

    const store = await loadStore();
    store.setFollowTab("all");
    const ids = store.illusts().map((i) => i.id);
    expect(ids).toEqual([1, 2, 4]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("followStore — actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("fetchMore calls fetchNextPage on the active query", async () => {
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-pub");
    getQ("follow_public").hasNextPage = true;

    const store = await loadStore();
    store.setFollowTab("public");
    await store.fetchMore();
    expect(getQ("follow_public").fetchNextPage).toHaveBeenCalled();
  });

  it("refresh calls refetch on active queries", async () => {
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-pub");

    const store = await loadStore();
    store.setFollowTab("public");
    await store.refresh();
    expect(getQ("follow_public").refetch).toHaveBeenCalled();
  });
});

describe("followStore — loading and error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("loading reflects active query fetching state", async () => {
    getQ("follow_public").isFetching = true;
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);

    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.loading()).toBe(true);
  });

  it("loading is false when no query is fetching", async () => {
    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.loading()).toBe(false);
  });

  it("refreshing reflects active query fetching state", async () => {
    getQ("follow_public").isFetching = true;
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);

    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.refreshing()).toBe(true);
  });

  it("error reflects active query error", async () => {
    getQ("follow_public").error = {
      type: ApiErrorType.SERVER,
      message: "服务器错误 (HTTP 500)",
    };
    getQ("follow_public").data = {
      pages: [{ illusts: [], next_url: null }],
      pageParams: [undefined],
    };

    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.error()).not.toBeNull();
    expect(store.error()!.type).toBe(ApiErrorType.SERVER);
  });

  it("error is null when no query has error", async () => {
    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.error()).toBeNull();
  });

  it("error is null for partial failure in 'all' mode (one source succeeds, one fails)", async () => {
    getQ("follow_public").error = {
      type: ApiErrorType.SERVER,
      message: "public 源错误",
    };
    getQ("follow_public").data = {
      pages: [{ illusts: [], next_url: null }],
      pageParams: [undefined],
    };
    setQueryData("follow_private", [createIllust(2, "2026-07-01T10:00:00+09:00")], null);

    const store = await loadStore();
    store.setFollowTab("all");
    expect(store.error()).toBeNull();
    expect(store.illusts().map((i) => i.id)).toEqual([2]);
  });
});

describe("followStore — isFollowCached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("returns false when no data has been loaded", async () => {
    const store = await loadStore();
    expect(store.isFollowCached()).toBe(false);
  });

  it("returns true when active source has data", async () => {
    setQueryData("follow_public", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);

    const store = await loadStore();
    store.setFollowTab("public");
    expect(store.isFollowCached()).toBe(true);
  });
});

describe("followStore — ensureLoaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("is a function that returns a promise", async () => {
    const store = await loadStore();
    expect(typeof store.ensureLoaded).toBe("function");
    const result = store.ensureLoaded();
    expect(result).toBeInstanceOf(Promise);
  });

  // 契约（ADR-0042 按需查询）：activate 只置订阅标志、不触发任何 fetch；
  // 数据加载必须由 ensureLoaded 驱动（回归防护：首页收藏/关注 Tab 之前只 activate → 空）。
  it("activate 不触发任何 fetch（数据加载需 ensureLoaded）", async () => {
    vi.resetModules();
    const { loadFollow } = await import("@/api/illust");
    const store = await import("@/stores/followStore");
    store.activate();
    expect(loadFollow).not.toHaveBeenCalled();
    expect(store.illusts()).toEqual([]);
  });
});
