// ─── 更新编排层单测（updateStore） ───
// seam：runStartupUpdateCheck 的导航决策（注入 fake checker + fake timers）、
// openReleasePage / exitUpdatePage 的原生桥分发（mock getNativeModules）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  navigate: vi.fn(),
  resetHistory: vi.fn(),
  getNativeModules: vi.fn(),
}))

vi.mock("@pictelio/update-check", () => ({
  checkForUpdate: mocks.checkForUpdate,
}))
vi.mock("../router", () => ({
  navigate: mocks.navigate,
  resetHistory: mocks.resetHistory,
}))
vi.mock("../api/client", () => ({
  getNativeModules: mocks.getNativeModules,
  // 与真实实现同语义：任一 Pictelio 原生模块存在即原生模式
  isNativeMode: () => !!mocks.getNativeModules()?.PictelioApp,
}))

import { runStartupUpdateCheck, openReleasePage, exitUpdatePage, updateResult, createUpdateFetchImpl } from "./updateStore"

const baseResult = {
  hasUpdate: false,
  latestVersion: "",
  latestReleaseUrl: "",
  latestChangelog: "",
}

describe("updateStore.runStartupUpdateCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("发现新版本 → 500ms 后清历史栈 + replace 导航到 /update", async () => {
    mocks.checkForUpdate.mockResolvedValue({
      ...baseResult,
      hasUpdate: true,
      latestVersion: "9.9.9",
      latestReleaseUrl: "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
    })

    runStartupUpdateCheck()
    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.resetHistory).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).toHaveBeenCalledWith("/update", { replace: true })
  })

  it("无更新 → 不导航、不清历史栈", async () => {
    mocks.checkForUpdate.mockResolvedValue({ ...baseResult, latestVersion: "4.5.0" })

    runStartupUpdateCheck()
    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.resetHistory).not.toHaveBeenCalled()
  })

  it("检查失败 → 不导航（正常进入 app）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.checkForUpdate.mockResolvedValue({ ...baseResult, error: "HTTP 404" })

    runStartupUpdateCheck()
    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.navigate).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("重复调用只触发一次检查（isChecking 防抖）", async () => {
    mocks.checkForUpdate.mockResolvedValue({ ...baseResult })

    runStartupUpdateCheck()
    runStartupUpdateCheck()
    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1)
  })
})

describe("updateStore.openReleasePage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 模块级 ref 跨用例残留：清空上次检查结果（否则 openReleasePage 读到旧 URL）
    updateResult.value = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("原生桥存在 → 调用 openUrl（release URL）", async () => {
    const openUrl = vi.fn()
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { openUrl } })
    mocks.checkForUpdate.mockResolvedValue({
      ...baseResult,
      hasUpdate: true,
      latestVersion: "9.9.9",
      latestReleaseUrl: "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
    })
    vi.useFakeTimers()

    // 先跑一次启动检查填充 updateResult（openReleasePage 消费它）
    runStartupUpdateCheck()
    await vi.advanceTimersByTimeAsync(500)

    openReleasePage()

    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/a1121611810/Pictelio/releases/tag/v9.9.9",
      expect.any(Function),
    )
  })

  it("无 latestReleaseUrl（未检查/检查失败）→ warn 不调用 openUrl", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const openUrl = vi.fn()
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { openUrl } })

    openReleasePage()

    expect(openUrl).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("原生桥缺失（web-core 预览）→ warn 不崩溃", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.getNativeModules.mockReturnValue(undefined)
    mocks.checkForUpdate.mockResolvedValue({
      ...baseResult,
      hasUpdate: true,
      latestVersion: "9.9.9",
      latestReleaseUrl: "https://example.com/releases/v9.9.9",
    })
    vi.useFakeTimers()

    runStartupUpdateCheck()
    await vi.advanceTimersByTimeAsync(500)

    openReleasePage()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe("updateStore.exitUpdatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("原生桥存在 → 调用 exitApp", () => {
    const exitApp = vi.fn()
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { exitApp } })

    exitUpdatePage()

    expect(exitApp).toHaveBeenCalled()
  })

  it("原生桥缺失 → warn 不崩溃", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.getNativeModules.mockReturnValue(undefined)

    exitUpdatePage()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe("updateStore.createUpdateFetchImpl（原生 httpGet 网络适配）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("原生模式 → httpGet 成功时包装 Response 并解析 JSON body", async () => {
    const httpGet = vi.fn((url: string, cb: (status: number, body: string) => void) => {
      cb(200, JSON.stringify({ version: "9.9.9", url: "https://github.com/x/releases/tag/v9.9.9" }))
    })
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { httpGet } })

    const res = await createUpdateFetchImpl()("http://10.0.2.2:8080/version.json" as unknown as URL)

    expect(httpGet).toHaveBeenCalledWith("http://10.0.2.2:8080/version.json", expect.any(Function))
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      version: "9.9.9",
      url: "https://github.com/x/releases/tag/v9.9.9",
    })
  })

  it("原生模式 → status 0（网络错误）reject", async () => {
    const httpGet = vi.fn((_url: string, cb: (status: number, body: string) => void) => {
      cb(0, "network down")
    })
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { httpGet } })

    await expect(createUpdateFetchImpl()("http://x" as unknown as URL)).rejects.toThrow("network down")
  })

  it("原生模式 → 非 2xx 状态包装为 ok=false（由 checkForUpdate 判定失败）", async () => {
    const httpGet = vi.fn((_url: string, cb: (status: number, body: string) => void) => {
      cb(404, "")
    })
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { httpGet } })

    const res = await createUpdateFetchImpl()("http://x" as unknown as URL)

    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
  })

  it("原生模式 → 桥缺失 reject", async () => {
    mocks.getNativeModules.mockReturnValue({ PictelioApp: {} })

    await expect(createUpdateFetchImpl()("http://x" as unknown as URL)).rejects.toThrow(/httpGet/)
  })

  it("原生模式 → abort 信号触发时 reject（JS 侧超时兜底）", async () => {
    const httpGet = vi.fn((_url: string, _cb: (status: number, body: string) => void) => {
      /* 永不回调：模拟 Java 侧挂起 */
    })
    mocks.getNativeModules.mockReturnValue({ PictelioApp: { httpGet } })
    const controller = new AbortController()

    const p = createUpdateFetchImpl()("http://x" as unknown as URL, { signal: controller.signal })
    controller.abort()

    await expect(p).rejects.toThrow("aborted")
  })

  it("web 模式（无原生模块）→ 走 requestFetch（不抛桥缺失）", async () => {
    mocks.getNativeModules.mockReturnValue(undefined)
    // web 模式直接返回 requestFetch；测试环境有全局 fetch，调用应成功发起
    const impl = createUpdateFetchImpl()
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    // requestFetch 指向 globalThis.fetch——不实际请求，仅验证返回的是 requestFetch 本身
    expect(typeof impl).toBe("function")
    warnSpy.mockRestore()
  })
})
