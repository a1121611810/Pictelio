import type {
  PixivIllust,
  PixivNovel,
  SearchSort,
  SearchScope,
  ApiError,
  SearchResultItem,
} from "@/api/types";
import { searchIllust, searchNovel, searchIllustNext, searchNovelNext } from "@/api/search";
import { toApiError } from "@/api/client";
import { ApiErrorType } from "@/api/types";
import { mergeSearchResults } from "@/utils/searchMerger";
import { aiFilterMode } from "@/stores/settingsStore";
import { filterSearchResultsByAiMode } from "@/utils/aiFilter";
import { t } from "@/i18n";
import {
  DEFAULT_SEARCH_FILTERS,
  buildCacheKey,
  filterByBookmarkBand,
  resolveAiMode,
  type SearchFilters,
} from "@pictelio/search-core";

interface SearchStoreState {
  /** Current search keyword */
  keyword: () => string;
  /** Search scope (all / illust / novel) */
  scope: () => SearchScope;
  /** Sort order */
  sort: () => SearchSort;
  /** Sort order (alias, used by Search.tsx) */
  toSorted: () => SearchSort;
  /** 筛选状态（canonical shape 单点在 @pictelio/search-core，spec §3.1） */
  filters: () => SearchFilters;
  /** Merged search results (illust + novel combined) */
  results: () => SearchResultItem[];
  /** Whether a search request is in flight */
  loading: () => boolean;
  /** Error from the last search, if any */
  error: () => ApiError | null;
  /** 当前错误是否来自分页（loadMore）而非首次搜索。分页失败时保留已加载结果 */
  paginationError: () => boolean;
  /** Update the search keyword */
  setKeyword: (word: string) => void;
  /** Update the search scope */
  setScope: (scope: SearchScope) => void;
  /** Update the sort order */
  setSort: (sort: SearchSort) => void;
  /** 更新筛选状态（仅改状态；即改即搜的 450ms 去抖触发在 Search.tsx，spec §5.2） */
  setFilters: (filters: SearchFilters) => void;
  /** Execute a search with current keyword/scope/sort. Checks internal cache first. */
  executeSearch: () => Promise<void>;
  /** Whether there are more results to load */
  hasMore: () => boolean;
  /** Load more results (handles both illust and novel pagination internally) */
  loadMore: () => Promise<void>;
}

// ─── 搜索结果 LRU 缓存（跨组件卸载持久）───

interface SearchCacheEntry {
  illustResults: PixivIllust[];
  novelResults: PixivNovel[];
  hasMoreIllust: boolean;
  hasMoreNovel: boolean;
  nextIllustUrl: string | null;
  nextNovelUrl: string | null;
}

const SEARCH_CACHE_MAX = 20;
const searchCache = new Map<string, SearchCacheEntry>();

function readSearchCacheByKey(key: string): SearchCacheEntry | undefined {
  return searchCache.get(key);
}

function writeSearchCacheByKey(key: string, entry: SearchCacheEntry): void {
  searchCache.delete(key);
  searchCache.set(key, entry);
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const first = searchCache.keys().next();
    if (!first.done) searchCache.delete(first.value);
  }
}

