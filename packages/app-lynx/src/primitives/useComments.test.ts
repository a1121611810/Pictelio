// ─── useComments 评论状态机单测（issue #162） ───
// fake transport：内存实现 CommentsTransport（方法均为 vi.fn，可记录 calls/参数断言），
// 需要手动控制时序的用例用 deferred promise + AbortSignal 监听模拟 abort。
import { describe, expect, it, vi } from "vitest"
import { useComments } from "./useComments"
import { ApiErrorType } from "../api/types"
import type {
  PixivComment,
  PixivCommentReplyResponse,
  PixivCommentRootResponse,
} from "../api/types"
import type { CommentContentType, CommentsTransport } from "../api/comment"

function makeComment(id: number, text = `评论${id}`): PixivComment {
  return {
    id,
    comment: text,
    date: "2024-01-01T00:00:00+09:00",
    user: { id: id * 10, name: "作者", account: "author" },
    has_replies: false,
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 返回一个「signal abort 时 reject」的 pending promise（模拟 fetch abort） */
function abortAwarePending<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("aborted")))
  })
}

function createTransport(overrides: Partial<CommentsTransport> = {}): CommentsTransport {
  return {
    loadRootComments: vi.fn(async () => ({ comments: [], next_url: null })),
    loadRootCommentsNext: vi.fn(async () => ({ comments: [], next_url: null })),
    loadReplies: vi.fn(async () => ({ comments: [], next_url: null })),
    postComment: vi.fn(async () => {}),
    deleteComment: vi.fn(async () => {}),
    ...overrides,
  }
}

/** 模拟 classifyError 已产出的中文 ApiError（I6 透传 message） */
const netErr = { type: ApiErrorType.NETWORK, message: "网络不可用，请检查连接" }

