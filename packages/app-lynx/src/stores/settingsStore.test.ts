// isRestricted 单测：R18/R18G 遮罩判定（issue #91 方案：过滤 → 遮罩）
// 用例矩阵：x_restrict ∈ {0,1,2} × showR18 × showR18G 共 12 例（纯函数无 IO）
// 每个 it 内显式设定开关状态，避免依赖 describe 块的执行顺序
// detailQuality 单测（issue #146 T1）：默认 medium + setter + idbKV 持久化恢复；
// node 环境无 indexedDB，顶层 mock idbKV（既有 isRestricted 用例不受影响）
// Pinia 化（ADR-0139/T5）：mock 形式从「导出 currentUser ref」改为「替换 useAuthStore 单函数」
// ——与 T2 router-shim-integration 同模式；mock useAuthStore() 返回 currentUser
// ref 实例（settingsStore 内 `useAuthStore()` 即读到本 mock 的 _user.value），
// __lynxMockUser 全局钩子保留供各用例推/拉 currentUser。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import { useSettingsStore, BACKUP_DEVICE_KEYS } from "./settingsStore"
import { idbGet, idbSet, idbRemove } from "../utils/idbKV"

vi.mock("../utils/idbKV", () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
  idbRemove: vi.fn(async () => {}),
}))

/** 账号级 R18 测试：可控制的 authStore.currentUser（ADR-0103，uid 键控 show_r18_${uid}）。
 * mock useAuthStore 返回的 currentUser 必须是真实 Vue ref（setup 内
 * `const auth = useAuthStore()` 即读本 mock 的 currentUser，watch 也跟踪其 .value）。
 * 经 globalThis 暴露供各用例推/拉。 */
const mockUser = ref<{ id: number } | null>(null)
vi.mock("./authStore", () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))
;(globalThis as unknown as { __lynxMockUser?: typeof mockUser }).__lynxMockUser = mockUser
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

/** 每用例隔离 pinia 实例（替代旧 resetSearchHistoryForTest 套路） */
let store: ReturnType<typeof useSettingsStore>

beforeEach(() => {
  setActivePinia(createPinia())
  store = useSettingsStore()
})

describe("settingsStore.isRestricted", () => {
  describe("showR18=off, showR18G=off（默认）", () => {
    it("x_restrict=0 不限制", () => {
      store.setShowR18(false); store.setShowR18G(false)
      expect(store.isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 限制", () => {
      store.setShowR18(false); store.setShowR18G(false)
      expect(store.isRestricted({ x_restrict: 1 })).toBe(true)
    })
    it("x_restrict=2 限制", () => {
      store.setShowR18(false); store.setShowR18G(false)
      expect(store.isRestricted({ x_restrict: 2 })).toBe(true)
    })
  })

  describe("showR18=on, showR18G=off", () => {
    it("x_restrict=0 不限制", () => {
      store.setShowR18(true); store.setShowR18G(false)
      expect(store.isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 不限制", () => {
      store.setShowR18(true); store.setShowR18G(false)
      expect(store.isRestricted({ x_restrict: 1 })).toBe(false)
    })
    it("x_restrict=2 限制", () => {
      store.setShowR18(true); store.setShowR18G(false)
      expect(store.isRestricted({ x_restrict: 2 })).toBe(true)
    })
  })

  describe("showR18=off, showR18G=on", () => {
    it("x_restrict=0 不限制", () => {
      store.setShowR18(false); store.setShowR18G(true)
      expect(store.isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 限制", () => {
      store.setShowR18(false); store.setShowR18G(true)
      expect(store.isRestricted({ x_restrict: 1 })).toBe(true)
    })
    it("x_restrict=2 不限制", () => {
      store.setShowR18(false); store.setShowR18G(true)
      expect(store.isRestricted({ x_restrict: 2 })).toBe(false)
    })
  })

  describe("showR18=on, showR18G=on", () => {
    it("x_restrict=0 不限制", () => {
      store.setShowR18(true); store.setShowR18G(true)
      expect(store.isRestricted({ x_restrict: 0 })).toBe(false)
    })
    it("x_restrict=1 不限制", () => {
      store.setShowR18(true); store.setShowR18G(true)
      expect(store.isRestricted({ x_restrict: 1 })).toBe(false)
    })
    it("x_restrict=2 不限制", () => {
      store.setShowR18(true); store.setShowR18G(true)
      expect(store.isRestricted({ x_restrict: 2 })).toBe(false)
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
    expect(store.detailQuality).toBe("medium")
  })

  it("setDetailQuality 更新 ref", () => {
    store.setDetailQuality("large")
    expect(store.detailQuality).toBe("large")
  })

  it("setDetailQuality 持久化到 idbKV", () => {
    store.setDetailQuality("original")
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_detail_quality", "original")
  })

  it("loadSettings 从 idbKV 恢复持久化档位", async () => {
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_detail_quality" ? "large" : null,
    )
    await store.loadSettings()
    expect(store.detailQuality).toBe("large")
  })

  it("loadSettings 恢复非法值时不覆盖当前值", async () => {
    store.setDetailQuality("original")
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_detail_quality" ? "ultra" : null,
    )
    await store.loadSettings()
    expect(store.detailQuality).toBe("original")
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
    // spec lynx-night-mode T4 闭环：scrim 上文字必须走 --colorOverlayForeground（替代 text-white）
    expect(overlaySrc).toContain("var(--colorOverlayForeground)")
    // backdrop-filter 路线已废弃（web-core/原生均不支持）——只约束样式块，注释允许提及
    const styleBlock = overlaySrc.split("<style")[1] ?? ""
    expect(styleBlock).not.toContain("backdrop-filter")
    expect(styleBlock).not.toContain("@supports")
    // 遮罩样式块无字面色值（徽章等 UI 允许合法用色）
    const glassBlock = overlaySrc.split(".restrict-overlay")[1] ?? ""
    expect(glassBlock).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}/)
  })

  it("AiOverlay M3 遮罩走 token 且样式块无 backdrop-filter/字面色值（ADR-0155）", () => {
    const overlaySrc = readFileSync(resolve(here, "../components/AiOverlay.vue"), "utf-8")
    expect(overlaySrc).toContain("var(--md-scrim)")
    // spec lynx-night-mode T4 闭环：scrim 上文字必须走 --colorOverlayForeground
    expect(overlaySrc).toContain("var(--colorOverlayForeground)")
    const styleBlock = overlaySrc.split("<style")[1] ?? ""
    expect(styleBlock).not.toContain("backdrop-filter")
    expect(styleBlock).not.toContain("@supports")
    const glassBlock = overlaySrc.split(".ai-overlay")[1] ?? ""
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
    store.setShowR18(true)
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
    await store.loadSettings()
    expect(store.showR18).toBe(true)
  })

  it("原生模式迁移：老键 show_r18 播种 show_r18_42 并删老键", async () => {
    env.native = true
    const storeMap = new Map<string, string>([["show_r18", "true"]])
    const ops: string[] = []
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) => cb(storeMap.get(k) ?? "", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          storeMap.set(k, v)
          ops.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          storeMap.delete(k)
          ops.push(`del:${k}`)
          cb(null)
        },
      },
    }
    userRef().value = { id: 42 }
    await store.loadSettings()
    expect(store.showR18).toBe(true)
    expect(ops).toContain("show_r18_42=true")
    expect(ops).toContain("del:show_r18")
  })

  it("dev 模式：IndexedDB 迁移 settings_show_r18 → show_r18_42", async () => {
    const storeMap = new Map<string, string>([["settings_show_r18", "true"]])
    vi.mocked(idbGet).mockImplementation(async (k: string) => storeMap.get(k) ?? null)
    vi.mocked(idbSet).mockImplementation(async (k: string, v: string) => {
      storeMap.set(k, v)
    })
    vi.mocked(idbRemove).mockImplementation(async (k: string) => {
      storeMap.delete(k)
    })
    userRef().value = { id: 42 }
    await store.loadSettings()
    expect(store.showR18).toBe(true)
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("show_r18_42", "true")
    expect(vi.mocked(idbRemove)).toHaveBeenCalledWith("settings_show_r18")
    expect(storeMap.has("settings_show_r18")).toBe(false)
  })

  it("未登录：loadSettings 保持默认且不写盘", async () => {
    await store.loadSettings()
    expect(store.showR18).toBe(false)
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled()
  })

  it("登出：watch currentUser → refs 重置默认（flush sync 即时）", () => {
    userRef().value = { id: 42 }
    store.setShowR18(true)
    expect(store.showR18).toBe(true)
    userRef().value = null
    expect(store.showR18).toBe(false)
    expect(store.showR18G).toBe(false)
  })
})

