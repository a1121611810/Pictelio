// ─── 通用 IndexedDB KV 存储（web-core Worker 环境，ADR-0050/0051） ───
// lynx 双线程架构：app-lynx 的 JS 运行在 Web Worker（lynx-bg），
// **无 window/document/localStorage**；持久化统一用 IndexedDB（标准 Worker API）。
// 单一存储入口：tokenStorage（refresh_token）与 settingsStore（R18 开关等）共用。
const DB_NAME = "pictelio_lynx"
// [lynx:fix] version 2：旧版（ADR-0050 初版）已建同 DB（store "tokens"），
// 若 version 保持 1 则 onupgradeneeded 不触发、kv store 不会创建 → 读写失败。
// 升级到 2 强制触发创建 kv；旧 tokens 数据不迁移（一次性重新登录）。
const DB_VERSION = 2
const STORE = "kv"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 写入 KV（key → string） */
export async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 读取 KV（不存在返回 null） */
export async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDb()
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** 删除 KV */
export async function idbRemove(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* IndexedDB 不可用时静默忽略 */
  }
}
