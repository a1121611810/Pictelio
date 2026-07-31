import { createInfiniteQuery } from "@tanstack/solid-query";
import { loadUserIllusts } from "../api/illust";
import { loadUserNovels } from "../api/novel";
import { type ApiError, type PixivIllust, type PixivNovel, type ContentType } from "../api/types";
import { filterFeedIllusts, filterNovels } from "../utils/r18Filter";
import { queryKeys } from "../api/queryKeys";
import { normalizeQueryError } from "../api/normalizeQueryError";
import { apiClient } from "../api/client";
import { queryClient } from "../api/queryClient";
/**
 * userIllustsStore 暂不迁移到 createTQFeedStore。
 *
 * 原因（ADR-0022）：
 * 1. illust/manga 和 novel 使用不同的 API 响应类型（{ illusts } vs { novels }），
 *    工厂要求统一的 { items } 格式，适配需要额外的映射层。
 * 2. 切换 content type 时使用 placeholderData 保留旧数据避免闪烁，
 *    工厂不提供此钩子。
 * 3. factory 的 currentTab 切换会立即禁用旧查询，而 userIllustsStore
 *    需要在 inactive 查询上保留占位数据。
 *
 * 这三个问题使得迁移到工厂的收益不足以覆盖风险和复杂度。
 * 待 factory 支持 heterogeneous 响应类型 + placeholderData 后再评估。
 */

// ── Content type signal ──
const [contentType, setContentType] = createSignal<ContentType>("illust");

// ── Fetch trigger source ──
const [fetchSource, setFetchSource] = createSignal<{ userId: number; type: ContentType } | false>(
  false,
);

// ── TQ Infinite Query: illust / manga ──
const illustQuery = createRoot(() =>
  createInfiniteQuery(
    () => {
      const s = fetchSource();
      const isActive = s && s.type !== "novel";
      return {
        queryKey: isActive
          ? queryKeys.userIllusts(s!.userId, s!.type === "manga" ? "manga" : "illust")
          : (["__disabled__", "illust", "userWorks", 0] as const),
        queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
          if (!s) {
            return { illusts: [] as PixivIllust[], next_url: null as string | null };
          }
          if (pageParam) {
            return apiClient.get<{ illusts: PixivIllust[]; next_url: string | null }>(pageParam);
          }
          return loadUserIllusts(s.userId, s.type);
        },
        getNextPageParam: (lastPage: { next_url: string | null }) => lastPage.next_url ?? undefined,
        initialPageParam: undefined as string | undefined,
        enabled: !!isActive,
        // 切换 content type (illust↔manga) 时保留旧数据，避免整个页面闪现 loading
        placeholderData: (previousData: any, previousQuery: any) =>
          previousData ?? (previousQuery?.state.data as any) ?? undefined,
      };
    },
    () => queryClient,
  ),
);

// ── TQ Infinite Query: novel ──
const novelQuery = createRoot(() =>
  createInfiniteQuery(
    () => {
      const s = fetchSource();
      const isActive = s && s.type === "novel";
      return {
        queryKey: isActive
          ? queryKeys.userNovels(s!.userId)
          : (["__disabled__", "novel", "userWorks", 0] as const),
        queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
          if (!s) {
            return { novels: [] as PixivNovel[], next_url: null as string | null };
          }
          if (pageParam) {
            return apiClient.get<{ novels: PixivNovel[]; next_url: string | null }>(pageParam);
          }
          return loadUserNovels(s.userId);
        },
        getNextPageParam: (lastPage: { next_url: string | null }) => lastPage.next_url ?? undefined,
        initialPageParam: undefined as string | undefined,
        enabled: !!isActive,
        // 切换 content type (novel↔illust/manga) 时保留旧数据，避免全页面闪烁
        placeholderData: (previousData: any, previousQuery: any) =>
          previousData ?? (previousQuery?.state.data as any) ?? undefined,
      };
    },
    () => queryClient,
  ),
);

// ── Derived exports ──

/** Returns illusts (non-novel types) or empty array when current type is novel. */
export const illusts = () => {
  const data = illustQuery.data;
  if (!data) {
    return [] as PixivIllust[];
  }
  return filterFeedIllusts(data.pages.flatMap((p) => p.illusts));
};

/** Returns novels (novel type only) or empty array otherwise. */
export const novels = () => {
  if (contentType() !== "novel") {
    return [] as PixivNovel[];
  }
  const data = novelQuery.data;
  if (!data) {
    return [] as PixivNovel[];
  }
  return filterNovels(data.pages.flatMap((p) => p.novels));
};

export const nextUrl = (): string | null => {
  if (contentType() === "novel") {
    const data = novelQuery.data;
    if (!data) {
      return null;
    }
    return data.pages[data.pages.length - 1]?.next_url ?? null;
  }
  const data = illustQuery.data;
  if (!data) {
    return null;
  }
  return data.pages[data.pages.length - 1]?.next_url ?? null;
};

export const loading = () =>
  contentType() === "novel" ? novelQuery.isFetching : illustQuery.isFetching;

export const error = (): ApiError | null =>
  normalizeQueryError(contentType() === "novel" ? novelQuery.error : illustQuery.error);

export { contentType };

// ── Actions ──

/**
 * Load user works for a given userId and type.
 * TQ handles caching via staleTime/gcTime: switching to an already-loaded type
 * returns cached data immediately without re-fetching.
 * Pass force=true to invalidate cache and force re-fetch.
 */
export function load(userId: number, type: ContentType = "illust", force = false) {
  if (force) {
    if (type === "novel") {
      queryClient.invalidateQueries({ queryKey: queryKeys.userNovels(userId) });
    } else {
      queryClient.invalidateQueries({ queryKey: queryKeys.userIllusts(userId, type) });
    }
  }
  setContentType(type);
  setFetchSource({ userId, type });
}

export async function loadMore() {
  if (contentType() === "novel") {
    if (!novelQuery.hasNextPage || novelQuery.isFetchingNextPage) {
      return;
    }
    await novelQuery.fetchNextPage();
    return;
  }
  if (!illustQuery.hasNextPage || illustQuery.isFetchingNextPage) {
    return;
  }
  await illustQuery.fetchNextPage();
}

/** Switch content type. Does not trigger fetch by itself. */
export function switchType(type: ContentType) {
  setContentType(type);
}
