import { createTQFeedStore } from "./shared/createTQFeedStore";
import { getUserFollowing, getUserFollowers } from "../api/user";
import { followUser, unfollowUser } from "../api/illust";
import { filterUserPreviews } from "../utils/r18Filter";
import type { PixivUserPreview, PixivUserFollowingResponse } from "../api/types";
import { queryKeys } from "../api/queryKeys";
import { queryClient } from "../api/queryClient";
import { apiClient } from "../api/client";


export type FollowMode = "following" | "followers";

// ── Reactive source signals ──
const [mode, setMode] = createSignal<FollowMode>("following");
const [userId, setUserId] = createSignal<number>(0);

// FollowItem satisfies TItem extends { id: number; create_date: string }
type FollowItem = PixivUserPreview & { id: number; create_date: string };

function toFollowItem(p: PixivUserPreview): FollowItem {
  // create_date 设为空字符串：FollowItem 仅用于满足工厂的 TItem 类型约束，
  // 关注列表按用户而非日期排序，此字段不会被消费。
  return { ...p, id: p.user.id, create_date: "" };
}

// ── Factory ──
const store = createTQFeedStore<FollowItem, "followList", { mode: FollowMode; userId: number }>({
  name: "followList",
  currentTab: () => "followList" as const,
  enabled: () => userId() > 0,
  getDeps: () => ({ mode: mode(), userId: userId() }),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  errorStrategy: "allMustFail",
  filterFn: (items) => filterUserPreviews(items),

  tabs: {
    followList: {
      allMode: { type: "single", subTabs: ["following", "followers"] },
      getSubTab: () => mode(),
      setSubTab: (v) => setMode(v as FollowMode),
      queries: {
        following: {
          queryKey: (deps) => queryKeys.followList("following", deps.userId),
          queryFn: (deps, pageParam) =>
            pageParam
              ? apiClient
                  .get<{ user_previews: PixivUserPreview[]; next_url: string | null }>(pageParam)
                  .then((r) => ({
                    items: r.user_previews.map(toFollowItem),
                    next_url: r.next_url,
                  }))
              : getUserFollowing(deps.userId).then((r) => ({
                  items: r.user_previews.map(toFollowItem),
                  next_url: r.next_url,
                })),
        },
        followers: {
          queryKey: (deps) => queryKeys.followList("followers", deps.userId),
          queryFn: (deps, pageParam) =>
            pageParam
              ? apiClient
                  .get<{ user_previews: PixivUserPreview[]; next_url: string | null }>(pageParam)
                  .then((r) => ({
                    items: r.user_previews.map(toFollowItem),
                    next_url: r.next_url,
                  }))
              : getUserFollowers(deps.userId).then((r) => ({
                  items: r.user_previews.map(toFollowItem),
                  next_url: r.next_url,
                })),
        },
      },
    },
  },
});

// ── Derived exports (backward compatible) ──
export const users = store.items;
export const loading = store.loading;
export const error = store.error;
export const nextUrl = store.nextUrl;

// ── Actions ──

export function loadList(m: FollowMode, uid: number): void {
  setMode(m);
  setUserId(uid);
}

export async function loadMore(): Promise<void> {
  await store.fetchMore();
}

/**
 * Optimistic toggle: mutate data in-place, then revert on API failure.
 * Uses setQueryData to re-trigger the derived users() signal to re-evaluate.
 * Kept as wrapper because optimistic update is business-specific, not part of factory.
 */
export async function toggleFollow(index: number): Promise<void> {
  const current = store.items();
  const preview = current[index];
  if (!preview) return;

  const prev = preview.user.is_followed ?? false;
  preview.user.is_followed = !prev;

  queryClient.setQueryData(
    queryKeys.followList(mode(), userId()),
    (old: { pages: PixivUserFollowingResponse[]; pageParams: unknown[] } | undefined) => {
      if (!old) return old;
      return { ...old, pages: [...old.pages] };
    },
  );

  const [err] = prev
    ? await tryAsync(unfollowUser(preview.user.id))
    : await tryAsync(followUser(preview.user.id));
  if (err) {
    // Rollback
    preview.user.is_followed = prev;
    queryClient.setQueryData(
      queryKeys.followList(mode(), userId()),
      (old: { pages: PixivUserFollowingResponse[]; pageParams: unknown[] } | undefined) => {
        if (!old) return old;
        return { ...old, pages: [...old.pages] };
      },
    );
  }
}

export function reset(): void {
  setMode("following");
  setUserId(0);
  queryClient.removeQueries({ queryKey: ["user", "followList"] });
}
