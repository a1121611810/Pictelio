// ─── api/search 单元测试（app-lynx 全局搜索 T1，issue #291） ───
// IO 边界覆盖（AGENTS.md 测试硬约束 1）：成功与失败双路径都测。
// mock 组织（参照 client.test.ts）：走真实 apiClient（web 模式 stub globalThis.fetch /
// 原生模式 stub NativeModules.PictelioApi），断言完整 URL/params 与错误归一，
// 不 mock apiClient.get —— 避免「实现错 mock 全绿」的虚假信心。
// 响应 mock 数据结构来自真实契约：字段形状逐字对齐 lynx api/types.ts
// （与 webview app api/types.ts 同源；PixivIllustListResponse / PixivNovelListResponse）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  setAccessToken,
  setOnUnauthorized,
  setAuthPermanentFailure,
} from "./client"
import {
  searchIllust,
  searchNovel,
  searchIllustNext,
  searchNovelNext,
  searchTransport,
  deriveSearchTarget,
} from "./search"
import { ApiErrorType, type PixivIllust, type PixivIllustListResponse, type PixivNovel, type PixivNovelListResponse } from "./types"

// ─── 真实契约样例 —— 字段形状来自 api/types.ts（与 webview 同源契约） ───

const ILLUST_ITEM: PixivIllust = {
  id: 123456789,
  title: "星空の少女",
  type: "illust",
  user: {
    id: 987654321,
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
  total_bookmarks: 321,
  tags: [
    { name: "星空", translated_name: "starry sky" },
    { name: "オリジナル" },
  ],
  x_restrict: 0,
  create_date: "2026-01-01T00:00:00+09:00",
  caption: "テスト作品",
  total_comments: 2,
  meta_pages: [],
  meta_single_page: {},
}

const NOVEL_ITEM: PixivNovel = {
  id: 987654321,
  title: "星空の物語",
  user: {
    id: 987654321,
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
  tags: [
    { name: "夜空", translated_name: "night sky" },
    { name: "短編" },
  ],
  page_count: 1,
  text_length: 2314,
  series: { id: 111, title: "星空シリーズ" },
  is_bookmarked: false,
  total_bookmarks: 58,
  x_restrict: 0,
  create_date: "2026-01-02T00:00:00+09:00",
  caption: "テスト小説",
  total_comments: 0,
}

const ILLUST_RESPONSE: PixivIllustListResponse = {
  illusts: [ILLUST_ITEM],
  next_url: null,
}

const NOVEL_RESPONSE: PixivNovelListResponse = {
  novels: [NOVEL_ITEM],
  next_url: null,
}

const ABS_NEXT_URL = "https://app-api.pixiv.net/v1/search/illust?word=test&offset=30"

describe("api/search（web 模式：fetch + /pixiv-api 代理）", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("web-token") // web 模式 Bearer 头来源
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("NativeModules", undefined) // 无原生模块 → isNativeMode false
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("searchIllust 默认参数 → 标准端点 + search_target=partial_match_for_tags + filter=for_ios（含 Bearer）", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ILLUST_RESPONSE), { status: 200 }))
    const result = await searchIllust("Fate")
    // rewriteUrl："/v1/search/illust" → "/pixiv-api/v1/search/illust"（代理路径，glossary-search-pagination 相对路径契约）
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/search/illust?word=Fate&sort=date_desc&search_target=partial_match_for_tags&filter=for_ios",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer web-token" }),
      }),
    )
    expect(result).toEqual(ILLUST_RESPONSE)
  })

  it("searchIllust 关键词含空格 → search_target 派生为 exact_match_for_tags", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ILLUST_RESPONSE), { status: 200 }))
    await searchIllust("Fate night")
    // 空格派生：含空格 → exact_match_for_tags（对齐 webview searchStore 语义）
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/search/illust?word=Fate+night&sort=date_desc&search_target=exact_match_for_tags&filter=for_ios",
      expect.anything(),
    )
  })

  it("searchIllust sort=popular_desc → popular-preview 端点（无 sort 参数，不分页），其余参数不变", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ILLUST_RESPONSE), { status: 200 }))
    await searchIllust("Fate", "popular_desc")
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/search/popular-preview/illust?word=Fate&search_target=partial_match_for_tags&filter=for_ios",
      expect.anything(),
    )
  })

  it("searchNovel 默认参数 → 标准端点 + 参数", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(NOVEL_RESPONSE), { status: 200 }))
    const result = await searchNovel("小説")
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/search/novel?word=%E5%B0%8F%E8%AA%AC&sort=date_desc&search_target=partial_match_for_tags&filter=for_ios",
      expect.anything(),
    )
    expect(result).toEqual(NOVEL_RESPONSE)
  })

  it("searchNovel sort=popular_desc → /v1/search/popular-preview/novel", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(NOVEL_RESPONSE), { status: 200 }))
    await searchNovel("test", "popular_desc", "exact_match_for_tags")
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/search/popular-preview/novel?word=test&search_target=exact_match_for_tags&filter=for_ios",
      expect.anything(),
    )
  })

  it("searchIllustNext 绝对 next_url（app-api.pixiv.net）放行 + 原始响应透传（transport 不自发分页）", async () => {
    // next_url 非空：若实现错误地「自动跟进分页」会发第二次请求——断言仅 1 次请求
    const respWithNext: PixivIllustListResponse = { ...ILLUST_RESPONSE, next_url: ABS_NEXT_URL }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(respWithNext), { status: 200 }))
    const result = await searchIllustNext(ABS_NEXT_URL)
    // 断言通过后交 apiClient.get，rewriteUrl 在 client 内执行（勿在 search 层重复重写）：
    // 绝对 URL → /pixiv-api 代理路径（web 模式）
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/search/illust?word=test&offset=30",
      expect.anything(),
    )
    // next_url 原样透传（分页决策在控制器，transport 零加工）
    expect(result.next_url).toBe(ABS_NEXT_URL)
    expect(result.illusts).toHaveLength(1)
  })

  it("searchNovelNext 相对代理路径（/pixiv-api）放行", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(NOVEL_RESPONSE), { status: 200 }))
    const proxyUrl = "/pixiv-api/v1/search/novel?word=test&offset=30"
    await searchNovelNext(proxyUrl)
    expect(fetchMock).toHaveBeenCalledWith(proxyUrl, expect.anything())
  })

  it("searchIllustNext 非法 host（evil.com）→ 抛错（带模块前缀，warn 可见），且不发起网络请求", async () => {
    // 注意：assertPixivUrl 同步抛错（先断言后请求），webview 蓝本同款 — toThrow 而非 .rejects
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => searchIllustNext("https://evil.example.com/steal")).toThrow(
      "[api/search] searchIllustNext: invalid next_url",
    )
    expect(fetchMock).not.toHaveBeenCalled()
    // 静默降级禁令：SSRF 拒绝路径必须 warn 可见
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[api/search] searchIllustNext: invalid next_url"),
    )
    warnSpy.mockRestore()
  })

  it("searchNovelNext 非法 host → 抛错（带模块前缀）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => searchNovelNext("https://evil.example.com/steal")).toThrow(
      "[api/search] searchNovelNext: invalid next_url",
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("searchIllustNext 非 URL 字符串 / 裸相对路径（非 /pixiv-api 前缀）也拒绝（对齐 webview assertPixivUrl）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    // 裸相对路径不带 /pixiv-api 前缀 → 无法证明指向 Pixiv（防御性拒绝）
    expect(() => searchIllustNext("/v1/search/illust?word=test&offset=30")).toThrow(
      "[api/search] searchIllustNext: invalid next_url",
    )
    expect(() => searchIllustNext("not-a-url")).toThrow(
      "[api/search] searchIllustNext: invalid next_url",
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  it("signal 透传：AbortController.signal 原样传给 fetch", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(ILLUST_RESPONSE), { status: 200 }))
    const controller = new AbortController()
    await searchIllust("Fate", "date_desc", "partial_match_for_tags", controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("失败路径：HTTP 500 → ApiError（SERVER，classifyError 归一，成功/失败双路径门禁）", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }))
    await expect(searchIllust("Fate")).rejects.toMatchObject({
      type: ApiErrorType.SERVER,
      status: 500,
    })
  })

  it("失败路径：fetch 网络拒绝（TypeError）→ ApiError（NETWORK）", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(searchNovel("test")).rejects.toMatchObject({
      type: ApiErrorType.NETWORK,
    })
  })

  it("searchTransport 默认实例绑定四个真实导出函数（seam 同构，useSearch 可注入替身）", () => {
    expect(searchTransport.searchIllust).toBe(searchIllust)
    expect(searchTransport.searchNovel).toBe(searchNovel)
    expect(searchTransport.searchIllustNext).toBe(searchIllustNext)
    expect(searchTransport.searchNovelNext).toBe(searchNovelNext)
  })
})

