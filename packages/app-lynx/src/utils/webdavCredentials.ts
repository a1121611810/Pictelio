// ─── WebDAV 凭据持久化（spec docs/specs/webdav-backup.md §8 / ADR-0156 D4）───
// 与 app utils/webdavCredentials.ts 同源同语义（双端差分对齐约定）：
// 两个密码只存 secure storage，绝不进普通 prefs / 备份文件。
// 双路径（同 utils/tokenStorage.ts）：web-core Worker → IndexedDB；
// 原生 LynxView → NativeModules.PictelioSecureStorage（与 webview 同一加密存储）。
import { idbGet, idbSet, idbRemove } from "./idbKV"

/** WebDAV 服务器登录密码（Basic Auth 用） */
const WEBDAV_PASSWORD_KEY = "webdav_password"
/** 备份文件加密密码（PICTELIO-ENC1 派生密钥用，与登录密码相互独立） */
const WEBDAV_BACKUP_PASSWORD_KEY = "webdav_backup_password"

/** 原生安全存储 Module（回调契约见 PictelioSecureStorageModule.java） */
interface NativeSecureStorageModule {
  getItem(key: string, callback: (value: string | null, err: string | null) => void): void
  setItem(key: string, data: string, callback: (err: string | null) => void): void
  removeItem(key: string, callback: (err: string | null) => void): void
}

function nativeModule(): NativeSecureStorageModule | null {
  const nm = (typeof NativeModules !== "undefined" ? NativeModules : undefined) ??
    (globalThis as {
      NativeModules?: { PictelioSecureStorage?: NativeSecureStorageModule }
    }).NativeModules
  return nm?.PictelioSecureStorage ?? null
}

function save(key: string, value: string): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.setItem(key, value, (err) => {
        if (err) {
          console.warn("[webdavCredentials] 原生存储写入失败", err)
          reject(new Error(err))
        } else {
          resolve()
        }
      })
    })
  }
  return idbSet(key, value)
}

/** 读取；原生路径存储异常按未设置处理并 warn（禁静默降级约定） */
function load(key: string): Promise<string | null> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve) => {
      mod.getItem(key, (value, err) => {
        if (err) {
          console.warn("[webdavCredentials] 原生存储读取失败（按未设置处理）", err)
          resolve(null)
          return
        }
        resolve(value)
      })
    })
  }
  return idbGet(key)
}

function clear(key: string): Promise<void> {
  const mod = nativeModule()
  if (mod) {
    return new Promise((resolve, reject) => {
      mod.removeItem(key, (err) => {
        if (err) {
          console.warn("[webdavCredentials] 原生存储删除失败", err)
          reject(new Error(err))
        } else {
          resolve()
        }
      })
    })
  }
  return idbRemove(key)
}

// ── WebDAV 登录密码 ──
export function saveWebdavPassword(password: string): Promise<void> {
  return save(WEBDAV_PASSWORD_KEY, password)
}
export function loadWebdavPassword(): Promise<string | null> {
  return load(WEBDAV_PASSWORD_KEY)
}
export function clearWebdavPassword(): Promise<void> {
  return clear(WEBDAV_PASSWORD_KEY)
}

// ── 备份加密密码 ──
export function saveBackupPassword(password: string): Promise<void> {
  return save(WEBDAV_BACKUP_PASSWORD_KEY, password)
}
export function loadBackupPassword(): Promise<string | null> {
  return load(WEBDAV_BACKUP_PASSWORD_KEY)
}
export function clearBackupPassword(): Promise<void> {
  return clear(WEBDAV_BACKUP_PASSWORD_KEY)
}
