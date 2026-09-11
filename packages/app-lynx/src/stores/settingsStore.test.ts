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
import { useSettingsStore } from "./settingsStore"
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
})
