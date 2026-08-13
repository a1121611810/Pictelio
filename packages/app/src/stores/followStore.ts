import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadFollow } from "../api/illust";
import type { PixivIllust } from "../api/types";
import { filterFeedIllusts } from "../utils/r18Filter";
import { dedupIllusts, nextPageOrLoad } from "./shared/feedHelpers";

// ── Sub-tab signal ──

const [followTabState, setFollowTab] = createSignal<"all" | "public" | "private">("all");

export const followTab = followTabState;
export { setFollowTab };

// ── Factory instance ──

const store = createTQFeedStore<PixivIllust, "follow", undefined>({
  name: "follow",
  currentTab: () => "follow" as const,
  enabled: () => true,
  lazy: true,
  getDeps: () => undefined,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterFeedIllusts,
  dedupFn: dedupIllusts,

  tabs: {
    follow: {
      allMode: { type: "merge", subTabs: ["public", "private"] },
      getSubTab: () => followTabState(),
      setSubTab: (v) => setFollowTab(v as "all" | "public" | "private"),
      queries: {
        public: {
          queryKey: () => ["feed", "follow_public"],
          queryFn: (_deps, pageParam, signal) =>
            nextPageOrLoad(pageParam, (sig) => loadFollow("public", sig), signal),
        },
        private: {
          queryKey: () => ["feed", "follow_private"],
          queryFn: (_deps, pageParam, signal) =>
            nextPageOrLoad(pageParam, (sig) => loadFollow("private", sig), signal),
        },
      },
    },
  },
});

// ── Derived state (re-export from factory) ──

export const illusts = store.items;
export const nextUrl = store.nextUrl;
export const loading = store.loading;
export const refreshing = store.refreshing;
export const loadingMore = store.loadingMore;
export const error = store.error;
export const paginationError = store.paginationError;

// ── Cache helper ──

export function isFollowCached(): boolean {
  return store.isCached();
}

// ── Actions (re-export from factory) ──

export const ensureLoaded = store.ensureLoaded;
export const refresh = store.refresh;
export const activate = store.activate;
export const isActivated = store.isActivated;

/** 串行翻页 */
export function fetchMore(_signal?: AbortSignal): Promise<unknown> | undefined {
  return store.fetchMore(_signal);
}
