/**
 * recommendedStore 独立测试。
 *
 * 测试 TQ 版 recommendedStore 的所有公开接口。
 * 测试策略：为 2 个数据源（recommended_illust, recommended_manga）
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
  loadRecommended: vi.fn(),
}));

import { scrollRestoreGlobal } from "@/primitives/createScrollRestore";

// ── mock uiStore for createFeedScrollStore ──
vi.mock("@/stores/uiStore", () => ({
  get currentTab() {
    return () => "recommended";
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

function createIllust(
  id: number,
  createDate: string,
  type: "illust" | "manga" = "illust",
): PixivIllust {
  return {
    id,
    title: `work-${id}`,
    type,
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
  return import("@/stores/recommendedStore");
}

// ── Tests ──

describe("recommendedStore — sub-tab routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
    scrollRestoreGlobal.clearAll();
  });

  it("illusts() returns illust data when sub-tab is illust", async () => {
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-i");

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.illusts().map((i) => i.id)).toEqual([1]);
    expect(store.nextUrl()).toBe("next-i");
  });

  it("illusts() returns manga data when sub-tab is manga", async () => {
    setQueryData(
      "recommended_manga",
      [createIllust(2, "2026-07-01T12:00:00+09:00", "manga")],
      "next-m",
    );

    const store = await loadStore();
    store.setRecommendSubTab("manga");
    expect(store.illusts().map((i) => i.id)).toEqual([2]);
    expect(store.nextUrl()).toBe("next-m");
  });

  it("illusts() merges illust+manga when sub-tab is mixed, sorted by create_date desc", async () => {
    setQueryData(
      "recommended_illust",
      [
        createIllust(1, "2026-07-01T09:00:00+09:00", "illust"),
        createIllust(3, "2026-07-01T11:00:00+09:00", "illust"),
      ],
      "next-i",
    );
    setQueryData(
      "recommended_manga",
      [createIllust(2, "2026-07-01T10:00:00+09:00", "manga")],
      "next-m",
    );

    const store = await loadStore();
    store.setRecommendSubTab("mixed");
    expect(store.illusts().map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it("illusts() deduplicates mixed results by illust id", async () => {
    setQueryData(
      "recommended_illust",
      [
        createIllust(1, "2026-07-01T09:00:00+09:00", "illust"),
        createIllust(2, "2026-07-01T11:00:00+09:00", "illust"),
      ],
      "next-i",
    );
    setQueryData(
      "recommended_manga",
      [
        createIllust(2, "2026-07-01T11:00:00+09:00", "manga"),
        createIllust(4, "2026-07-01T10:00:00+09:00", "manga"),
      ],
      "next-m",
    );

    const store = await loadStore();
    store.setRecommendSubTab("mixed");
    const ids = store.illusts().map((i) => i.id);
    expect(ids).toEqual([2, 4, 1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nextUrl for mixed sub-tab is derived from available source next_urls", async () => {
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-i");
    setQueryData("recommended_manga", [createIllust(2, "2026-07-01T10:00:00+09:00")], null);

    const store = await loadStore();
    store.setRecommendSubTab("mixed");
    expect(store.nextUrl()).toBe("next-i");
  });
});

describe("recommendedStore — actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
    scrollRestoreGlobal.clearAll();
  });

  it("fetchMore calls fetchNextPage on the active query", async () => {
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-i");
    getQ("recommended_illust").hasNextPage = true;

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    await store.fetchMore();
    expect(getQ("recommended_illust").fetchNextPage).toHaveBeenCalled();
  });

  it("refresh calls refetch on active queries", async () => {
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], "next-i");

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    await store.refresh();
    expect(getQ("recommended_illust").refetch).toHaveBeenCalled();
  });

  it("scroll positions save/restore correctly per sub-tab", async () => {
    (globalThis as any).window = { scrollY: 100 };
    const store = await loadStore();
    store.setRecommendSubTab("illust");
    store.saveTabScroll("recommended");

    (globalThis as any).window = { scrollY: 200 };
    store.setRecommendSubTab("manga");
    store.saveTabScroll("recommended");

    expect(store.getFeedScrollY("recommended")).toBe(200);
    store.setRecommendSubTab("illust");
    expect(store.getFeedScrollY("recommended")).toBe(100);
  });
});

describe("recommendedStore — loading and error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("loading reflects active query fetching state", async () => {
    getQ("recommended_illust").isFetching = true;
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.loading()).toBe(true);
  });

  it("loading is false when no query is fetching", async () => {
    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.loading()).toBe(false);
  });

  it("refreshing reflects active query fetching state", async () => {
    getQ("recommended_illust").isFetching = true;
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.refreshing()).toBe(true);
  });

  it("error reflects active query error", async () => {
    getQ("recommended_illust").error = {
      type: ApiErrorType.SERVER,
      message: "服务器错误 (HTTP 500)",
    };
    getQ("recommended_illust").data = {
      pages: [{ illusts: [], next_url: null }],
      pageParams: [undefined],
    };

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.error()).not.toBeNull();
    expect(store.error()!.type).toBe(ApiErrorType.SERVER);
  });

  it("error is null when no query has error", async () => {
    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.error()).toBeNull();
  });

  it("error is null for partial failure in mixed mode (one source succeeds, one fails)", async () => {
    getQ("recommended_illust").error = {
      type: ApiErrorType.SERVER,
      message: "illust 源错误",
    };
    getQ("recommended_illust").data = {
      pages: [{ illusts: [], next_url: null }],
      pageParams: [undefined],
    };
    setQueryData(
      "recommended_manga",
      [createIllust(2, "2026-07-01T10:00:00+09:00", "manga")],
      null,
    );

    const store = await loadStore();
    store.setRecommendSubTab("mixed");
    expect(store.error()).toBeNull();
    expect(store.illusts().map((i) => i.id)).toEqual([2]);
  });

  it("error is set when both sources fail in mixed mode", async () => {
    getQ("recommended_illust").error = {
      type: ApiErrorType.SERVER,
      message: "illust 源错误",
    };
    getQ("recommended_manga").error = {
      type: ApiErrorType.RATE_LIMIT,
      message: "manga 源错误",
    };

    const store = await loadStore();
    store.setRecommendSubTab("mixed");
    expect(store.error()).not.toBeNull();
  });
});

describe("recommendedStore — isRecommendedCached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
  });

  it("returns false when no data has been loaded", async () => {
    const store = await loadStore();
    expect(store.isRecommendedCached()).toBe(false);
  });

  it("returns true when active source has data", async () => {
    setQueryData("recommended_illust", [createIllust(1, "2026-07-01T12:00:00+09:00")], null);

    const store = await loadStore();
    store.setRecommendSubTab("illust");
    expect(store.isRecommendedCached()).toBe(true);
  });
});

describe("recommendedStore — ensureLoaded", () => {
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
});

describe("recommendedStore — virtual scroll state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryMocks();
    scrollRestoreGlobal.clearAll();
  });

  it("saveFeedScrollState / getFeedScrollState persist and restore VirtualItem state", async () => {
    (globalThis as any).window = { scrollY: 0 };
    const store = await loadStore();
    store.setRecommendSubTab("illust");

    const state = { snapshot: [] as any[], offset: 100, version: 1 };
    store.saveFeedScrollState("recommended", state);
    expect(store.getFeedScrollState("recommended")).toEqual(state);
  });
});
