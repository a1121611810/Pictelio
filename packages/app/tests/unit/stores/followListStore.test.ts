import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PixivUserPreview } from "@/api/types";

// ── Mock TanStack Query for followListStore ──
// Note: createTQFeedStore 工厂内部使用 createInfiniteQuery，
// 工厂的 items 访问器读取 data.pages[].items，因此 mock data
// 使用 items 字段（与 API 原始 user_previews 不同）。
type MockInfiniteData<T> = {
  pages: T[];
  pageParams: unknown[];
};

let mockData: MockInfiniteData<{ items: PixivUserPreview[]; next_url: string | null }> | undefined;
let mockIsFetching = false;
let mockIsFetchingNext = false;
let mockError: Error | null = null;
let mockHasNext = false;
const mockFetchNext = vi.fn();
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
          // TQ returns undefined when query is disabled
          return opts.enabled !== false ? mockData : undefined;
        },
        isFetching: mockIsFetching,
        isFetchingNextPage: mockIsFetchingNext,
        error: mockError,
        hasNextPage: mockHasNext,
        fetchNextPage: mockFetchNext,
        refetch: mockRefetch,
      };
    },
  };
});

// Mock API
const mockGetUserFollowing = vi.fn();
const mockGetUserFollowers = vi.fn();
const mockFollowUser = vi.fn().mockResolvedValue(undefined);
const mockUnfollowUser = vi.fn().mockResolvedValue(undefined);

vi.mock("@/api/user", () => ({
  getUserFollowing: (...args: unknown[]) => mockGetUserFollowing(...args),
  getUserFollowers: (...args: unknown[]) => mockGetUserFollowers(...args),
}));

vi.mock("@/api/illust", () => ({
  followUser: (...args: unknown[]) => mockFollowUser(...args),
  unfollowUser: (...args: unknown[]) => mockUnfollowUser(...args),
}));

vi.mock("@/utils/r18Filter", () => ({
  filterUserPreviews: (previews: PixivUserPreview[]) => previews,
}));

function createPreview(userId: number, followed = false) {
  return {
    user: { id: userId, name: `u${userId}`, account: `u${userId}`, is_followed: followed },
    illusts: [],
  };
}

async function loadStore() {
  vi.resetModules();
  return import("@/stores/followListStore");
}

describe("followListStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockData = { pages: [{ items: [], next_url: null }], pageParams: [undefined] };
    mockIsFetching = false;
    mockIsFetchingNext = false;
    mockError = null;
    mockHasNext = false;
  });

  describe("initial state", () => {
    it("starts empty", async () => {
      const { users, loading, error, nextUrl } = await loadStore();
      expect(users()).toEqual([]);
      expect(loading()).toBe(false);
      expect(error()).toBeNull();
      expect(nextUrl()).toBeNull();
    });
  });

  describe("loadList", () => {
    it("loads following list", async () => {
      mockData = {
        pages: [{ items: [createPreview(1), createPreview(2)], next_url: "next" }],
        pageParams: [undefined],
      };
      mockHasNext = true;

      const store = await loadStore();
      await store.loadList("following", 5);

      expect(store.users()).toHaveLength(2);
      expect(store.nextUrl()).toBe("next");
    });

    it("loads followers list", async () => {
      mockData = {
        pages: [{ items: [createPreview(3)], next_url: null }],
        pageParams: [undefined],
      };

      const store = await loadStore();
      await store.loadList("followers", 5);

      expect(store.users()).toHaveLength(1);
    });

    it("handles errors gracefully", async () => {
      mockError = new Error("Failed");

      const store = await loadStore();
      await store.loadList("following", 5);

      expect(store.error()!.message).toContain("Failed");
      expect(store.loading()).toBe(false);
    });
  });

  describe("loadMore", () => {
    it("loads next page of following", async () => {
      mockData = {
        pages: [{ items: [createPreview(1)], next_url: "next-following" }],
        pageParams: [undefined],
      };
      mockHasNext = true;

      const store = await loadStore();
      await store.loadList("following", 5);

      mockFetchNext.mockResolvedValue(undefined as never);

      await store.loadMore();

      expect(mockFetchNext).toHaveBeenCalled();
    });

    it("does nothing when no next page", async () => {
      mockHasNext = false;
      const store = await loadStore();
      // Load but no nextUrl
      await store.loadMore();
      expect(mockFetchNext).not.toHaveBeenCalled();
    });
  });

  describe("toggleFollow", () => {
    it("optimistically toggles follow state", async () => {
      mockData = {
        pages: [{ items: [createPreview(10, false)], next_url: null }],
        pageParams: [undefined],
      };

      const store = await loadStore();
      await store.loadList("following", 5);

      await store.toggleFollow(0);

      expect(store.users()[0].user.is_followed).toBe(true);
      expect(mockFollowUser).toHaveBeenCalledWith(10);
    });

    it("rolls back on API failure", async () => {
      mockFollowUser.mockRejectedValue(new Error("err"));
      mockData = {
        pages: [{ items: [createPreview(10, false)], next_url: null }],
        pageParams: [undefined],
      };

      const store = await loadStore();
      await store.loadList("following", 5);
      await store.toggleFollow(0);

      expect(store.users()[0].user.is_followed).toBe(false);
    });

    it("does nothing for invalid index", async () => {
      const store = await loadStore();
      await store.toggleFollow(999);
      expect(mockFollowUser).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("resets all state", async () => {
      mockData = {
        pages: [{ items: [createPreview(1)], next_url: "next" }],
        pageParams: [undefined],
      };

      const store = await loadStore();
      await store.loadList("following", 5);
      store.reset();

      expect(store.users()).toEqual([]);
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.nextUrl()).toBeNull();
    });
  });
});