// 主题色（外观）：设备级持久化（native SharedPreferences / dev IndexedDB），
// 未登录也应恢复；非法持久化值维持默认并 warn（禁止静默降级）。
describe("settingsStore — 主题色（外观）", () => {
  beforeEach(() => {
    userRef().value = null
    env.native = false
    env.modules = {}
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
  })

  it("默认 sky", () => {
    expect(store.themeColor).toBe("sky")
  })

  it("setThemeColor 更新 ref 并经 prefs seam 持久化（dev=IndexedDB）", () => {
    store.setThemeColor("violet")
    expect(store.themeColor).toBe("violet")
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_theme_color", "violet")
  })

  it("loadSettings 在未登录状态也恢复主题色（设备级，先于 uid 判定）", async () => {
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_theme_color" ? "green" : null,
    )
    await store.loadSettings()
    expect(store.themeColor).toBe("green")
  })

  it("loadSettings 恢复非法值 → 维持默认 sky 并 console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_theme_color" ? "neon" : null,
    )
    await store.loadSettings()
    expect(store.themeColor).toBe("sky")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("主题色"), "neon")
    warn.mockRestore()
  })

  it("原生模式：setThemeColor 经 PictelioPrefs 写 settings_theme_color", async () => {
    env.native = true
    const written: string[] = []
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          written.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    store.setThemeColor("orange")
    await vi.waitFor(() => expect(written).toContain("settings_theme_color=orange"))
  })

  it("读取失败（IO 异常）→ 维持默认 sky 并 console.warn（硬约束 #1/#3）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (key: string) => {
      if (key === "settings_theme_color") throw new Error("idb down")
      return null
    })
    await store.loadSettings()
    expect(store.themeColor).toBe("sky")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("主题色加载失败"), expect.any(Error))
    warn.mockRestore()
  })

  it("写入失败（IO 异常）→ 内存态即时更新但 warn，不静默吞（硬约束 #3）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbSet).mockRejectedValue(new Error("idb down"))
    store.setThemeColor("violet")
    expect(store.themeColor).toBe("violet")
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("主题色写入失败"), expect.any(Error)),
    )
    warn.mockRestore()
  })
})

