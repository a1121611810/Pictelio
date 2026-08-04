/**
 * 持久化 Set 集合 —— 基于统一 Settings registry。
 *
 * 存储格式与旧 Preferences 数据兼容：数组 JSON（JSON.stringify([...])）。
 * 旧 createPersistedSet（直接依赖 Preferences）已由 createPersistedSetSetting 取代。
 */

import { jsonCodec, settings } from "@/settings";
import type { SettingDef } from "@/settings";

interface PersistedSet<T> {
  /** 响应式集合 accessor（每次调用返回当前快照） */
  values: () => Set<T>;
  /** 添加元素并持久化。已存在时跳过。 */
  add: (value: T) => Promise<void>;
  /** 移除元素并持久化。不存在时跳过。 */
  remove: (value: T) => Promise<void>;
  /** 判断元素是否在集合中 */
  has: (value: T) => boolean;
  /** 从存储加载已持久化的集合 */
  load: () => Promise<void>;
  /** 清空集合并持久化空数组 */
  reset: () => void;
}

/**
 * 创建一个基于 Settings registry 的持久化 Set。
 *
 * @param def - 设置定义（key / default / validate 等），存储值类型为 T[]（数组 JSON）。
 */
export function createPersistedSetSetting<T>(def: SettingDef<T[]>): PersistedSet<T> {
  const handle = settings.define<T[]>({
    ...def,
    codec: def.codec ?? jsonCodec,
  });

  return {
    values: () => new Set(handle.value()),
    async add(value) {
      if (handle.value().includes(value)) return;
      handle.set([...handle.value(), value]);
    },
    async remove(value) {
      if (!handle.value().includes(value)) return;
      handle.set(handle.value().filter((v) => v !== value));
    },
    has: (value) => handle.value().includes(value),
    async load() {
      await handle.hydrate();
    },
    reset() {
      handle.set([]);
    },
  };
}
