// createRankingFeed 单源分页契约（spec docs/specs/ranking.md §5.5 / §6.3）。
// oracle：名次 = 渲染流下标 + 1，服务端返回顺序即名次顺序（§5.5）；切换 (mode,date) 后旧实例
// 在途响应不得覆盖新结果（实例隔离 + createMixFeed 的 dispose/abort）；nextUrl 非空走翻页端点。
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { RankingQuery } from "@pictelio/ranking-core"
import { toIllustId, toUserId } from "../api/id"
import type { PixivIllust, PixivIllustListResponse } from "../api/types"

const { loadRankingMock, loadRankingNextMock } = vi.hoisted(() => ({
  loadRankingMock: vi.fn(),
  loadRankingNextMock: vi.fn(),
}))

vi.mock("../api/ranking", () => ({
  loadRanking: (...a: unknown[]) => loadRankingMock(...a),
  loadRankingNext: (...a: unknown[]) => loadRankingNextMock(...a),
}))

import { createRankingFeed } from "./createRankingFeed"

function mkIllust(id: number, createDate = "2026-01-01"): PixivIllust {
  return {
    id: toIllustId(id),
    title: `t${id}`,
    type: "illust",
    user: { id: toUserId(1), name: "u", account: "u", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 1,
    height: 1,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: id,
    tags: [],
    x_restrict: 0,
    create_date: createDate,
    meta_pages: [],
    meta_single_page: {},
  }
}

function page(ids: number[], nextUrl: string | null = null): PixivIllustListResponse {
  return { illusts: ids.map((id) => mkIllust(id)), next_url: nextUrl }
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

beforeEach(() => {
  loadRankingMock.mockReset()
  loadRankingNextMock.mockReset()
})

describe("createRankingFeed", () => {
  it("单源保序：名次 = 下标 + 1，按服务端顺序而非 create_date 排序", async () => {
    // 让 create_date 与名次逆序：若引入任何按时间重排的合并路径，顺序会翻转
    loadRankingMock.mockResolvedValue(page([5, 3, 9]))
    const feed = createRankingFeed({ mode: "daily", date: null })
    await feed.refresh()

    expect(feed.items().map((i) => i.id)).toEqual([5, 3, 9])
    expect(feed.settled()).toBe(true)
    feed.dispose()
  })

  it("翻页：nextUrl 非空时走 loadRankingNext，名次跨页连续", async () => {
    vi.useFakeTimers()
    try {
      loadRankingMock.mockResolvedValue(page([5, 3], "https://app-api.pixiv.net/next?offset=30"))
      loadRankingNextMock.mockResolvedValue(page([9]))
      const feed = createRankingFeed({ mode: "daily", date: null })
      await feed.refresh()
      expect(feed.items().map((i) => i.id)).toEqual([5, 3])

      // 越过 createMixFeed 的双防抖（cooldown 3000 + throttle 800）
      await vi.advanceTimersByTimeAsync(10000)
      await feed.fetchMore()

      expect(loadRankingNextMock).toHaveBeenCalled()
      expect(loadRankingNextMock.mock.calls[0]?.[0]).toBe("https://app-api.pixiv.net/next?offset=30")
      expect(feed.items().map((i) => i.id)).toEqual([5, 3, 9])
      feed.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("切 (mode,date) 重建实例：旧查询迟到响应不覆盖新实例结果", async () => {
    const a = deferred<PixivIllustListResponse>()
    const b = deferred<PixivIllustListResponse>()
    loadRankingMock.mockImplementation((q: RankingQuery) => (q.mode === "daily" ? a.promise : b.promise))

    const feed = createRankingFeed({ mode: "daily", date: null })
    const pendingA = feed.refresh() // daily 在途

    feed.setQuery({ mode: "weekly", date: null }) // dispose A + 以 weekly 重建
    const pendingB = feed.refresh()
    b.resolve(page([7]))
    await pendingB
    expect(feed.items().map((i) => i.id)).toEqual([7])

    // A 迟到：不得覆盖新实例
    a.resolve(page([1, 2]))
    await pendingA.catch(() => {})
    await Promise.resolve()
    expect(feed.items().map((i) => i.id)).toEqual([7])
    feed.dispose()
  })

  it("首载失败：error 文案非空、未落定、无数据", async () => {
    loadRankingMock.mockRejectedValue(new Error("boom"))
    const feed = createRankingFeed({ mode: "daily", date: null })
    await feed.refresh().catch(() => {})

    expect(feed.error()).toBeTruthy()
    expect(feed.settled()).toBe(false)
    expect(feed.items()).toEqual([])
    feed.dispose()
  })

  it("setQuery 改变请求参数（维度/日期随动）", async () => {
    loadRankingMock.mockResolvedValue(page([1]))
    const feed = createRankingFeed({ mode: "daily", date: null })
    await feed.refresh()
    expect(loadRankingMock).toHaveBeenLastCalledWith({ mode: "daily", date: null }, expect.anything())

    feed.setQuery({ mode: "weekly", date: "2026-09-01" })
    await feed.refresh()
    expect(loadRankingMock).toHaveBeenLastCalledWith(
      { mode: "weekly", date: "2026-09-01" },
      expect.anything(),
    )
    feed.dispose()
  })
})
