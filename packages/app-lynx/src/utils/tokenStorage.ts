// ─── refresh_token 持久化（ADR-0050） ───
// 双路径：
// - web-core（lynx-bg Worker，无 localStorage）：IndexedDB（utils/idbKV.ts），重启恢复登录
// - 原生 LynxView（#52）：NativeModules.PictelioSecureStorage —— 对齐主项目
//   @aparajita/capacitor-secure-storage（AndroidKeyStore + "WSSecureStorageSharedPreferences"，
//   同 key/同密文格式），登录态与 webview client 共享
import { idbSet, idbGet, idbRemove } from "./idbKV"

const KEY = "refresh_token"

/** 原生登录存储 Module（Lynx Native Module；回调契约见 PictelioSecureStorageModule.java） */
interface NativeSecureStorageModule {
  getItem(key: string, callback: (value: string | null, err: string | null) => void): void
  setItem(key: string, data: string, callback: (err: string | null) => void): void
  removeItem(key: string, callback: (err: string | null) => void): void
}

/** 探测原生 Module（web-core 无 NativeModules → null，走 IndexedDB） */
function nativeModule(): NativeSecureStorageModule | null {
  // 同时检查裸 NativeModules（lynx runtime 全局对象，真机实测不在 globalThis 上）
  const nm = (typeof NativeModules !== "undefined" ? NativeModules : undefined) ??
    (globalThis as {
      NativeModules?: { PictelioSecureStorage?: NativeSecureStorageModule }
    }).NativeModules
  return nm?.PictelioSecureStorage ?? null
}

/** 保存 refresh_token（登录成功 / 401 刷新轮换后更新） */
export function saveRefreshToken(token: string): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.setItem(KEY, token, (err) => {
        if (err) {
          console.warn("[tokenStorage] 原生存储写入失败", err)
          reject(new Error(err))
        } else {
          resolve()
        }
      })
    })
  }
  return idbSet(KEY, token)
}

/** 读取 refresh_token（启动恢复）；原生路径存储异常视为无 token（强制重新登录，warn 可见） */
export function loadRefreshToken(): Promise<string | null> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve) => {
      mod.getItem(KEY, (value, err) => {
        if (err) {
          console.warn("[tokenStorage] 原生存储读取失败（按未登录处理）", err)
          resolve(null)
        } else {
          resolve(unquoteNativeString(value))
        }
      })
    })
  }
  return idbGet(KEY)
}

/**
 * lynx Callback.invoke(String)（native→JS）会把字符串参数 JSON 序列化——
 * 实测 getItem 回调的 value 形如 `"LXa0TEPb..."`（首尾带 JSON 双引号），
 * 直接当 token 传给 OAuth 会 400 invalid_grant（issue #120 登录态恢复失败根因）。
 * 还原：仅当值符合 JSON 字符串形态（`"..."` 且 parse 后为 string）时去引号。
 */
export function unquoteNativeString(value: string | null): string | null {
  if (typeof value === "string" && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return typeof parsed === "string" ? parsed : value
    } catch {
      // 非 JSON 字符串（如错误消息）→ 原样返回
      return value
    }
  }
  return value
}

/** 清除 refresh_token（登出） */
export function clearRefreshToken(): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve) => {
      mod.removeItem(KEY, (err) => {
        if (err) {
          console.warn("[tokenStorage] 原生存储清除失败", err)
        }
        resolve()
      })
    })
  }
  return idbRemove(KEY)
}
