// ─── 评论列表状态机（app-lynx，issue #162） ───
// 响应式形态：内部全部用 ref（与 authStore/settingsStore 全 ref 先例一致），
// 不用 reactive 对象。controller.state 以「computed 聚合 + getter 返回」组织：
//   - 内部各 ref 是唯一数据源，controller 是唯一写者；
//   - state 通过 computed 聚合各 ref 的 .value，生成符合 CommentsState 接口
//     （字段为普通值类型）的只读快照，测试/模板读 state.comments 即数组本身；
//   - 读取发生在 ref.value 上 → Vue 依赖收集保持响应式，getter 无 setter → 只读。
// 错误语义：列表类（首次加载/分页）失败 → error（分页失败时 status 保持 ready、
// 保留列表）；操作类（发表/删除/楼层展开）失败 → actionError。
import { computed, ref } from "vue"
import type { PixivComment } from "../api/types"
import { MAX_COMMENT_LENGTH, commentTransport } from "../api/comment"
import type { CommentContentType, CommentsTransport } from "../api/comment"
import { toApiError } from "../utils/errors"

export type CommentListStatus = "idle" | "loading" | "ready" | "error"

export interface CommentsState {
  status: CommentListStatus
  /** 列表类错误（中文）；分页失败时 status 保持 ready、error 置值（banner 保留列表） */
  error: string | null
  /** 操作类错误：发表/删除/楼层失败 */
  actionError: string | null
  comments: PixivComment[]
  /** next_url 镜像 */
  hasMore: boolean
  posting: boolean
  deletingId: number | null
  expandedIds: number[]
  /** 楼层缓存（收起不清除） */
  replies: Record<number, PixivComment[]>
  loadingRepliesId: number | null
}

export interface CommentController {
  readonly state: CommentsState
  open(): Promise<void>
  loadMore(): Promise<void>
  toggleReplies(commentId: number): Promise<void>
  post(text: string, parentId?: number): Promise<boolean>
  remove(commentId: number): Promise<void>
  dispose(): void
}

