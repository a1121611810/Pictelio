/**
 * memory adapter —— 测试注入用。
 *
 * 实现刻意极小（一个 Map），测试的 leverage 来自「行为与 PreferencesAdapter
 * 一致」而非功能丰富。同时满足 getSync/setSync，使首屏同步读在测试中可复现。
 * dump() 是唯一的测试后门。
 */

import type { KVStorage } from "../types";

export function createMemoryAdapter(
  seed: Readonly<Record<string, string>> = {},
): KVStorage & { dump(): Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    sync: true,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    getSync(key) {
      return data.get(key) ?? null;
    },
    setSync(key, value) {
      data.set(key, value);
    },
    async keys() {
      return [...data.keys()];
    },
    dump: () => new Map(data),
  };
}
