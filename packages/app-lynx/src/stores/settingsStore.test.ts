// isRestricted 单测：R18/R18G 遮罩判定（issue #91 方案：过滤 → 遮罩）
// 用例矩阵：x_restrict ∈ {0,1,2} × showR18 × showR18G 共 12 例（纯函数无 IO）
// 每个 it 内显式设定开关状态，避免依赖 describe 块的执行顺序
// detailQuality 单测（issue #146 T1）：默认 medium + setter + idbKV 持久化恢复；
// node 环境无 indexedDB，顶层 mock idbKV（既有 isRestricted 用例不受影响）
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  detailQuality,
  isRestricted,
  loadSettings,
  setDetailQuality,
  setShowR18,
  setShowR18G,
  showR18,
  showR18G,
} from "./settingsStore"
import { idbGet, idbSet, idbRemove } from "../utils/idbKV"

vi.mock("../utils/idbKV", () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
  idbRemove: vi.fn(async () => {}),
}))

/** 账号级 R18 测试：可控制的 authStore.currentUser（ADR-0103，uid 键控 show_r18_${uid}）。
 * 必须是真实 Vue ref（watch 依赖响应性）；vi.hoisted 不能 import，经 globalThis 暴露。 */
vi.mock("./authStore", async () => {
  const { ref } = await import("vue")
  const currentUser = ref<{ id: number } | null>(null)
  ;(globalThis as unknown as { __lynxMockUser?: typeof currentUser }).__lynxMockUser = currentUser
  return { currentUser }
})

type UserRef = { value: { id: number } | null }
const userRef = (): UserRef => (globalThis as unknown as { __lynxMockUser: UserRef }).__lynxMockUser

/** 环境探测（PrefsStorage seam 选择）：native 模式与 NativeModules 内容 */
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

const here = dirname(fileURLToPath(import.meta.url))

describe("settingsStore.isRestricted", () => {
  describe("showR18=off, showR18G=off（默认）", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(false); setShowR18G(false)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 限制", () => {
      setShowR18(false); setShowR18G(false)
      expect(isRestricted({ x_restrict: 1 })).toBe(true)
    })
    it("x_restrict=2 限制", () => {
      setShowR18(false); setShowR18G(false)
      expect(isRestricted({ x_restrict: 2 })).toBe(true)
    })
  })

  describe("showR18=on, showR18G=off", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(true); setShowR18G(false)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 不限制", () => {
      setShowR18(true); setShowR18G(false)
      expect(isRestricted({ x_restrict: 1 })).toBe(false)
    })
    it("x_restrict=2 限制", () => {
      setShowR18(true); setShowR18G(false)
      expect(isRestricted({ x_restrict: 2 })).toBe(true)
    })
  })

  describe("showR18=off, showR18G=on", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(false); setShowR18G(true)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 限制", () => {
      setShowR18(false); setShowR18G(true)
      expect(isRestricted({ x_restrict: 1 })).toBe(true)
    })
    it("x_restrict=2 不限制", () => {
      setShowR18(false); setShowR18G(true)
      expect(isRestricted({ x_restrict: 2 })).toBe(false)
    })
  })

  describe("showR18=on, showR18G=on", () => {
    it("x_restrict=0 不限制", () => {
      setShowR18(true); setShowR18G(true)
      expect(isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 不限制", () => {
      setShowR18(true); setShowR18G(true)
      expect(isRestricted({ x_restrict: 1 })).toBe(false)
    })
    it("x_restrict=2 不限制", () => {
      setShowR18(true); setShowR18G(true)
      expect(isRestricted({ x_restrict: 2 })).toBe(false)
    })
  })
})

// detailQuality 单测（issue #146 T1）：默认 medium + setDetailQuality + idbKV 持久化恢复
describe("settingsStore.detailQuality（issue #146 T1）", () => {
  beforeEach(() => {
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
  })

  it("默认 medium（对齐 webview client settingsStore.ts:230）", () => {
    expect(detailQuality.value).toBe("medium")
  })

  it("setDetailQuality 更新 ref", () => {
    setDetailQuality("large")
    expect(detailQuality.value).toBe("large")
  })

  it("setDetailQuality 持久化到 idbKV", () => {
    setDetailQuality("original")
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_detail_quality", "original")
  })

  it("loadSettings 从 idbKV 恢复持久化档位", async () => {
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_detail_quality" ? "large" : null,
    )
    await loadSettings()
    expect(detailQuality.value).toBe("large")
  })

  it("loadSettings 恢复非法值时不覆盖当前值", async () => {
    setDetailQuality("original")
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_detail_quality" ? "ultra" : null,
    )
    await loadSettings()
    expect(detailQuality.value).toBe("original")
  })
})