export function createSearchStore(): SearchStoreState {
  const [keyword, setKeyword] = createSignal("");
  const [scope, setScope] = createSignal<SearchScope>("all");
  const [sort, setSort] = createSignal<SearchSort>("date_desc");
  // 筛选状态（canonical shape 单点在 search-core；默认 = 全部不限 + AI 跟随账号设置）
  const [filters, setFiltersSig] = createSignal<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  const [illustResults, setIllustResults] = createSignal<PixivIllust[]>([]);
  const [novelResults, setNovelResults] = createSignal<PixivNovel[]>([]);
  const [loading, setLoading] = createSignal(false);
  // 独立跟踪并行请求数，避免 boolean loading 的竞态问题
  let pendingRequests = 0;

  function incPending() {
    pendingRequests++;
    setLoading(true);
  }

  function decPending() {
    pendingRequests--;
    if (pendingRequests <= 0) {
      pendingRequests = 0;
      setLoading(false);
    }
  }
  const [error, setError] = createSignal<ApiError | null>(null);
  // 分页错误标记：loadMore 失败置 true；executeSearch/loadMore 成功置 false。
  // 组件据此决定「整页错误展示（首载失败）」还是「保留结果 + 底部内联重试（分页失败）」。
  const [paginationError, setPaginationError] = createSignal(false);
  const [hasMoreIllust, setHasMoreIllust] = createSignal(false);
  const [hasMoreNovel, setHasMoreNovel] = createSignal(false);
  const [nextIllustUrl, setNextIllustUrl] = createSignal<string | null>(null);
  const [nextNovelUrl, setNextNovelUrl] = createSignal<string | null>(null);

  // ── Merged results (computed) ──
  // 派生层过滤（缓存仍存服务端原始结果）：AI 三态（ADR-0155）+ 面板覆盖（#479，
  // resolveAiMode：follow=账号设置 / all=show / hide=mask）+ 收藏数客户端兜底（spec §7，
  // 服务端对免费账号静默忽略区间参数；热门路径不兜底——#478 置灰语义）。
  const results = createMemo(() => {
    const merged = mergeSearchResults(illustResults(), novelResults());
    const effectiveAi = resolveAiMode(aiFilterMode(), filters().aiOverride);
    const withBookmark =
      sort() === "popular_desc"
        ? merged
        : filterByBookmarkBand(merged, filters().bookmark, (row) => row.entity.total_bookmarks);
    return filterSearchResultsByAiMode(withBookmark, effectiveAi);
  });
  const hasMore = createMemo(() => hasMoreIllust() || hasMoreNovel());

  // ── AbortController management ──
  let abortController: AbortController | null = null;

  function abortPrevious() {
    abortController?.abort();
    abortController = new AbortController();
  }

  // ── 防重入：同参数搜索在飞行时跳过 ──
  // 场景：搜索框提交后 navigate 改变 URL → URL 同步 effect 再次调用 executeSearch。
  // 若不跳过，第二次会 abort 第一次的请求，两者都静默失败，结果被清空。
  let inFlightSearchKey: string | null = null;

  async function executeSearch() {
    const kw = keyword().trim();
    if (!kw) return;

    const currentScope = scope();
    const currentSort = sort();
    const currentFilters = filters();
    // 缓存/判重键含筛选规范段（search-core 单点）——换筛选不命中脏缓存（spec §6.2）
    const searchKey = buildCacheKey(kw, currentScope, currentSort, currentFilters);
    // 相同参数搜索已在飞行 → 跳过（由第一个请求负责写入结果）
    if (inFlightSearchKey === searchKey) return;
    inFlightSearchKey = searchKey;

    try {
      abortPrevious();
      const signal = abortController!.signal;
      pendingRequests = 0;
      // 新搜索开始 → 清除分页错误标记（本次失败属于首载失败）
      setPaginationError(false);

      // Check internal cache first
      const cached = readSearchCacheByKey(searchKey);
      if (cached) {
        setIllustResults(cached.illustResults);
        setNovelResults(cached.novelResults);
        setHasMoreIllust(cached.hasMoreIllust);
        setHasMoreNovel(cached.hasMoreNovel);
        setNextIllustUrl(cached.nextIllustUrl);
        setNextNovelUrl(cached.nextNovelUrl);
        setError(null);
        setLoading(false);
        return;
      }

      incPending();
      setError(null);
      // Clear previous results to avoid stale data on partial failure
      setIllustResults([]);
      setNovelResults([]);
      setHasMoreIllust(false);
      setHasMoreNovel(false);
      setNextIllustUrl(null);
      setNextNovelUrl(null);

      const [err] = await tryAsync(
        (async () => {
          let anySucceeded = false;

          if (currentScope === "illust" || currentScope === "all") {
            const [illustErr, illustRes] = await tryAsync(
              searchIllust(kw, currentSort, signal, currentFilters),
            );
            if (illustErr) {
              if ((illustErr as Error).name === "AbortError") throw illustErr;
              if (currentScope === "illust") throw illustErr;
            } else {
              setIllustResults(illustRes!.illusts);
              setHasMoreIllust(illustRes!.next_url != null);
              setNextIllustUrl(illustRes!.next_url);
              anySucceeded = true;
            }
          }

          if (currentScope === "novel" || currentScope === "all") {
            const [novelErr, novelRes] = await tryAsync(
              searchNovel(kw, currentSort, signal, currentFilters),
            );
            if (novelErr) {
              if ((novelErr as Error).name === "AbortError") throw novelErr;
              if (currentScope === "novel") throw novelErr;
            } else {
              setNovelResults(novelRes!.novels);
              setHasMoreNovel(novelRes!.next_url != null);
              setNextNovelUrl(novelRes!.next_url);
              anySucceeded = true;
            }
          }

          // scope=all: both failed, set error
          if (currentScope === "all" && !anySucceeded) {
            // i18n: set 时快照（瞬态）
            setError({
              type: ApiErrorType.UNKNOWN,
              message: t("core.store.searchStore.searchFailed"),
            });
          }

          // 写入搜索结果缓存（键含筛选段）
          writeSearchCacheByKey(searchKey, {
            illustResults: illustResults(),
            novelResults: novelResults(),
            hasMoreIllust: hasMoreIllust(),
            hasMoreNovel: hasMoreNovel(),
            nextIllustUrl: nextIllustUrl(),
            nextNovelUrl: nextNovelUrl(),
          });
        })(),
      );
      decPending();
      if (err) {
        if ((err as Error).name === "AbortError") return;
        setError(toApiError(err));
      }
    } finally {
      inFlightSearchKey = null;
    }
  }

  async function loadMore() {
    const hasI = hasMoreIllust();
    const hasN = hasMoreNovel();
    if (!hasI && !hasN) return;

    setError(null);
    // 分页开始 → 先清除分页错误标记（重试时复位）
    setPaginationError(false);

    // Load illust next page
    const illustPromise = hasI
      ? (async () => {
          const url = nextIllustUrl();
          if (!url) return;
          incPending();
          const [err, res] = await tryAsync(
            searchIllustNext(url, abortController?.signal ?? undefined),
          );
          decPending();
          if (err) {
            if ((err as Error).name === "AbortError") return;
            setError(toApiError(err));
            // 分页失败：保留已加载结果，标记为分页错误（组件显示底部内联重试）
            setPaginationError(true);
          } else {
            setIllustResults((prev) => [...prev, ...res!.illusts]);
            setHasMoreIllust(res!.next_url != null);
            setNextIllustUrl(res!.next_url);
          }
        })()
      : Promise.resolve();

    // Load novel next page
    const novelPromise = hasN
      ? (async () => {
          const url = nextNovelUrl();
          if (!url) return;
          incPending();
          const [err, res] = await tryAsync(
            searchNovelNext(url, abortController?.signal ?? undefined),
          );
          decPending();
          if (err) {
            if ((err as Error).name === "AbortError") return;
            setError(toApiError(err));
            // 分页失败：保留已加载结果，标记为分页错误（组件显示底部内联重试）
            setPaginationError(true);
          } else {
            setNovelResults((prev) => [...prev, ...res!.novels]);
            setHasMoreNovel(res!.next_url != null);
            setNextNovelUrl(res!.next_url);
          }
        })()
      : Promise.resolve();

    await Promise.all([illustPromise, novelPromise]);
  }

  return {
    keyword,
    scope,
    sort,
    toSorted: sort,
    filters,
    results,
    hasMore,
    loading,
    error,
    paginationError,
    // SolidJS 2.0 批处理语义（set-后-读审计修复点）：这些 setter 是命令式 API，
    // 调用方契约是「set 后同 tick 内 executeSearch / keyword() 读到新值」（1.x 同步
    // 可见语义）。set 后 flush 保持该契约，属命令式边界豁免（同时消除 Search.tsx
    // setKeyword("") 后同步 keyword().trim() 读到旧值的批处理错位）。
    setKeyword: (word: string) => {
      setKeyword(word);
      flush();
    },
    setScope: (next: SearchScope) => {
      setScope(next);
      flush();
    },
    setSort: (next: SearchSort) => {
      setSort(next);
      flush();
    },
    setFilters: (next: SearchFilters) => {
      setFiltersSig(next);
      flush();
    },
    executeSearch,
    loadMore,
  };
}