// 暗色外观三态（spec docs/specs/lynx-night-mode.md T1）：默认 system + 设备级持久化 +
// 非法值 warn + 回退默认；resolvedDark 派生（手动即时映射；system 随哑桥源重算）。
// oracle = spec §1 + ADR-0152 themeColor 同模式（清单单一事实源 + isDarkModeId 校验）。
// currentDarkMode ref 是模块级单例（settingsStore 与本测试 import 同一实例），
// 测试通过直接读写 currentDarkMode.value 触发响应；不复位模块（避免 settingsStore 内
// 已绑定的 ref 引用与新实例不一致）。
import { currentDarkMode as _bridgeDarkMode } from "../utils/darkMode"
describe("settingsStore — 暗色外观三态（spec lynx-night-mode T1）", () => {
  beforeEach(() => {
    userRef().value = null
    env.native = false
    env.modules = {}
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    // 哑桥：node 测试环境无 matchMedia → 走兜底 light（与 darkMode.test.ts 同思路）
    delete (globalThis as Record<string, unknown>).matchMedia
    delete (globalThis as Record<string, unknown>).lynx
    delete (globalThis as Record<string, unknown>).NativeModules
    // 哑桥初值 light（每用例重置，避免其它 describe 注入的 matchMedia 干扰）
    _bridgeDarkMode.value = "light"
    setActivePinia(createPinia())
    store = useSettingsStore()
  })

  it("默认 system（跟随系统，首次启动零配置成本）", () => {
    expect(store.darkMode).toBe("system")
    expect(store.resolvedDark).toBe("light") // currentDarkMode 兜底 light
  })

  it("setDarkMode(light)：即时映射 + 持久化（dev=IndexedDB）", async () => {
    store.setDarkMode("light")
    expect(store.darkMode).toBe("light")
    expect(store.resolvedDark).toBe("light")
    await vi.waitFor(() =>
      expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_dark_mode", "light"),
    )
  })

  it("setDarkMode(dark)：即时映射（不论哑桥初值）", () => {
    _bridgeDarkMode.value = "light"
    store.setDarkMode("dark")
    expect(store.darkMode).toBe("dark")
    expect(store.resolvedDark).toBe("dark")
  })

  it("setDarkMode(system)：从哑桥源派生", () => {
    _bridgeDarkMode.value = "dark"
    store.setDarkMode("system")
    expect(store.darkMode).toBe("system")
    expect(store.resolvedDark).toBe("dark")
    // 哑桥变化 → resolvedDark 即时重算
    _bridgeDarkMode.value = "light"
    expect(store.resolvedDark).toBe("light")
  })

  it("loadSettings 恢复合法值 light / dark / system", async () => {
    for (const v of ["light", "dark", "system"] as const) {
      vi.mocked(idbGet).mockImplementation(async (key: string) =>
        key === "settings_dark_mode" ? v : null,
      )
      await store.loadSettings()
      expect(store.darkMode).toBe(v)
    }
  })

  it("loadSettings 恢复非法值 → 维持默认 system + console.warn（禁静默降级）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_dark_mode" ? "auto" : null,
    )
    await store.loadSettings()
    expect(store.darkMode).toBe("system")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("暗色外观值非法"), "auto")
    warn.mockRestore()
  })

  it("loadSettings 读取失败（IO 异常）→ 维持默认 system + warn（硬约束 #1/#3）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (key: string) => {
      if (key === "settings_dark_mode") throw new Error("idb down")
      return null
    })
    await store.loadSettings()
    expect(store.darkMode).toBe("system")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("暗色外观加载失败"), expect.any(Error))
    warn.mockRestore()
  })

  it("loadSettings 未登录也恢复暗色状态（设备级，先于 uid 判定）", async () => {
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_dark_mode" ? "dark" : null,
    )
    userRef().value = null // 未登录
    await store.loadSettings()
    expect(store.darkMode).toBe("dark")
  })

  it("setDarkMode 写入失败 → 内存态即时更新 + warn，不静默吞（硬约束 #3）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbSet).mockRejectedValue(new Error("idb down"))
    store.setDarkMode("dark")
    expect(store.darkMode).toBe("dark")
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("暗色外观写入失败"), expect.any(Error)),
    )
    warn.mockRestore()
  })

  it("原生模式：setDarkMode 经 PictelioPrefs 写 settings_dark_mode", async () => {
    env.native = true
    const written: string[] = []
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          written.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    store.setDarkMode("dark")
    await vi.waitFor(() => expect(written).toContain("settings_dark_mode=dark"))
  })

  it("原生模式：loadSettings 从 prefs 恢复 settings_dark_mode", async () => {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(k === "settings_dark_mode" ? JSON.stringify("dark") : "", null),
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb(null),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    await store.loadSettings()
    expect(store.darkMode).toBe("dark")
  })

  it("resolvedDark 是 computed：手动 light/dark 即时映射，system 跟随哑桥源", () => {
    _bridgeDarkMode.value = "light"
    // 初始：light + system → 跟随 light
    store.setDarkMode("system")
    expect(store.resolvedDark).toBe("light")
    // 哑桥 → dark
    _bridgeDarkMode.value = "dark"
    expect(store.resolvedDark).toBe("dark")
    // 切到手动 dark（无关哑桥）
    store.setDarkMode("dark")
    expect(store.resolvedDark).toBe("dark")
    // 哑桥回到 light，dark 仍是 dark（手动不跟随）
    _bridgeDarkMode.value = "light"
    expect(store.resolvedDark).toBe("dark")
    // 切回 system，跟随哑桥
    store.setDarkMode("system")
    expect(store.resolvedDark).toBe("light")
  })

  it("importRawValues：合法值应用，非法值跳过", async () => {
    const res = await store.importRawValues({
      settings_dark_mode: "dark",
      settings_dark_mode_bogus: "bogus",
    })
    expect(store.darkMode).toBe("dark")
    expect(res.applied).toContain("settings_dark_mode")
    expect(res.skipped).toContain("settings_dark_mode_bogus")
  })

  it("BACKUP_DEVICE_KEYS 含 settings_dark_mode（设备级，进备份域）", () => {
    expect(BACKUP_DEVICE_KEYS as readonly string[]).toContain("settings_dark_mode")
  })
})

