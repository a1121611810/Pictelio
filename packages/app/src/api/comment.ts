import { apiClient } from "./client";
import type { PixivCommentRootResponse, PixivCommentReplyResponse } from "./types";

/** 评论内容类型：插画或小说 */
export type CommentContentType = "illust" | "novel";

// ── 端点映射表（编译时常量，as const 防篡改）──

const COMMENT_ROOTS: Record<CommentContentType, string> = {
  illust: "/v3/illust/comments",
  novel: "/v1/novel/comments",
} as const;

const COMMENT_REPLIES: Record<CommentContentType, string> = {
  illust: "/v2/illust/comment/replies",
  novel: "/v2/novel/comment/replies",
} as const;

const COMMENT_POST: Record<CommentContentType, string> = {
  illust: "/v1/illust/comment/add",
  novel: "/v1/novel/comment/add",
} as const;

const COMMENT_DELETE: Record<CommentContentType, string> = {
  illust: "/v1/illust/comment/delete",
  novel: "/v1/novel/comment/delete",
} as const;

/** ID 参数名映射 */
const ID_PARAM: Record<CommentContentType, "illust_id" | "novel_id"> = {
  illust: "illust_id",
  novel: "novel_id",
} as const;

/** 评论最大长度（与 Pixiv API 一致） */
export const MAX_COMMENT_LENGTH = 2000;

// ── 导出函数 ──

export function loadRootComments(
  type: CommentContentType,
  targetId: number,
  signal?: AbortSignal,
): Promise<PixivCommentRootResponse> {
  return apiClient.get<PixivCommentRootResponse>(
    COMMENT_ROOTS[type],
    { [ID_PARAM[type]]: String(targetId), include_total_comments: "true" },
    signal,
  );
}

export function loadRootCommentsNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivCommentRootResponse> {
  return apiClient.get<PixivCommentRootResponse>(url, undefined, signal);
}

/** @internal 评论回复功能已预留 API，当前 UI 尚未接入 */
export function loadReplies(
  type: CommentContentType,
  commentId: number,
  signal?: AbortSignal,
): Promise<PixivCommentReplyResponse> {
  return apiClient.get<PixivCommentReplyResponse>(
    COMMENT_REPLIES[type],
    { comment_id: String(commentId) },
    signal,
  );
}

export function postComment(
  type: CommentContentType,
  targetId: number,
  comment: string,
  parentCommentId?: number,
): Promise<void> {
  if (comment.length > MAX_COMMENT_LENGTH) {
    return Promise.reject(
      new Error(`Comment exceeds maximum length of ${MAX_COMMENT_LENGTH} characters`),
    );
  }
  const body: Record<string, string> = {
    [ID_PARAM[type]]: String(targetId),
    comment,
  };
  if (parentCommentId != null) {
    body.parent_comment_id = String(parentCommentId);
  }
  return apiClient.post(COMMENT_POST[type], body);
}

export function deleteComment(type: CommentContentType, commentId: number): Promise<void> {
  return apiClient.post(COMMENT_DELETE[type], {
    comment_id: String(commentId),
  });
}
