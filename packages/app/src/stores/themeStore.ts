import { settings } from "@/settings";
import { applyPageStyleClass, applyDarkClass } from "@/utils/themeApplier";

/** 页面风格主题 */
export type PageStyleThemeId = "fluent" | "card";

export const PAGE_STYLE_THEME_IDS: readonly PageStyleThemeId[] = ["fluent", "card"];

/** 明暗主题 */
export type Theme = "light" | "dark" | "system";

// ── 主题辅助函数 ──

/** 根据 OS 偏好获取当前系统主题（安全兜底） */
function getSystemTheme(): "dark" | "light" {
  const [err, isDark] = trySync(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  return err ? "light" : isDark ? "dark" : "light";
}

/** 根据用户选择的 theme 计算出实际生效的主题 */
function computeResolvedTheme(userTheme: Theme): "dark" | "light" {
  return userTheme === "system" ? getSystemTheme() : userTheme;
}

// ── 明暗主题状态（统一 settings registry 管理）──

const themeHandle = settings.define<Theme>({
  key: "theme",
  default: "system",
  storage: "mirrored",
  syncInit: true,
  validate: (v): v is Theme => v === "light" || v === "dark" || v === "system",
  apply: (t) => {
    currentResolved = computeResolvedTheme(t);
    applyDarkClass(currentResolved === "dark");
  },
});

let currentResolved: "dark" | "light" = computeResolvedTheme(themeHandle.value());

export function getTheme(): Theme {
  return themeHandle.value();
}

export function getResolvedTheme(): "dark" | "light" {
  return currentResolved;
}

export function setTheme(t: Theme): void {
  themeHandle.set(t);
}

/** 设置并持久化明暗主题（registry 接管 Preferences + localStorage 镜像双写） */
export function setThemePersisted(newTheme: Theme): void {
  themeHandle.set(newTheme);
}

// ── 页面风格主题状态（统一 settings registry 管理）──

const pageStyleHandle = settings.define<PageStyleThemeId>({
  key: "page_style_theme",
  default: "fluent",
  storage: "mirrored",
  syncInit: true,
  validate: (v): v is PageStyleThemeId =>
    (PAGE_STYLE_THEME_IDS as readonly string[]).includes(v as string),
  apply: (id) => applyPageStyleClass(id),
});

export const pageStyleTheme = (): PageStyleThemeId => pageStyleHandle.value();

export function setPageStyleTheme(id: PageStyleThemeId): void {
  pageStyleHandle.set(id);
}

// ── 模块级副作用：系统主题跟随 ──

// 监听系统主题变化，用户选 "system" 时自动跟随
trySync(() => {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (getTheme() === "system") {
      currentResolved = getSystemTheme();
      applyDarkClass(currentResolved === "dark");
    }
  });
});
