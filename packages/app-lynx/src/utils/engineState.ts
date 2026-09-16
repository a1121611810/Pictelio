// ─── 引擎生效状态快照（ADR-0164 / spec engine-default-lynx §3）───
// Java EngineRouting.resolve 每次启动覆写 SharedPreferences("CapacitorStorage") 的
// pictelio_engine_state 键（EngineRoute.snapshotLine 逐字格式）：
//   preferred=<kind> effective=<kind|none> reason=<code>
// 双端 UI（「首选 X · 本次生效 Y」）与 android-e2e（adb 直读）消费同一份字符串。
// 键/码字面量的唯一所有者是 Java EnginePrefs.KEY_STATE / EngineRoute.Reason；
// TS 侧为镜像常量，键集一致性由 spec §9 口径的一致性测试钉住（engineState.test.ts）。
// 读取走 NativeModules.PictelioPrefs（engineFallbackNotice 同款契约：""→null、
// JSON 引号 unquote、错误 warn）；web-core dev 预览无原生快照 → warn 一次 + null
// （禁止静默跳过，测试硬约束 #3）。
import { getNativeModules, isNativeMode } from "../api/client"
import { unquoteNativeString } from "./tokenStorage"
import type { I18nKey } from "../i18n"

/** 契约键：与 Java EnginePrefs.KEY_STATE 一致（勿单独改动） */
export const ENGINE_STATE_KEY = "pictelio_engine_state"

export type EngineKind = "webview" | "lynx"
/** 快照 effective 段取值：`none` = 双失败（无引擎可用，由错误页兜底，UI 不渲染双态行） */
export type EffectiveKind = EngineKind | "none"

/** 降级原因码（稳定 ASCII，全 10 码；与 EngineRoute.Reason.code 逐字一致，禁改字面量） */
export const FALLBACK_REASON_CODES = [
  "preferred",
  "lynx_unavailable",
  "lynx_known_bad",
  "lynx_retry",
  "webview_unavailable",
  "a11y_webview",
  "a11y_lynx_last_resort",
  "no_engine",
  "forced_webview",
  "runtime_failure",
] as const

export type FallbackReasonCode = (typeof FALLBACK_REASON_CODES)[number]
/** UI 视角的 reason：Java 侧未来新增码 / 契约缺省值 "none" 归一为 "unknown" */
export type EngineStateReason = FallbackReasonCode | "unknown"

export interface EngineStateSnapshot {
  preferred: EngineKind
  effective: EffectiveKind
  reason: EngineStateReason
}

/** 原因码 → i18n 键（UI 映射；键集 = 10 码 + unknown 兜底，文案见 locales *.pages engineFallback.reason.*） */
export const REASON_I18N_KEYS: Record<EngineStateReason, I18nKey> = {
  preferred: "engineFallback.reason.preferred",
  lynx_unavailable: "engineFallback.reason.lynx_unavailable",
  lynx_known_bad: "engineFallback.reason.lynx_known_bad",
  lynx_retry: "engineFallback.reason.lynx_retry",
  webview_unavailable: "engineFallback.reason.webview_unavailable",
  a11y_webview: "engineFallback.reason.a11y_webview",
  a11y_lynx_last_resort: "engineFallback.reason.a11y_lynx_last_resort",
  no_engine: "engineFallback.reason.no_engine",
  forced_webview: "engineFallback.reason.forced_webview",
  runtime_failure: "engineFallback.reason.runtime_failure",
  unknown: "engineFallback.reason.unknown",
}

function parseKind(raw: string): EngineKind | null {
  return raw === "webview" || raw === "lynx" ? raw : null
}

/**
 * 解析快照行（oracle = EngineRoute.snapshotLine：空格分隔 k=v 三元组，字段序即契约）。
 * 畸形（缺字段 / preferred、effective 非法）→ warn + null（spec E11：禁静默）；
 * reason 未知码 → warn + "unknown"（结构仍有效，渲染「引擎状态未知」而非隐藏降级）；
 * reason="none"（Java reason==null 的契约值）→ "unknown" 不 warn。
 */
export function parseEngineState(raw: string): EngineStateSnapshot | null {
  const fields = new Map<string, string>()
  for (const token of raw.split(" ")) {
    const idx = token.indexOf("=")
    if (idx <= 0) continue
    fields.set(token.slice(0, idx), token.slice(idx + 1))
  }
  const preferred = parseKind(fields.get("preferred") ?? "")
  const effectiveRaw = fields.get("effective") ?? ""
  const effective = effectiveRaw === "none" ? "none" : parseKind(effectiveRaw)
  if (preferred === null || effective === null) {
    console.warn("[engineState] 引擎状态快照畸形，按无快照处理:", raw)
    return null
  }
  const reasonRaw = fields.get("reason") ?? ""
  let reason: EngineStateReason = "unknown"
  if ((FALLBACK_REASON_CODES as readonly string[]).includes(reasonRaw)) {
    reason = reasonRaw as FallbackReasonCode
  } else if (reasonRaw !== "none") {
    console.warn("[engineState] 引擎状态原因码未知，按 unknown 渲染:", raw)
  }
  return { preferred, effective, reason }
}

interface NativePrefsModule {
  prefsGet(key: string, callback: (value: string, err: string | null) => void): void
}

function nativePrefs(): NativePrefsModule | null {
  return (getNativeModules()?.PictelioPrefs as NativePrefsModule | undefined) ?? null
}

/** web-core dev 预览的「无原生快照」只 warn 一次（每次进 Me 页都会读，不刷屏） */
let warnedDevUnavailable = false

/**
 * 读取并解析引擎生效状态快照（lynx 侧直读 NativeModules.PictelioPrefs）。
 * @returns 快照；键缺失 / 读取失败 / 畸形 → null（三条失败路径均已 warn，禁静默）。
 */
export async function readEngineState(): Promise<EngineStateSnapshot | null> {
  if (!isNativeMode()) {
    if (!warnedDevUnavailable) {
      console.warn("[engineState] web-core dev 预览无原生快照（Java 启动路由未运行），按无降级渲染")
      warnedDevUnavailable = true
    }
    return null
  }
  const value = await new Promise<string | null>((resolve) => {
    const mod = nativePrefs()
    if (!mod) {
      console.warn("[engineState] 原生 PictelioPrefs 不可用（按缺失处理）")
      resolve(null)
      return
    }
    mod.prefsGet(ENGINE_STATE_KEY, (value, err) => {
      if (err) {
        console.warn("[engineState] 原生读取失败", err)
        resolve(null)
        return
      }
      // lynx Callback 的字符串参数带 JSON 引号（settingsStore 同款坑）——unquote；
      // 键不存在时 Java 返回 ""（契约），映射为 null。
      resolve(value === "" ? null : unquoteNativeString(value))
    })
  })
  if (value === null) return null
  return parseEngineState(value)
}
