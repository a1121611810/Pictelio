import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/solid-query";
import {
  ApiErrorType,
  type PixivIllust,
  type PixivIllustListResponse,
  type ApiError,
} from "@/api/types";

// ── Mock TanStack Query ──
// Mock the full @tanstack/solid-query module and replace useInfiniteQuery
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
    useInfiniteQuery: (...args: unknown[]) => {
      const optsAccessor = args[0] as () => { enabled?: boolean };
      return {
        get data() {
          void optsAccessor();
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

// ── Mock 全局 QueryClient 单例 ──
// createTQFeedStore 只经 `queryClient.ensureInfiniteQueryData` 触达缓存，因此必须给它一个
// **真** client 才能 spy 到 ensureLoaded 真正传下去的 options（@tanstack/solid-query 整体
// mock 只替换 useInfiniteQuery，QueryClient 类仍是 actual 展开出来的真类）。
// 注入方式取自邻近目录 tests/unit/stores/shared/ 的共享 fixture sharedQueryClientMock.ts
// （getter 惰性读一个可变导出对象；prefetch.test.ts 用的是同一份，跨目录 import 已实测生效）。
import { queryClientRef as qc, type EnsureOptions } from "./shared/sharedQueryClientMock";

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
  // 每个用例一份**全新空缓存** client：#811 的复现条件正是「该 query 从未被上面的
  // useInfiniteQuery（已 mock）装配进缓存」，复用同一实例会让缓存跨用例残留、稀释该条件。
  // retry: false —— 断言一旦失败立刻红，不被 TanStack 默认 3 次指数退避拖慢。
  qc.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    // loadBookmarks 的真实返回形状（src/api/illust.ts:77 → PixivIllustListResponse）：
    // 给了实现，ensureLoaded 传下去的 queryFn 才真的能取到数，「存在」之外还能验「可用」。
    mockLoadBookmarks.mockResolvedValue({
      illusts: [makeIllust(1)],
      next_url: null,
    } satisfies PixivIllustListResponse);
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
      flush(); // 2.0 批处理语义：set 后同步读返回旧值，先 flush 再断言
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
    it("query 未装配在缓存时不得抛 Missing queryFn（#811 回归）", async () => {
      // 复现条件就在本文件里：useInfiniteQuery 被整体 mock ⇒ 真实 queryClient 缓存里
      // 永远不会出现 ["bookmarks",1,"public"]。原实现只传 queryKey（并用 `as any`
      // 逃过「queryFn 必填」的类型检查），ensureInfiniteQueryData 遂走
      // QueryCache.build() 新建一个无 queryFn 的 query → TanStack 抛
      // `Missing queryFn: '["bookmarks",1,"public"]'`。
      //
      // 为什么以前是**间歇**的：既有两条用例都不 await ensureLoaded()，浮空 promise 的
      // rejection 与「测试文件收尾」赛跑——谁先到谁说了算，于是 CI 上偶发、rerun 又绿，
      // 表现为「2051 passed / 1 error」。本例显式 await ⇒ 抖动变成确定性断言。
      const { ensureLoaded } = await loadStore();
      const spy = vi.spyOn(qc.client!, "ensureInfiniteQueryData");
      let err: unknown = null;
      try {
        await ensureLoaded();
      } catch (e) {
        err = e;
      }
      // 只钉这一个失败模式：mock 的 loadBookmarks 已给真实形状实现，此处 err 若非空必是别处所致
      expect(String((err as Error | null)?.message ?? "")).not.toMatch(/Missing queryFn/);

      // ── 肯定路径（#811 的真契约）──
      // 上一条只是「没抛这个错」：把实现换成「总是抛别的错」照样绿。真正的契约是
      // 「ensureInfiniteQueryData 收到的 options 自带一个可用的 queryFn」——
      // #811 的修复点正是 createTQFeedStore.ts:519 补传 queryFn。
      // 不断言调用**次数**（本契约不关心）：ensureLoaded 未来合法地多调一次
      // （merge 模式扩子查询）时本用例仍绿，pin 的是下面这条 options 的内容。
      expect(spy).toHaveBeenCalled();
      const options = spy.mock.calls[0]![0] as EnsureOptions;
      // queryKey 形状对齐 bookmarkStore.ts:31 的 ["bookmarks", userId, restrict]
      expect(options.queryKey).toEqual(["bookmarks", 1, "public"]);
      expect(typeof options.queryFn).toBe("function");

      // 再钉一层「存在即可用」：实调一次并断言取到数。换成
      // `() => Promise.reject()` 之类的假 queryFn，会在这一行转红。
      const page = await options.queryFn!({ pageParam: undefined, signal: undefined });
      expect(page).toEqual({ items: [makeIllust(1)], next_url: null });
      expect(mockLoadBookmarks).toHaveBeenCalledWith(1, "public", undefined);
    });

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
