import { createSignal, createEffect, onCleanup } from "solid-js";

import type { Accessor } from "solid-js";
import type { PixivComment } from "../api/types";
import type { CommentContentType } from "../api/comment";
import {
  loadRootComments,
  loadRootCommentsNext,
  postComment as apiPostComment,
  deleteComment as apiDeleteComment,
} from "../api/comment";
import { createSentinel } from "./visibility";
import { SHEET_LAZY_MARGIN } from "./rootMargins";

export interface UseCommentsResult {
  comments: Accessor<PixivComment[]>;
  hasLoaded: Accessor<boolean>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  postError: Accessor<string | null>;
  posting: Accessor<boolean>;
  deletingId: Accessor<number | null>;
  hasMore: Accessor<boolean>;
  loadMore: () => void;
  post: (text: string, parentId?: number) => Promise<void>;
  remove: (commentId: number) => Promise<void>;
  sentinelAttach: (el: HTMLDivElement) => void;
}

export function useComments(
  type: Accessor<CommentContentType>,
  targetId: Accessor<number>,
  enabled: Accessor<boolean>,
): UseCommentsResult {
  const [rootComments, setRootComments] = createSignal<PixivComment[]>([]);
  const [hasLoaded, setHasLoaded] = createSignal(false);
  const [nextUrl, setNextUrl] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [postError, setPostError] = createSignal<string | null>(null);
  const [posting, setPosting] = createSignal(false);
  const [deletingId, setDeletingId] = createSignal<number | null>(null);

  // 加载根评论（当 enabled + targetId 变化时触发）
  createEffect(() => {
    if (!enabled()) return;
    const id = targetId();
    const t = type();
    const ac = new AbortController();

    setError(null);
    setHasLoaded(false);
    setRootComments([]);
    setNextUrl(null);

    void (async () => {
      const [loadErr, res] = await tryAsync(loadRootComments(t, id, ac.signal));
      if (ac.signal.aborted) return;
      if (loadErr) {
        if ((loadErr as { name?: string }).name !== "AbortError") {
          setError("加载评论失败，请重试");
        }
      } else {
        setRootComments(res.comments);
        setNextUrl(res.next_url);
        setHasLoaded(true);
      }
    })();

    onCleanup(() => ac.abort());
  });

  // 分页加载更多
  async function loadMore() {
    const url = nextUrl();
    if (!url || loadingMore()) return;
    setLoadingMore(true);
    const [err, res] = await tryAsync(loadRootCommentsNext(url));
    setLoadingMore(false);
    if (err) {
      setError("加载更多失败");
    } else {
      setRootComments((prev) => [...prev, ...res.comments]);
      setNextUrl(res.next_url);
    }
  }

  // 分页哨兵
  const { attach: sentinelAttach } = createSentinel({
    rootMargin: SHEET_LAZY_MARGIN,
    enabled: () => nextUrl() !== null && !loadingMore(),
    onTrigger: () => void loadMore(),
  });

  // 发表/回复评论
  async function post(text: string, parentId?: number): Promise<void> {
    setPosting(true);
    setPostError(null);
    const [apiErr] = await tryAsync(apiPostComment(type(), targetId(), text, parentId));
    if (apiErr) {
      setPosting(false);
      setPostError("发送失败，请重试");
      return;
    }
    const [loadErr, res] = await tryAsync(loadRootComments(type(), targetId()));
    setPosting(false);
    if (loadErr) {
      setPostError("发送失败，请重试");
      return;
    }
    setRootComments(res.comments);
    setNextUrl(res.next_url);
  }

  // 删除评论
  async function remove(commentId: number): Promise<void> {
    setDeletingId(commentId);
    const [delErr] = await tryAsync(apiDeleteComment(type(), commentId));
    if (!delErr) {
      setRootComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    setDeletingId(null);
    if (delErr) {
      setError("删除失败");
    }
  }

  return {
    comments: rootComments,
    hasLoaded,
    loading: () => !hasLoaded() && !error(),
    error,
    postError,
    posting,
    deletingId,
    hasMore: () => nextUrl() !== null,
    loadMore,
    post,
    remove,
    sentinelAttach,
  };
}