describe("deriveSearchTarget（对齐 webview searchStore 派生规则）", () => {
  it("无空格 → partial_match_for_tags", () => {
    expect(deriveSearchTarget("星空")).toBe("partial_match_for_tags")
    expect(deriveSearchTarget("Fate/stay")).toBe("partial_match_for_tags")
  })

  it("含空格 → exact_match_for_tags", () => {
    expect(deriveSearchTarget("星空 花火")).toBe("exact_match_for_tags")
    expect(deriveSearchTarget("Fate night")).toBe("exact_match_for_tags")
  })
})

describe("api/search（原生模式：PictelioApi.request 转发）", () => {
  beforeEach(() => {
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("") // 原生模式 access_token 在 Java 堆，JS 零知
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("searchIllustNext 绝对 next_url → 断言放行后由 client 剥离域名成相对路径交给插件（ADR-0104 防双域名 404）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(200, JSON.stringify(ILLUST_RESPONSE), ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    const result = await searchIllustNext(ABS_NEXT_URL)
    expect(result).toEqual(ILLUST_RESPONSE)
    // 插件只收相对路径（内部拼 apiBase）；绝对 URL 剥离域名，否则双域名 → Pixiv 404
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/v1/search/illust?word=test&offset=30",
      "",
      expect.any(Function),
    )
  })

  it("失败路径：原生回调 404 → ApiError（UNKNOWN + status 404，classifyError 归一）", async () => {
    vi.stubGlobal("NativeModules", {
      PictelioApi: {
        request: (_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) =>
          cb(404, JSON.stringify({ error: { message: "not found" } })),
      },
    })
    await expect(searchNovelNext("https://app-api.pixiv.net/v1/search/novel?word=test&offset=30")).rejects.toMatchObject({
      type: ApiErrorType.UNKNOWN,
      status: 404,
    })
  })
})
