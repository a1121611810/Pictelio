import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadRecommended, loadFollow } from "../api/illust";
import type { PixivIllust } from "../api/types";
import { currentTab } from "./uiStore";
import { filterFeedIllusts } from "../utils/r18Filter";
import { apiClient } from "../api/client";
import {
  createFeedScrollStore,
  type ScrollRestoreState,
} from "../primitives/createFeedScrollStore";

export type RecommendSubTab = "mixed" | "illust" | "manga";

// ── Sub-tab signals (kept in module for backward compatibility) ──

const [followTabState, setFollowTab] = createSignal<"all" | "public" | "private">("all");
const [recommendSubTabState, setRecommendSubTabRaw] = createSignal<RecommendSubTab>("mixed");

export const followTab = followTabState;
export { setFollowTab };
export const recommendSubTab = recommendSubTabState;

export function setRecommendSubTab(t: RecommendSubTab) {
  batch(() => {
    setRecommendSubTabRaw(t);
  });
}

/**
 * SubTab adapter:
 * feedStore uses "mixed" for recommended merge, factory uses "all".
 * Follow tab uses "all" unchanged.
 */
function toFactorySubTab(tab: string, sub: string): string {
  return tab === "recommended" && sub === "mixed" ? "all" : sub;
}

function fromFactorySubTab(tab: string, sub: string): string {
  return tab === "recommended" && sub === "all" ? "mixed" : sub;
}

/** 去重：按 illust.id */
function dedupIllusts(items: PixivIllust[]): PixivIllust[] {
  const seen = new Set<number>();
  return items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

/** 下一页 API 请求（pageParam 有值 → apiClient.get，否则调初始 loader） */
function nextPageOrLoad(
  pageParam: string | undefined,
  initialLoader: (
    signal?: AbortSignal,
  ) => Promise<{ illusts: PixivIllust[]; next_url: string | null }>,
  signal?: AbortSignal,
): Promise<{ items: PixivIllust[]; next_url: string | null }> {
  if (pageParam) {
    return apiClient
      .get<{ illusts: PixivIllust[]; next_url: string | null }>(pageParam, undefined, signal)
      .then((r) => ({ items: r.illusts, next_url: r.next_url }));
  }
  return initialLoader(signal).then((r) => ({ items: r.illusts, next_url: r.next_url }));
}

// ── Factory instance ──

const store = createTQFeedStore<PixivIllust, "recommended" | "follow", undefined>({
  name: "feed",
  currentTab: () => currentTab() as "recommended" | "follow",
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
      getSubTab: () => toFactorySubTab("recommended", recommendSubTabState()),
      setSubTab: (v) => setRecommendSubTab(fromFactorySubTab("recommended", v) as RecommendSubTab),
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
    follow: {
      allMode: { type: "merge", subTabs: ["public", "private"] },
      getSubTab: () => toFactorySubTab("follow", followTabState()),
      setSubTab: (v) =>
        setFollowTab(fromFactorySubTab("follow", v) as "all" | "public" | "private"),
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
export const error = store.error;

// ── Tab cache helper ──

export function isFeedCached(tab?: string): boolean {
  void tab;
  return store.isCached();
}

export function markFeedMounted() {
  // No-op: lifecycle hook for Feed component
}

// ── Actions (re-export from factory) ──

export const ensureLoaded = store.ensureLoaded;
export const refresh = store.refresh;

/** 串行翻页（匹配原 feedStore 行为） */
export function fetchMore(_signal?: AbortSignal): Promise<unknown> | undefined {
  return store.fetchMore(_signal);
}

// ── Scroll restore (kept from original createFeedScrollStore) ──

const feedScroll = createFeedScrollStore("", followTab, recommendSubTab);
export const saveTabScroll = feedScroll.saveTabScroll;
export const getFeedScrollY = feedScroll.getFeedScrollY;
export const saveFeedScrollState = feedScroll.saveScrollState;
export const getFeedScrollState = feedScroll.getScrollState;
export type { ScrollRestoreState };
