// ─── 引擎降级通知（ADR-0153）───
// 原生 LynxActivity 在「WebView 不可用 → 降级进入 Lynx」时向 SharedPreferences
// ("CapacitorStorage") 写一次性键；app-lynx 首帧消费：读到 'true' 展示可关闭说明并删键。
// 双路径（与 settingsStore 的 PrefsStorage seam 同契约）：
// - 原生 LynxView：NativeModules.PictelioPrefs（真实产品面）
// - web-core dev 预览：IndexedDB KV
// 契约键 ENGINE_FALLBACK_NOTICE_KEY 与 Java EngineFallbackNotice.KEY 由
// packages/app/tests/unit/utils/engineFallbackNoticeConsistency.test.ts 比对（防漂移）。
import { getNativeModules, isNativeMode } from "../api/client"
import { idbGet, idbRemove } from "./idbKV"
import { unquoteNativeString } from "./tokenStorage"

/** 契约键：与 native EngineFallbackNotice.KEY 一致（勿单独改动） */
export const ENGINE_FALLBACK_NOTICE_KEY = "pictelio_engine_fallback_notice"

interface NativePrefsModule {
  prefsGet(key: string, callback: (value: string, err: string | null) => void): void
  prefsRemove(key: string, callback: (err: string | null) => void): void
}

function nativePrefs(): NativePrefsModule | null {
  return (getNativeModules()?.PictelioPrefs as NativePrefsModule | undefined) ?? null
}

function nativeGet(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    const mod = nativePrefs()
    if (!mod) {
      console.warn("[engineFallbackNotice] 原生 PictelioPrefs 不可用（按缺失处理）")
      resolve(null)
      return
    }
    mod.prefsGet(key, (value, err) => {
      if (err) {
        console.warn("[engineFallbackNotice] 原生读取失败", err)
        resolve(null)
        return
      }
      // lynx Callback 的字符串参数带 JSON 引号（settingsStore 同款坑）——unquote；
      // 键不存在时 Java 返回 ""（契约），映射为 null。
      resolve(value === "" ? null : unquoteNativeString(value))
    })
  })
}

function nativeRemove(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = nativePrefs()
    if (!mod) {
      console.warn("[engineFallbackNotice] 原生 PictelioPrefs 不可用（删失败）")
      reject(new Error("native prefs unavailable"))
      return
    }
    mod.prefsRemove(key, (err) => {
      if (err) {
        console.warn("[engineFallbackNotice] 原生删除失败", err)
        reject(new Error(err))
      } else {
        resolve()
      }
    })
  })
}

/**
 * 消费一次性降级通知。
 *
 * @returns true = 本次由引擎降级进入（说明应立即展示）；键已消费删除。
 *          false = 无通知。
 *
 * 读/删失败一律 console.warn 后按 false 处理（禁止静默降级，但不得阻断启动）。
 */
export async function consumeEngineFallbackNotice(): Promise<boolean> {
  const native = isNativeMode()
  let value: string | null = null
  try {
    value = native
      ? await nativeGet(ENGINE_FALLBACK_NOTICE_KEY)
      : await idbGet(ENGINE_FALLBACK_NOTICE_KEY)
  } catch (e) {
    console.warn("[engineFallbackNotice] 读取异常（按无通知处理）", e)
    return false
  }
  if (value !== "true") return false
  try {
    if (native) await nativeRemove(ENGINE_FALLBACK_NOTICE_KEY)
    else await idbRemove(ENGINE_FALLBACK_NOTICE_KEY)
  } catch (e) {
    console.warn("[engineFallbackNotice] 通知键清除失败（下次启动会再次提示）", e)
    return true
  }
  return true
}
