// ─── client.requestRaw 单元测试（双模式：web fetch 代理 / 原生 PictelioApi 转发） ───
// IO 边界覆盖（AGENTS.md 测试硬约束 1）：成功与失败/降级路径都必须有测试。
// mock 技巧：
// - isNativeMode() 探测 NativeModules（裸变量/globalThis 双通道）——用
//   vi.stubGlobal('NativeModules', ...) 切换模式（空壳/含 Pictelio* 模块/undefined）；
// - requestFetch 读 globalThis.fetch ——用 vi.stubGlobal('fetch', ...) mock；
// - 原生回调契约来自 PixivApiModule：(status, data, rotatedRefreshToken)，
//   data 即原始响应字符串（PixivApiCore 对非 JSON 响应原样返回）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { apiClient, setAccessToken, setOnUnauthorized, setAuthPermanentFailure, rewriteUrl } from "./client"
import { ApiErrorType } from "./types"
import { PIXIV_USER_AGENT, PIXIV_REFERER, PIXIV_API_BASE } from "./userAgent"

// 真实结构样例：/webview/v2/novel 返回的 HTML（含 window.pixiv.novel.text）
const NOVEL_HTML = `<script>window.pixiv = { novel: { "text": "第一行\\n第二行" } }</script>`

describe("client.requestRaw web 模式（fetch + /pixiv-api 代理）", () => {
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

  it("成功：fetch ok + text() 返回原始 HTML，且 URL 重写为代理路径并携带 Bearer", async () => {
    fetchMock.mockResolvedValue(new Response(NOVEL_HTML, { status: 200 }))
    const html = await apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    expect(html).toBe(NOVEL_HTML)
    // 相对路径 → rewriteUrl 为 /pixiv-api 代理路径 + params
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/webview/v2/novel?id=123",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "User-Agent": PIXIV_USER_AGENT,
          Referer: PIXIV_REFERER,
          Authorization: "Bearer web-token",
        }),
      }),
    )
  })

  it("HTTP 404 → 抛 ApiError（UNKNOWN + status 404，classifyError 归类）", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
    )
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      type: ApiErrorType.UNKNOWN,
      status: 404,
    })
  })

  it("HTTP 500 → 抛 ApiError（SERVER）", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }))
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      type: ApiErrorType.SERVER,
      status: 500,
    })
  })

  it("fetch 网络拒绝（TypeError）→ 抛 ApiError（NETWORK）", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      type: ApiErrorType.NETWORK,
    })
  })

  it("401 → execWithAuthRetry 自动刷新后重试成功（与 execute 行为一致）", async () => {
    // 第一次 401，刷新 handler 轮换 token 后重放请求第二次 200
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }))
      .mockResolvedValueOnce(new Response(NOVEL_HTML, { status: 200 }))
    const refreshHandler = vi.fn(async () => {
      setAccessToken("refreshed-token")
    })
    setOnUnauthorized(refreshHandler)
    const html = await apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    expect(html).toBe(NOVEL_HTML)
    expect(refreshHandler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("web 模式未登录（GET 无 access_token）→ 抛 ApiError（UNAUTHORIZED）", async () => {
    setAccessToken("")
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      type: ApiErrorType.UNAUTHORIZED,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("client.requestRaw 原生模式（PictelioApi.request 转发，JS 零知 access_token）", () => {
  beforeEach(() => {
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("") // 原生模式 access_token 在 Java 堆，JS 零知（getAccessToken 恒空）
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("成功：回调 (200, html, '') → resolve 原始字符串（不 JSON 解析）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(200, NOVEL_HTML, ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    const html = await apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    expect(html).toBe(NOVEL_HTML)
    // path + query 直接传给原生模块（不走 web 代理前缀）
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/webview/v2/novel?id=123",
      "",
      expect.any(Function),
    )
  })

  it("回调 status 404 → 抛 ApiError（classifyError 归类）", async () => {
    vi.stubGlobal("NativeModules", {
      PictelioApi: {
        request: (_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) =>
          cb(404, JSON.stringify({ error: { message: "not found" } })),
      },
    })
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      status: 404,
    })
  })

  it("回调 status 500 → 抛 ApiError（SERVER；非 JSON body 也正确归类）", async () => {
    vi.stubGlobal("NativeModules", {
      PictelioApi: {
        request: (_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) =>
          cb(500, "server error"),
      },
    })
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      type: ApiErrorType.SERVER,
      status: 500,
    })
  })

  it("原生模式 JS 无 access_token 不抛未登录（token 在 Java 堆，仍发起请求）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) => cb(401, JSON.stringify({})),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      status: 401,
    })
    expect(requestMock).toHaveBeenCalled()
  })

  it("原生模式绝对 next_url → 归一化剥离域名后传给原生模块（ADR-0104，防双域名 404）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(200, NOVEL_HTML, ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    const absUrl = `${PIXIV_API_BASE}/webview/v2/novel`
    const html = await apiClient.requestRaw("GET", absUrl, { id: "123" })
    expect(html).toBe(NOVEL_HTML)
    // 插件只收相对路径（内部拼 apiBase）；绝对 URL 剥离域名，否则双域名 → Pixiv 404
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/webview/v2/novel?id=123",
      "",
      expect.any(Function),
    )
  })

  it("原生模块缺失（isNativeMode true 但无 PictelioApi）→ 抛 NETWORK「原生 API 模块不可用」", async () => {
    // 空壳/其他 Pictelio 模块存在使 isNativeMode()=true，但 PictelioApi 缺失 →
    // 原生分支内模块不可用（对齐 execute 现有写法）
    vi.stubGlobal("NativeModules", { PictelioApp: {} })
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({
      type: ApiErrorType.NETWORK,
      message: "原生 API 模块不可用",
    })
  })
})

describe("rewriteUrl 原生分支（ADR-0104：绝对 next_url 归一化，防双域名 404）", () => {
  beforeEach(() => {
    // 原生模式探测：存在 Pictelio 模块即 isNativeMode true
    vi.stubGlobal("NativeModules", { PictelioApi: {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("绝对 Pixiv URL → 剥离域名成相对路径（含 query）", () => {
    const abs = `${PIXIV_API_BASE}/v1/illust/recommended?content_type=illust&offset=30`
    expect(rewriteUrl(abs)).toBe("/v1/illust/recommended?content_type=illust&offset=30")
  })

  it("绝对 Pixiv URL 无 query 同样剥离", () => {
    expect(rewriteUrl(`${PIXIV_API_BASE}/v1/novel/follow`)).toBe("/v1/novel/follow")
  })

  it("相对路径原样透传（插件内部拼 apiBase）", () => {
    expect(rewriteUrl("/v1/illust/recommended")).toBe("/v1/illust/recommended")
  })

  it("非 Pixiv 绝对 URL 原样（防御性兜底，不剥离）", () => {
    const evil = "https://evil.example.com/v1/x"
    expect(rewriteUrl(evil)).toBe(evil)
  })

  it("精确主机边界：伪后缀域（app-api.pixiv.net.evil.com）不剥离", () => {
    const fake = `${PIXIV_API_BASE}.evil.com/v1/x`
    expect(rewriteUrl(fake)).toBe(fake)
  })

  it("/pixiv-img 相对路径原样（交给 PictelioImageService 原生重写）", () => {
    expect(rewriteUrl("/pixiv-img/xxx.png")).toBe("/pixiv-img/xxx.png")
  })
})
