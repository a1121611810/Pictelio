import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadBookmarks } from "../api/novel";
import type { PixivNovel, RestrictType, ApiError } from "../api/types";
import { ApiErrorType } from "../api/types";
import { filterNovels } from "../utils/r18Filter";
import { contentType } from "./uiStore";
import { user } from "./authStore";
import { adaptNovelResponse } from "./shared/novelHelpers";
// ── Signals ──

const [bookmarkRestrictState, setBookmarkRestrict] = createSignal<RestrictType>("public");
export { bookmarkRestrictState as bookmarkRestrict, setBookmarkRestrict };

const [fallbackError, setFallbackError] = createSignal<ApiError | null>(null);

// ── Deps type ──

type NovelDeps = { userId: number | null; restrict: RestrictType };

// ── Factory instance ──

const store = createTQFeedStore<PixivNovel, "bookmarks", NovelDeps>({
  name: "novel_bookmarks",
  currentTab: () => "bookmarks" as const,
  enabled: () => contentType() === "novel" && !!user(),
  lazy: true,
  getDeps: () => ({ userId: user()?.id ?? 0, restrict: bookmarkRestrictState() }),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterNovels,

  tabs: {
    bookmarks: {
      allMode: { type: "single", subTabs: ["all"] },
      queries: {
        all: {
          queryKey: (deps) => ["novel", "bookmarks", deps.userId, deps.restrict] as const,
          queryFn: (deps, pageParam, signal) =>
            adaptNovelResponse(
              pageParam,
              () => loadBookmarks(deps.userId ?? 0, deps.restrict),
              signal,
            ),
        },
      },
    },
  },
});

// ── Derived state ──

export const novels = store.items;
export const nextUrl = store.nextUrl;
export const loading = store.loading;
export const refreshing = store.refreshing;
export const loadingMore = store.loadingMore;

export const error = (): ApiError | null => {
  return fallbackError() ?? store.error();
};

export function isNovelBookmarkCached(): boolean {
  return store.isCached();
}

// ── Actions ──

export async function ensureLoaded(): Promise<void> {
  setFallbackError(null);
  if (!user()) {
    setFallbackError({ type: ApiErrorType.UNAUTHORIZED, message: "未登录" });
    return;
  }
  await store.ensureLoaded();
}

export async function refresh(): Promise<void> {
  await store.refresh();
}

export function fetchMore(_signal?: AbortSignal): Promise<unknown> | undefined {
  return store.fetchMore(_signal);
}

export const activate = store.activate;
export const isActivated = store.isActivated;