export function useComments(config: {
  type: CommentContentType
  targetId: number
  /** 缺省 = commentTransport（真实 api/comment.ts） */
  transport?: CommentsTransport
}): CommentController {
  const transport = config.transport ?? commentTransport

  // ── 响应式状态（全部 ref） ──
  const statusRef = ref<CommentListStatus>("idle")
  const errorRef = ref<string | null>(null)
  const actionErrorRef = ref<string | null>(null)
  const commentsRef = ref<PixivComment[]>([])
  const nextUrlRef = ref<string | null>(null) // hasMore 的镜像来源
  const postingRef = ref(false)
  const deletingIdRef = ref<number | null>(null)
  const expandedIdsRef = ref<number[]>([])
  const repliesRef = ref<Record<number, PixivComment[]>>({})
  const loadingRepliesIdRef = ref<number | null>(null)

  // ── 内部控制（非响应式） ──
  let ac = new AbortController() // 单一 AbortController，open() 轮换；dispose() abort 全部在途
  let disposed = false
  let loadingMore = false // loadMore 重入门控（state 无该字段，内部自持）

  /** 错误归一为中文文案：优先透传 ApiError.message（client.classifyError 已产中文） */
  function toErrorText(e: unknown, fallback: string): string {
    return toApiError(e, fallback).message
  }

  /** 加载根评论的公共路径（open 与 post 成功后复用） */
  async function refresh(): Promise<void> {
    try {
      const res = await transport.loadRootComments(config.type, config.targetId, ac.signal)
      if (disposed || ac.signal.aborted) return
      commentsRef.value = res.comments
      nextUrlRef.value = res.next_url
      statusRef.value = "ready"
    } catch (e) {
      if (disposed || ac.signal.aborted) return
      if (statusRef.value === "loading") {
        // 首次加载失败 → 整列表 error
        statusRef.value = "error"
      }
      // post 后刷新失败 → status 保持 ready/error，仅置 error（banner 保留列表）
      errorRef.value = toErrorText(e, "加载评论失败，请重试")
    }
  }

  /** 打开/重新加载评论列表 */
  async function open(): Promise<void> {
    if (disposed) return
    // I1：进行中 no-op（重入安全）
    if (statusRef.value === "loading") return
    // I2：轮换 AbortController，abort 在途 loadMore/楼层请求
    ac.abort()
    ac = new AbortController()
    statusRef.value = "loading"
    errorRef.value = null
    await refresh()
  }

  /** 分页加载更多 */
  async function loadMore(): Promise<void> {
    if (disposed) return
    // I1：仅 status==='ready' && hasMore 时生效（nextUrlRef 非空）
    if (statusRef.value !== "ready" || !nextUrlRef.value || loadingMore) return
    loadingMore = true
    const url = nextUrlRef.value
    const signal = ac.signal
    try {
      const res = await transport.loadRootCommentsNext(url, signal)
      if (disposed || signal.aborted) return
      commentsRef.value = [...commentsRef.value, ...res.comments]
      nextUrlRef.value = res.next_url
    } catch (e) {
      // I1：分页失败 → status 保持 ready，error 置值（banner 保留列表）
      if (!disposed && !signal.aborted) {
        errorRef.value = toErrorText(e, "加载更多失败")
      }
    } finally {
      loadingMore = false
    }
  }

  /** 展开/收起楼层；展开首次拉取并缓存，收起仅移除展开标记 */
  async function toggleReplies(commentId: number): Promise<void> {
    if (disposed) return
    if (expandedIdsRef.value.includes(commentId)) {
      // I5：收起 → expandedIds 移除，楼层缓存保留
      expandedIdsRef.value = expandedIdsRef.value.filter((id) => id !== commentId)
      return
    }
    // I1：拉取中重入 no-op
    if (loadingRepliesIdRef.value === commentId) return
    // I5：已缓存 → 直接展开，不重复拉取
    if (repliesRef.value[commentId]) {
      expandedIdsRef.value = [...expandedIdsRef.value, commentId]
      return
    }
    loadingRepliesIdRef.value = commentId
    const signal = ac.signal
    try {
      const res = await transport.loadReplies(config.type, commentId, signal)
      if (disposed || signal.aborted) return
      repliesRef.value = { ...repliesRef.value, [commentId]: res.comments }
      expandedIdsRef.value = [...expandedIdsRef.value, commentId]
    } catch (e) {
      // 楼层失败 → actionError（操作类错误）
      if (!disposed && !signal.aborted) {
        actionErrorRef.value = toErrorText(e, "楼层加载失败")
      }
    } finally {
      if (loadingRepliesIdRef.value === commentId) {
        loadingRepliesIdRef.value = null
      }
    }
  }

  /** 发表/回复评论；成功返回 true 并重拉根列表 */
  async function post(text: string, parentId?: number): Promise<boolean> {
    if (disposed) return false
    if (text.trim().length === 0 || text.length > MAX_COMMENT_LENGTH) {
      actionErrorRef.value = "评论内容不能为空或超过 2000 字"
      return false
    }
    postingRef.value = true
    actionErrorRef.value = null
    try {
      await transport.postComment(config.type, config.targetId, text, parentId)
    } catch (e) {
      postingRef.value = false
      if (!disposed) {
        // I3：失败 → false + actionError
        actionErrorRef.value = toErrorText(e, "发送失败，请重试")
      }
      return false
    }
    postingRef.value = false
    if (disposed) return false
    // I3：成功 → 复用 open 的加载路径重拉根评论
    await refresh()
    return true
  }

  /** 删除评论；成功本地移除 + 清楼层缓存 */
  async function remove(commentId: number): Promise<void> {
    if (disposed) return
    deletingIdRef.value = commentId
    try {
      await transport.deleteComment(config.type, commentId)
    } catch (e) {
      deletingIdRef.value = null
      // I4：失败仅置 actionError
      if (!disposed) {
        actionErrorRef.value = toErrorText(e, "删除失败，请重试")
      }
      return
    }
    deletingIdRef.value = null
    if (disposed) return
    // I4：本地移除 + 删除楼层缓存（连同展开标记一并清理）
    commentsRef.value = commentsRef.value.filter((c) => c.id !== commentId)
    const nextReplies = { ...repliesRef.value }
    delete nextReplies[commentId]
    repliesRef.value = nextReplies
    expandedIdsRef.value = expandedIdsRef.value.filter((id) => id !== commentId)
  }

  /** 释放：abort 全部在途请求；此后所有方法调用安全 no-op */
  function dispose(): void {
    if (disposed) return
    disposed = true
    ac.abort()
  }

  // I7：state 只读（computed 聚合 + getter，无 setter）；controller 是唯一写者
  const stateComputed = computed<CommentsState>(() => ({
    status: statusRef.value,
    error: errorRef.value,
    actionError: actionErrorRef.value,
    comments: commentsRef.value,
    hasMore: nextUrlRef.value != null,
    posting: postingRef.value,
    deletingId: deletingIdRef.value,
    expandedIds: expandedIdsRef.value,
    replies: repliesRef.value,
    loadingRepliesId: loadingRepliesIdRef.value,
  }))

  return {
    get state(): CommentsState {
      return stateComputed.value
    },
    open,
    loadMore,
    toggleReplies,
    post,
    remove,
    dispose,
  }
}
