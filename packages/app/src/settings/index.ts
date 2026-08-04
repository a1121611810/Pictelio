/**
 * 统一设置存储抽象层 —— 模块入口。
 *
 * 模块级单例（与现有模块级 store 单例一致）。构造无副作用（T0 零 IO）。
 */

import { createSettings } from "./registry";
import { createPreferencesAdapter } from "./backends/preferences";
import { createLocalStorageAdapter } from "./backends/localStorage";
import { createMirroredAdapter } from "./backends/mirrored";

const preferences = createPreferencesAdapter();
const localStorageAdapter = createLocalStorageAdapter();
const mirrored = createMirroredAdapter(preferences, localStorageAdapter);

export const settings = createSettings({
  storages: {
    preferences,
    localStorage: localStorageAdapter,
    mirrored,
  },
  defaultStorage: "preferences",
});

export type {
  Codec,
  KVStorage,
  SettingDef,
  SettingHandle,
  DynamicSettingFactory,
  Settings,
} from "./types";
export { stringCodec, boolCodec, numCodec, jsonCodec, inferCodec } from "./codecs";
export { createSettings, type SettingsOptions } from "./registry";
export { createPreferencesAdapter } from "./backends/preferences";
export { createLocalStorageAdapter } from "./backends/localStorage";
export { createMirroredAdapter } from "./backends/mirrored";
export { createMemoryAdapter } from "./backends/memory";
