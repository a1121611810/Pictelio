// ─── useApiCommentsQuery composable（ADR-0141 D5 / T5 lists 工具层）───
//
// 定位：T5 ticket 范围收窄为「工具层就位」，不迁 useComments consumer。
// 真实业务编排（dispose / 楼层缓存 / 跨页状态机）超 useInfiniteQuery 抽象
// 的表达能力——保留 useComments primitive 不变，composable 作为未来迁移的
// 模板单独存在。
//
// 关键能力（已通过 helper 实现）：
// - useApiInfiniteQuery 包装（generation-gate + signal 透传）
// - ApiError.kind 双错误槽位（first / pagination）—— useApiInfiniteQuery 已实现
// - 派生 firstError / pageError 供 UI 分流 banner
// - 派生 comments（拍平 pages）/ hasMore（任一页 next_url 非空）
//
// ⚠️ consumer 切换：T5 ticket 不切 useComments consumer。后续可独立 ticket
// 评估迁移成本（dispose 时机 / 楼层缓存 / 跨页状态机复杂度）。

import { computed, type ComputedRef, type Ref } from 'vue'
import {
  useApiInfiniteQuery,
  isApiQueryError,
  type ApiQueryError,
} from '../primitives/useApiInfiniteQuery'
import { apiClient } from '../api/client'
import { queryKeys } from '../api/queryKeys'
import type { ApiError, PixivCommentRootResponse, PixivComment } from '../api/types'

export type CommentsContentType = 'illust' | 'novel'

export interface UseApiCommentsQueryOptions {
  type: CommentsContentType
  targetId: number
  /** 仅当评论页可见时调（detail 页 mount 后 enable；卸载后 disable 触发 abort） */
  enabled?: boolean
}

export interface UseApiCommentsQueryReturn {
  /** 拍平后的评论列表（按 page 顺序） */
  readonly comments: ComputedRef<PixivComment[]>
  /** 是否还有更多分页（任一页 next_url 非空） */
  readonly hasMore: ComputedRef<boolean>
  /** 首屏错误（kind=first → 全屏 banner）；非 first 错误返回 null */
  readonly firstError: ComputedRef<ApiError | null>
  /** 分页错误（kind=pagination → inline banner）；非 pagination 错误返回 null */
  readonly pageError: ComputedRef<ApiError | null>
  /** 原始 query 暴露（refetch / fetchNextPage / status 等） */
  readonly query: ReturnType<typeof useApiInfiniteQuery<PixivCommentRootResponse, Error, readonly unknown[], string | null>>
}

export function useApiCommentsQuery(options: UseApiCommentsQueryOptions): UseApiCommentsQueryReturn {
  const { type, targetId, enabled = true } = options

  const path = type === 'illust' ? '/v3/illust/comments' : '/v1/novel/comments'
  const idParam = type === 'illust' ? 'illust_id' : 'novel_id'

  const queryKey = type === 'illust'
    ? queryKeys.illusts.comments(targetId)
    : queryKeys.novels.comments(targetId)

  const query = useApiInfiniteQuery<PixivCommentRootResponse, Error, readonly unknown[], string | null>({
    queryKey,
    queryFn: async ({ signal, pageParam }) => {
      if (pageParam) {
        // next_url 路径（绝对 URL）—— apiClient 内部 rewrite + 401 重试
        return apiClient.get<PixivCommentRootResponse>(pageParam, undefined, signal)
      }
      // 首屏
      return apiClient.get<PixivCommentRootResponse>(
        path,
        { [idParam]: String(targetId), include_total_comments: 'true' },
        signal,
      )
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_url,
    enabled,
  })

  const comments = computed<PixivComment[]>(() => {
    const data = query.data.value
    if (!data) return []
    return data.pages.flatMap((p) => p.comments)
  })

  const hasMore = computed<boolean>(() => {
    const data = query.data.value
    if (!data) return false
    return data.pages.some((p) => p.next_url != null)
  })

  const firstError = computed<ApiError | null>(() => {
    const err = query.error.value
    if (!err || !isApiQueryError(err) || err.kind !== 'first') return null
    return err.cause
  })

  const pageError = computed<ApiError | null>(() => {
    const err = query.error.value
    if (!err || !isApiQueryError(err) || err.kind !== 'pagination') return null
    return err.cause
  })

  return { comments, hasMore, firstError, pageError, query }
}