import { createSignal } from "solid-js";
import { Preferences } from "@capacitor/preferences";

interface PersistedSet<T> {
  /** 响应式集合信号 */
  values: () => Set<T>;
  /** 添加元素并持久化。已存在时跳过。 */
  add: (value: T) => Promise<void>;
  /** 移除元素并持久化。不存在时跳过。 */
  remove: (value: T) => Promise<void>;
  /** 判断元素是否在集合中 */
  has: (value: T) => boolean;
  /** 从 Preferences 加载已持久化的集合 */
  load: () => Promise<void>;
  /** 清空集合（不操作 Preferences） */
  reset: () => void;
}

/**
 * 创建一个持久化的 Set 工厂，自动同步到 Capacitor Preferences。
 *
 * @param storageKey - Preferences 中存储的键名
 * @param logPrefix - console.warn 的前缀标签
 */
export function createPersistedSet<T>(storageKey: string, logPrefix: string): PersistedSet<T> {
  const [values, setValues] = createSignal<Set<T>>(new Set());

  async function load(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: storageKey });
      if (value) {
        const items: T[] = JSON.parse(value);
        setValues(new Set(items));
      }
    } catch (error) {
      console.warn(`[${logPrefix}] Failed to load ${storageKey}`, error);
    }
  }

  async function add(value: T): Promise<void> {
    if (values().has(value)) return;
    const next = new Set(values());
    next.add(value);
    setValues(next);
    try {
      await Preferences.set({ key: storageKey, value: JSON.stringify([...next]) });
    } catch (error) {
      console.warn(`[${logPrefix}] Failed to persist ${storageKey}`, error);
    }
  }

  async function remove(value: T): Promise<void> {
    if (!values().has(value)) return;
    const next = new Set(values());
    next.delete(value);
    setValues(next);
    try {
      await Preferences.set({ key: storageKey, value: JSON.stringify([...next]) });
    } catch (error) {
      console.warn(`[${logPrefix}] Failed to persist ${storageKey}`, error);
    }
  }

  function has(value: T): boolean {
    return values().has(value);
  }

  function reset(): void {
    setValues(new Set<T>());
  }

  return { values, add, remove, has, load, reset };
}
