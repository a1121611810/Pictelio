import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadRecommended } from "../api/novel";
import type { PixivNovel } from "../api/types";
import { filterNovels } from "../utils/r18Filter";
import { adaptNovelResponse } from "./shared/novelHelpers";
import {
  createFeedScrollStore,
  type ScrollRestoreState,
} from "../primitives/createFeedScrollStore";

// ── Factory instance ──

const store = createTQFeedStore<PixivNovel, "recommended", undefined>({
  name: "novel_recommended",
  currentTab: () => "recommended" as const,
  enabled: () => true,
  getDeps: () => undefined,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterNovels,

  tabs: {
    recommended: {
      allMode: { type: "single", subTabs: ["all"] },
      queries: {
        all: {
          queryKey: () => ["novel", "recommended"] as const,
          queryFn: (_deps, pageParam, signal) =>
            adaptNovelResponse(pageParam, () => loadRecommended(), signal),
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

export function isNovelRecommendedCached(): boolean {
  return store.isCached();
}

// ── Actions ──

export const ensureLoaded = store.ensureLoaded;
export const refresh = store.refresh;

export function fetchMore(_signal?: AbortSignal): Promise<unknown> | undefined {
  return store.fetchMore(_signal);
}

// ── Scroll restore ──

const novelScroll = createFeedScrollStore("novel_");
export const saveTabScroll = novelScroll.saveTabScroll;
export const getFeedScrollY = novelScroll.getFeedScrollY;
export const saveNovelScrollState = novelScroll.saveScrollState;
export const getNovelScrollState = novelScroll.getScrollState;
export type { ScrollRestoreState };
