import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadRecommended } from "../api/illust";
import type { PixivIllust } from "../api/types";
import { filterFeedIllusts } from "../utils/r18Filter";
import { dedupIllusts, nextPageOrLoad } from "./shared/feedHelpers";

export type RecommendSubTab = "mixed" | "illust" | "manga";

// ── Sub-tab signal ──

const [recommendSubTabState, setRecommendSubTabRaw] = createSignal<RecommendSubTab>("mixed");

export const recommendSubTab = recommendSubTabState;

export function setRecommendSubTab(t: RecommendSubTab) {
  batch(() => {
    setRecommendSubTabRaw(t);
  });
}

/**
 * SubTab adapter:
 * recommendedStore uses "mixed" for recommended merge, factory uses "all".
 */
function toFactorySubTab(sub: string): string {
  return sub === "mixed" ? "all" : sub;
}

function fromFactorySubTab(sub: string): string {
  return sub === "all" ? "mixed" : sub;
}

// ── Factory instance ──

const store = createTQFeedStore<PixivIllust, "recommended", undefined>({
  name: "recommended",
  currentTab: () => "recommended" as const,
  enabled: () => true,
  getDeps: () => undefined,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterFeedIllusts,
  dedupFn: dedupIllusts,

  tabs: {
    recommended: {
      allMode: { type: "merge", subTabs: ["illust", "manga"] },
      getSubTab: () => toFactorySubTab(recommendSubTabState()),
      setSubTab: (v) => setRecommendSubTab(fromFactorySubTab(v) as RecommendSubTab),
      queries: {
        illust: {
          queryKey: () => ["feed", "recommended_illust"],
          queryFn: (_deps, pageParam, signal) =>
            nextPageOrLoad(pageParam, (sig) => loadRecommended("illust", sig), signal),
        },
        manga: {
          queryKey: () => ["feed", "recommended_manga"],
          queryFn: (_deps, pageParam, signal) =>
            nextPageOrLoad(pageParam, (sig) => loadRecommended("manga", sig), signal),
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
export const error = store.error;

// ── Cache helper ──

export function isRecommendedCached(): boolean {
  return store.isCached();
}

// ── Actions (re-export from factory) ──

export const ensureLoaded = store.ensureLoaded;
export const refresh = store.refresh;

/** 串行翻页 */
export function fetchMore(_signal?: AbortSignal): Promise<unknown> | undefined {
  return store.fetchMore(_signal);
}

