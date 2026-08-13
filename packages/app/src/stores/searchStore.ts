import type {
  PixivIllust,
  PixivNovel,
  SearchSort,
  SearchTarget,
  SearchScope,
  ApiError,
  SearchResultItem,
} from "@/api/types";
import { searchIllust, searchNovel, searchIllustNext, searchNovelNext } from "@/api/search";
import { toApiError } from "@/api/client";
import { ApiErrorType } from "@/api/types";
import { mergeSearchResults } from "@/utils/searchMerger";

interface SearchStoreState {
  /** Current search keyword */
  keyword: () => string;
  /** Search scope (all / illust / novel) */
  scope: () => SearchScope;
  /** Sort order */
  sort: () => SearchSort;
  /** Sort order (alias, used by Search.tsx) */
  toSorted: () => SearchSort;
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

function getSearchCacheKey(word: string, scope: SearchScope, sort: SearchSort): string {
  return `${word}_${scope}_${sort}`;
}

function readSearchCache(
  word: string,
  scope: SearchScope,
  sort: SearchSort,
): SearchCacheEntry | undefined {
  const key = getSearchCacheKey(word, scope, sort);
  return searchCache.get(key);
}

function writeSearchCache(
  word: string,
  scope: SearchScope,
  sort: SearchSort,
  entry: SearchCacheEntry,
): void {
  const key = getSearchCacheKey(word, scope, sort);
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
  // 多标签（含空格）时使用精确标签匹配，单标签使用部分匹配以搜到复合标签
  const searchTarget = createMemo<SearchTarget>(() => {
    return keyword().includes(" ") ? "exact_match_for_tags" : "partial_match_for_tags";
  });
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
  const results = createMemo(() => mergeSearchResults(illustResults(), novelResults()));
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
    const searchKey = `${kw}_${currentScope}_${currentSort}`;
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
      const cached = readSearchCache(kw, currentScope, currentSort);
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
          const currentTarget = searchTarget();
          let anySucceeded = false;

          if (currentScope === "illust" || currentScope === "all") {
            const [illustErr, illustRes] = await tryAsync(
              searchIllust(kw, currentSort, currentTarget, signal),
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
              searchNovel(kw, currentSort, currentTarget, signal),
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
            setError({ type: ApiErrorType.UNKNOWN, message: "搜索失败，请稍后重试" });
          }

          // 写入搜索结果缓存
          writeSearchCache(kw, currentScope, currentSort, {
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
    results,
    hasMore,
    loading,
    error,
    paginationError,
    setKeyword,
    setScope,
    setSort,
    executeSearch,
    loadMore,
  };
}
