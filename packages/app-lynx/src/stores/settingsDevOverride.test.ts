// ─── dev override 通道：显示谓词与翻译授权谓词「两个独立开关」的契约（#947）───
//
// 判据来源（oracle 溯源，禁自洽反推）：
// - ADR-0173 **D4b** + spec §9.7：把受限正文发给第三方 LLM 需**用户显式授权**，
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
//
// ── #1035：读侧构建闸门 ────────────────────────────────────────────────────
// 写侧的 `if (!BuildConfig.DEBUG) return;` **只**保证 release 不写，证不了 release 不读。
// debug 与 release 共用 applicationId 与同一份 SharedPreferences，`adb install -r` 不清
// 数据 ⇒ 残留键会被 release 读到。故读点必须自判构建类型（原生 BuildConfig.DEBUG，fail closed）。
//
// ⚠️ **本文件剩余的已知失效面（登记，非缺陷）**：
// 1. 写侧仍是**文本层契约**，证不了 release 变体里 `BuildConfig.DEBUG` 确为 false（挂账 #1034）。
// 2. 读侧闸门由**注入的 `isDebugBuild` 桩**驱动。它证的是「判定被 consulted 且生效」，
//    证不了原生侧那座桥真的把 `BuildConfig.DEBUG` 送到了 JS——该缺口挂账 **#1038**
//    （JVM/Robolectric 单测；本仓只存在 testDebugUnitTest，跑在 debug 变体，故它证的是
//    「回传的值 === BuildConfig.DEBUG 这个常量」，不是「release 为 false」）。
//    ⚠️ 因此**不得**把本文件的绿色读成「release 真的不读残留键」。
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

import { idbGet } from "../utils/idbKV"
import { useSettingsStore } from "./settingsStore"
import { resetDebugBuildCacheForTest } from "../utils/debugBuild"

const UID = 42

/**
 * 原生 env 注入形态。`isDebug` 之外的两个变体用于钉 fail-closed 分支——
 * 它们是**刻意**与正常路径不同，故收敛成显式选项而非散落三份 env 字面量。
 */
type NativeEnvOpts =
  | { isDebug?: boolean }
  | { omitDebugBuild?: true }
  | { debugBuildThrows?: true }
  | { prefsGetThrowsFor?: string }

/**
 * 注入原生 env（native 模式的 prefs seam = loadSettings 的账号键与 dev 键读点，
 * 外加 #1035 读侧闸门的构建判定来源）。
 *
 * @returns 写入记录数组，用于断言 dev override **不**回写账号级授权键。
 */
function injectNativeEnv(
  seed: Record<string, string>,
  opts: NativeEnvOpts = {},
): Array<[string, string]> {
  const written: Array<[string, string]> = []
  env.native = true
  const prefsGet = (k: string, cb: (v: string, e: string | null) => void) => {
    if ("prefsGetThrowsFor" in opts && opts.prefsGetThrowsFor === k) throw new Error("read fail")
    cb(k in seed ? JSON.stringify(seed[k]) : "", null)
  }
  const app: Record<string, unknown> = {}
  if (!("omitDebugBuild" in opts)) {
    app.isDebugBuild =
      "debugBuildThrows" in opts
        ? () => {
            throw new Error("bridge down")
          }
        : (cb: (isDebug: boolean) => void) => cb("isDebug" in opts ? opts.isDebug !== false : true)
  }
  env.modules = {
    PictelioPrefs: {
      prefsGet,
      prefsSet: (k: string, v: string, cb: (e: string | null) => void) => {
        written.push([k, v])
        cb(null)
      },
      prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
    },
    PictelioApp: app,
  }
  return written
}

let store: ReturnType<typeof useSettingsStore>

beforeEach(() => {
  env.native = false
  env.modules = {}
  vi.mocked(idbGet).mockReset()
  // resolveDebugBuild 进程内记忆化（BuildConfig.DEBUG 是编译期常量）：跨用例必须重置，
  // 否则前一个用例的判定会串进下一个——这类记忆化漏重置是典型的假绿来源。
  resetDebugBuildCacheForTest()
  mockUser.value = { id: UID }
  setActivePinia(createPinia())
  store = useSettingsStore()
})

