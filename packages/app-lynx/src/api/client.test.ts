// ─── client.requestRaw 单元测试（双模式：web fetch 代理 / 原生 PictelioApi 转发） ───
// IO 边界覆盖（AGENTS.md 测试硬约束 1）：成功与失败/降级路径都必须有测试。
// mock 技巧：
// - isNativeMode() 探测 NativeModules（裸变量/globalThis 双通道）——用
//   vi.stubGlobal('NativeModules', ...) 切换模式（空壳/含 Pictelio* 模块/undefined）；
// - requestFetch 读 globalThis.fetch ——用 vi.stubGlobal('fetch', ...) mock；
// - 原生回调契约来自 PixivApiModule：(status, data, rotatedRefreshToken)，
//   data 即原始响应字符串（PixivApiCore 对非 JSON 响应原样返回）。
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
import {
  apiClient,
  setAccessToken,
  setOnUnauthorized,
  setAuthPermanentFailure,
  setAuthReadyProvider,
  setRateLimitBackoffConfig,
  rewriteUrl,
} from "./client"
import { ApiErrorType, type ApiError } from "./types"
import { PIXIV_USER_AGENT, PIXIV_REFERER, PIXIV_API_BASE } from "./userAgent"
import { setLocale } from "../i18n"

// 真实结构样例：/webview/v2/novel 返回的 HTML（含 window.pixiv.novel.text）
const NOVEL_HTML = `<script>window.pixiv = { novel: { "text": "第一行\\n第二行" } }</script>`

/** web 模式 fetch 返回的 JSON Response 构造（status 429 等错误也走 JSON body） */
const jsonResponse = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })

// 认证就绪门（client.setAuthReadyProvider）默认清空，防跨用例泄漏；用例内按需注册。
// 限流退避配置（ADR-0199 D4 seam）同理：null = 回落默认参数，防上一用例注入的
// enabled:false / 自定义档位泄漏进下一用例（before + after 双侧清，用例中途失败也不残留）。
beforeEach(() => {
  setAuthReadyProvider(null)
  setRateLimitBackoffConfig(null)
})

