import { Preferences } from "@capacitor/preferences";
import { applyPageStyleClass, applyDarkClass } from "@/utils/themeApplier";

/** 页面风格主题 */
export type PageStyleThemeId = "fluent" | "card";

export const PAGE_STYLE_THEME_IDS: readonly PageStyleThemeId[] = ["fluent", "card"];

/** 明暗主题 */
export type Theme = "light" | "dark" | "system";

const PREF_KEY_THEME = "theme";
const PREF_KEY_PAGE_STYLE_THEME = "page_style_theme";

// ── 主题辅助函数 ──

/** 根据 OS 偏好获取当前系统主题（安全兜底） */
function getSystemTheme(): "dark" | "light" {
  const [err, isDark] = trySync(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  return err ? "light" : (isDark ? "dark" : "light");
}

/** 根据用户选择的 theme 计算出实际生效的主题 */
function computeResolvedTheme(userTheme: Theme): "dark" | "light" {
  return userTheme === "system" ? getSystemTheme() : userTheme;
}

// ── 明暗主题状态 ──

let currentTheme: Theme = "system";
let currentResolved: "dark" | "light" = computeResolvedTheme(currentTheme);

export function getTheme(): Theme {
  return currentTheme;
}

export function getResolvedTheme(): "dark" | "light" {
  return currentResolved;
}

export function setTheme(t: Theme): void {
  currentTheme = t;
}

export async function setThemePersisted(newTheme: Theme): Promise<void> {
  currentTheme = newTheme;
  currentResolved = computeResolvedTheme(newTheme);
  applyDarkClass(currentResolved === "dark");
  const [err] = await tryAsync(Preferences.set({ key: PREF_KEY_THEME, value: newTheme }));
  if (err) {
    console.warn("[themeStore] Failed to persist theme", err);
  } else {
    localStorage.setItem(PREF_KEY_THEME, newTheme);
  }
}

export async function loadThemePreference(): Promise<void> {
  const [err, result] = await tryAsync(Preferences.get({ key: PREF_KEY_THEME }));
  if (err) {
    console.warn("[themeStore] Failed to load theme preference", err);
    currentResolved = getSystemTheme();
    applyDarkClass(currentResolved === "dark");
    return;
  }
  const { value } = result!;
  const userTheme: Theme =
    value === "light" || value === "dark" || value === "system" ? value : "system";
  currentTheme = userTheme;
  currentResolved = computeResolvedTheme(userTheme);
  applyDarkClass(currentResolved === "dark");
}

// ── 页面风格主题状态 ──

const [internalPageStyleTheme, setInternalPageStyleTheme] =
  createSignal<PageStyleThemeId>("fluent");

export const pageStyleTheme = () => internalPageStyleTheme();

export function setPageStyleTheme(id: PageStyleThemeId): void {
  setInternalPageStyleTheme(id);
  // 立即应用 class（不等待 createEffect 调度）
  if (typeof document !== "undefined") {
    applyPageStyleClass(id);
  }
}

export async function loadPageStyleThemePreference(): Promise<void> {
  const [err, result] = await tryAsync(Preferences.get({ key: PREF_KEY_PAGE_STYLE_THEME }));
  if (err) {
    console.warn("[themeStore] Failed to load page style theme preference", err);
    return;
  }
  const { value } = result!;
  if (value != null && (PAGE_STYLE_THEME_IDS as readonly string[]).includes(value)) {
    setInternalPageStyleTheme(value as PageStyleThemeId);
  }
}

// ── 模块级副作用 ──

// 监听系统主题变化，用户选 "system" 时自动跟随
trySync(() => {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (currentTheme === "system") {
      currentResolved = getSystemTheme();
      applyDarkClass(currentResolved === "dark");
    }
  });
});

// 自动持久化页面风格主题到 Preferences
let lastPersistedPageStyle: string | undefined;
createRoot(() => {
  createEffect(() => {
    const id = internalPageStyleTheme();
    if (typeof document === "undefined") return;
    if (id !== lastPersistedPageStyle) {
      lastPersistedPageStyle = id;
      tryAsync(Preferences.set({ key: PREF_KEY_PAGE_STYLE_THEME, value: id })).then(
        ([err]) => {
          if (err) console.warn("[themeStore] Failed to persist page style theme", err);
        },
      );
    }
  });
});
