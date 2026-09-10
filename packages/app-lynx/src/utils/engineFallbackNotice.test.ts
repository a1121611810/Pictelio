// 引擎降级通知消费单测（ADR-0153）。
// Oracle = ADR-0153 决策 6：读到 'true' → 消费（删键）并返回 true；其余值/缺失 → false
// 且不删键；原生模块不可用 → console.warn + 返回 false（禁止静默失败、不阻断启动）。
import { beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({
  native: false,
  modules: {} as Record<string, unknown>,
}))
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>()
  return {
    ...actual,
    isNativeMode: vi.fn(() => env.native),
    getNativeModules: vi.fn(() => env.modules),
  }
})
vi.mock("./idbKV", () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
  idbRemove: vi.fn(async () => {}),
}))

import { idbGet, idbRemove } from "./idbKV"
import { consumeEngineFallbackNotice, ENGINE_FALLBACK_NOTICE_KEY } from "./engineFallbackNotice"

const idbGetMock = vi.mocked(idbGet)
const idbRemoveMock = vi.mocked(idbRemove)

beforeEach(() => {
  vi.clearAllMocks()
  env.native = false
  env.modules = {}
  idbGetMock.mockResolvedValue(null)
  idbRemoveMock.mockResolvedValue(undefined)
})

describe("consumeEngineFallbackNotice", () => {
  it("dev：键为 true → 返回 true 且删键", async () => {
    idbGetMock.mockResolvedValue("true")

    await expect(consumeEngineFallbackNotice()).resolves.toBe(true)

    expect(idbGetMock).toHaveBeenCalledWith(ENGINE_FALLBACK_NOTICE_KEY)
    expect(idbRemoveMock).toHaveBeenCalledWith(ENGINE_FALLBACK_NOTICE_KEY)
  })

  it("dev：键缺失 → 返回 false 且不删键", async () => {
    idbGetMock.mockResolvedValue(null)

    await expect(consumeEngineFallbackNotice()).resolves.toBe(false)

    expect(idbRemoveMock).not.toHaveBeenCalled()
  })

  it("dev：脏值（非 true）→ 返回 false 且不删键", async () => {
    idbGetMock.mockResolvedValue("1")

    await expect(consumeEngineFallbackNotice()).resolves.toBe(false)

    expect(idbRemoveMock).not.toHaveBeenCalled()
  })

  it("dev：读取抛异常 → false + warn", async () => {
    idbGetMock.mockRejectedValue(new Error("idb down"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(consumeEngineFallbackNotice()).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  it("native：键为 true → 返回 true 且调 prefsRemove", async () => {
    env.native = true
    const remove = vi.fn((_key: string, cb: (err: string | null) => void) => cb(null))
    env.modules = {
      PictelioPrefs: {
        prefsGet: vi.fn((_k: string, cb: (v: string, e: string | null) => void) => cb("true", null)),
        prefsRemove: remove,
      },
    }

    await expect(consumeEngineFallbackNotice()).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith(ENGINE_FALLBACK_NOTICE_KEY, expect.any(Function))
  })

  it("native：PictelioPrefs 不可用 → false + warn", async () => {
    env.native = true
    env.modules = {}
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(consumeEngineFallbackNotice()).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })
});
