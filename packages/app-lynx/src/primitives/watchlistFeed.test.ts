// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US7（追更列表分页 +
// 错误槽分流）；mergeWatchlistPage 去重键 = 系列 id（spec §3：响应顶层 series
// 装的是系列，id 是系列 id）。mock 字段对齐 Pixiv-Shaft Models.kt WatchlistSeries。
import { describe, it, expect, vi, beforeEach } from "vitest"
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

  it("竞态代：在飞 refresh 被后到调用作废，慢响应落地不生效", async () => {
    let resolveSlow!: (v: WatchlistNovelListResponse) => void
    const slow = new Promise<WatchlistNovelListResponse>((res) => (resolveSlow = res))
    const fetchFirst = vi
      .fn()
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce(page([9], null))
    const feed = createWatchlistFeed({ fetchFirst, fetchNext: vi.fn() })
    const p1 = feed.refresh()
    await feed.refresh() // 在飞锁吞掉，但竞态代递增 → p1 响应作废
    resolveSlow(page([1], null))
    await p1
    expect(feed.items()).toEqual([])
    await feed.refresh() // 第三次 refresh 正常拉取
    expect(feed.items().map((s) => s.id)).toEqual([9])
  })
})