describe("useComments", () => {
  it("初始态：status idle、comments 空、hasMore false", () => {
    const c = useComments({ type: "illust", targetId: 1, transport: createTransport() })
    expect(c.state.status).toBe("idle")
    expect(c.state.comments).toEqual([])
    expect(c.state.hasMore).toBe(false)
    expect(c.state.error).toBeNull()
    expect(c.state.actionError).toBeNull()
    expect(c.state.posting).toBe(false)
    expect(c.state.deletingId).toBeNull()
    expect(c.state.expandedIds).toEqual([])
    expect(c.state.replies).toEqual({})
    expect(c.state.loadingRepliesId).toBeNull()
  })

  it("open() 成功 → status ready、comments 填充、hasMore 跟随 next_url", async () => {
    const transport = createTransport({
      loadRootComments: vi.fn(async () => ({
        comments: [makeComment(1), makeComment(2)],
        next_url: "https://app-api.pixiv.net/v3/illust/comments?next=1",
      })),
    })
    const c = useComments({ type: "illust", targetId: 42, transport })
    await c.open()
    expect(c.state.status).toBe("ready")
    expect(c.state.comments.map((x) => x.id)).toEqual([1, 2])
    expect(c.state.hasMore).toBe(true)
    expect(transport.loadRootComments).toHaveBeenCalledWith("illust", 42, expect.any(AbortSignal))
  })

  it("open() 失败 → status error、error 为中文文案（I6 透传）", async () => {
    const transport = createTransport({
      loadRootComments: vi.fn(async () => {
        throw netErr
      }),
    })
    const c = useComments({ type: "illust", targetId: 1, transport })
    await c.open()
    expect(c.state.status).toBe("error")
    expect(c.state.error).toContain("网络不可用")
  })

  it("open() 重入安全（进行中 no-op，只发一次请求）", async () => {
    const d = deferred<PixivCommentRootResponse>()
    const transport = createTransport({
      loadRootComments: vi.fn(() => d.promise),
    })
    const c = useComments({ type: "illust", targetId: 1, transport })
    const p1 = c.open()
    const p2 = c.open() // 进行中 → no-op
    d.resolve({ comments: [makeComment(1)], next_url: null })
    await p1
    await p2
    expect(transport.loadRootComments).toHaveBeenCalledTimes(1)
  })

  describe("分页", () => {
    it("loadMore 追加（next_url 存在时）并更新 hasMore", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: "u1" })),
        loadRootCommentsNext: vi.fn(async () => ({ comments: [makeComment(2)], next_url: null })),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.loadMore()
      expect(c.state.comments.map((x) => x.id)).toEqual([1, 2])
      expect(c.state.hasMore).toBe(false)
      expect(transport.loadRootCommentsNext).toHaveBeenCalledWith("u1", expect.any(AbortSignal))
    })

    it("hasMore false 时 loadMore no-op（不发请求）", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.loadMore()
      expect(transport.loadRootCommentsNext).not.toHaveBeenCalled()
    })

    it("分页失败 → status 保持 ready、error 置值（列表保留）", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: "u1" })),
        loadRootCommentsNext: vi.fn(async () => {
          throw netErr
        }),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.loadMore()
      expect(c.state.status).toBe("ready")
      expect(c.state.error).toContain("网络不可用")
      expect(c.state.comments.map((x) => x.id)).toEqual([1])
    })
  })

  describe("发表", () => {
    it("post 成功 → 返回 true、重拉根列表（loadRootComments 第二次）、posting 流转", async () => {
      const d = deferred<void>()
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
        postComment: vi.fn(() => d.promise),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      const p = c.post("新评论")
      expect(c.state.posting).toBe(true) // 提交期间 posting=true
      d.resolve()
      const ok = await p
      expect(ok).toBe(true)
      expect(c.state.posting).toBe(false)
      expect(transport.postComment).toHaveBeenCalledWith("illust", 1, "新评论", undefined)
      expect(transport.loadRootComments).toHaveBeenCalledTimes(2) // open + post 后重拉
    })

    it("post 空/纯空白/超长文本 → false（module 层拦截，不发请求）", async () => {
      const transport = createTransport()
      const c = useComments({ type: "illust", targetId: 1, transport })
      expect(await c.post("")).toBe(false)
      expect(await c.post("   ")).toBe(false)
      expect(await c.post("a".repeat(2001))).toBe(false)
      expect(transport.postComment).not.toHaveBeenCalled()
      expect(c.state.actionError).toContain("2000")
    })

    it("post transport 层拒绝 → false + actionError（中文）", async () => {
      const transport = createTransport({
        postComment: vi.fn(async () => {
          throw { type: ApiErrorType.SERVER, message: "服务器错误 (HTTP 500)" }
        }),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      const ok = await c.post("正常评论")
      expect(ok).toBe(false)
      expect(c.state.actionError).toContain("服务器错误")
      expect(c.state.posting).toBe(false)
    })
  })

  describe("删除", () => {
    it("remove 成功 → 本地移除 + 清楼层缓存（连同展开标记）", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({
          comments: [makeComment(1, "一楼"), makeComment(2, "二楼")],
          next_url: null,
        })),
        loadReplies: vi.fn(async () => ({ comments: [makeComment(11, "回复")], next_url: null })),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.toggleReplies(1) // 展开并缓存楼层
      expect(c.state.replies[1]).toHaveLength(1)
      await c.remove(1)
      expect(transport.deleteComment).toHaveBeenCalledWith("illust", 1)
      expect(c.state.comments.map((x) => x.id)).toEqual([2])
      expect(c.state.replies[1]).toBeUndefined() // 楼层缓存已清除
      expect(c.state.expandedIds).not.toContain(1)
    })

    it("remove 失败 → 仅置 actionError，列表与楼层不变", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
        deleteComment: vi.fn(async () => {
          throw { type: ApiErrorType.SERVER, message: "服务器错误 (HTTP 500)" }
        }),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.remove(1)
      expect(c.state.actionError).toContain("服务器错误")
      expect(c.state.comments).toHaveLength(1)
      expect(c.state.deletingId).toBeNull()
    })
  })

  describe("楼层展开/收起", () => {
    it("首次拉取缓存 + expandedIds 更新；收起保留缓存；再次展开不重拉", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
        loadReplies: vi.fn(async () => ({ comments: [makeComment(11)], next_url: null })),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.toggleReplies(1) // 展开：首次拉取
      expect(c.state.expandedIds).toEqual([1])
      expect(c.state.replies[1]!.map((x) => x.id)).toEqual([11])
      expect(transport.loadReplies).toHaveBeenCalledTimes(1)
      expect(c.state.loadingRepliesId).toBeNull()

      await c.toggleReplies(1) // 收起：expandedIds 移除，缓存保留
      expect(c.state.expandedIds).toEqual([])
      expect(c.state.replies[1]).toHaveLength(1)

      await c.toggleReplies(1) // 再次展开：命中缓存，不重新请求
      expect(c.state.expandedIds).toEqual([1])
      expect(transport.loadReplies).toHaveBeenCalledTimes(1)
    })

    it("拉取中重入 no-op（只发一次请求）", async () => {
      const d = deferred<PixivCommentReplyResponse>()
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
        loadReplies: vi.fn(() => d.promise),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      const p1 = c.toggleReplies(1)
      // 第一次调用的同步部分已设置 loadingRepliesId → 重入 no-op
      await c.toggleReplies(1)
      d.resolve({ comments: [makeComment(11)], next_url: null })
      await p1
      expect(transport.loadReplies).toHaveBeenCalledTimes(1)
      expect(c.state.expandedIds).toEqual([1])
    })

    it("楼层拉取失败 → actionError（中文）", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
        loadReplies: vi.fn(async () => {
          throw netErr
        }),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      await c.toggleReplies(1)
      expect(c.state.actionError).toContain("网络不可用")
      expect(c.state.expandedIds).toEqual([])
      expect(c.state.loadingRepliesId).toBeNull()
    })
  })

  describe("竞态与生命周期", () => {
    it("open 期间在途 loadMore 被 abort（AbortController 轮换），不污染状态", async () => {
      const transport = createTransport({
        loadRootComments: vi
          .fn()
          .mockResolvedValueOnce({ comments: [makeComment(1)], next_url: "u1" })
          .mockResolvedValue({ comments: [makeComment(99)], next_url: null }),
        loadRootCommentsNext: vi.fn(
          (_url: string, signal?: AbortSignal) => abortAwarePending<PixivCommentRootResponse>(signal),
        ),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      await c.open()
      const lm = c.loadMore()
      expect(c.state.status).toBe("ready")
      await c.open() // 轮换 ac → abort 在途 loadMore
      await lm
      // 被 abort 的 loadMore 不追加、不置 error；新 open 结果生效
      expect(transport.loadRootComments).toHaveBeenCalledTimes(2)
      expect(c.state.comments.map((x) => x.id)).toEqual([99])
      expect(c.state.error).toBeNull()
    })

    it("dispose abort 全部在途请求（此后不再写状态）", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(
          (_t: CommentContentType, _id: number, signal?: AbortSignal) =>
            abortAwarePending<PixivCommentRootResponse>(signal),
        ),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      const p = c.open()
      c.dispose()
      await p
      // dispose 后 abort → refresh 不写状态（status 停留在 loading，未变 ready/error）
      expect(c.state.status).toBe("loading")
    })

    it("dispose 后方法调用安全 no-op", async () => {
      const transport = createTransport({
        loadRootComments: vi.fn(async () => ({ comments: [makeComment(1)], next_url: null })),
      })
      const c = useComments({ type: "illust", targetId: 1, transport })
      c.dispose()
      await c.open()
      expect(c.state.status).toBe("idle")
      expect(await c.post("x")).toBe(false)
      expect(c.state.posting).toBe(false)
      await c.remove(1)
      expect(c.state.deletingId).toBeNull()
      await c.toggleReplies(1)
      expect(transport.loadRootComments).not.toHaveBeenCalled()
    })
  })

  it("type 传 novel → transport 收到 novel 参数", async () => {
    const transport = createTransport({
      loadRootComments: vi.fn(async () => ({ comments: [], next_url: null })),
    })
    const c = useComments({ type: "novel", targetId: 7, transport })
    await c.open()
    expect(transport.loadRootComments).toHaveBeenCalledWith("novel", 7, expect.any(AbortSignal))
  })
})
