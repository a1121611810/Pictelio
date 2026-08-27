// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US7（追更列表分页 +
// 错误槽分流）；mergeWatchlistPage 去重键 = 系列 id（spec §3：响应顶层 series
// 装的是系列，id 是系列 id）。mock 字段对齐 Pixiv-Shaft Models.kt WatchlistSeries。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mergeWatchlistPage, createWatchlistFeed } from "./watchlistFeed"
import type { WatchlistNovelListResponse, WatchlistSeries } from "../api/types"

function makeSeries(id: number): WatchlistSeries {
  return {
    id,
    title: `系列${id}`,
    url: null,
    mask_text: null,
    published_content_count: id,
    latest_content_id: id * 100,
    latest_content_date: "2026-08-10T12:34:56+09:00",
    user: { id: 1, name: "作者", account: "a", profile_image_urls: {} },
  } as WatchlistSeries
}

function page(ids: number[], nextUrl: string | null = null): WatchlistNovelListResponse {
  return { series: ids.map(makeSeries), next_url: nextUrl }
}

describe("mergeWatchlistPage", () => {
  it("追加新页保持既有顺序", () => {
    const merged = mergeWatchlistPage([makeSeries(1), makeSeries(2)], page([3, 4]))
    expect(merged.map((s) => s.id)).toEqual([1, 2, 3, 4])
  })

  it("跨页重复条目按系列 id 去重（服务端不保证跨页零重复）", () => {
    const merged = mergeWatchlistPage([makeSeries(1), makeSeries(2)], page([2, 3]))
    expect(merged.map((s) => s.id)).toEqual([1, 2, 3])
  })
})

