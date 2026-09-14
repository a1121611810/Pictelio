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
import { t } from "../i18n";

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
  // 2.0 拆分效应：compute 段只读快照，重置/异步请求的写 signal 移入 apply 段，
  // AbortController 经 apply 返回的 cleanup 在依赖变化/销毁时注销
  createEffect(
    () => {
      if (!enabled()) return null;
      return { id: targetId(), t: type() };
    },
    (snap) => {
      if (!snap) return;
      const ac = new AbortController();

      setError(null);
      setHasLoaded(false);
      setRootComments([]);
      setNextUrl(null);

      void (async () => {
        const [loadErr, res] = await tryAsync(loadRootComments(snap.t, snap.id, ac.signal));
        if (ac.signal.aborted) return;
        if (loadErr) {
          if ((loadErr as { name?: string }).name !== "AbortError") {
            setError(t("core.primitive.useComments.loadFailed")); // i18n: set 时快照（瞬态）
          }
        } else {
          setRootComments(res.comments);
          setNextUrl(res.next_url);
          setHasLoaded(true);
        }
      })();

      return () => ac.abort();
    },
  );

  // 分页加载更多
  async function loadMore() {
    const url = nextUrl();
    if (!url || loadingMore()) return;
    setLoadingMore(true);
    const [err, res] = await tryAsync(loadRootCommentsNext(url));
    setLoadingMore(false);
    if (err) {
      setError(t("core.primitive.useComments.loadMoreFailed")); // i18n: set 时快照（瞬态）
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
      setPostError(t("core.primitive.useComments.postFailed")); // i18n: set 时快照（瞬态）
      return;
    }
    const [loadErr, res] = await tryAsync(loadRootComments(type(), targetId()));
    setPosting(false);
    if (loadErr) {
      setPostError(t("core.primitive.useComments.postFailed"));
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
      setError(t("core.primitive.useComments.deleteFailed")); // i18n: set 时快照（瞬态）
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
