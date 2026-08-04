/**
 * localStorage adapter —— 同步后端（首屏同步读 + 纯 Web 侧数据）。
 *
 * 收拢 localStorage 的三个坑：SecurityError / QuotaExceededError / SSR。
 */

import type { KVStorage } from "../types";

export function createLocalStorageAdapter(): KVStorage {
  return {
    sync: true,
    async get(key) {
      return readSync(key);
    },
    async set(key, value) {
      writeSync(key, value);
    },
    async remove(key) {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.removeItem(key);
      } catch {
        /* 忽略（隐私模式等） */
      }
    },
    getSync: readSync,
    setSync: writeSync,
  };
}

function readSync(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSync(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn("[settings] localStorage write failed", key, e);
  }
}
