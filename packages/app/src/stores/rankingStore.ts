/**
 * rankingStore — 排行榜数据层（spec docs/specs/ranking.md §6.2）。
 *
 * 单源分页：每 `(mode, date)` 一个 TanStack InfiniteQuery，走服务端 `next_url` 翻页；
 * 展平页面时**严格保持页序 × 页内序**——**禁止**走 createTQFeedStore 的 merge 路径
 * （它对 items 做 sortByDate + 去重，会按 create_date 重排，直接毁掉名次顺序）。
 *
 * 名次 = 全局下标 + 1（跨页累加，spec §5.5）。受限条目沿用既有 `filterFeedIllusts` 链路
 * 滤除，但**不重编号**，因此会留下名次空洞——这是裁决 #7 的预期行为，不是 bug。
 *
 * ADR-0042 延迟加载：查询 `enabled:false`，页面挂载后激活并 `ensureLoaded()`，
 * 保证「先渲染骨架、后发请求」。
 */
import type { Accessor } from "solid-js";
import { createSignal, untrack } from "solid-js";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { DEFAULT_RANK_MODE, rankingCacheKey, type RankingQuery } from "@pictelio/ranking-core";
import { queryClient } from "@/api/queryClient";
import { normalizeQueryError } from "@/api/normalizeQueryError";
import { fetchRanking, fetchRankingNext } from "@/api/ranking";
import { queryKeys } from "@/api/queryKeys";
import type { ApiError, PixivIllust, PixivIllustListResponse } from "@/api/types";
import { filterFeedIllusts } from "@/utils/r18Filter";
import { fetchDirection } from "@/stores/shared/fetchDirection";

/** 榜单条目（渲染用，spec §3.3）：名次由 offset+index 推得，服务端不返回 */
export interface RankEntry {
  rank: number;
  illust: PixivIllust;
}

/** stale 时间（spec §3.4）：今日榜 5min，历史榜已定格放宽到 30min */
const STALE_TODAY_MS = 5 * 60 * 1000;
const STALE_HISTORY_MS = 30 * 60 * 1000;
const GC_TIME_MS = 30 * 60 * 1000;

function staleTimeFor(query: RankingQuery): number {
  return query.date === null ? STALE_TODAY_MS : STALE_HISTORY_MS;
}

export interface RankingStoreResult {
  /** 当前查询标识 (mode, date) */
  query: Accessor<RankingQuery>;
  /** 切换维度/日期（#515）；不同键各自读缓存，互不清空 */
  setQuery: (query: RankingQuery) => void;

  /** 名次条目（保序；过滤只移除，不重编号） */
  entries: Accessor<RankEntry[]>;
  nextUrl: Accessor<string | null>;
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  error: Accessor<ApiError | null>;
  paginationError: Accessor<boolean>;

  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<unknown>;
  fetchMore: () => Promise<unknown> | undefined;
}

/** 展平各页 illusts，严格保持页序 × 页内序（rank 的前置条件） */
function flattenIllusts(pages: PixivIllustListResponse[]): PixivIllust[] {
  const out: PixivIllust[] = [];
  for (const page of pages) {
    if (page.illusts) out.push(...page.illusts);
  }
  return out;
}

export function createRankingStore(initial?: RankingQuery): RankingStoreResult {
  const [query, setQuerySig] = createSignal<RankingQuery>(
    initial ?? { mode: DEFAULT_RANK_MODE, date: null },
  );
  const [paginationError, setPaginationError] = createSignal(false);

  const q = useInfiniteQuery(
    () => {
      const current = query();
      return {
        queryKey: queryKeys.ranking(rankingCacheKey(current)),
        queryFn: ({
          pageParam,
          signal,
        }: {
          pageParam: string | undefined;
          signal?: AbortSignal;
        }) => (pageParam ? fetchRankingNext(pageParam, signal) : fetchRanking(current, signal)),
        getNextPageParam: (last: PixivIllustListResponse) => last.next_url ?? undefined,
        initialPageParam: undefined as string | undefined,
        enabled: false,
        staleTime: staleTimeFor(current),
        gcTime: GC_TIME_MS,
      };
    },
    () => queryClient,
  );

  const entries: Accessor<RankEntry[]> = () => {
    const flat = flattenIllusts(q.data?.pages ?? []);
    // 先按服务端下标定名次，再走既有过滤链；过滤只移除、不重编号（名次空洞为预期）
    const kept = new Set(filterFeedIllusts(flat));
    const out: RankEntry[] = [];
    for (let i = 0; i < flat.length; i++) {
      const illust = flat[i]!;
      if (kept.has(illust)) out.push({ rank: i + 1, illust });
    }
    return out;
  };

  const nextUrl: Accessor<string | null> = () => {
    const pages = q.data?.pages ?? [];
    if (pages.length === 0) return null;
    return pages[pages.length - 1]!.next_url ?? null;
  };

  // 首载粘滞：已挂载即待发请求（enabled:false + ensureLoaded）→ status=pending 视为加载中，
  // 避免骨架在 ensureLoaded 前闪空态；数据/错误到达（status 变化）立即落回 false。
  const loading: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" || (q.status === "pending" && !q.error);
  const refreshing: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" && q.status !== "pending" && fetchDirection(q) == null;
  const loadingMore: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" && fetchDirection(q) === "forward";
  const error: Accessor<ApiError | null> = () => normalizeQueryError(q.error);

  const ensureLoaded = async (): Promise<void> => {
    const current = untrack(query);
    await queryClient.ensureInfiniteQueryData({
      queryKey: queryKeys.ranking(rankingCacheKey(current)),
      staleTime: staleTimeFor(current),
      // 陈旧缓存同步返回 + 后台重拉（SWR），与 feed store 同语义
      revalidateIfStale: true,
    } as never);
  };

  const refresh = async (): Promise<unknown> => {
    setPaginationError(false);
    return q.refetch();
  };

  const fetchMore = (): Promise<unknown> | undefined => {
    if (!q.hasNextPage || q.isFetchingNextPage) return undefined;
    const hadError = q.isError;
    setPaginationError(false);
    const p = q.fetchNextPage();
    void Promise.resolve(p).then(
      () => {
        if (q.isError && !hadError) setPaginationError(true);
      },
      () => {
        // 兜底：即便 fetchNextPage 以 reject 结束，也标记为分页失败（保留已加载列表）
        setPaginationError(true);
      },
    );
    return p;
  };

  const setQuery = (next: RankingQuery): void => {
    setPaginationError(false);
    setQuerySig(next);
  };

  return {
    query,
    setQuery,
    entries,
    nextUrl,
    loading,
    refreshing,
    loadingMore,
    error,
    paginationError,
    ensureLoaded,
    refresh,
    fetchMore,
  };
}
