/**
 * IndexedDB 抽象层。
 *
 * 提供两种实现：
 * - createIDBStore()  — 真实 IndexedDB（生产环境）
 * - createMemoryStore() — 内存实现（测试环境）
 *
 * 在 novelCache.ts 中通过 _useStore() 注入。
 */

// ─── Interface ───

export interface IDBStore {
  get<T>(store: string, key: number): Promise<T | undefined>;
  put<T extends { id: number }>(store: string, value: T): Promise<void>;
  delete(store: string, key: number): Promise<void>;
  count(store: string): Promise<number>;
  getAll<T>(store: string): Promise<T[]>;
  clear(store: string): Promise<void>;
}

// ─── Memory implementation (for testing) ───

export function createMemoryStore(): IDBStore {
  const data = new Map<string, Map<number, unknown>>();

  function storeMap(store: string): Map<number, unknown> {
    if (!data.has(store)) {
      data.set(store, new Map());
    }
    return data.get(store)!;
  }

  return {
    async get<T>(store: string, key: number): Promise<T | undefined> {
      return storeMap(store).get(key) as T | undefined;
    },
    async put<T extends { id: number }>(store: string, value: T): Promise<void> {
      storeMap(store).set(value.id, value);
    },
    async delete(store: string, key: number): Promise<void> {
      storeMap(store).delete(key);
    },
    async count(store: string): Promise<number> {
      return storeMap(store).size;
    },
    async getAll<T>(store: string): Promise<T[]> {
      return Array.from(storeMap(store).values()) as T[];
    },
    async clear(store: string): Promise<void> {
      data.delete(store);
    },
  };
}

// ─── IndexedDB implementation (production) ───

const DB_NAME = "pictelio";
/** 1→2：新增 translations store（译文 LRU 缓存，决策 #24）；升级必须补建 store，否则运行时 NotFoundError */
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("novels")) {
        db.createObjectStore("novels", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("series")) {
        db.createObjectStore("series", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("translations")) {
        db.createObjectStore("translations", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDB();
  }
  return dbPromise;
}

export function createIDBStore(): IDBStore {
  return {
    async get(store, key) {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result ?? undefined);
        req.onerror = () => reject(req.error);
      });
    },
    async put(store, value) {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const req = tx.objectStore(store).put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async delete(store, key) {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const req = tx.objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async count(store) {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async getAll(store) {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async clear(store) {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const req = tx.objectStore(store).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
  };
}
