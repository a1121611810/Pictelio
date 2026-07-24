import { createSignal } from "solid-js";
import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadRecommended, loadBookmarks, loadFollow } from "../api/novel";
import type { PixivNovel, RestrictType, ApiError } from "../api/types";
import { ApiErrorType } from "../api/types";
import { filterNovels } from "../utils/r18Filter";
import { currentTab } from "./uiStore";
import { user } from "./authStore";
import { apiClient } from "../api/client";
import {
  createFeedScrollStore,
  type ScrollRestoreState,
} from "../primitives/createFeedScrollStore";

// ── Signals (kept for backward compatibility) ──

const [followTabState, setNovelFollowTab] = createSignal<"all" | "public" | "private">("all");
const [bookmarkRestrictState, setBookmarkRestrict] = createSignal<RestrictType>("public");
/** 非 TQ 错误兜底（如未登录提示），error() 会将其纳入 */
const [fallbackError, setFallbackError] = createSignal<ApiError | null>(null);

export const novelFollowTab = followTabState;
export { setNovelFollowTab };
export { bookmarkRestrictState as bookmarkRestrict, setBookmarkRestrict };

// ── SubTab adapter (factory uses "all" for merge mode) ──

function toFactorySubTab(tab: string, sub: string): string {
  // follow: "all" → "all" (already match)
  // bookmarks/recommended: any sub → "all" (single query tabs)
  return tab === "follow" ? sub : "all";
}

// ── Response adapter: { novels, next_url } → { items, next_url } ──

type NovelListResponse = { novels: PixivNovel[]; next_url: string | null };

function adaptNovelResponse(
  pageParam: string | undefined,
  loader: (signal?: AbortSignal) => Promise<NovelListResponse>,
  signal?: AbortSignal,
): Promise<{ items: PixivNovel[]; next_url: string | null }> {
  if (pageParam) {
    return apiClient
      .get<NovelListResponse>(pageParam, undefined, signal)
      .then((r) => ({ items: r.novels, next_url: r.next_url }));
  }
  return loader(signal).then((r) => ({ items: r.novels, next_url: r.next_url }));
}

// ── Deps type for bookmarks tab ──

type NovelDeps = {
  userId: number | null;
  restrict: RestrictType;
};

// ── Factory instance ──

const store = createTQFeedStore<PixivNovel, "follow" | "recommended" | "bookmarks", NovelDeps>({
  name: "novel",
  currentTab: () => currentTab() as "follow" | "recommended" | "bookmarks",
  enabled: () => currentTab() !== "bookmarks" || !!user(),
  getDeps: () => ({ userId: user()?.id ?? 0, restrict: bookmarkRestrictState() }),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterNovels,

  tabs: {
    follow: {
      allMode: { type: "merge", subTabs: ["public", "private"] },
      getSubTab: () => toFactorySubTab("follow", followTabState()),
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

// ── Derived state (re-export from factory) ──

export const novels = store.items;
export const nextUrl = store.nextUrl;
export const loading = store.loading;
export const refreshing = store.refreshing;

// ── Error (factory + fallbackError) ──

export const error = (): ApiError | null => {
  return fallbackError() ?? store.error();
};

// ── Cache check ──

export function isNovelCached(_tab?: string): boolean {
  void _tab;
  return store.isCached();
}

// ── Actions ──

export async function ensureLoaded(): Promise<void> {
  setFallbackError(null); // 清除兜底错误，允许 TQ 错误自然生效
  // Fallback for unauthenticated bookmark loading
  if (currentTab() === "bookmarks" && !user()) {
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

// ── Scroll restore (kept from original createFeedScrollStore) ──

const novelScroll = createFeedScrollStore("novel_", novelFollowTab);
export const saveTabScroll = novelScroll.saveTabScroll;
export const getFeedScrollY = novelScroll.getFeedScrollY;
export const saveNovelScrollState = novelScroll.saveScrollState;
export const getNovelScrollState = novelScroll.getScrollState;
export type { ScrollRestoreState };