// 契约断言：M3 token 必须真实存在于 tokens.css（真实样例硬约束，
// 参照 tests/unit.test.ts 的 tailwind↔tokens 契约模式，读真实源文件比对）
describe("M3 token 契约（Material Design 3 改造）", () => {
  const tokensCss = readFileSync(resolve(here, "../styles/tokens.css"), "utf-8")
  for (const token of ["--md-scrim", "--md-error", "--md-error-container", "--md-shape-large"]) {
    it(`tokens.css 定义 ${token}`, () => {
      expect(tokensCss, `tokens.css 缺少 ${token}`).toContain(`${token}:`)
    })
  }
  it("RestrictOverlay M3 遮罩走 token 且样式块无 backdrop-filter 路线（issue #97）", () => {
    const overlaySrc = readFileSync(resolve(here, "../components/RestrictOverlay.vue"), "utf-8")
    expect(overlaySrc).toContain("var(--md-scrim)")
    // backdrop-filter 路线已废弃（web-core/原生均不支持）——只约束样式块，注释允许提及
    const styleBlock = overlaySrc.split("<style")[1] ?? ""
    expect(styleBlock).not.toContain("backdrop-filter")
    expect(styleBlock).not.toContain("@supports")
    // 遮罩样式块无字面色值（徽章等 UI 允许合法用色）
    const glassBlock = overlaySrc.split(".restrict-overlay")[1] ?? ""
    expect(glassBlock).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}/)
  })
})

describe("settingsStore — 账号级 R18/R18G（ADR-0103）", () => {
  beforeEach(() => {
    userRef().value = null
    env.native = false
    env.modules = {}
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
  })

  it("原生模式：setShowR18 经 PictelioPrefs 写 show_r18_42", async () => {
    env.native = true
    const written: string[] = []
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          written.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          written.push(`del:${k}`)
          cb(null)
        },
      },
    }
    userRef().value = { id: 42 }
    setShowR18(true)
    await vi.waitFor(() => expect(written).toContain("show_r18_42=true"))
  })

  it("原生模式：loadSettings 读共享存储（unquote lynx Callback JSON 引号）", async () => {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(k === "show_r18_42" ? '"true"' : "", null),
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb(null),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    userRef().value = { id: 42 }
    await loadSettings()
    expect(showR18.value).toBe(true)
  })

  it("原生模式迁移：老键 show_r18 播种 show_r18_42 并删老键", async () => {
    env.native = true
    const store = new Map<string, string>([["show_r18", "true"]])
    const ops: string[] = []
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) => cb(store.get(k) ?? "", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          store.set(k, v)
          ops.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          store.delete(k)
          ops.push(`del:${k}`)
          cb(null)
        },
      },
    }
    userRef().value = { id: 42 }
    await loadSettings()
    expect(showR18.value).toBe(true)
    expect(ops).toContain("show_r18_42=true")
    expect(ops).toContain("del:show_r18")
  })

  it("dev 模式：IndexedDB 迁移 settings_show_r18 → show_r18_42", async () => {
    const store = new Map<string, string>([["settings_show_r18", "true"]])
    vi.mocked(idbGet).mockImplementation(async (k: string) => store.get(k) ?? null)
    vi.mocked(idbSet).mockImplementation(async (k: string, v: string) => {
      store.set(k, v)
    })
    vi.mocked(idbRemove).mockImplementation(async (k: string) => {
      store.delete(k)
    })
    userRef().value = { id: 42 }
    await loadSettings()
    expect(showR18.value).toBe(true)
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("show_r18_42", "true")
    expect(vi.mocked(idbRemove)).toHaveBeenCalledWith("settings_show_r18")
    expect(store.has("settings_show_r18")).toBe(false)
  })

  it("未登录：loadSettings 保持默认且不写盘", async () => {
    await loadSettings()
    expect(showR18.value).toBe(false)
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled()
  })

  it("登出：watch currentUser → refs 重置默认（flush sync 即时）", () => {
    userRef().value = { id: 42 }
    setShowR18(true)
    expect(showR18.value).toBe(true)
    userRef().value = null
    expect(showR18.value).toBe(false)
    expect(showR18G.value).toBe(false)
  })
})