describe("dev override：翻译授权谓词与显示谓词分离（#947）", () => {
  it("播种键存在 → 强制打开 R18/R18G 翻译授权，闸门放行", async () => {
    injectNativeEnv({ dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(1)).toBe(false)
    expect(store.isTranslationRestricted(2)).toBe(false)
  })

  it("**只有**显示 override → 翻译闸门仍然拒绝（显示权限不得蕴含外发授权）", async () => {
    injectNativeEnv({ dev_force_r18: "true" })
    await store.loadSettings()

    // 显示谓词已强制打开
    expect(store.showR18).toBe(true)
    expect(store.showR18G).toBe(true)
    // 翻译授权谓词未被连带打开 —— 这一条就是红线 2 的机器防线
    expect(store.isTranslationRestricted(1)).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("**只有**翻译 override → 显示谓词不受影响（两个决定反向也分离）", async () => {
    injectNativeEnv({ dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(false)
    expect(store.showR18).toBe(false)
    expect(store.showR18G).toBe(false)
  })

  it("两个键都在 → 两组谓词各自打开（互不覆盖、互不依赖）", async () => {
    injectNativeEnv({ dev_force_r18: "true", dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.showR18G).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(false)
  })

  it("无播种键 → 默认拒绝（闸门默认拒绝不得被本次改动放松）", async () => {
    injectNativeEnv({})
    await store.loadSettings()

    expect(store.isTranslationRestricted(1)).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("播种键值非 \"true\" → 不放行（严格相等，与显示 override 同口径）", async () => {
    injectNativeEnv({ dev_force_translate_r18: "1" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("dev override 只改内存态，**不**回写账号级授权键（不得伪造用户持久授权）", async () => {
    const written = injectNativeEnv({ dev_force_translate_r18: "true" })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(false)
    expect(written).toEqual([])
  })

  it("读取抛异常 → warn 可见且不放行（禁静默降级，硬约束 #1/#3）", async () => {
    // prefsGet 同步抛出 → prefs().get 的 Promise 拒绝 → 读点 catch 分支必须 warn。
    // 用同步抛而非 err 回调：err 回调路径被 adapter 吞成 resolve(null)（同样不放行），
    // 但那条路径的 warn 由 adapter 发出、不归读点负责，钉在这里会测错对象。
    injectNativeEnv({}, { prefsGetThrowsFor: "dev_force_translate_r18" })
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
// #1035 读侧构建闸门：debug 播种、release 覆盖安装 ⇒ 残留键必须不生效
// （本 describe 才是本次修复的机器防线；上面的 #947 分组是它成立后的正路）
// ═══════════════════════════════════════════════════════════════════════════

describe("dev override 读侧构建闸门（#1035）", () => {
  it("release 构建 + 残留播种键 → 翻译闸门保持拒绝（正文零外发，ADR-0173 D4b）", async () => {
    // 这正是缺陷场景：debug 播种过 → 覆盖装 release → SharedPreferences 未清
    injectNativeEnv({ dev_force_translate_r18: "true" }, { isDebug: false })
    await store.loadSettings()

    expect(store.isTranslationRestricted(1)).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("release 构建 + 残留播种键 → 受限内容保持遮罩（存量同形键 dev_force_r18 同样受闸门）", async () => {
    injectNativeEnv({ dev_force_r18: "true" }, { isDebug: false })
    await store.loadSettings()

    expect(store.showR18).toBe(false)
    expect(store.showR18G).toBe(false)
  })

  it("release 构建 + **两个**残留键 → 两组谓词都不开（不得只闸门新键、漏掉已上线的存量键）", async () => {
    injectNativeEnv({ dev_force_r18: "true", dev_force_translate_r18: "true" }, { isDebug: false })
    await store.loadSettings()

    expect(store.showR18).toBe(false)
    expect(store.showR18G).toBe(false)
    expect(store.isTranslationRestricted(1)).toBe(true)
    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("原生判定不可用（方法缺失）→ fail closed，残留键不生效（不得 fall through 到无闸门的读）", async () => {
    injectNativeEnv({ dev_force_translate_r18: "true" }, { omitDebugBuild: true })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(true)
    // 缺失必须 warn 可见（硬约束 #3 禁静默降级）。注意此处是**单参** warn：
    // 「方法不存在」没有可附的 error 对象，与「调用抛错」路径的签名不同。
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("isDebugBuild"))
    warn.mockRestore()
  })

  it("原生判定抛错 → fail closed，残留键不生效", async () => {
    injectNativeEnv({ dev_force_translate_r18: "true" }, { debugBuildThrows: true })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("isDebugBuild"), expect.anything())
    warn.mockRestore()
  })

  it("闸门依据原生判定、**不是** `__DEV__`：`__DEV__` 为 true 而原生回传 false 仍不放行", async () => {
    // vitest 注入 __DEV__=true（见 packages/app-lynx/vitest.config.ts），真机上它恒 false。
    // 拿它当闸门会得到「单测全绿、真机全死」的假绿，故此处显式反证：原生判定才是判据。
    expect(__DEV__).toBe(true)
    injectNativeEnv({ dev_force_translate_r18: "true" }, { isDebug: false })
    await store.loadSettings()

    expect(store.isTranslationRestricted(2)).toBe(true)
  })

  it("非原生环境（web-core 预览）→ 已播种的键不生效", async () => {
    // 必须**真实播种**才构成判别力：若此处不播种，`isTranslationRestricted` 恒为 true，
    // 把 `applyDevSeed` 的闸门整段删掉本用例仍然全绿（同义反复）。
    // 非原生路径的 prefs seam 是 IndexedDB（devPrefs），故播种走 idbGet 桩。
    env.native = false
    env.modules = {}
    vi.mocked(idbGet).mockImplementation(async (k: string) =>
      k === "dev_force_translate_r18" ? "true" : null,
    )
    await store.loadSettings()

    // 判别力来自下面这行：若把 `applyDevSeed` 的闸门整段删掉，idbGet 桩会返回
    // "true" → `_translateR18G` 被置 true → `isTranslationRestricted(2)` 变 false → 红。
    expect(store.isTranslationRestricted(2)).toBe(true)
    //
    // ⚠️ **未断言的前提**：上面那条判别力依赖 `devPrefs()` 仍把 `get` 接到 idbGet
    // （settingsStore 的环境适配 seam）。若日后该 seam 改道，本用例会**静默退化为
    // 同义反复**（key 取不到 → 默认不放行 → 仍绿）。此处刻意不写
    // `expect(await idbGet(...)).toBe("true")` ——那是把刚配好的桩读回来读给自己看，
    // 不证明任何可达性。
    expect(await idbGet("dev_force_translate_r18")).toBe("true")
  })

  it("构建判定只跨桥一次（进程内记忆化，BuildConfig.DEBUG 是编译期常量）", async () => {
    let calls = 0
    env.native = true
    env.modules = {
      PictelioPrefs: {
        prefsGet: (_k: string, cb: (v: string, e: string | null) => void) => cb("", null),
        prefsSet: (_k: string, _v: string, cb: (e: string | null) => void) => cb(null),
        prefsRemove: (_k: string, cb: (e: string | null) => void) => cb(null),
      },
      PictelioApp: {
        isDebugBuild: (cb: (isDebug: boolean) => void) => {
          calls++
          cb(true)
        },
      },
    }
    await store.loadSettings()

    expect(calls).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Java 侧形态契约：extra 落在 BuildConfig.DEBUG 闸禁的 applyDevIntentHooks 内
// （AC：release 构建忽略该 extra）。无 Robolectric 覆盖时，源码形态 + 夹具自检。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 去注释。`//` 规则带**负向先行断言**：URL 字面量里的 `://` 不是注释
 * （无此断言时 `"https://"` 会被当行注释，把该行后半截连同收尾括号一起吃掉，
 * 留下语法残缺的方法体，让后续检测器读到被截断的源码而可能静默通过）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "")
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

/** 非截断计数：子串在全文出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

const DEV_HOOKS_BODY = methodBody(LYNX_ACTIVITY_CODE, "private void applyDevIntentHooks(")

describe("Java 契约：dev extra 的 DEBUG 闸门（#947）", () => {
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

  it("**全文件写点唯一**：该键只有一处 putString，绕过守卫的第二条路不存在", () => {
    // 只断言「出现在方法体内」不够——另开一处写入路径同样能通过。
    // 计数必须取自**整个去注释后的 Java 文件**（未截断），否则新增第二处不会被发现。
    expect(countOccurrences(LYNX_ACTIVITY_CODE, "putString(DEV_FORCE_TRANSLATE_R18_PREFS_KEY")).toBe(1)
    expect(countOccurrences(LYNX_ACTIVITY_CODE, "putString(DEV_FORCE_R18_PREFS_KEY")).toBe(1)
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
    expect(bogusBody).not.toContain("DEV_FORCE_TRANSLATE_R18_PREFS_KEY")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Java 侧形态契约：PictelioAppModule.isDebugBuild 是读侧闸门的判定来源
// 跨桥回传的机器防线见 #1038（JVM/Robolectric）；本组只钉源码形态。
// ═══════════════════════════════════════════════════════════════════════════

const LYNX_APP_MODULE_CODE = stripComments(
  readFileSync(
    new URL(
      "../../../android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java",
      HERE,
    ),
    "utf8",
  ),
)

const IS_DEBUG_BUILD_BODY = methodBody(LYNX_APP_MODULE_CODE, "public void isDebugBuild(")

describe("Java 契约：isDebugBuild 回传裸 BuildConfig.DEBUG（#1035）", () => {
  it("方法存在且是 @LynxMethod（JS 经 NativeModules.PictelioApp 调用）", () => {
    expect(LYNX_APP_MODULE_CODE).toContain("public void isDebugBuild(Callback callback)")
    // @LynxMethod 必须紧贴方法声明之前（去注释后只剩注解 + 签名）
    expect(LYNX_APP_MODULE_CODE).toMatch(/@LynxMethod\s+public void isDebugBuild\(Callback callback\)/)
  })

  it("**不**自我判定：方法体无条件回传 BuildConfig.DEBUG（自我闸门会吞掉 fail-closed 语义）", () => {
    // 判据是「确认是 debug 构建」，不是「不是 debug 构建」。若原生侧自己判 DEBUG 再回传，
    // 调用方就分不清「release 构建」与「判定不可用」，fail closed 的分支无从表达。
    expect(IS_DEBUG_BUILD_BODY).toContain("callback.invoke(BuildConfig.DEBUG)")
    expect(IS_DEBUG_BUILD_BODY).not.toContain("if (BuildConfig.DEBUG)")
    expect(IS_DEBUG_BUILD_BODY).not.toContain("if (!BuildConfig.DEBUG)")
  })

  it("异常路径 fail closed，且兜底 invoke 不穿出 @LynxMethod", () => {
    const catchIdx = IS_DEBUG_BUILD_BODY.indexOf("catch (Exception e)")
    expect(catchIdx).toBeGreaterThan(-1)
    const catchTail = IS_DEBUG_BUILD_BODY.slice(catchIdx)
    expect(catchTail).toContain("callback.invoke(false)")
    // 兜底 invoke 必须**自带 try 且该 try 真的包住它**：否则它自身抛错会把 fail closed
    // 变成「抛到 JS」。用带花括号的正则而非裸 lastIndexOf("try")——后者会命中
    // 任何以 try 结尾的标识符（retry、日志串），构成低概率假通过。
    expect(catchTail).toMatch(/try\s*\{[^}]*callback\.invoke\(false\)/)
  })

  it("检测器非恒真：把方法体换成自我判定形态后必须失配（夹具自检）", () => {
    const bogus = stripComments(
      `public void isDebugBuild(Callback callback) {
        if (BuildConfig.DEBUG) { callback.invoke(true); }
        callback.invoke(false);
      }`,
    )
    const bogusBody = methodBody(bogus, "public void isDebugBuild(")
    expect(bogusBody).toContain("callback.invoke(false)")
    // 自我判定形态不得通过「无条件回传 BuildConfig.DEBUG」这一条
    expect(bogusBody).not.toContain("callback.invoke(BuildConfig.DEBUG)")
    expect(bogusBody).toContain("if (BuildConfig.DEBUG)")
  })

  it("抽取器自检：`://` 不得被当行注释吃掉（否则后续检测器读到语法残缺的方法体）", () => {
    // 用**合成夹具**而非生产源码字面量：夹具自带阳性对照，不依赖 URL 白名单的写法，
    // 故日后把 `url.startsWith("https://")` 重构成常量表也不会让本用例因错误的原因变红。
    const fixture = stripComments(
      `class Probe {
        void check(String url) {
          if (url.startsWith("https://")) { return; }
        }
      }`,
    )
    expect(fixture).toContain('url.startsWith("https://")')
    // 合成夹具下本用例若恒真即失去意义：旧抽取器必须让它失配
    const oldExtractor = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
    expect(oldExtractor(fixture)).not.toContain('url.startsWith("https://")')
  })
})
