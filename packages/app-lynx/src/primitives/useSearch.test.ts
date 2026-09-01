// ─── useSearch 搜索状态机单测（issue #292 / spec app-lynx-global-search D2） ───
// 范式：仿 useComments.test.ts —— fake transport（vi.fn）+ 断言 controller.state 外部行为，
// 不测内部 ref 实现；fake timers 测 debounce。
// 期望值出处（oracle 溯源）：
// - debounce 300ms / 空词立即复位 / isSearching 窗口标记 → spec D2 定案；
// - scope/sort 切换立即重搜、paginationError 语义、loadMore 双游标 → webview store/searchStore.ts；
// - mergeSearchResults 混排（date 降序 + 同日 illust 优先）→ webview utils/searchMerger.ts 逐字语义；
// - 实时响应 mock 数据结构来自真实契约：字段形状逐字对齐 lynx api/types.ts
//   （PixivIllustListResponse / PixivNovelListResponse，与 webview app api/types.ts 同源，
//   样例参照 api/search.test.ts 的 ILLUST_ITEM/NOVEL_ITEM）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { SEARCH_DEBOUNCE_MS, mergeSearchResults, useSearch } from "./useSearch"
import type { SearchTransport } from "../api/search"
import {
  ApiErrorType,
  type PixivIllust,
  type PixivIllustListResponse,
  type PixivNovel,
  type PixivNovelListResponse,
  type SearchSort,
  type SearchTarget,
} from "../api/types"

// ─── 真实契约样例（字段形状对齐 api/types.ts；仅 id/日期参数化） ───

function makeIllust(id: number, createDate: string): PixivIllust {
  return {
    id,
    title: `作品${id}`,
    type: "illust",
    user: {
      id: id * 10,
      name: "test_user",
      account: "test_user",
      profile_image_urls: {
        medium: "https://i.pximg.net/c/360x360_70/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
        px_16x16: "https://i.pximg.net/c/16x16/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
        px_50x50: "https://i.pximg.net/c/50x50/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
        px_170x170: "https://i.pximg.net/c/170x170/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
      },
    },
    image_urls: {
      square_medium: "https://i.pximg.net/c/360x360_70/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
      medium: "https://i.pximg.net/c/540x540_70/img-master/img/2026/01/01/00/00/00/1_p0_master1200.jpg",
      large: "https://i.pximg.net/c/720x720_50/img-master/img/2026/01/01/00/00/00/1_p0_master1200.jpg",
    },
    width: 1200,
    height: 1600,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 100,
    tags: [{ name: "星空", translated_name: "starry sky" }],
    x_restrict: 0,
    create_date: createDate,
    caption: `作品${id}描述`,
    meta_pages: [],
    meta_single_page: {},
  }
}

function makeNovel(id: number, createDate: string): PixivNovel {
  return {
    id,
    title: `小说${id}`,
    user: {
      id: id * 10,
      name: "test_user",
      account: "test_user",
      profile_image_urls: {
        medium: "https://i.pximg.net/c/360x360_70/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
        px_16x16: "https://i.pximg.net/c/16x16/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
        px_50x50: "https://i.pximg.net/c/50x50/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
        px_170x170: "https://i.pximg.net/c/170x170/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
      },
    },
    image_urls: {
      square_medium: "https://i.pximg.net/c/360x360_70/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg",
      medium: "https://i.pximg.net/c/540x540_70/img-master/img/2026/01/01/00/00/00/1_p0_master1200.jpg",
      large: "https://i.pximg.net/c/720x720_50/img-master/img/2026/01/01/00/00/00/1_p0_master1200.jpg",
    },
    tags: [{ name: "夜空", translated_name: "night sky" }],
    page_count: 1,
    text_length: 1000,
    is_bookmarked: false,
    total_bookmarks: 50,
    x_restrict: 0,
    create_date: createDate,
    caption: `小说${id}描述`,
  }
}

function illustResponse(items: PixivIllust[], next_url: string | null): PixivIllustListResponse {
  return { illusts: items, next_url }
}

function novelResponse(items: PixivNovel[], next_url: string | null): PixivNovelListResponse {
  return { novels: items, next_url }
}

// ─── fake transport（vi.fn 记录调用；override 控制时序） ───

