// ─── dev override 通道：显示谓词与翻译授权谓词「两个独立开关」的契约（#947）───
//
// 判据来源（oracle 溯源，禁自洽反推）：
// - ADR-0173 D3 + spec §9.7：把受限正文发给第三方 LLM 需**用户显式授权**，
//   且该授权与「允许看见受限内容」是两个刻意分离的决定。
// - 本票的修复边界：闸门本身工作正常，缺的是验证 harness 的授权播种步骤；
//   `pictelio_dev_force_r18` 只覆盖显示谓词，不碰翻译授权谓词 ⇒ 真机 R18G 章被拦在闸门前。
//
// ⚠️ 本文件钉的是**分离性**（红线：显示权限不得蕴含翻译授权）。既有 `dev_force_r18`
// 此前无任何单测覆盖（阴性证据：grep 0 命中），所以本文件把它一并纳入——
// 两者的分离关系只有成对断言才拦得住「顺手把两个谓词合并」的重构。
//
// Java 侧形态断言跑在 stripComments 之后的文本上（口径同 utils/darkModeJavaContract.test.ts）：
// 否则「只在注释里写一句已实现」照样全绿。每个检测器带夹具自检。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { ref } from "vue"
import { setActivePinia, createPinia } from "pinia"

const HERE = new URL(".", import.meta.url)

vi.mock("../utils/idbKV", () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
  idbRemove: vi.fn(async () => {}),
}))

/** authStore 替身：settingsStore 内 `useAuthStore()` 读到本 mock 的 currentUser */
const mockUser = ref<{ id: number } | null>(null)
vi.mock("./authStore", () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))

const env = vi.hoisted(() => ({ native: false, modules: {} as Record<string, unknown> }))
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>()
  return {
    ...actual,
    isNativeMode: vi.fn(() => env.native),
    getNativeModules: vi.fn(() => env.modules),
    setRateLimitBackoffConfig: vi.fn(),
  }
})

import { useSettingsStore } from "./settingsStore"

const UID = 42

/**
 * 注入原生 PictelioPrefs（native 模式 prefs seam = loadSettings 的账号键与 dev 键读点）。
 * 返回写入记录数组，用于断言 dev override **不**回写账号级授权键。
 */
function nativePrefs(seed: Record<string, string>) {
  const written: Array<[string, string]> = []
  env.native = true
  env.modules = {
    PictelioPrefs: {
      prefsGet: (k: string, cb: (v: string, e: string | null) => void) =>
        cb(k in seed ? JSON.stringify(seed[k]) : "", null),
      prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
        written.push([k, v])
        cb(null)
      },
      prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
    },
  }
  return written
}

let store: ReturnType<typeof useSettingsStore>

beforeEach(() => {
  env.native = false
  env.modules = {}
  mockUser.value = { id: UID }
  setActivePinia(createPinia())
  store = useSettingsStore()
})

