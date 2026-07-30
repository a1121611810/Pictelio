import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadFollow } from "../api/novel";
import type { PixivNovel } from "../api/types";
import { filterNovels } from "../utils/r18Filter";
import { adaptNovelResponse, dedupNovels } from "./shared/novelHelpers";
import {
  createFeedScrollStore,
  type ScrollRestoreState,
} from "../primitives/createFeedScrollStore";

// ── Sub-tab signal ──

const [followTabState, setNovelFollowTab] = createSignal<"all" | "public" | "private">("all");

export const novelFollowTab = followTabState;
export { setNovelFollowTab };

// ── Factory instance ──

const store = createTQFeedStore<PixivNovel, "follow", undefined>({
  name: "novel_follow",
  currentTab: () => "follow" as const,
  enabled: () => true,
  getDeps: () => undefined,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterNovels,
  dedupFn: dedupNovels,

  tabs: {
    follow: {
      allMode: { type: "merge", subTabs: ["public", "private"] },
      getSubTab: () => followTabState(),
      setSubTab: (v) => setNovelFollowTab(v as "all" | "public" | "private"),
      queries: {
        public: {
          queryKey: () => ["novel", "follow_public"] as const,
          queryFn: (_deps, pageParam, signal) =>
            adaptNovelResponse(pageParam, () => loadFollow("public"), signal),
        },
        private: {
          queryKey: () => ["novel", "follow_private"] as const,
          queryFn: (_deps, pageParam, signal) =>
            adaptNovelResponse(pageParam, () => loadFollow("private"), signal),
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
export const error = store.error;

export function isNovelFollowCached(): boolean {
  return store.isCached();
}

// ── Actions ──

export const ensureLoaded = store.ensureLoaded;
export const refresh = store.refresh;

export function fetchMore(_signal?: AbortSignal): Promise<unknown> | undefined {
  return store.fetchMore(_signal);
}

// ── Scroll restore ──

const novelScroll = createFeedScrollStore("novel_", novelFollowTab);
export const saveTabScroll = novelScroll.saveTabScroll;
export const getFeedScrollY = novelScroll.getFeedScrollY;
export const saveNovelScrollState = novelScroll.saveScrollState;
export const getNovelScrollState = novelScroll.getScrollState;
export type { ScrollRestoreState };