function createTransport(overrides: Partial<SearchTransport> = {}): SearchTransport {
  return {
    searchIllust: vi.fn(async () => illustResponse([], null)),
    searchNovel: vi.fn(async () => novelResponse([], null)),
    searchIllustNext: vi.fn(async () => illustResponse([], null)),
    searchNovelNext: vi.fn(async () => novelResponse([], null)),
    ...overrides,
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

/** 模拟 classifyError 已产出的中文 ApiError（错误文案透传） */
const netErr = { type: ApiErrorType.NETWORK, message: "网络不可用，请检查连接" }

/**
 * 排空微任务链：async 链多跳（fetch 续体 → Promise.all 续体 → executeSearch 续体）
 * 后状态才 settle；fake timers 下逐个 await 排空（不足 10 拍，取上限保险）。
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

describe("mergeSearchResults（oracle: webview utils/searchMerger.ts 逐字语义）", () => {
  it("按 create_date 降序交叉混排（iso 字符串字典序）", () => {
    const i1 = makeIllust(1, "2026-08-10T00:00:00+09:00")
    const i2 = makeIllust(2, "2026-08-05T00:00:00+09:00")
    const n1 = makeNovel(3, "2026-08-08T00:00:00+09:00")
    const n2 = makeNovel(4, "2026-08-01T00:00:00+09:00")
    const out = mergeSearchResults([i1, i2], [n1, n2])
    expect(out.map((r) => r.entity.id)).toEqual([1, 3, 2, 4])
  })

  it("同一 create_date → illust 优先于 novel（同类型保持相对顺序）", () => {
    const stamp = "2026-08-10T00:00:00+09:00"
    const i1 = makeIllust(1, stamp)
    const i2 = makeIllust(2, stamp)
    const n1 = makeNovel(3, stamp)
    const out = mergeSearchResults([i1, i2], [n1])
    expect(out.map((r) => r.type)).toEqual(["illust", "illust", "novel"])
    // 同类型返回 0 → 保持服务端相对顺序（V8 稳定排序）
    expect(out.map((r) => r.entity.id)).toEqual([1, 2, 3])
  })

  it("空输入安全", () => {
    expect(mergeSearchResults([], [])).toEqual([])
    expect(mergeSearchResults([makeIllust(1, "2026-08-01")], [])).toHaveLength(1)
  })
})

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("初始态：idle、空结果、hasMore false、scope=all、sort=date_desc", () => {
    const c = useSearch({ transport: createTransport() })
    expect(c.state.status).toBe("idle")
    expect(c.state.results).toEqual([])
    expect(c.state.hasMore).toBe(false)
    expect(c.state.error).toBeNull()
    expect(c.state.scope).toBe("all")
    expect(c.state.sort).toBe("date_desc")
    expect(c.state.isSearching).toBe(false)
    expect(c.state.paginationError).toBe(false)
  })

  describe("debounce（即输即搜，spec D2 / 用户故事 8-9）", () => {
    it("3 次输入 150ms 间隔 → 仅 1 次请求（最后一次词）", async () => {
      const transport = createTransport()
      const c = useSearch({ transport })
      c.search("a")
      expect(c.state.isSearching).toBe(true) // debounce 窗口标记
      expect(c.state.status).toBe("idle") // 未触发前保持 idle
      await vi.advanceTimersByTimeAsync(150)
      c.search("ab")
      await vi.advanceTimersByTimeAsync(150)
      // 若未重置 timer，300ms 时请求已发出；此处仍无请求 → 防抖生效
      expect(transport.searchIllust).not.toHaveBeenCalled()
      c.search("abc")
      await vi.advanceTimersByTimeAsync(300)
      expect(transport.searchIllust).toHaveBeenCalledTimes(1)
      expect(transport.searchNovel).toHaveBeenCalledTimes(1)
      // 最后一次词 + 默认 sort + 无空格 → partial_match_for_tags（deriveSearchTarget 语义）
      expect(transport.searchIllust).toHaveBeenCalledWith(
        "abc",
        "date_desc",
        "partial_match_for_tags",
        expect.any(AbortSignal),
      )
      expect(transport.searchNovel).toHaveBeenCalledWith(
        "abc",
        "date_desc",
        "partial_match_for_tags",
        expect.any(AbortSignal),
      )
      expect(c.state.status).toBe("ready")
      expect(c.state.isSearching).toBe(false)
    })

    it("空词（含纯空白）→ 立即清空回 idle、取消待发 debounce（不请求）", async () => {
      const transport = createTransport()
      const c = useSearch({ transport })
      c.search("a") // 待发 debounce
      expect(c.state.isSearching).toBe(true)
      c.search("   ") // 空词 → 立即复位（不 debounce）
      expect(c.state.status).toBe("idle")
      expect(c.state.isSearching).toBe(false)
      expect(c.state.results).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(transport.searchIllust).not.toHaveBeenCalled()
      expect(transport.searchNovel).not.toHaveBeenCalled()
    })

    it("已 ready 后清空输入 → 立即回 idle 且结果清空", async () => {
      const transport = createTransport({
        searchNovel: vi.fn(async () => novelResponse([makeNovel(7, "2026-08-09T00:00:00+09:00")], null)),
      })
      const c = useSearch({ transport })
      c.search("星空")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("ready")
      expect(c.state.results).toHaveLength(1)
      c.search("")
      expect(c.state.status).toBe("idle")
      expect(c.state.results).toEqual([])
    })
  })

  describe("竞态与 last-write-wins（spec D2：旧请求作废、乱序不回填）", () => {
    it("新搜索触发 → 旧 AbortController 被 abort；旧响应延迟 resolve 不覆盖新结果", async () => {
      const d1 = deferred<PixivIllustListResponse>()
      const d2 = deferred<PixivIllustListResponse>()
      const searchIllustMock = vi.fn<
        (word: string, sort: SearchSort, target: SearchTarget, signal?: AbortSignal) => Promise<PixivIllustListResponse>
      >()
      searchIllustMock.mockImplementationOnce(() => d1.promise)
      searchIllustMock.mockImplementationOnce(() => d2.promise)
      // 非 abort-aware 的 fake transport（不因 abort reject）—— 测的是控制器自身防线：
      // settle 后校验 signal.aborted，模拟「旧响应延迟 resolve」仍不回填
      const transport = createTransport({ searchIllust: searchIllustMock })
      const c = useSearch({ transport })
      c.setScope("illust") // 空词 → 仅更新 scope，不触发请求
      c.search("a")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("loading")
      const firstSignal = searchIllustMock.mock.calls[0]![3]!
      c.search("ab") // 新词 → 触发新搜索
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(firstSignal.aborted).toBe(true) // 旧请求被 abort（AbortController 轮换）
      expect(searchIllustMock).toHaveBeenCalledTimes(2)

      // 旧响应（词 "a"）延迟 resolve → 不得覆盖新搜索状态（last-write-wins）
      d1.resolve(illustResponse([makeIllust(1, "2026-01-01T00:00:00+09:00")], null))
      await d1.promise
      expect(c.state.status).toBe("loading") // 未被旧响应改写为 ready
      expect(c.state.results).toEqual([])

      const secondSignal = searchIllustMock.mock.calls[1]![3]!
      expect(secondSignal.aborted).toBe(false) // 新请求持有新信号
      d2.resolve(illustResponse([makeIllust(2, "2026-01-02T00:00:00+09:00")], null))
      await d2.promise
      await settle() // 排空续体链：fetch → Promise.all → executeSearch
      expect(c.state.status).toBe("ready")
      expect(c.state.results.map((r) => r.entity.id)).toEqual([2])
    })
  })

  describe("scope=all 混排（spec D1：全部 = 时间线合并）", () => {
    it("两类并行请求 → 结果按 create_date 降序且同日 illust 优先", async () => {
      // i1: 08-10, n1: 08-08, i2: 08-05；n2 与 i1 同日 → 排序预期 i1, n2, n1, i2
      const transport = createTransport({
        searchIllust: vi.fn(async () =>
          illustResponse(
            [makeIllust(1, "2026-08-10T00:00:00+09:00"), makeIllust(2, "2026-08-05T00:00:00+09:00")],
            null,
          ),
        ),
        searchNovel: vi.fn(async () =>
          novelResponse(
            [makeNovel(3, "2026-08-08T00:00:00+09:00"), makeNovel(4, "2026-08-10T00:00:00+09:00")],
            null,
          ),
        ),
      })
      const c = useSearch({ transport })
      c.search("星空")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.results.map((r) => r.entity.id)).toEqual([1, 4, 3, 2])
      expect(c.state.results.map((r) => r.type)).toEqual(["illust", "novel", "novel", "illust"])
      expect(c.state.status).toBe("ready")
    })

    it("部分降级：仅一类失败 → warn 可见 + 成功类结果保留（非静默）", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const transport = createTransport({
        searchIllust: vi.fn(async () => {
          throw netErr
        }),
        searchNovel: vi.fn(async () => novelResponse([makeNovel(9, "2026-08-09T00:00:00+09:00")], null)),
      })
      const c = useSearch({ transport })
      c.search("星空")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("ready")
      expect(c.state.error).toBeNull() // 部分降级不置首载错误
      expect(c.state.results.map((r) => r.type)).toEqual(["novel"])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[useSearch]"), netErr)
    })
  })

  describe("scope/sort 切换（spec D2：关键词存在时立即重搜，不 debounce）", () => {
    it("setScope：空词仅更新状态；有词立即重搜（无需等待 debounce）", async () => {
      const transport = createTransport()
      const c = useSearch({ transport })
      c.setScope("illust")
      expect(c.state.scope).toBe("illust")
      expect(transport.searchIllust).not.toHaveBeenCalled() // 空词不触发请求
      c.search("花")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(transport.searchIllust).toHaveBeenCalledTimes(1)
      expect(transport.searchNovel).not.toHaveBeenCalled() // scope=illust 单类
      c.setScope("all") // 立即重搜（同步记录调用，无需 advance timers）
      expect(transport.searchIllust).toHaveBeenCalledTimes(2)
      expect(transport.searchNovel).toHaveBeenCalledTimes(1)
      expect(c.state.scope).toBe("all")
      await settle()
      expect(c.state.status).toBe("ready")
    })

    it("setSort：立即重搜并透传新排序", async () => {
      const transport = createTransport()
      const c = useSearch({ transport })
      c.search("花")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      c.setSort("popular_desc")
      expect(transport.searchIllust).toHaveBeenCalledWith(
        "花",
        "popular_desc",
        "partial_match_for_tags",
        expect.any(AbortSignal),
      )
      expect(transport.searchNovel).toHaveBeenCalledWith(
        "花",
        "popular_desc",
        "partial_match_for_tags",
        expect.any(AbortSignal),
      )
      expect(c.state.sort).toBe("popular_desc")
      await settle()
      expect(c.state.status).toBe("ready")
    })
  })

  describe("分页（loadMore：双游标 / 失败保留结果，spec 用户故事 14-15）", () => {
    it("all scope：双游标并行推进、结果追加、next_url 清 null 后 hasMore=false", async () => {
      const nextIllust = "https://app-api.pixiv.net/v1/search/illust?word=x&offset=1"
      const nextNovel = "https://app-api.pixiv.net/v1/search/novel?word=x&offset=1"
      const transport = createTransport({
        searchIllust: vi.fn(async () =>
          illustResponse([makeIllust(1, "2026-08-10T00:00:00+09:00")], nextIllust),
        ),
        searchNovel: vi.fn(async () =>
          novelResponse([makeNovel(2, "2026-08-09T00:00:00+09:00")], nextNovel),
        ),
        searchIllustNext: vi.fn(async () =>
          illustResponse([makeIllust(3, "2026-08-08T00:00:00+09:00")], null),
        ),
        searchNovelNext: vi.fn(async () =>
          novelResponse([makeNovel(4, "2026-08-07T00:00:00+09:00")], null),
        ),
      })
      const c = useSearch({ transport })
      c.search("x")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.hasMore).toBe(true)
      expect(c.state.results).toHaveLength(2)
      await c.loadMore()
      expect(transport.searchIllustNext).toHaveBeenCalledWith(nextIllust, expect.any(AbortSignal))
      expect(transport.searchNovelNext).toHaveBeenCalledWith(nextNovel, expect.any(AbortSignal))
      expect(c.state.results).toHaveLength(4)
      expect(c.state.hasMore).toBe(false)
      expect(c.state.paginationError).toBe(false)
      expect(c.state.error).toBeNull()
    })

    it("illust scope：单游标，只推进插画分页", async () => {
      const nextIllust = "https://app-api.pixiv.net/v1/search/illust?word=x&offset=1"
      const transport = createTransport({
        searchIllust: vi.fn(async () => illustResponse([makeIllust(1, "2026-08-10T00:00:00+09:00")], nextIllust)),
        searchIllustNext: vi.fn(async () => illustResponse([makeIllust(2, "2026-08-09T00:00:00+09:00")], null)),
      })
      const c = useSearch({ transport })
      c.setScope("illust")
      c.search("x")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      await c.loadMore()
      expect(transport.searchIllustNext).toHaveBeenCalledTimes(1)
      expect(transport.searchNovelNext).not.toHaveBeenCalled()
      expect(c.state.results).toHaveLength(2)
    })

    it("分页失败 → status 保持 ready、已加载结果保留、paginationError=true（可重试）", async () => {
      const nextIllust = "https://app-api.pixiv.net/v1/search/illust?word=x&offset=1"
      const transport = createTransport({
        searchIllust: vi.fn(async () => illustResponse([makeIllust(1, "2026-08-10T00:00:00+09:00")], nextIllust)),
        searchIllustNext: vi.fn(async () => {
          throw netErr
        }),
      })
      const c = useSearch({ transport })
      c.setScope("illust")
      c.search("x")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      await c.loadMore()
      expect(c.state.status).toBe("ready")
      expect(c.state.results.map((r) => r.entity.id)).toEqual([1]) // 列表保留
      expect(c.state.error).toContain("网络不可用")
      expect(c.state.paginationError).toBe(true)
      expect(c.state.hasMore).toBe(true) // next_url 未推进 → 内联重试可再次 loadMore
    })
  })

  describe("错误与重试（spec 用户故事 16）", () => {
    it("首载失败（双类都失败）→ status=error + 中文文案；refresh 重试成功复位", async () => {
      const transport = createTransport({
        searchIllust: vi
          .fn()
          .mockRejectedValueOnce(netErr)
          .mockResolvedValue(illustResponse([makeIllust(1, "2026-08-10T00:00:00+09:00")], null)),
        searchNovel: vi
          .fn()
          .mockRejectedValueOnce(netErr)
          .mockResolvedValue(novelResponse([makeNovel(2, "2026-08-09T00:00:00+09:00")], null)),
      })
      const c = useSearch({ transport })
      c.search("星空")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("error")
      expect(c.state.error).toContain("网络不可用")
      expect(c.state.results).toEqual([])
      await c.refresh()
      expect(c.state.status).toBe("ready")
      expect(c.state.error).toBeNull()
      expect(c.state.results).toHaveLength(2)
    })

    it("refresh 非 error 态 no-op（ready 态不重复请求，加载态门控）", async () => {
      const searchIllustMock = vi.fn(async () =>
        illustResponse([makeIllust(1, "2026-08-10T00:00:00+09:00")], null),
      )
      const transport = createTransport({ searchIllust: searchIllustMock })
      const c = useSearch({ transport })
      c.setScope("illust")
      c.search("花")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("ready")
      await c.refresh()
      expect(searchIllustMock).toHaveBeenCalledTimes(1) // 未再请求
    })
  })

  describe("scope 切换游标与原子写入（review P1-1/P2-1 修复）", () => {
    it("all → setScope('novel')：异类(illust)游标不残留，novel 无 next 时 hasMore=false", async () => {
      const NEXT_I = "https://app-api.pixiv.net/v1/search/illust?word=a&offset=30"
      const NEXT_N = "https://app-api.pixiv.net/v1/search/novel?word=a&offset=30"
      const searchIllustMock = vi.fn(async () =>
        illustResponse([makeIllust(1, "2026-01-03T00:00:00+09:00")], NEXT_I),
      )
      const searchNovelMock = vi
        .fn()
        .mockResolvedValueOnce(novelResponse([makeNovel(2, "2026-01-01T00:00:00+09:00")], NEXT_N))
        .mockResolvedValueOnce(novelResponse([makeNovel(3, "2026-01-02T00:00:00+09:00")], null))
      const c = useSearch({ transport: createTransport({ searchIllust: searchIllustMock, searchNovel: searchNovelMock }) })
      c.search("a")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.hasMore).toBe(true) // all：双游标均非空
      expect(searchIllustMock).toHaveBeenCalledTimes(1)
      // 切 novel → 立即重搜（只发 novel 请求）；illust 游标残留会让 hasMore 撒谎（P1-1）
      c.setScope("novel")
      await settle()
      expect(c.state.status).toBe("ready")
      expect(searchIllustMock).toHaveBeenCalledTimes(1) // 未再发插画请求
      expect(c.state.hasMore).toBe(false) // novel 游标为 null + illust 游标已清空
      expect(c.state.results.map((r) => r.entity.id)).toEqual([3]) // 仅小说新结果
    })

    it("all 加载期间一侧未 settle：state 保持旧快照，不混拼新旧关键词，settle 后原子落表", async () => {
      let phase: "old" | "new" = "old"
      const novelDeferred = deferred<PixivNovelListResponse>()
      const t = createTransport({
        searchIllust: vi.fn(async () =>
          illustResponse([makeIllust(phase === "old" ? 1 : 9, "2026-01-03T00:00:00+09:00")], null),
        ),
        searchNovel: vi.fn(() => {
          if (phase === "old") return Promise.resolve(novelResponse([makeNovel(2, "2026-01-01T00:00:00+09:00")], null))
          return novelDeferred.promise // 新词 novel 挂起（illust 已立即返回）
        }),
      })
      const c = useSearch({ transport: t })
      c.search("old")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.results.map((r) => r.entity.id)).toEqual([1, 2])
      // 新词：illust 立即 settle、novel 挂起 → Promise.all 未结束
      phase = "new"
      c.search("new")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      await settle() // 排空 illust 续体；novel 仍 pending
      expect(c.state.status).toBe("loading")
      // 核心断言：不出现「新词插画 + 旧词小说」混拼（P2-1 修复前此处为 [9, 2]）
      expect(c.state.results.map((r) => r.entity.id)).toEqual([1, 2])
      novelDeferred.resolve(novelResponse([makeNovel(4, "2026-01-02T00:00:00+09:00")], null))
      await settle()
      expect(c.state.status).toBe("ready")
      expect(c.state.results.map((r) => r.entity.id)).toEqual([9, 4])
    })

    it("分页失败重试成功：error/paginationError 复位（banner 消失）", async () => {
      const searchIllustNextMock = vi
        .fn()
        .mockRejectedValueOnce(netErr)
        .mockResolvedValueOnce(illustResponse([makeIllust(2, "2026-01-03T00:00:00+09:00")], null))
      const c = useSearch({
        transport: createTransport({
          searchIllust: vi.fn(async () =>
            illustResponse(
              [makeIllust(1, "2026-01-03T00:00:00+09:00")],
              "https://app-api.pixiv.net/v1/search/illust?word=a&offset=30",
            ),
          ),
          searchIllustNext: searchIllustNextMock,
        }),
      })
      c.setScope("illust")
      c.search("a")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      await c.loadMore() // 第一页失败
      expect(c.state.paginationError).toBe(true)
      expect(c.state.error).toBe(netErr.message)
      expect(c.state.results).toHaveLength(1) // 已加载结果保留
      await c.loadMore() // 重试成功
      await settle()
      expect(c.state.paginationError).toBe(false)
      expect(c.state.error).toBeNull()
      expect(c.state.results).toHaveLength(2)
    })
  })

  describe("生命周期（reset / dispose）", () => {
    it("reset：清空结果回 idle + 中止在途（迟到响应不回填）", async () => {
      const searchIllustMock = vi.fn<
        (word: string, sort: SearchSort, target: SearchTarget, signal?: AbortSignal) => Promise<PixivIllustListResponse>
      >((_w, _s, _t, signal) => abortAwarePending<PixivIllustListResponse>(signal))
      const transport = createTransport({ searchIllust: searchIllustMock })
      const c = useSearch({ transport })
      c.setScope("illust")
      c.search("x")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("loading")
      const signal = searchIllustMock.mock.calls[0]![3]!
      c.reset()
      expect(c.state.status).toBe("idle")
      expect(c.state.results).toEqual([])
      expect(signal.aborted).toBe(true) // 在途被中止
      await vi.advanceTimersByTimeAsync(0) // flush 被 abort 的请求链
      expect(c.state.status).toBe("idle") // 中止后不写状态
    })

    it("dispose：abort 在途（不再写状态）；此后 search/refresh 等均 no-op", async () => {
      const searchIllustMock = vi.fn<
        (word: string, sort: SearchSort, target: SearchTarget, signal?: AbortSignal) => Promise<PixivIllustListResponse>
      >((_w, _s, _t, signal) => abortAwarePending<PixivIllustListResponse>(signal))
      const transport = createTransport({ searchIllust: searchIllustMock })
      const c = useSearch({ transport })
      c.setScope("illust")
      c.search("x")
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
      expect(c.state.status).toBe("loading")
      const signal = searchIllustMock.mock.calls[0]![3]!
      c.dispose()
      expect(signal.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      // dispose 后 abort → executeSearch 不写状态（status 停留在 loading，同 useComments 先例）
      expect(c.state.status).toBe("loading")

      c.search("y")
      c.setScope("novel")
      c.setSort("date_asc")
      await c.loadMore()
      await c.refresh()
      c.reset()
      await vi.advanceTimersByTimeAsync(1000)
      expect(searchIllustMock).toHaveBeenCalledTimes(1) // 仅 dispose 前那次
    })
  })
})