// 小说导出设置（oracle = spec docs/specs/novel-export.md §6：4 键 + 默认值 + 非法值 warn）
describe("settingsStore — 小说导出设置（spec novel-export §6）", () => {
  beforeEach(() => {
    userRef().value = null
    env.native = false
    env.modules = {}
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
  })

  it("默认：格式 txt + 三项开关全开", () => {
    expect(store.novelExportFormat).toBe("txt")
    expect(store.novelExportOptions).toEqual({
      includeMetadata: true,
      includeCover: true,
      includeInlineImages: true,
    })
  })

  it("setNovelExportFormat 更新 ref 并经 prefs seam 持久化（dev=IndexedDB）", () => {
    store.setNovelExportFormat("epub")
    expect(store.novelExportFormat).toBe("epub")
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_novel_export_format", "epub")
  })

  it("setNovelExportInclude* 分别持久化且更新快照", () => {
    store.setNovelExportIncludeMetadata(false)
    store.setNovelExportIncludeCover(false)
    expect(store.novelExportOptions).toEqual({
      includeMetadata: false,
      includeCover: false,
      includeInlineImages: true,
    })
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith(
      "settings_novel_export_include_metadata",
      "false",
    )
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_novel_export_include_cover", "false")
  })

  it("loadSettings 恢复合法格式与开关", async () => {
    vi.mocked(idbGet).mockImplementation(async (key: string) => {
      switch (key) {
        case "settings_novel_export_format":
          return "pdf"
        case "settings_novel_export_include_metadata":
          return "false"
        case "settings_novel_export_include_images":
          return "false"
        default:
          return null
      }
    })
    await store.loadSettings()
    expect(store.novelExportFormat).toBe("pdf")
    expect(store.novelExportOptions).toEqual({
      includeMetadata: false,
      includeCover: true,
      includeInlineImages: false,
    })
  })

  it("loadSettings 非法格式值维持默认 txt 并 console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_novel_export_format" ? "bogus" : null,
    )
    await store.loadSettings()
    expect(store.novelExportFormat).toBe("txt")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("小说导出格式"), "bogus")
    warn.mockRestore()
  })
})

// AI 三态过滤（ADR-0155）：账号级共享键 ai_filter_mode_${uid}；真值表 3 模式 × 4 值。
// 期望值 oracle = docs/adr/ADR-0155 三态语义（独立于实现）。
describe("settingsStore — AI 三态过滤（ADR-0155）", () => {
  beforeEach(() => {
    userRef().value = null
    env.native = false
    env.modules = {}
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
  })

  // 3 模式 × 4 值真值表由 tests/differential/aiFilterTruthTable.test.ts 消费共享 fixture
  // （sharedAiFilterTruthTable.ts，与 app 侧逐字节一致）断言——两端实现直接对同一 fixture
  // 断言，任一实现漂移即失败（机器防线）；本文件不再内联第二份表（避免 duplicate oracle）。

  it("isAiWork：ai_type>=1 为 AI（插画/小说字段都识别），缺失视为非 AI", () => {
    expect(store.isAiWork({ illust_ai_type: 0 })).toBe(false)
    expect(store.isAiWork({ illust_ai_type: 1 })).toBe(true)
    expect(store.isAiWork({ novel_ai_type: 2 })).toBe(true)
    expect(store.isAiWork({})).toBe(false)
  })

  it("默认 show", () => {
    expect(store.aiFilterMode).toBe("show")
  })

  it("原生模式：setAiFilterMode 写 ai_filter_mode_42", async () => {
    env.native = true
    const written: string[] = []
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          written.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    userRef().value = { id: 42 }
    store.setAiFilterMode("only")
    await vi.waitFor(() => expect(written).toContain("ai_filter_mode_42=only"))
  })

  it("dev 模式：loadSettings 读共享键 ai_filter_mode_42", async () => {
    vi.mocked(idbGet).mockImplementation(async (k: string) =>
      k === "ai_filter_mode_42" ? "mask" : null,
    )
    userRef().value = { id: 42 }
    await store.loadSettings()
    expect(store.aiFilterMode).toBe("mask")
  })

  it("非法持久化值 → 默认 show + warn（禁止静默降级）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (k: string) =>
      k === "ai_filter_mode_42" ? "bogus" : null,
    )
    userRef().value = { id: 42 }
    await store.loadSettings()
    expect(store.aiFilterMode).toBe("show")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("AI 模式值非法"), "bogus")
    warn.mockRestore()
  })

  it("未登录：loadSettings 保持默认 show 且不写盘", async () => {
    await store.loadSettings()
    expect(store.aiFilterMode).toBe("show")
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled()
  })

  it("登出：watch currentUser → aiFilterMode 重置 show", () => {
    userRef().value = { id: 42 }
    store.setAiFilterMode("only")
    expect(store.aiFilterMode).toBe("only")
    userRef().value = null
    expect(store.aiFilterMode).toBe("show")
  })
})

