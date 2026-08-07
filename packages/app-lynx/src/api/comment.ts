// ─── Pixiv 评论 API 端点适配层（app-lynx MVP，issue #162） ───
// 端点映射与 webview 版（packages/app/src/api/comment.ts）逐行同构。
import { apiClient } from "./client"
import type { PixivCommentReplyResponse, PixivCommentRootResponse } from "./types"

/** 评论内容类型：插画或小说 */
export type CommentContentType = "illust" | "novel"

// ── 端点映射表（编译时常量，as const 防篡改） ──

const COMMENT_ROOTS: Record<CommentContentType, string> = {
  illust: "/v3/illust/comments",
  novel: "/v1/novel/comments",
} as const

const COMMENT_REPLIES: Record<CommentContentType, string> = {
  illust: "/v2/illust/comment/replies",
  novel: "/v2/novel/comment/replies",
} as const

const COMMENT_POST: Record<CommentContentType, string> = {
  illust: "/v1/illust/comment/add",
  novel: "/v1/novel/comment/add",
} as const

const COMMENT_DELETE: Record<CommentContentType, string> = {
  illust: "/v1/illust/comment/delete",
  novel: "/v1/novel/comment/delete",
} as const

/** ID 参数名映射 */
const ID_PARAM: Record<CommentContentType, "illust_id" | "novel_id"> = {
  illust: "illust_id",
  novel: "novel_id",
} as const

/** 评论最大长度（与 Pixiv API 一致） */
export const MAX_COMMENT_LENGTH = 2000

// ── 传输接口：useComments 通过它取数/写数，测试可注入内存替身 ──

export interface CommentsTransport {
  loadRootComments(
    type: CommentContentType,
    targetId: number,
    signal?: AbortSignal,
  ): Promise<PixivCommentRootResponse>
  loadRootCommentsNext(url: string, signal?: AbortSignal): Promise<PixivCommentRootResponse>
  loadReplies(
    type: CommentContentType,
    commentId: number,
    signal?: AbortSignal,
  ): Promise<PixivCommentReplyResponse>
  postComment(
    type: CommentContentType,
    targetId: number,
    text: string,
    parentCommentId?: number,
  ): Promise<void>
  deleteComment(type: CommentContentType, commentId: number): Promise<void>
}

// ── 导出函数（天然满足 CommentsTransport） ──

export function loadRootComments(
  type: CommentContentType,
  targetId: number,
  signal?: AbortSignal,
): Promise<PixivCommentRootResponse> {
  return apiClient.get<PixivCommentRootResponse>(
    COMMENT_ROOTS[type],
    { [ID_PARAM[type]]: String(targetId), include_total_comments: "true" },
    signal,
  )
}

export function loadRootCommentsNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivCommentRootResponse> {
  // next_url 是绝对 URL，rewriteUrl 在 client 内统一重写
  return apiClient.get<PixivCommentRootResponse>(url, undefined, signal)
}

export function loadReplies(
  type: CommentContentType,
  commentId: number,
  signal?: AbortSignal,
): Promise<PixivCommentReplyResponse> {
  return apiClient.get<PixivCommentReplyResponse>(
    COMMENT_REPLIES[type],
    { comment_id: String(commentId) },
    signal,
  )
}

export function postComment(
  type: CommentContentType,
  targetId: number,
  text: string,
  parentCommentId?: number,
): Promise<void> {
  if (text.trim().length === 0 || text.length > MAX_COMMENT_LENGTH) {
    return Promise.reject(new Error("评论内容不能为空或超过 2000 字"))
  }
  const body: Record<string, string> = {
    [ID_PARAM[type]]: String(targetId),
    comment: text,
  }
  if (parentCommentId != null) {
    body.parent_comment_id = String(parentCommentId)
  }
  // apiClient.post 内部以 URLSearchParams 表单编码（form-urlencoded）
  return apiClient.post(COMMENT_POST[type], body)
}

export function deleteComment(type: CommentContentType, commentId: number): Promise<void> {
  return apiClient.post(COMMENT_DELETE[type], {
    comment_id: String(commentId),
  })
}

// ── 默认传输实现（真实端点绑定） ──

export const commentTransport: CommentsTransport = {
  loadRootComments,
  loadRootCommentsNext,
  loadReplies,
  postComment,
  deleteComment,
}