describe("createWatchlistFeed", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("refresh 成功：填充条目 + nextUrl", async () => {
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockResolvedValue(page([1, 2], "/next")),
      fetchNext: vi.fn(),
    })
    await feed.refresh()
    expect(feed.items().map((s) => s.id)).toEqual([1, 2])
    expect(feed.nextUrl()).toBe("/next")
    expect(feed.error()).toBeNull()
  })

  it("refresh 失败：error 槽置文案 + warn 带模块前缀，不静默", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockRejectedValue(new Error("boom")),
      fetchNext: vi.fn(),
    })
    await feed.refresh()
    expect(feed.error()).toBeTruthy()
    expect(feed.items()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[watchlistFeed]"), expect.anything())
  })

  it("fetchMore 成功：合并下一页 + 更新 nextUrl", async () => {
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockResolvedValue(page([1], "/p2")),
      fetchNext: vi.fn().mockResolvedValue(page([2], null)),
    })
    await feed.refresh()
    await feed.fetchMore()
    expect(feed.items().map((s) => s.id)).toEqual([1, 2])
    expect(feed.nextUrl()).toBeNull()
  })

  it("fetchMore 失败：pageError 槽置文案 + 已加载内容保留 + nextUrl 保留供重试", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchNext = vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(page([2], null))
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockResolvedValue(page([1], "/p2")),
      fetchNext,
    })
    await feed.refresh()
    await feed.fetchMore()
    expect(feed.pageError()).toBeTruthy()
    expect(feed.items().map((s) => s.id)).toEqual([1])
    expect(feed.nextUrl()).toBe("/p2")
    // 滚动重试成功
    await feed.fetchMore()
    expect(feed.items().map((s) => s.id)).toEqual([1, 2])
    expect(feed.pageError()).toBeNull()
  })

  it("nextUrl 为 null 或翻页在飞时 fetchMore 直接返回（在飞锁）", async () => {
    const fetchNext = vi.fn().mockResolvedValue(page([2], null))
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockResolvedValue(page([1], null)),
      fetchNext,
    })
    await feed.refresh()
    await feed.fetchMore()
    expect(fetchNext).not.toHaveBeenCalled()
  })

  it("在飞锁：重复 refresh 被吞且不作废在飞响应（review P1-1 回归），在飞结果正常落地", async () => {
    // oracle：review P1-1 正确行为定义——在飞响应相对页面状态不是陈旧的，
    // 被吞的重复调用不得递增竞态代，否则在飞响应落地被丢弃 → 假空态
    let resolveSlow!: (v: WatchlistNovelListResponse) => void
    const slow = new Promise<WatchlistNovelListResponse>((res) => (resolveSlow = res))
    const fetchFirst = vi
      .fn()
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce(page([9], null))
    const feed = createWatchlistFeed({ fetchFirst, fetchNext: vi.fn() })
    const p1 = feed.refresh()
    await feed.refresh() // 在飞锁吞掉：不递增代、不发新请求
    expect(fetchFirst).toHaveBeenCalledTimes(1)
    resolveSlow(page([1], null))
    await p1
    expect(feed.items().map((s) => s.id)).toEqual([1])
    expect(feed.loading()).toBe(false)
    await feed.refresh() // 后续 refresh 正常拉取
    expect(feed.items().map((s) => s.id)).toEqual([9])
  })

  it("removeItem：取消追更后本地移除，fetchMore 后 sync 不复活已删条目（review P1-2 回归）", async () => {
    // oracle：spec §US7 取消追更语义——取消成功的系列不得再出现在列表
    const fetchFirst = vi.fn().mockResolvedValue(page([1, 2], "https://next"))
    const fetchNext = vi.fn().mockResolvedValue(page([3], null))
    const feed = createWatchlistFeed({ fetchFirst, fetchNext })
    await feed.refresh()
    feed.removeItem(2)
    expect(feed.items().map((s) => s.id)).toEqual([1])
    await feed.fetchMore()
    expect(feed.items().map((s) => s.id)).toEqual([1, 3])
  })

  it("T1 重试：在飞锁吞掉的单发事件 → 窗口后自动补发一次并调用 onUpdate（不永久卡死）", async () => {
    // oracle：spec app-lynx-feed-pagination-and-watchlist-prompt-fix §4 T1——原生
    // scrolltolower 低频单发，落在在飞窗口被吞且无重试 = 永久卡死；需自动补发。
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    let resolveNext!: (v: WatchlistNovelListResponse) => void
    const fetchNext = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<WatchlistNovelListResponse>((resolve) => (resolveNext = resolve)),
      )
      .mockResolvedValueOnce(page([3], null))
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockResolvedValue(page([1], "/next")),
      fetchNext,
      onUpdate,
    })
    await feed.refresh()

    // 第一次 fetchMore 在飞（fetchNext 挂起）；第二次落在在飞窗口被吞 → 挂起补触发
    void feed.fetchMore()
    feed.fetchMore()
    expect(fetchNext).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalled()

    // 完成在飞：items=[1,2]
    resolveNext(page([2], "/next"))
    await Promise.resolve()
    expect(feed.items().map((s) => s.id)).toEqual([1, 2])

    // 补触发窗口（800ms）结束 → 自动再翻一页 + 通知页面重新快照（P1）
    await vi.advanceTimersByTimeAsync(800)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchNext).toHaveBeenCalledTimes(2)
    expect(feed.items().map((s) => s.id)).toEqual([1, 2, 3])
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it("T1 重试：dispose 清除挂起的补触发，不产生孤儿翻页", async () => {
    // oracle：spec app-lynx-feed-pagination-and-watchlist-prompt-fix §4 T1 dispose——
    // 页面卸载后挂起的补触发不得继续发请求。
    vi.useFakeTimers()
    // 首个 fetchMore 挂起（在飞中），后续调用直接计次（不应发生）
    const fetchNext = vi
      .fn()
      .mockImplementationOnce(() => new Promise<WatchlistNovelListResponse>(() => undefined))
    const feed = createWatchlistFeed({
      fetchFirst: vi.fn().mockResolvedValue(page([1], "/next")),
      fetchNext,
    })
    await feed.refresh()

    // 在飞吞 → 挂起补触发（800ms）
    void feed.fetchMore()
    feed.fetchMore()
    expect(vi.getTimerCount()).toBe(1)

    // dispose：定时器被清，无残留
    feed.dispose()
    expect(vi.getTimerCount()).toBe(0)

    // 推进超过窗口：无孤儿请求
    await vi.advanceTimersByTimeAsync(2000)
    await Promise.resolve()
    expect(fetchNext).toHaveBeenCalledTimes(1)
  })

  it("T1 重试：refresh 清除挂起的补触发，不幽灵翻页", async () => {
    // oracle：spec app-lynx-feed-pagination-and-watchlist-prompt-fix §4 T1 refresh——
    // 重建会话后旧补触发不得用旧会话继续翻页。
    vi.useFakeTimers()
    // 首个 fetchMore 挂起（在飞中）；refresh 后的 fetchMore 不应再发生
    const fetchNext = vi
      .fn()
      .mockImplementationOnce(() => new Promise<WatchlistNovelListResponse>(() => undefined))
    const feed = createWatchlistFeed({
      fetchFirst: vi
        .fn()
        .mockResolvedValueOnce(page([1], "/next"))
        .mockResolvedValueOnce(page([9], null)),
      fetchNext,
    })
    await feed.refresh()

    // 在飞吞 → 挂起补触发（800ms）
    void feed.fetchMore()
    feed.fetchMore()
    expect(vi.getTimerCount()).toBe(1)

    // refresh 重建会话 → 挂起补触发被清（用新会话第一页替换）
    await feed.refresh()
    expect(vi.getTimerCount()).toBe(0)
    expect(feed.items().map((s) => s.id)).toEqual([9])

    // 推进超过原窗口：无幽灵翻页
    await vi.advanceTimersByTimeAsync(2000)
    await Promise.resolve()
    expect(fetchNext).toHaveBeenCalledTimes(1)
  })
})
