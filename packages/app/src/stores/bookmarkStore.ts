import { createTQFeedStore } from "./shared/createTQFeedStore";
import { loadBookmarks } from "../api/illust";
import { user } from "./authStore";
import type { PixivIllust, RestrictType } from "../api/types";
import { filterFeedIllusts } from "../utils/r18Filter";
import { apiClient } from "../api/client";

// ── Restrict signal ──
const [restrict, setRestrictSignal] = createSignal<RestrictType>("public");

// ── Factory ──
const store = createTQFeedStore<PixivIllust, "bookmarks", { userId: number }>({
  name: "bookmarks",
  currentTab: () => "bookmarks" as const,
  enabled: () => !!user()?.id,
  getDeps: () => ({ userId: user()?.id ?? 0 }),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: filterFeedIllusts,

  tabs: {
    bookmarks: {
      allMode: { type: "single", subTabs: ["public", "private"] },
      getSubTab: () => restrict(),
      setSubTab: (v) => setRestrictSignal(v as RestrictType),
      queries: {
        public: {
          queryKey: (deps) => ["bookmarks", deps.userId, "public"],
          queryFn: (deps, pageParam, signal) =>
            pageParam
              ? apiClient
                  .get<{ illusts: PixivIllust[]; next_url: string | null }>(
                    pageParam,
                    undefined,
                    signal,
                  )
                  .then((r) => ({ items: r.illusts, next_url: r.next_url }))
              : loadBookmarks(deps.userId, "public", signal).then((r) => ({
                  items: r.illusts,
                  next_url: r.next_url,
                })),
        },
        private: {
          queryKey: (deps) => ["bookmarks", deps.userId, "private"],
          queryFn: (deps, pageParam, signal) =>
            pageParam
              ? apiClient
                  .get<{ illusts: PixivIllust[]; next_url: string | null }>(
                    pageParam,
                    undefined,
                    signal,
                  )
                  .then((r) => ({ items: r.illusts, next_url: r.next_url }))
              : loadBookmarks(deps.userId, "private", signal).then((r) => ({
                  items: r.illusts,
                  next_url: r.next_url,
                })),
        },
      },
    },
  },
});

// ── Public API (backward compatible) ──

export const illusts = store.items;
export const nextUrl = store.nextUrl;
export const loading = store.loading;
export const error = store.error;
export { restrict };

export function saveBookmarkScroll() {
  store.saveScroll();
}

export function getBookmarkScrollY(): number {
  return store.getScrollY();
}

export const ensureLoaded = store.ensureLoaded;
export const fetchMore = store.fetchMore;
export const refresh = store.refresh;

export function setRestrict(r: RestrictType) {
  if (restrict() === r) return;
  setRestrictSignal(r);
}
