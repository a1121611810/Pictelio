// ─── api/novel 系列章节加载契约测试（spec app-lynx-novel-intro-action-row §3.2 / §7.1）───
//
// 测试硬约束：
// 1. IO 边界双路径（成功 + 失败）—— loadNovelSeriesChapters / loadNovelSeriesChaptersNext 各覆盖
// 2. 真实样例 mock —— 字段名取自 types.ts 注释中引用的 Pixiv-Shaft Models.kt NovelSeriesDetail
//    与 PixivNovel；envelope 对齐 webview `packages/app/src/api/novel.ts:120-132`
// 3. 期望值可追溯 —— 断言路径/参数/响应形状逐字对照 webview `loadSeries:138-141` / `loadSeriesNext:145-147`
// 4. mock 风格跟随 notification.test.ts（vi.hoisted + vi.mock("./client")）

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { SeriesId } from "./id"
import type { NovelSeriesDetailResponse, PixivNovel } from "./types"

const getMock = vi.hoisted(() => vi.fn())

vi.mock("./client", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}))

const { loadNovelSeriesChapters, loadNovelSeriesChaptersNext } = await import("./novel")

// ─── 真实形状 mock（字段名逐字对齐 Pixiv-Shaft Models.kt NovelSeriesDetail + PixivNovel）───
// 仅取核心字段满足类型 narrowing；保留全部 spec 强制覆盖字段（id/title/content_count/is_concluded/
// watchlist_added + novels + next_url）。
function makeChapter(overrides: Partial<PixivNovel> = {}): PixivNovel {
  return {
    id: 1111111 as PixivNovel["id"],
    title: "第一章",
    user: {
      id: 2222222 as PixivNovel["user"]["id"],
      name: "作者名",
      account: "author_account",
      profile_image_urls: {},
    },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 5000,
    series: { id: 3333333 as SeriesId, title: "测试系列" },
    is_bookmarked: false,
    total_bookmarks: 0,
    x_restrict: 0,
    create_date: "2026-09-26T10:00:00+09:00",
    ...overrides,
  }
}

function makeResponse(overrides: Partial<NovelSeriesDetailResponse> = {}): NovelSeriesDetailResponse {
  return {
    novel_series_detail: {
      id: 3333333 as SeriesId,
      title: "测试系列",
      content_count: 3,
      is_concluded: false,
      watchlist_added: true,
    },
    novels: [makeChapter()],
    next_url: "https://app-api.pixiv.net/v2/novel/series?series_id=3333333&last_order=1",
    ...overrides,
  }
}

describe("api/novel loadNovelSeriesChapters（GET /v2/novel/series，带可选 last_order）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("成功（首屏）：不带 last_order，参数仅含 series_id 字符串化", async () => {
    const fixture = makeResponse()
    getMock.mockResolvedValue(fixture)
    const result = await loadNovelSeriesChapters(3333333 as SeriesId)
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith(
      "/v2/novel/series",
      { series_id: "3333333" },
      undefined,
    )
    expect(result).toEqual(fixture)
    // type narrowing：envelope 三个字段均可读
    expect(result.novels).toHaveLength(1)
    expect(result.next_url).toBe(
      "https://app-api.pixiv.net/v2/novel/series?series_id=3333333&last_order=1",
    )
    // 既有契约不破：NovelIntro.vue:76 读 novel_series_detail.watchlist_added
    expect(result.novel_series_detail.watchlist_added).toBe(true)
  })

  it("成功（增量追加）：lastOrder 字符串化进 query，对齐 webview loadSeries:139-141", async () => {
    const fixture = makeResponse({
      novel_series_detail: {
        id: 3333333 as SeriesId,
        title: "测试系列",
        content_count: 3,
        is_concluded: false,
        watchlist_added: true,
      },
      novels: [makeChapter({ id: 1111112 as PixivNovel["id"], title: "第二章" })],
      next_url: null,
    })
    getMock.mockResolvedValue(fixture)
    const result = await loadNovelSeriesChapters(3333333 as SeriesId, 1)
    expect(getMock).toHaveBeenCalledWith(
      "/v2/novel/series",
      { series_id: "3333333", last_order: "1" },
      undefined,
    )
    expect(result.novels[0]!.title).toBe("第二章")
    expect(result.next_url).toBeNull()
  })

  it("成功（signal 透传）：AbortSignal 第三个参数原样下传", async () => {
    getMock.mockResolvedValue(makeResponse())
    const ctrl = new AbortController()
    await loadNovelSeriesChapters(3333333 as SeriesId, undefined, ctrl.signal)
    expect(getMock).toHaveBeenCalledWith(
      "/v2/novel/series",
      { series_id: "3333333" },
      ctrl.signal,
    )
  })
})

describe("api/novel loadNovelSeriesChaptersNext（next_url 透传翻页）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("成功：next_url 原样下传（含 query 游标），对齐 webview loadSeriesNext:145-147", async () => {
    const nextUrl =
      "https://app-api.pixiv.net/v2/novel/series?series_id=3333333&last_order=1"
    const fixture = makeResponse({
      next_url: "https://app-api.pixiv.net/v2/novel/series?series_id=3333333&last_order=2",
    })
    getMock.mockResolvedValue(fixture)
    const result = await loadNovelSeriesChaptersNext(nextUrl)
    expect(getMock).toHaveBeenCalledWith(nextUrl, undefined, undefined)
    expect(result).toEqual(fixture)
  })

  it("成功（signal 透传）", async () => {
    getMock.mockResolvedValue(makeResponse())
    const ctrl = new AbortController()
    await loadNovelSeriesChaptersNext(
      "https://app-api.pixiv.net/v2/novel/series?series_id=3333333",
      ctrl.signal,
    )
    expect(getMock).toHaveBeenCalledWith(
      "https://app-api.pixiv.net/v2/novel/series?series_id=3333333",
      undefined,
      ctrl.signal,
    )
  })
})

describe("api/novel 系列章节加载 IO 边界（失败路径）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("失败（HTTP 5xx）：ApiError 原样上抛，不静默吞错", async () => {
    const apiError = { type: "SERVER", message: "服务器错误 (HTTP 500)", status: 500 }
    getMock.mockRejectedValue(apiError)
    await expect(loadNovelSeriesChapters(3333333 as SeriesId)).rejects.toEqual(apiError)
  })

  it("失败（HTTP 401 过期）：ApiError UNAUTHORIZED 上抛（消费方负责 token 刷新）", async () => {
    const apiError = { type: "UNAUTHORIZED", message: "未授权", status: 401 }
    getMock.mockRejectedValue(apiError)
    await expect(
      loadNovelSeriesChaptersNext("https://app-api.pixiv.net/v2/novel/series?series_id=3333333"),
    ).rejects.toEqual(apiError)
  })
})