afterEach(() => {
  setRateLimitBackoffConfig(null)
})

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

  // 启动竞态回归（用户报告：刷新页面先闪「未登录，请先登录」红字而非骨架）：
  // 子页面 onMounted 早于 App.onMounted → 首帧 GET 早于 restoreToken。
  // 修复：无 token 时先等「认证就绪」落定，再判定是否真的未登录。
  it("web 模式无 token + 认证恢复在飞 → 请求等待恢复落定后带 Bearer 发出（不误抛未登录）", async () => {
    setAccessToken("")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setAuthReadyProvider(async () => {
      await gate
      setAccessToken("restored-token")
      return true
    })
    fetchMock.mockResolvedValue(new Response(NOVEL_HTML, { status: 200 }))
    const p = apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    // 恢复门未落定：请求必须仍在等待，不得提前发出
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    release()
    await p
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer restored-token")
  })

  it("web 模式无 token + 恢复失败 → 仍抛未登录（不永久挂起）", async () => {
    setAccessToken("")
    setAuthReadyProvider(async () => false)
    await expect(
      apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }),
    ).rejects.toMatchObject({ type: ApiErrorType.UNAUTHORIZED })
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

  // ── #815 启动竞态（原生模式同样需要认证就绪门）──────────────────────────
  // 旧实现 `if (accessToken || !authReadyProvider) return` 让**原生模式完全跳过**这道门
  // （理由是「access_token 在 Java 堆、不经此门」）。但 access_token 是异步 OAuth 交换的
  // 产物，交换完成前 Java 堆同样为空 ⇒ 启动窗口内的请求裸奔 → 401 → 401 handler 读空内存
  // → 跳过刷新 → 上报会话失效（一次性 401 升级为永久失效）。
  // 实测时序（2026-09-28 19:52，logcat）：
  //   28.419 useApiQuery health 请求发出 → 28.465 loginWithRefreshToken 发出
  //   → 29.835 401 ×2（交换未完成，内存无 refresh_token）
  it("原生模式 + 认证恢复在飞 → 等恢复落定后再转发（#815：不再跳过就绪门）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(200, NOVEL_HTML, ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let providerCalls = 0
    setAuthReadyProvider(async () => {
      providerCalls++
      await gate
      return true
    })

    const p = apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    await Promise.resolve()
    // 恢复门未落定：原生转发**不得**已发出（这正是 #815 的裸奔窗口）
    expect(providerCalls).toBe(1)
    expect(requestMock).not.toHaveBeenCalled()
    release()
    await p
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("原生模式 + 恢复失败（provider 返回 false）→ 仍转发，不永久挂起（#815 保持可用性）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(200, NOVEL_HTML, ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    setAuthReadyProvider(async () => false)
    await apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it("原生模式 + 无 provider（web-core 预览等）→ 放行，不挂起（#815 保持既有行为）", async () => {
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(200, NOVEL_HTML, ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    setAuthReadyProvider(null)
    await apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    expect(requestMock).toHaveBeenCalledTimes(1)
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

// ─── 429 限流退避接线（ADR-0199 D5：runWithRateLimitBackoff 包在 execWithAuthRetry 内层） ───
// oracle 溯源：重试次数/终态形状以 ADR-0199 D3/D5 为准（重试上限不含首次；耗尽终态
// 附 params.attempts）；web 模式用 fake timers 驱动退避 sleep（默认 base=1000ms，
// full jitter 上界 30s，一次性推进 2 分钟必覆盖）；断言「429 才重试、其他错误原样抛」。

/** web/原生退避用例共用的探测 promise：立即挂 handler 防 unhandled rejection（reject 先于断言发生） */
function probe<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  return p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  )
}

describe("client 429 限流退避（web 模式接线，ADR-0199 D5）", () => {
  const fetchMock = vi.fn()
  let warnSpy: MockInstance

  beforeEach(() => {
    fetchMock.mockReset()
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("web-token")
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("NativeModules", undefined) // 无原生模块 → isNativeMode false
    // 静音退避留痕 warn（留痕内容的断言在各用例内做）
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
    vi.useRealTimers() // fake timers 用后必须还原，防泄漏进真实定时器用例
    vi.unstubAllGlobals()
  })

  it("429→429→200 退避重试：fetch 共 3 次、最终 resolve、warn 留痕（attempt 从 1 计）", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const out = await (async () => {
      const p = probe(apiClient.get<{ ok: boolean }>("/v1/illust/recommended"))
      await vi.advanceTimersByTimeAsync(120_000)
      return p
    })()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.v).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // onRetry 留痕契约：每次退避重试一条 "[client] 429 限流退避重试" attempt delayMs+"ms"
    expect(warnSpy).toHaveBeenCalledWith("[client] 429 限流退避重试", 1, expect.any(String))
    expect(warnSpy).toHaveBeenCalledWith("[client] 429 限流退避重试", 2, expect.any(String))
    expect(warnSpy.mock.calls.filter((c) => c[0] === "[client] 429 限流退避重试")).toHaveLength(2)
  })

  it("持续 429 → 重试耗尽 reject RATE_LIMIT + params.attempts=3，fetch 共 4 次（首次+3 重试）", async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse(429))
    const p = probe(apiClient.get("/v1/illust/recommended"))
    await vi.advanceTimersByTimeAsync(120_000)
    const out = await p
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.e).toMatchObject({ type: ApiErrorType.RATE_LIMIT, params: { attempts: 3 } })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("setRateLimitBackoffConfig({enabled:false}) → 零重试 fetch 1 次立即 reject（无 attempts）", async () => {
    setRateLimitBackoffConfig({ enabled: false, maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000 })
    fetchMock.mockResolvedValue(jsonResponse(429))
    const out = await probe(apiClient.get("/v1/illust/recommended"))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.e).toMatchObject({ type: ApiErrorType.RATE_LIMIT })
    expect((out.e as ApiError).params).toBeUndefined() // 首次即失败：不附重试计数
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("500 → 非限流错误不重试，fetch 共 1 次原样抛 SERVER", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500))
    const out = await probe(apiClient.get("/v1/illust/recommended"))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.e).toMatchObject({ type: ApiErrorType.SERVER, status: 500 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("401→刷新→重放 429→退避→200：refreshHandler 1 次、fetch 共 4 次（重放请求同样享受退避）", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const refreshHandler = vi.fn(async () => {
      setAccessToken("refreshed-token")
    })
    setOnUnauthorized(refreshHandler)
    const p = probe(apiClient.get<{ ok: boolean }>("/v1/illust/recommended"))
    await vi.advanceTimersByTimeAsync(120_000)
    const out = await p
    expect(out.ok).toBe(true)
    expect(refreshHandler).toHaveBeenCalledTimes(1)
    // 401 → 重放 429 → 退避 429 → 退避 200：401 层（外）与退避层（内）正交
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(warnSpy.mock.calls.filter((c) => c[0] === "[client] 429 限流退避重试")).toHaveLength(2)
  })

  it("POST 分支同样接退避：429→200 重试成功，fetch 共 2 次", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const p = probe(apiClient.post<{ ok: boolean }>("/v1/illust/bookmark/add", { illust_id: "1" }))
    await vi.advanceTimersByTimeAsync(120_000)
    const out = await p
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.v).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("requestRaw 同样接退避：429→200 重试成功，fetch 共 2 次", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(new Response(NOVEL_HTML, { status: 200 }))
    const p = probe(apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" }))
    await vi.advanceTimersByTimeAsync(120_000)
    const out = await p
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.v).toBe(NOVEL_HTML)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ─── 退避等待期 abort 取消（ADR-0199 D5：GET 路径 signal 透传 = vue-query queryFn 生产主路径）───
// 生产上 queryFn 把 AbortSignal 一路透传到 client.get → 组件卸载/参数变更即取消，
// 因此「等待期取消」是常态路径而非边角。断言口径两条：
//   1) 拒因 = abort 语义（透传 signal.reason），且不得被 execute 的 catch 归类成 NETWORK ApiError；
//   2) fetch 调用次数 = 取消后不得再重试（含推进远超名义窗口后仍不重试）。
// 观测用 fake timers：random 钉 0.5 → 默认档 base=1000 首次退避名义 500ms，
// 推进 100ms 即确认「已进入等待窗口且未到期」（不依赖真实等待）。
describe("client 429 退避等待期 abort（web 模式，signal 透传）", () => {
  const fetchMock = vi.fn()
  let warnSpy: MockInstance
  let randomSpy: MockInstance

  beforeEach(() => {
    fetchMock.mockReset()
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("web-token")
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("NativeModules", undefined) // 无原生模块 → isNativeMode false
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5) // 首次退避名义 = 0.5 × 1000 = 500ms
  })
  afterEach(() => {
    randomSpy.mockRestore() // 防影响后续用例的退避窗口推算
    warnSpy.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("退避等待中 abort → 立即 reject（abort 语义、非 NETWORK）、fetch 恰 1 次；推进远超窗口仍不重试", async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse(429))
    const controller = new AbortController()
    const p = probe(apiClient.get("/v1/illust/recommended", undefined, controller.signal))
    await vi.advanceTimersByTimeAsync(0) // 首个 429 归因落定 → 退避 sleep 进入等待窗口
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100) // 窗口内推进 100ms（< 名义 500ms）：仍在等待，未重试
    expect(fetchMock).toHaveBeenCalledTimes(1)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    const out = await p
    expect(out.ok).toBe(false)
    if (out.ok) return
    // 拒因 = abort 语义：透传 signal.reason；不得被归类成 ApiError（那会污染 UI 的错误文案）
    expect(String(out.e)).toMatch(/abort/i)
    expect((out.e as ApiError).type).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0) // 取消即清理等待定时器，无残留
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // 推进远超退避窗口（3 次重试名义上界 500+1000+2000ms，封顶 30s）→ 取消后一次都不再发
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("请求前已 abort 的 signal → 首个 429 后立即 reject、fetch 恰 1 次、零定时器残留", async () => {
    vi.useFakeTimers()
    // mock fetch 不实现 signal 语义（首个请求照发并返回 429）——本用例考验的是退避层：
    // 先验已 abort 必须在进入等待前短路，不得挂定时器、不得重试。
    fetchMock.mockResolvedValue(jsonResponse(429))
    const controller = new AbortController()
    controller.abort() // 请求发起前已取消（defaultSleep 的 signal.aborted 早退分支）
    const p = probe(apiClient.get("/v1/illust/recommended", undefined, controller.signal))
    await vi.advanceTimersByTimeAsync(0)
    const out = await p
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(String(out.e)).toMatch(/abort/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0) // 早退分支不注册等待定时器
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("client 429 限流退避（原生模式接线，PictelioApi 回调契约）", () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("") // 原生模式 access_token 在 Java 堆，JS 零知
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("回调 429→429→200 → 退避重试成功，PictelioApi.request 共 3 次", async () => {
    vi.useFakeTimers()
    let call = 0
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) => {
        call += 1
        if (call <= 2) cb(429, JSON.stringify({ message: "rate limited" }), "")
        else cb(200, JSON.stringify({ ok: true }), "")
      },
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    const p = probe(apiClient.get<{ ok: boolean }>("/v1/illust/recommended"))
    await vi.advanceTimersByTimeAsync(120_000)
    const out = await p
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.v).toEqual({ ok: true })
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it("回调持续 429 → 重试耗尽 reject RATE_LIMIT + params.attempts=3，request 共 4 次", async () => {
    vi.useFakeTimers()
    const requestMock = vi.fn(
      (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
        cb(429, JSON.stringify({ message: "rate limited" }), ""),
    )
    vi.stubGlobal("NativeModules", { PictelioApi: { request: requestMock } })
    const p = probe(apiClient.get("/v1/illust/recommended"))
    await vi.advanceTimersByTimeAsync(120_000)
    const out = await p
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.e).toMatchObject({ type: ApiErrorType.RATE_LIMIT, params: { attempts: 3 } })
    expect(requestMock).toHaveBeenCalledTimes(4)
  })
})

describe("GET 去重与退避交互（ADR-0199 D5：共享 promise = 共享退避）", () => {
  const fetchMock = vi.fn()
  let warnSpy: MockInstance

  beforeEach(() => {
    fetchMock.mockReset()
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("web-token")
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("NativeModules", undefined)
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("无 signal 并发相同 GET：fetch 恒 429 一次后 200 → fetch 共 2 次（非 4），两调用同值 resolve", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    // 同步发起两次相同 path+params 的 GET（无 signal → 参与去重，共享同一 in-flight promise）
    const p1 = apiClient.get<{ ok: boolean }>("/v1/illust/recommended")
    const p2 = apiClient.get<{ ok: boolean }>("/v1/illust/recommended")
    const both = Promise.all([probe(p1), probe(p2)])
    await vi.advanceTimersByTimeAsync(120_000)
    const [r1, r2] = await both
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return
    expect(r1.v).toEqual({ ok: true })
    expect(r1.v).toBe(r2.v) // 同一 promise → 同一响应对象（不是各发各的两次退避）
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ─── Accept-Language 头（ADR-0200 D3：web 通道 TS headers 注入 locale.value） ───
// oracle 溯源（测试硬约束 #6）：断言依据 = ADR-0200 D1/D3 与 spec §2.2——
// web 分支 headers = { UA, Referer, "Accept-Language": locale.value, [Authorization] }；
// 头值域 = i18n SUPPORTED_LOCALES（"zh-CN" | "en"，即合法 BCP-47 语言标签）。
// 原生模式（PictelioApi 转发）不加语言头——Java 侧负责（ADR-0200 D2，转发契约不涉 headers）。
describe("client web 模式 Accept-Language 头（ADR-0200 D3 + spec §2.2）", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    setOnUnauthorized(null)
    setAuthPermanentFailure(false)
    setAccessToken("web-token")
    // locale 用例隔离：i18n locale 是模块级 ref，setLocale 切过的值会跨用例泄漏；
    // 且模块初始值随环境 navigator.language 浮动——before + after 双侧显式钉
    // "zh-CN"（参照上方 setRateLimitBackoffConfig 的双侧清范式）。
    setLocale("zh-CN")
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("NativeModules", undefined) // 无原生模块 → isNativeMode false
  })
  afterEach(() => {
    setLocale("zh-CN")
    vi.unstubAllGlobals()
  })

  it("apiClient.get：fetch headers 含 Accept-Language: zh-CN（默认 locale）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    await apiClient.get("/v1/illust/recommended")
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/v1/illust/recommended",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": PIXIV_USER_AGENT,
          Referer: PIXIV_REFERER,
          "Accept-Language": "zh-CN",
        }),
      }),
    )
  })

  it("apiClient.requestRaw：fetch headers 同样含 Accept-Language: zh-CN（executeRaw web 分支）", async () => {
    fetchMock.mockResolvedValue(new Response(NOVEL_HTML, { status: 200 }))
    await apiClient.requestRaw("GET", "/webview/v2/novel", { id: "123" })
    expect(fetchMock).toHaveBeenCalledWith(
      "/pixiv-api/webview/v2/novel?id=123",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Accept-Language": "zh-CN",
        }),
      }),
    )
  })

  it("setLocale('en') 后新请求头值变 en；在飞请求头为构造时快照不受切换影响（spec E2）", async () => {
    // 两次请求各自消费 body → mock 必须每次返回新 Response（mockResolvedValue 复用同一对象会 "Body already read"）
    fetchMock.mockImplementation(() => jsonResponse(200, { ok: true }))
    // 在飞请求：有 token 时 execute 无前置 await，headers 在调用同一 tick 同步构造 → 快照 zh-CN
    const inflight = apiClient.get("/v1/illust/recommended")
    setLocale("en")
    await inflight
    expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe("zh-CN")
    // 切换后的新请求即带新值（不同 params 避开 GET 去重）
    await apiClient.get("/v1/illust/recommended", { offset: "after-switch" })
    expect(fetchMock.mock.calls[1][1].headers["Accept-Language"]).toBe("en")
  })

  it("401 重放：初始与重放请求均携带 Accept-Language（spec E4，review round 1 P2-1）", async () => {
    // 第一次 401 → execWithAuthRetry 刷新后重放同一 fn；Response 不可复用 → 逐次构造
    fetchMock
      .mockImplementationOnce(() => jsonResponse(401, {}))
      .mockImplementationOnce(() => jsonResponse(200, { ok: true }))
    const refreshHandler = vi.fn(async () => {
      setAccessToken("refreshed-token")
    })
    setOnUnauthorized(refreshHandler)
    await expect(apiClient.get("/v1/illust/detail", { id: "e4" })).resolves.toEqual({ ok: true })
    expect(refreshHandler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 重放走 execute 全量重建 headers → 语言头不得丢失（与初始请求一致）
    expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe("zh-CN")
    expect(fetchMock.mock.calls[1][1].headers["Accept-Language"]).toBe("zh-CN")
  })
})
