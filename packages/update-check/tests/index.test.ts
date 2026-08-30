// ─── @pictelio/update-check 单元测试 ───
// 用例自主 app tests/unit/services/updateService.test.ts 迁移 + 增强：
//   - error 字段（「检查失败」与「无更新」可区分）
//   - fetchImpl 依赖注入（不 stub 全局 fetch）
//   - 超时路径（fake timers + signal abort）
//   - 双坐标扩展（minWebVersion / webBundle，OTA web bundle #247）
// 契约 mock 使用真实 version.json 字段（version/url/changelog + minWebVersion/webBundle，
// 生产 schema 见 docs/specs/ota-web-bundle.md「版本与数据源」节）。
// oracle 溯源：
//   - isBelowMin 期望值来自规格语义「bundle 低于 floor ⟺ floor 较新」，并用 isNewer 反参
//     做差分断言（独立语义来源交叉验证，非从实现反推）
//   - webBundle 缺失/残缺路径的期望值来自「显式暴露 undefined、不伪造默认值」的禁静默降级约束
import { describe, it, expect, vi, afterEach } from "vitest"
import { isNewer, isBelowMin, checkForUpdate } from "../src/index"

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

  it("合法 JSON 但 body 为字面量 null / 数组 → 按检查失败处理（不崩溃，调用方无需 try/catch）", async () => {
    for (const body of ["null", "[]"]) {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const mockFetch = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))

      const result = await checkForUpdate("4.5.0", mockFetch)

      expect(result.hasUpdate, `body=${body}`).toBe(false)
      expect(result.error, `body=${body}`).toBeTruthy()
      expect(warnSpy, `body=${body}`).toHaveBeenCalled()
      warnSpy.mockRestore()
    }
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

describe("isBelowMin（OTA 强制门槛判定）", () => {
  it("floor 高于 local → true（门槛命中）", () => {
    expect(isBelowMin("4.20.0", "4.21.0")).toBe(true)
  })

  it("floor 等于 local → false", () => {
    expect(isBelowMin("4.21.0", "4.21.0")).toBe(false)
  })

  it("floor 低于 local → false", () => {
    expect(isBelowMin("4.22.0", "4.21.0")).toBe(false)
  })

  it("空 floor → false（fail-open：不设门槛）", () => {
    expect(isBelowMin("4.21.0", "")).toBe(false)
  })

  it("v 前缀 / 空白 / 混合深度与 isNewer 同语义", () => {
    expect(isBelowMin("4.21.0", "v4.22.0")).toBe(true)
    expect(isBelowMin(" v4.21.0 ", "4.22.0")).toBe(true)
    expect(isBelowMin("1.2", "1.2.1")).toBe(true)
    expect(isBelowMin("1.2.1", "1.2")).toBe(false)
  })

  it("非数字段防御（按 0，不崩溃）", () => {
    expect(isBelowMin("abc", "1.0.0")).toBe(true)
    expect(isBelowMin("1.0.0", "abc")).toBe(false)
  })

  it("差分断言：isBelowMin(local, floor) ≡ isNewer(local, floor)（反参交叉验证）", () => {
    const pairs: Array<[string, string]> = [
      ["4.20.0", "4.21.0"],
      ["4.21.0", "4.21.0"],
      ["9.9.9", "1.0.0"],
      ["1.0.0", "9.9.9"],
      ["1.2", "1.2.1"],
      ["1.2.1", "1.2"],
      ["2.0.0+build1", "v2.0.0"],
    ]
    for (const [local, floor] of pairs) {
      expect(isBelowMin(local, floor)).toBe(isNewer(local, floor))
    }
  })
})

describe("checkForUpdate 双坐标（minWebVersion / webBundle）", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("解析 minWebVersion 与 webBundle（OTA 发布 schema）", async () => {
    // 契约样例 = 规格生产 schema：webBundle.url 为三件套资产前缀 URL
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "4.21.0",
          url: "https://github.com/a1121611810/Pictelio/releases/tag/v4.21.0",
          changelog: "...",
          minWebVersion: "4.21.0",
          webBundle: {
            version: "4.21.0",
            url: "https://github.com/a1121611810/Pictelio/releases/download/v4.21.0/pictelio-4.21.0",
          },
        }),
        { status: 200 },
      ),
    )

    const result = await checkForUpdate("4.20.0", mockFetch)

    expect(result.minWebVersion).toBe("4.21.0")
    expect(result.webBundle).toEqual({
      version: "4.21.0",
      url: "https://github.com/a1121611810/Pictelio/releases/download/v4.21.0/pictelio-4.21.0",
    })
    expect(result.error).toBeUndefined()
  })

  it("新字段缺失时显式暴露 undefined（不伪造默认值，fail-open 判定留给消费端）", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ version: "9.9.9", url: "https://example.com/release" }),
        { status: 200 },
      ),
    )

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result.hasUpdate).toBe(true)
    expect(result.minWebVersion).toBeUndefined()
    expect(result.webBundle).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it("webBundle 残缺（缺 url / 字段非字符串 / 非对象）→ 视为不存在 + warn（契约破坏可见，禁静默）", async () => {
    const cases = [
      { webBundle: { version: "4.21.0" } }, // 缺 url
      { webBundle: { url: "https://example.com" } }, // 缺 version
      { webBundle: { version: 123, url: "https://example.com" } }, // 字段非字符串
      { webBundle: "not-an-object" }, // 非对象
    ]
    for (const payload of cases) {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ version: "4.21.0", ...payload }), { status: 200 }),
      )
      const result = await checkForUpdate("4.20.0", mockFetch)
      expect(result.webBundle, JSON.stringify(payload)).toBeUndefined()
      expect(result.error, JSON.stringify(payload)).toBeUndefined()
      expect(warnSpy, `脏 webBundle 必须 warn: ${JSON.stringify(payload)}`).toHaveBeenCalled()
      warnSpy.mockRestore()
    }
  })

  it("webBundle 携带未知扩展字段 → 正常采信（schema 加字段永远兼容）", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "4.21.0",
          webBundle: { version: "4.21.0", url: "https://example.com/prefix", build: 7 },
        }),
        { status: 200 },
      ),
    )

    const result = await checkForUpdate("4.20.0", mockFetch)

    expect(result.webBundle).toEqual({ version: "4.21.0", url: "https://example.com/prefix" })
  })

  it("version 非字符串（脏数据）→ hasUpdate=false 且不崩溃", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 9999, url: "https://example.com" }), { status: 200 }),
    )

    const result = await checkForUpdate("4.5.0", mockFetch)

    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe("")
    expect(result.error).toBeUndefined()
  })

  it("minWebVersion 纯空白 → undefined + warn（与缺失区分，契约破坏可见）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "4.21.0", minWebVersion: "   " }), { status: 200 }),
    )

    const result = await checkForUpdate("4.20.0", mockFetch)

    expect(result.minWebVersion).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it("minWebVersion 非字符串（数字/对象）→ undefined + warn（防御脏数据不崩溃）", async () => {
    for (const bad of [123, { v: "4.21.0" }]) {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ version: "4.21.0", minWebVersion: bad }), { status: 200 }),
      )
      const result = await checkForUpdate("4.20.0", mockFetch)
      expect(result.minWebVersion, JSON.stringify(bad)).toBeUndefined()
      expect(result.error, JSON.stringify(bad)).toBeUndefined()
      expect(warnSpy, `脏 minWebVersion 必须 warn: ${JSON.stringify(bad)}`).toHaveBeenCalled()
      warnSpy.mockRestore()
    }
  })
})
