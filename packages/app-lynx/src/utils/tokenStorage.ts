// ─── refresh_token 持久化（web-core Worker 环境，ADR-0050） ───
// lynx 双线程架构：app-lynx 的 JS 运行在 Web Worker（lynx-bg），
// **无 window/document/localStorage**；持久化用 IndexedDB（标准 Worker API）。
// 原生 LynxView（#41）改用 Native Module 对齐主项目 @aparajita Keystore 存储（见 ADR-0050）。
const DB_NAME = "pictelio_lynx"
const STORE = "tokens"
const KEY = "refresh_token"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 保存 refresh_token（登录成功 / 401 刷新轮换后更新） */
export async function saveRefreshToken(token: string): Promise<void> {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(token, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 读取 refresh_token（启动恢复） */
export async function loadRefreshToken(): Promise<string | null> {
  try {
    const db = await openDb()
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** 清除 refresh_token（登出） */
export async function clearRefreshToken(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* IndexedDB 不可用时静默忽略（回退内存态） */
  }
}