// WebDAV 连接配置单测（spec docs/specs/webdav-backup.md §7/§8；T5 双端对齐 app settingsStoreWebdav.test.ts）
// IO 边界双路径（硬约束 #1）：原生 PictelioPrefs 成功/降级 + dev idbKV 降级 + 写失败。
describe("settingsStore.webdav（T5）", () => {
  beforeEach(() => {
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
    userRef().value = null
    env.native = false
    env.modules = {}
  })

  /** 注入原生 PictelioPrefs（storeMap 为种子数据；failGet/failSet 构造失败路径） */
  function nativePrefs(map: Map<string, string>, opts: { failGet?: boolean; failSet?: boolean } = {}) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) => {
          if (opts.failGet) {
            cb("", "keystore lost")
            return
          }
          // native Callback 值带 JSON 引号（adapter 层 unquote 契约）；
          // 用 JSON.stringify 包裹以正确转义内嵌引号（真实 Callback 编码形态，
          // 手写 "${v}" 对含引号值（如 JSON 数组）会产生非法 JSON）
          const v = map.get(k)
          cb(v === undefined ? "" : JSON.stringify(v), null)
        },
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => {
          if (opts.failSet) {
            cb("disk full")
            return
          }
          cb(null)
        },
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
  }

  it("原生模式：loadSettings 恢复 8 键（默认值对齐 app 侧 spec §7）", async () => {
    nativePrefs(
      new Map([
        ["settings_webdav_enabled", "true"],
        ["settings_webdav_url", "https://dav.example.com"],
        ["settings_webdav_username", "alice"],
        ["settings_webdav_dir", "MyBackup/dir"],
        ["settings_webdav_auto_backup", "true"],
        ["settings_webdav_auto_backup_days", "30"],
        ["settings_webdav_last_backup", "2026-09-11T17:30:00+08:00"],
        ["settings_webdav_excluded_keys", '["show_r18_1"]'],
      ]),
    )
    await store.loadSettings()
    expect(store.webdavEnabled).toBe(true)
    expect(store.webdavUrl).toBe("https://dav.example.com")
    expect(store.webdavUsername).toBe("alice")
    expect(store.webdavDir).toBe("MyBackup/dir")
    expect(store.webdavAutoBackup).toBe(true)
    expect(store.webdavAutoBackupDays).toBe(30)
    expect(store.webdavLastBackup).toBe("2026-09-11T17:30:00+08:00")
    expect(store.webdavExcludedKeys).toEqual(["show_r18_1"])
  })

  it("默认值：无记录 → 全关、目录 Pictelio/backup、周期 7、排除清单空", async () => {
    nativePrefs(new Map())
    await store.loadSettings()
    expect(store.webdavEnabled).toBe(false)
    expect(store.webdavDir).toBe("Pictelio/backup")
    expect(store.webdavAutoBackupDays).toBe(7)
    expect(store.webdavExcludedKeys).toEqual([])
  })

  it("降级：days 非法值 → 默认 7 + warn", async () => {
    nativePrefs(new Map([["settings_webdav_auto_backup_days", "999"]]))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()
    expect(store.webdavAutoBackupDays).toBe(7)
    expect(warn).toHaveBeenCalledWith(
      "[settingsStore] WebDAV 自动备份周期非法，维持默认 7:",
      "999",
    )
    warn.mockRestore()
  })

  it("降级：布尔键非法值 → 默认 false + warn（对齐 app registry corrupt 行为）", async () => {
    nativePrefs(new Map([["settings_webdav_enabled", "yes"]]))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()
    expect(store.webdavEnabled).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      "[settingsStore] WebDAV 开关值非法，维持默认 false:",
      "yes",
    )
    warn.mockRestore()
  })

  it("降级：排除清单非法 JSON → 默认空 + warn", async () => {
    nativePrefs(new Map([["settings_webdav_excluded_keys", "{not-json"]]))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()
    expect(store.webdavExcludedKeys).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("降级：原生读取失败 → 维持默认 + warn（不静默）", async () => {
    nativePrefs(new Map([["settings_webdav_url", "https://x"]]), { failGet: true })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()
    expect(store.webdavUrl).toBe("")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("成功：setWebdavEnabled 经 PictelioPrefs 写 settings_webdav_enabled", async () => {
    const written: string[] = []
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          written.push(`${k}=${v}`)
          cb(null)
        },
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    store.setWebdavEnabled(true)
    await vi.waitFor(() => expect(written).toContain("settings_webdav_enabled=true"))
  })

  it("失败：prefsSet 报错 → warn 可见（fire-and-forget 不抛）", async () => {
    nativePrefs(new Map(), { failSet: true })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    store.setWebdavDir("Other/dir")
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[settingsStore] WebDAV 目录写入失败",
        expect.anything(),
      ),
    )
    warn.mockRestore()
  })

  it("dev 降级：web-core 无 NativeModules → 走 idbKV 读写", async () => {
    env.native = false
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === "settings_webdav_url" ? "https://dev.example.com" : null,
    )
    await store.loadSettings()
    expect(store.webdavUrl).toBe("https://dev.example.com")
    store.setWebdavAutoBackupDays(3)
    expect(vi.mocked(idbSet)).toHaveBeenCalledWith("settings_webdav_auto_backup_days", "3")
  })
})


