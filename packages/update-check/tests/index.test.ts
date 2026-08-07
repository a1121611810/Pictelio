// ─── @pictelio/update-check 单元测试 ───
// 用例自主 app tests/unit/services/updateService.test.ts 迁移 + 增强：
//   - error 字段（「检查失败」与「无更新」可区分）
//   - fetchImpl 依赖注入（不 stub 全局 fetch）
//   - 超时路径（fake timers + signal abort）
// 契约 mock 使用真实 version.json 字段（version/url/changelog）。
import { describe, it, expect, vi, afterEach } from "vitest"
import { isNewer, checkForUpdate } from "../src/index"

describe("isNewer", () => {
  it("returns false when versions are equal", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false)
  })

  it("returns true when remote major is newer", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(true)
  })

  it("returns true when remote minor is newer", () => {
    expect(isNewer("1.2.0", "1.3.0")).toBe(true)
  })

  it("returns true when remote patch is newer", () => {
    expect(isNewer("1.2.3", "1.2.4")).toBe(true)
  })

  it("returns false when local is newer", () => {
    expect(isNewer("2.0.0", "1.9.9")).toBe(false)
  })

  it("handles leading v prefix on remote", () => {
    expect(isNewer("1.0.0", "v1.1.0")).toBe(true)
  })

  it("handles leading v prefix on local", () => {
    expect(isNewer("v1.0.0", "1.1.0")).toBe(true)
  })

  it("handles leading v prefix on both sides", () => {
    expect(isNewer("v1.0.0", "v1.0.1")).toBe(true)
  })

  it("ignores build metadata after plus sign", () => {
    expect(isNewer("1.0.0+1", "1.1.0+99")).toBe(true)
  })

  it("ignores build metadata when core versions are equal", () => {
    expect(isNewer("1.0.0+1", "1.0.0+2")).toBe(false)
  })

  it("trims whitespace around version strings", () => {
    expect(isNewer(" 1.0.0 ", " 1.1.0 ")).toBe(true)
  })

  it("handles mixed depth (remote shorter)", () => {
    expect(isNewer("1.2.3", "1.3")).toBe(true)
  })

  it("handles mixed depth (local shorter) when equal", () => {
    expect(isNewer("1.2", "1.2.0")).toBe(false)
  })

  it("handles mixed depth when local is newer", () => {
    expect(isNewer("1.2", "1.1.9")).toBe(false)
  })

  it("treats non-numeric segments as 0 (defensive, no crash)", () => {
    expect(isNewer("abc", "1.0.0")).toBe(true)
    expect(isNewer("1.0.0", "abc")).toBe(false)
  })
})

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("解析 version.json 的 url 字段为 latestReleaseUrl，远端更新时 hasUpdate=true", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "9.9.9",
          url: "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
          changelog: "✨ 新功能",
        }),
        { status: 200 },
      ),
    )

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result.hasUpdate).toBe(true)
    expect(result.latestVersion).toBe("9.9.9")
    expect(result.latestReleaseUrl).toBe("https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9")
    expect(result.latestChangelog).toBe("✨ 新功能")
    expect(result.error).toBeUndefined()
  })

  it("远端版本与本地相等时 hasUpdate=false 且无 error", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ version: "4.5.0", url: "https://github.com/a1121611810/Pictelio/releases/tag/v4.5.0" }),
        { status: 200 },
      ),
    )

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe("4.5.0")
    expect(result.error).toBeUndefined()
  })

  it("fetch 失败（网络异常）返回安全默认值 + error 字段 + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"))

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result).toEqual({
      hasUpdate: false,
      latestVersion: "",
      latestReleaseUrl: "",
      latestChangelog: "",
      error: "network down",
    })
    expect(warnSpy).toHaveBeenCalled()
  })

  it("HTTP 非 2xx 返回安全默认值 + error 字段 + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const mockFetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }))

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result).toEqual({
      hasUpdate: false,
      latestVersion: "",
      latestReleaseUrl: "",
      latestChangelog: "",
      error: "HTTP 404",
    })
    expect(warnSpy).toHaveBeenCalled()
  })

  it("200 但响应体非 JSON（json 解析失败）→ 安全默认值 + error + warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const mockFetch = vi.fn().mockResolvedValue(new Response("<html>gateway error</html>", { status: 200 }))

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBeTruthy()
    expect(warnSpy).toHaveBeenCalled()
  })

  it("环境无全局 fetch 且未注入 fetchImpl → 安全默认值 + error（不崩溃）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    // 模拟 web-core 等无全局 fetch 的环境（fetchWrapper.ts 实测场景）
    vi.stubGlobal("fetch", undefined)

    const result = await checkForUpdate("4.5.0")

    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBeTruthy()
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
  })

  it("version.json 缺 version 字段时 hasUpdate=false（不崩溃）", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe("")
    expect(result.error).toBeUndefined()
  })

  it("超过 10s 超时中止请求并返回安全默认值 + error", async () => {
    // fetchImpl 注入 seam：mock fetch 尊重 AbortSignal，永不 resolve
    const mockFetch = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    )
    vi.useFakeTimers()

    const pending = checkForUpdate("4.5.0", mockFetch)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await pending

    expect(result.hasUpdate).toBe(false)
    expect(result.error).toBeTruthy()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("未传 fetchImpl 时使用全局 fetch（默认依赖）", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "1.0.1" }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const result = await checkForUpdate("1.0.0")

    expect(result.hasUpdate).toBe(true)
    vi.unstubAllGlobals()
  })
})
