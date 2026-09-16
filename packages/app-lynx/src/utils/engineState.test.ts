// 引擎生效状态快照解析单测（ADR-0164 / #555 T3）。
// Oracle 来源（独立于被测实现）：
// - 快照行格式 = Java EngineRoute.snapshotLine() 逐字拼接（空格分隔 k=v 三元组，已核对引擎源码）；
// - 原因码字面量 = Java EngineRoute.Reason 全 10 码（spec engine-default-lynx §3.1）；
// - reason="none" = Java reason==null 时 snapshotLine 写出的契约值；
// - E11（spec §10）：快照畸形/缺失 → warn + 按无降级渲染（禁静默）。
// 结构字段（preferred/effective）非法 → 整体 null；reason 缺失/未知 → 结构仍有效，
// 归一 "unknown" 渲染「引擎状态未知」（隐藏降级 = 静默，比未知文案更差）。
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

import {
  ENGINE_STATE_KEY,
  FALLBACK_REASON_CODES,
  REASON_I18N_KEYS,
  parseEngineState,
  readEngineState,
} from "./engineState"
import zhDict from "../i18n/locales/zh-CN"
import enDict from "../i18n/locales/en"

describe("parseEngineState", () => {
  it("解析合法快照行（预检降级：首选 lynx 生效 webview）", () => {
    expect(parseEngineState("preferred=lynx effective=webview reason=lynx_unavailable")).toEqual({
      preferred: "lynx",
      effective: "webview",
      reason: "lynx_unavailable",
    })
  })

  it("解析反向降级行（ADR-0153：首选 webview 生效 lynx）", () => {
    expect(parseEngineState("preferred=webview effective=lynx reason=webview_unavailable")).toEqual({
      preferred: "webview",
      effective: "lynx",
      reason: "webview_unavailable",
    })
  })

  it("effective=none（双失败）保留 none", () => {
    expect(parseEngineState("preferred=lynx effective=none reason=no_engine")).toEqual({
      preferred: "lynx",
      effective: "none",
      reason: "no_engine",
    })
  })

  it("缺 preferred 段 → null + warn（畸形）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEngineState("effective=webview reason=preferred")).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("preferred 非法 kind → null + warn（畸形）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEngineState("preferred=blah effective=webview reason=preferred")).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("非快照字符串（无 k=v 段）→ null + warn（畸形）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEngineState("not-a-snapshot")).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("reason 未知码 → 结构保留 + reason 归一 unknown + warn（Java 侧新增码）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEngineState("preferred=lynx effective=webview reason=some_new_code")).toEqual({
      preferred: "lynx",
      effective: "webview",
      reason: "unknown",
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('reason 缺失 → reason unknown + warn；reason="none"（Java 契约值）→ unknown 不 warn', () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEngineState("preferred=lynx effective=webview")).toEqual({
      preferred: "lynx",
      effective: "webview",
      reason: "unknown",
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(parseEngineState("preferred=lynx effective=lynx reason=none")).toEqual({
      preferred: "lynx",
      effective: "lynx",
      reason: "unknown",
    })
    expect(warn).toHaveBeenCalledTimes(1) // none 不追加 warn
    warn.mockRestore()
  })
})

describe("REASON_I18N_KEYS（spec §9 键集一致性口径，TS 侧）", () => {
  it("键集 = 10 码 + unknown，逐项映射 engineFallback.reason.<code>", () => {
    expect(Object.keys(REASON_I18N_KEYS).sort()).toEqual([...FALLBACK_REASON_CODES, "unknown"].sort())
    for (const code of FALLBACK_REASON_CODES) {
      expect(REASON_I18N_KEYS[code]).toBe(`engineFallback.reason.${code}`)
    }
    expect(REASON_I18N_KEYS.unknown).toBe("engineFallback.reason.unknown")
  })

  it("每个映射键在 zh / en 字典中均真实存在（契约键可解析）", () => {
    for (const key of Object.values(REASON_I18N_KEYS)) {
      expect(typeof zhDict[key]).toBe("string")
      expect(typeof enDict[key]).toBe("string")
    }
  })
})

describe("readEngineState", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.native = false
    env.modules = {}
  })

  it("native：prefsGet 返回快照 → 解析结果", async () => {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(
            k === ENGINE_STATE_KEY
              ? "preferred=lynx effective=webview reason=lynx_unavailable"
              : "",
            null,
          ),
      },
    }
    await expect(readEngineState()).resolves.toEqual({
      preferred: "lynx",
      effective: "webview",
      reason: "lynx_unavailable",
    })
  })

  it("native：lynx Callback JSON 引号包裹 → unquote 后解析", async () => {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) =>
          cb(JSON.stringify("preferred=webview effective=lynx reason=webview_unavailable"), null),
      },
    }
    await expect(readEngineState()).resolves.toEqual({
      preferred: "webview",
      effective: "lynx",
      reason: "webview_unavailable",
    })
  })

  it("native：键缺失（Java 返回空串契约）→ null（不渲染）", async () => {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
      },
    }
    await expect(readEngineState()).resolves.toBeNull()
  })

  it("native：prefsGet 报错 → null + warn（禁静默）", async () => {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", "bridge error"),
      },
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(readEngineState()).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("native：PictelioPrefs 模块不可用 → null + warn（禁静默）", async () => {
    env.native = true
    env.modules = {}
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(readEngineState()).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("dev（web-core 预览）：无原生快照 → null + warn 恰好一次（禁静默跳过；resetModules 取新实例验证 once 语义）", async () => {
    env.native = false
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.resetModules()
    const fresh = (await import("./engineState")) as typeof import("./engineState")
    await expect(fresh.readEngineState()).resolves.toBeNull()
    await expect(fresh.readEngineState()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