describe('settingsStore 备份原语（T7 m3：exportRawValues / importRawValues 直测）', () => {
  beforeEach(() => {
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
    env.native = true
    env.modules = {}
    userRef().value = { id: 42 }
  })

  function prefsModule(map: Map<string, string>) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(map.has(k) ? JSON.stringify(map.get(k)!) : '', null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          map.set(k, v)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          map.delete(k)
          cb(null)
        },
      },
    }
  }

  it('exportRawValues：双源读取（idbKV 的 ugoiraMode/detailQuality + prefs 其余）+ 未记录键省略', async () => {
    vi.mocked(idbGet).mockImplementation(async (key: string) =>
      key === 'settings_ugoira_mode' ? 'fflate' : key === 'settings_detail_quality' ? 'large' : null,
    )
    const map = new Map<string, string>([['settings_theme_color', 'blue']])
    prefsModule(map)

    const raw = await store.exportRawValues()
    expect(raw.settings_ugoira_mode).toBe('fflate') // idb 源
    expect(raw.settings_detail_quality).toBe('large') // idb 源（另一键，m3 补测）
    expect(raw.settings_theme_color).toBe('blue') // prefs 源
    expect(raw.show_r18_42).toBeUndefined() // 无记录账号键不出现
  })

  it('importRawValues：设备/账号键写回；异账号与未知键跳过（merge-by-keys）', async () => {
    const map = new Map<string, string>()
    prefsModule(map)

    const res = await store.importRawValues({
      settings_ugoira_mode: 'range',
      settings_detail_quality: 'original',
      show_r18_42: 'true',
      show_r18_99: 'true',
      unknown_key: 'x',
    })

    expect(store.ugoiraMode).toBe('range')
    expect(store.detailQuality).toBe('original')
    expect(store.showR18).toBe(true)
    expect(res.applied).toContain('settings_ugoira_mode')
    expect(res.applied).toContain('show_r18_42')
    expect(res.skipped).toContain('show_r18_99')
    expect(res.skipped).toContain('unknown_key')
    expect(map.has('show_r18_99')).toBe(false) // 异账号键未落盘
  })

  // ── #519 code-review 回归：设备级键必须全部登记进备份域（否则跨引擎恢复静默丢键）──
  // oracle：spec docs/specs/webdav-backup.md §3.1 + app registry.rawValues 全键语义。
  it('settingsStore.ts 内所有 *_KEY 字面量 ⊆ BACKUP_DEVICE_KEYS（设备级键完整性守卫）', () => {
    const storeSrc = readFileSync(fileURLToPath(new URL('./settingsStore.ts', import.meta.url)), 'utf8')
    const declared = [...storeSrc.matchAll(/const [A-Z_]+_KEY = "([^"]+)"/g)].map((m) => m[1]!)
    expect(declared.length).toBeGreaterThan(10)
    const missing = declared.filter((k) => !(BACKUP_DEVICE_KEYS as readonly string[]).includes(k))
    expect(missing).toEqual([])
  })

  it('BACKUP_DEVICE_KEYS 每项均有 applyRawKey 分支（导入侧完整性守卫）', () => {
    const storeSrc = readFileSync(fileURLToPath(new URL('./settingsStore.ts', import.meta.url)), 'utf8')
    const constByLiteral = new Map(
      [...storeSrc.matchAll(/const ([A-Z_]+_KEY) = "([^"]+)"/g)].map((m) => [m[2]!, m[1]!]),
    )
    const uncovered = (BACKUP_DEVICE_KEYS as readonly string[])
      .map((key) => ({ key, constName: constByLiteral.get(key) }))
      .filter((x) => !x.constName || !storeSrc.includes(`case ${x.constName}:`))
    expect(uncovered).toEqual([])
  })

  it('exportRawValues 含 related_injection / ranking_entry（设备级开关）', async () => {
    prefsModule(new Map<string, string>([
      ['related_injection', 'false'],
      ['ranking_entry', 'false'],
    ]))
    const raw = await store.exportRawValues()
    expect(raw.related_injection).toBe('false')
    expect(raw.ranking_entry).toBe('false')
  })

  it('importRawValues 写回 related_injection / ranking_entry（非法值跳过）', async () => {
    prefsModule(new Map<string, string>())
    const res = await store.importRawValues({
      related_injection: 'false',
      ranking_entry: 'false',
      related_injection_bogus: 'bogus',
    })
    expect(store.relatedInjection).toBe(false)
    expect(store.rankingEntry).toBe(false)
    expect(res.applied).toContain('related_injection')
    expect(res.applied).toContain('ranking_entry')
    expect(res.skipped).toContain('related_injection_bogus')
  })
})

// related_injection 设备级开关（spec docs/specs/related-injection.md；review P2 补测：加载/非法值/写入路径）
describe("settingsStore.relatedInjection（spec #486）", () => {
  /** prefs seam（与上方 WebDAV describe 同款 mock） */
  function prefsModule(map: Map<string, string>) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(map.has(k) ? JSON.stringify(map.get(k)!) : '', null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          map.set(k, v)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          map.delete(k)
          cb(null)
        },
      },
    }
  }

  beforeEach(() => {
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    setActivePinia(createPinia())
    store = useSettingsStore()
  })

  it("默认开启", () => {
    expect(store.relatedInjection).toBe(true)
  })

  it("setRelatedInjection 持久化到 prefs（键 related_injection，native 路径）", async () => {
    const map = new Map<string, string>()
    prefsModule(map)
    store.setRelatedInjection(false)
    await vi.waitFor(() => expect(map.get("related_injection")).toBe("false"))
    expect(store.relatedInjection).toBe(false)
  })

  it("loadSettings 从 prefs 恢复持久化开关", async () => {
    const map = new Map<string, string>([["related_injection", "false"]])
    prefsModule(map)
    await store.loadSettings()
    expect(store.relatedInjection).toBe(false)
  })

  it("loadSettings 非法值不覆盖当前值（warn 可见，禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const map = new Map<string, string>([["related_injection", "bogus"]])
    prefsModule(map)
    await store.loadSettings()
    expect(store.relatedInjection).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("相关作品注入"), "bogus")
    warnSpy.mockRestore()
  })
})

// ranking_entry 设备级开关（spec docs/specs/ranking.md §5.8；#519：加载/非法值/写入）
describe("settingsStore.rankingEntry（spec #519）", () => {
  function prefsModule(map: Map<string, string>) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(map.has(k) ? JSON.stringify(map.get(k)!) : '', null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          map.set(k, v)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          map.delete(k)
          cb(null)
        },
      },
    }
  }

  beforeEach(() => {
    env.native = false
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    setActivePinia(createPinia())
    store = useSettingsStore()
  })

  it("默认开启", () => {
    expect(store.rankingEntry).toBe(true)
  })

  it("loadSettings 读取失败 → warn 可见、维持默认（禁静默降级，硬约束 #1）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(idbGet).mockImplementation(async (key: string) => {
      if (key === "ranking_entry") throw new Error("read fail")
      return null
    })
    await store.loadSettings()
    expect(store.rankingEntry).toBe(true)
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("排行榜入口"), expect.anything()),
    )
    warnSpy.mockRestore()
  })

  it("prefs 写入失败 → warn 可见（不抛出，硬约束 #1）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb("storage full"),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    store.setRankingEntry(true)
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("排行榜入口"), expect.anything()),
    )
    warnSpy.mockRestore()
  })

  it("setRankingEntry 持久化到 prefs（键 ranking_entry）", async () => {
    const map = new Map<string, string>()
    prefsModule(map)
    store.setRankingEntry(false)
    await vi.waitFor(() => expect(map.get("ranking_entry")).toBe("false"))
    expect(store.rankingEntry).toBe(false)
  })

  it("loadSettings 从 prefs 恢复持久化开关", async () => {
    const map = new Map<string, string>([["ranking_entry", "false"]])
    prefsModule(map)
    await store.loadSettings()
    expect(store.rankingEntry).toBe(false)
  })

  it("loadSettings 非法值不覆盖当前值（warn 可见，禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const map = new Map<string, string>([["ranking_entry", "bogus"]])
    prefsModule(map)
    await store.loadSettings()
    expect(store.rankingEntry).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("排行榜入口"), "bogus")
    warnSpy.mockRestore()
  })
})

