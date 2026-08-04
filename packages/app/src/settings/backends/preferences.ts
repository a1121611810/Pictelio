/**
 * Preferences adapter —— 异步后端，跨 WebView / 原生 SharedPreferences 互读。
 */

import { Preferences } from "@capacitor/preferences";
import type { KVStorage } from "../types";

export function createPreferencesAdapter(): KVStorage {
  return {
    sync: false,
    async get(key) {
      const { value } = await Preferences.get({ key });
      return value;
    },
    async set(key, value) {
      await Preferences.set({ key, value });
    },
    async remove(key) {
      await Preferences.remove({ key });
    },
  };
}