describe("dev override：翻译授权谓词与显示谓词分离（#947）", () => {
  it("播种键存在 → 强制打开 R18/R18G 翻译授权，闸门放行", async () => {
    nativePrefs({ dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(1)).toBe(false)
    expect(store.isTranslationRestricted(2)).toBe(false)
  })

  it("**只有**显示 override → 翻译闸门仍然拒绝（显示权限不得蕴含外发授权）", async () => {
    nativePrefs({ dev_force_r18: "true" })
    await store.loadSettings()

    // 显示谓词已强制打开
    expect(store.showR18).toBe(true)
    expect(store.showR18G).toBe(true)
    // 翻译授权谓词未被连带打开 —— 这一条就是红线 2 的机器防线
    expect(store.isTranslationRestricted(1)).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("**只有**翻译 override → 显示谓词不受影响（两个决定反向也分离）", async () => {
    nativePrefs({ dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(false)
    expect(store.showR18).toBe(false)
    expect(store.showR18G).toBe(false)
  })

  it("两个键都在 → 两组谓词各自打开（互不覆盖、互不依赖）", async () => {
    nativePrefs({ dev_force_r18: "true", dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.showR18G).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(false)
  })

  it("无播种键 → 默认拒绝（闸门默认拒绝不得被本次改动放松）", async () => {
    nativePrefs({})
    await store.loadSettings()

    expect(store.isTranslationRestricted(1)).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("播种键值非 \"true\" → 不放行（严格相等，与显示 override 同口径）", async () => {
    nativePrefs({ dev_force_translate_r18: "1" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("dev override 只改内存态，**不**回写账号级授权键（不得伪造用户持久授权）", async () => {
    const written = nativePrefs({ dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(false)
    expect(written).toEqual([])
  })

  it("读取抛异常 → warn 可见且不放行（禁静默降级，硬约束 #1/#3）", async () => {
    // prefsGet 同步抛出 → prefs().get 的 Promise 拒绝 → 读点 catch 分支必须 warn。
    // 用同步抛而非 err 回调：err 回调路径被 adapter 吞成 resolve(null)（同样不放行），
    // 但那条路径的 warn 由 adapter 发出、不归读点负责，钉在这里会测错对象。
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (k: string, cb: (v: string, e: string | null) => void) => {
          if (k === "dev_force_translate_r18") throw new Error("read fail")
          cb("", null)
        },
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb(null),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("dev_force_translate_r18"), expect.anything()),
    )
    expect(store.isTranslationRestricted(2)).toBe(true)
    warn.mockRestore()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Java 侧形态契约：extra 落在 BuildConfig.DEBUG 门禁的 applyDevIntentHooks 内
// （AC：release 构建忽略该 extra）。无 Robolectric 覆盖时，源码形态 + 夹具自检。
// ═══════════════════════════════════════════════════════════════════════════

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
}

const LYNX_ACTIVITY_CODE = stripComments(
  readFileSync(
    new URL(
      "../../../android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java",
      HERE,
    ),
    "utf8",
  ),
)

/** 抽出方法体（从签名到下一个同缩进方法声明为止） */
function methodBody(code: string, signature: string): string {
  const start = code.indexOf(signature)
  if (start < 0) return ""
  const rest = code.slice(start + signature.length)
  const end = rest.search(/\n {4}(?:private|public|protected|static|@|\})/)
  return rest.slice(0, end < 0 ? rest.length : end)
}

const DEV_HOOKS_BODY = methodBody(LYNX_ACTIVITY_CODE, "private void applyDevIntentHooks(")

describe("Java 契约：dev extra 的 DEBUG 门禁（#947）", () => {
  it("新 extra 常量字面量与 JS 侧 prefs 键逐字一致", () => {
    // 跨端契约：extra 名只在 adb 命令行出现一次，消费侧是 LynxActivity 常量
    expect(LYNX_ACTIVITY_CODE).toContain('DEV_EXTRA_FORCE_TRANSLATE_R18 = "pictelio_dev_force_translate_r18"')
    // prefs 键 = settingsStore 读点，两侧必须一致（唯一所有者 = Java 端）
    expect(LYNX_ACTIVITY_CODE).toContain('DEV_FORCE_TRANSLATE_R18_PREFS_KEY = "dev_force_translate_r18"')
  })

  it("新 extra 的写入点在 applyDevIntentHooks 方法体内", () => {
    expect(DEV_HOOKS_BODY).toContain("DEV_EXTRA_FORCE_TRANSLATE_R18")
    expect(DEV_HOOKS_BODY).toContain("DEV_FORCE_TRANSLATE_R18_PREFS_KEY")
  })

  it("applyDevIntentHooks 首句即 BuildConfig.DEBUG 早退（新播种随 release 整体失效）", () => {
    expect(DEV_HOOKS_BODY.trimStart().startsWith("android.content.Intent intent)")).toBe(true)
    expect(DEV_HOOKS_BODY).toContain("if (!BuildConfig.DEBUG) return;")
  })

  it("检测器非恒真：把方法体换成注释文本后必须失配（夹具自检）", () => {
    const bogus = stripComments(
      `private void applyDevIntentHooks(android.content.Intent intent) {
        // DEV_EXTRA_FORCE_TRANSLATE_R18 DEV_FORCE_TRANSLATE_R18_PREFS_KEY
        if (!BuildConfig.DEBUG) return;
      }`,
    )
    const bogusBody = methodBody(bogus, "private void applyDevIntentHooks(")
    expect(bogusBody).toContain("if (!BuildConfig.DEBUG) return;")
    expect(bogusBody).not.toContain("DEV_EXTRA_FORCE_TRANSLATE_R18_PREFS_KEY")
  })
})