// 引擎自动回退开关（ADR-0164 / #555 T3）：设备级布尔缺省开；键 pictelio_engine_auto_fallback
// 与 app 侧逐字一致（唯一所有者 = Java EnginePrefs.KEY_AUTO_FALLBACK，字面量已核对引擎源码）。
// 期望值 oracle = spec engine-default-lynx §3 键表（缺省 true，值域 "true"/"false"）。
describe("settingsStore.autoFallbackEngine（ADR-0164）", () => {
  /** prefs seam（与前述 describe 同款 mock：native Callback 值带 JSON 引号） */
  function prefsModule(map: Map<string, string>) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(map.has(k) ? JSON.stringify(map.get(k)!) : "", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          map.set(k, v)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          map.delete(k)
          cb(null)
        },
      },
    }
  }

  beforeEach(() => {
    env.native = true
    env.modules = {}
    userRef().value = null
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
    setActivePinia(createPinia())
    store = useSettingsStore()
  })

  it("默认开启（缺省 true，spec §3）", () => {
    expect(store.autoFallbackEngine).toBe(true)
  })

  it("loadSettings 从 prefs 恢复 \"false\"", async () => {
    prefsModule(new Map<string, string>([["pictelio_engine_auto_fallback", "false"]]))
    await store.loadSettings()
    expect(store.autoFallbackEngine).toBe(false)
  })

  it("loadSettings 非法值 → 维持默认 true + warn（禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    prefsModule(new Map<string, string>([["pictelio_engine_auto_fallback", "yes"]]))
    await store.loadSettings()
    expect(store.autoFallbackEngine).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("引擎自动回退"), "yes")
    warnSpy.mockRestore()
  })

  it("loadSettings 读取失败 → 维持默认 true + warn（硬约束 #1/#3）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    // dev 模式 idb 抛异常 → loadSettings catch 分支（native 读失败由 adapter resolve(null) + warn，见 WebDAV 读取失败用例）
    env.native = false
    vi.mocked(idbGet).mockImplementation(async (key: string) => {
      if (key === "pictelio_engine_auto_fallback") throw new Error("read fail")
      return null
    })
    await store.loadSettings()
    expect(store.autoFallbackEngine).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("引擎自动回退开关加载失败"),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it("setAutoFallbackEngine 持久化 String(enabled)（native 路径，键 pictelio_engine_auto_fallback）", async () => {
    const map = new Map<string, string>()
    prefsModule(map)
    store.setAutoFallbackEngine(false)
    await vi.waitFor(() => expect(map.get("pictelio_engine_auto_fallback")).toBe("false"))
    expect(store.autoFallbackEngine).toBe(false)
  })

  it("prefs 写入失败 → 内存态已更新 + warn 可见（不抛出，硬约束 #3）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb("disk full"),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    store.setAutoFallbackEngine(false)
    expect(store.autoFallbackEngine).toBe(false)
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("引擎自动回退"), expect.anything()),
    )
    warnSpy.mockRestore()
  })

  it("applyRawKey：importRawValues 写回合法值、非法值跳过", async () => {
    prefsModule(new Map<string, string>())
    const res = await store.importRawValues({
      pictelio_engine_auto_fallback: "false",
      pictelio_engine_auto_fallback_bogus: "bogus",
    })
    expect(store.autoFallbackEngine).toBe(false)
    expect(res.applied).toContain("pictelio_engine_auto_fallback")
    expect(res.skipped).toContain("pictelio_engine_auto_fallback_bogus")
  })
})

