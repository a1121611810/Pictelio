/**
 * mirrored adapter —— Preferences 主 + localStorage 镜像。
 *
 * 用于首屏防闪烁项（theme / page_style_theme）：
 * - 写：primary 成功 → mirror 尽力跟随（镜像冗余，失败只记日志）
 * - 读：永远从 primary 读（权威源）；mirror 只通过 getSync 暴露（首屏同步读）
 * - 独有不变量：read() 的结果必然 ≥ readSync() 的新鲜度
 */

import type { KVStorage } from "../types";

export function createMirroredAdapter(
  primary: KVStorage,
  mirror: KVStorage,
  onMirrorError?: (key: string, e: unknown) => void,
): KVStorage {
  const warn = onMirrorError ?? ((key: string, e: unknown) => console.warn("[settings] mirror write failed", key, e));
  return {
    sync: true,
    async get(key) {
      return primary.get(key);
    },
    async set(key, value) {
      await primary.set(key, value);
      if (mirror.setSync) {
        try {
          mirror.setSync(key, value);
        } catch (e) {
          warn(key, e);
        }
      } else {
        try {
          await mirror.set(key, value);
        } catch (e) {
          warn(key, e);
        }
      }
    },
    async remove(key) {
      await primary.remove(key);
      if (mirror.setSync) {
        try {
          mirror.setSync(key, "");
        } catch {
          /* 镜像尽力跟随 */
        }
      } else {
        try {
          await mirror.remove(key);
        } catch {
          /* 镜像尽力跟随 */
        }
      }
    },
    getSync(key) {
      return mirror.getSync?.(key) ?? null;
    },
    setSync(key, value) {
      mirror.setSync?.(key, value);
    },
  };
}
