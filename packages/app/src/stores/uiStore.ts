import { createStore } from "solid-js/store";
import { Preferences } from "@capacitor/preferences";

type Tab = "recommended" | "follow" | "bookmarks" | "me" | "history";
export type { Tab };
export type ContentType = "illust" | "novel";

/** 布局模式 → 列数映射 */
export const MODE_COLUMNS: Record<string, number> = {
  waterfall: 2,
  single: 1,
  grid: 3,
};

const PREF_KEY_CONTENT_TYPE = "content_type";

// ── Store ──

const initialState = () => ({
  // 导航
  currentTab: "recommended" as Tab,
  // 内容类型
  contentType: "illust" as ContentType,
});

const [state, setState] = createStore(initialState());

// ── 向后兼容的导出包装函数 ──

export const currentTab = () => state.currentTab;
export const setCurrentTab = (tab: Tab) => setState("currentTab", tab);

export const contentType = () => state.contentType;

export async function setContentType(type: ContentType): Promise<void> {
  const prev = state.contentType;
  if (type === prev) {
    return;
  }
  setState("contentType", type);
  const [err] = await tryAsync(Preferences.set({ key: PREF_KEY_CONTENT_TYPE, value: type }));
  if (err) {
    console.warn("[uiStore] Failed to persist contentType", err);
    setState("contentType", prev);
  }
  window.dispatchEvent(new CustomEvent("contentTypeChanged"));
}

export async function loadContentTypePreference(): Promise<void> {
  const [err, result] = await tryAsync(Preferences.get({ key: PREF_KEY_CONTENT_TYPE }));
  if (err) {
    console.warn("[uiStore] Failed to load contentType preference", err);
  } else {
    const { value } = result!;
    if (value === "illust" || value === "novel") {
      setState("contentType", value as ContentType);
    }
  }
}

/** 重置所有 UI 设置为默认值。委托给 settingsStore 重置。 */
export async function resetUiStore(): Promise<void> {
  const { setThemePersisted } = await import("./themeStore");
  await setThemePersisted("system");
  const { resetSettingsStore } = await import("./settingsStore");
  await resetSettingsStore();
}