// 全屏模式开关（spec docs/specs/lynx-systembars.md D5）：设备级默认关 + 原生即时切换。
// oracle = spec D5 + Java LynxActivity.KEY_FULLSCREEN_MODE（键字面量经 safeAreaJavaContract 钉住）。
describe("settingsStore.fullscreenMode（spec lynx-systembars D5）", () => {
  /** prefs seam（同 autoFallbackEngine describe 的 mock：native Callback 值带 JSON 引号） */
  function prefsModule(map: Map<string, string>) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(map.has(k) ? JSON.stringify(map.get(k)!) : "", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          map.set(k, v)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          map.delete(k)
          cb(null)
        },
      },
    }
  }

  const setSystemBarsHidden = vi.fn((_hidden: boolean, cb: (e: string | null) => void) => cb(null))

  beforeEach(() => {
    env.native = true
    env.modules = { PictelioApp: { setSystemBarsHidden } }
    setSystemBarsHidden.mockClear()
    userRef().value = null
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
    setActivePinia(createPinia())
    store = useSettingsStore()
  })

  it("默认关闭（缺省 false）", () => {
    expect(store.fullscreenMode).toBe(false)
  })

  it("loadSettings 从 prefs 恢复 \"true\"", async () => {
    prefsModule(new Map<string, string>([["settings_fullscreen_mode", "true"]]))
    await store.loadSettings()
    expect(store.fullscreenMode).toBe(true)
  })

  it("loadSettings 非法值 → 维持默认 false + warn（禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    prefsModule(new Map<string, string>([["settings_fullscreen_mode", "on"]]))
    await store.loadSettings()
    expect(store.fullscreenMode).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("全屏模式"), "on")
    warnSpy.mockRestore()
  })

  it("setFullscreenMode(true)：持久化 + 原生 setSystemBarsHidden(true) 即时切换", async () => {
    const map = new Map<string, string>()
    prefsModule(map)
    // prefsModule 会整体重置 env.modules——把 PictelioApp mock 放回去
    env.modules = { ...env.modules, PictelioApp: { setSystemBarsHidden } }
    store.setFullscreenMode(true)
    await vi.waitFor(() => expect(map.get("settings_fullscreen_mode")).toBe("true"))
    expect(store.fullscreenMode).toBe(true)
    expect(setSystemBarsHidden).toHaveBeenCalledWith(true, expect.any(Function))
  })

  it("prefs 写入失败 → 内存态已更新 + warn 可见（不抛出，硬约束 #3）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb("disk full"),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
      PictelioApp: { setSystemBarsHidden },
    }
    store.setFullscreenMode(true)
    expect(store.fullscreenMode).toBe(true)
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("全屏模式"), expect.anything()),
    )
    warnSpy.mockRestore()
  })

  it("dev/web-core（非 native）：仅持久化，不调原生（console.debug 可见）", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    env.native = false
    store.setFullscreenMode(true)
    expect(setSystemBarsHidden).not.toHaveBeenCalled()
    expect(store.fullscreenMode).toBe(true)
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("非原生环境"))
    debugSpy.mockRestore()
  })

  it("原生切换失败：内存态回滚（UI 回读真实状态）+ warn（spec §5 边界行，IO 双路径）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const map = new Map<string, string>()
    prefsModule(map)
    env.modules = {
      ...env.modules,
      PictelioApp: {
        setSystemBarsHidden: (hidden: boolean, cb: (e: string | null) => void) => cb("native boom"),
      },
    }
    store.setFullscreenMode(true)
    // 设置键保留用户意图（下次启动 onCreate 重试）；内存态回滚到真实状态
    await vi.waitFor(() => expect(map.get("settings_fullscreen_mode")).toBe("true"))
    expect(store.fullscreenMode).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("全屏模式切换失败"),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it("原生环境但模块缺失：warn 可见（禁静默降级，版本漂移异常）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    prefsModule(new Map<string, string>())
    env.modules = {} // native 模式但无 PictelioApp
    store.setFullscreenMode(true)
    expect(store.fullscreenMode).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("setSystemBarsHidden 不可用"))
    warnSpy.mockRestore()
  })

  it("applyRawKey：importRawValues 写回合法值、非法值跳过", async () => {
    prefsModule(new Map<string, string>())
    const res = await store.importRawValues({
      settings_fullscreen_mode: "true",
      settings_fullscreen_mode_bogus: "bogus",
    })
    expect(store.fullscreenMode).toBe(true)
    expect(res.applied).toContain("settings_fullscreen_mode")
    expect(res.skipped).toContain("settings_fullscreen_mode_bogus")
  })
})

// ADR-0164 备份域排除（#555 T3）：引擎「设备事实/协议键」恢复到跨设备是错的（失败记忆/
// 快照/optout/取证键/一次性通知键都是本机事实），不得进备份域。分区实现事实：backupCore
// partitionKeys 对未知键一律落入 deviceKeys（无独立排除集），lynx 侧守卫 = 备份域白名单
// （exportRawValues 只读 BACKUP_DEVICE_KEYS + 账号级键；importRawValues 只认 applyRawKey
// 分支）。键字面量 oracle = Java EnginePrefs.KEY_*（已核对引擎源码）+ engineFallbackNotice.ts。
describe("settingsStore 引擎设备事实键备份域排除（ADR-0164）", () => {
  /** 引擎设备事实/协议键（恢复跨设备是错；ADR-0164 spec §3） */
  const ENGINE_FACT_KEYS = [
    "pictelio_engine_state",
    "pictelio_engine_lynx_failure_version",
    "pictelio_engine_fallback_optout",
    "pictelio_debug_force_lynx_unavailable",
    "pictelio_engine_fallback_notice",
  ] as const

  beforeEach(() => {
    env.native = true
    env.modules = {}
    userRef().value = { id: 42 }
    vi.mocked(idbGet).mockReset().mockResolvedValue(null)
    vi.mocked(idbSet).mockReset().mockResolvedValue(undefined)
    vi.mocked(idbRemove).mockReset().mockResolvedValue(undefined)
    setActivePinia(createPinia())
    store = useSettingsStore()
  })

  function prefsModule(map: Map<string, string>) {
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
          cb(map.has(k) ? JSON.stringify(map.get(k)!) : "", null),
        prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
          map.set(k, v)
          cb(null)
        },
        prefsRemove: (k: string, cb: (e: string | null) => void) => {
          map.delete(k)
          cb(null)
        },
      },
    }
  }

  it("引擎设备事实键与 pictelio_client_kind 均不在 BACKUP_DEVICE_KEYS（首选键现行为：不入备份域）", () => {
    for (const key of [...ENGINE_FACT_KEYS, "pictelio_client_kind"]) {
      expect(BACKUP_DEVICE_KEYS as readonly string[]).not.toContain(key)
    }
  })

  it("exportRawValues 不导出引擎设备事实键（即使存储中存在）", async () => {
    prefsModule(new Map<string, string>(ENGINE_FACT_KEYS.map((k) => [k, "seeded"])))
    const raw = await store.exportRawValues()
    for (const key of ENGINE_FACT_KEYS) {
      expect(raw[key]).toBeUndefined()
    }
  })

  it("importRawValues 跳过引擎设备事实键（恢复永不写回）", async () => {
    const map = new Map<string, string>()
    prefsModule(map)
    const entries = Object.fromEntries(ENGINE_FACT_KEYS.map((k) => [k, "restored"]))
    const res = await store.importRawValues(entries)
    expect(res.applied).toEqual([])
    for (const key of ENGINE_FACT_KEYS) {
      expect(res.skipped).toContain(key)
      expect(map.has(key)).toBe(false) // 未落盘
    }
  })
})
