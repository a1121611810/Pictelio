// i18n 核心（抽取原型，wayfinder #496）。
// 选型：@solid-primitives/i18n（选型票 #494）——扁平字典 + resolveTemplate + translator。
// 加载策略：源语言（zh-CN）静态内联保首帧零闪烁；非源语言 dynamic import 独立 chunk 后台预取，
// 未就绪窗口回退源语言文案（t() 恒返回 string，组件零适配）。
// 未走 README 的 async memo + <Loading> 悬念模式：现有组件树无 Loading 包裹，Nullable 平滑
// 降级更贴近现状；async 模式是否切换属 spec 决策。
import { createMemo, createSignal } from "solid-js";
import { resolveTemplate, translator } from "@solid-primitives/i18n";
import { settings } from "@/settings";
import zhCN, { type Dict, type I18nKey } from "./locales/zh-CN";

export type { Dict, I18nKey };

export type Locale = "zh-CN" | "en";
export const SOURCE_LOCALE: Locale = "zh-CN";
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en"];

/** 与 app-lynx 共享的键（跨引擎同契约，参照 settings_novel_export_* 先例；WebDAV 备份自动收编） */
export const PREF_KEY_LANGUAGE = "settings_language";

function detectSystemLocale(): Locale {
  // WebView 会异步重置应用 locale（Google #37113860）：native 侧真实语言须经桥注入（spec 项），
  // Web 开发环境以 navigator.language 兜底。
  try {
    return navigator.language?.startsWith("en") ? "en" : SOURCE_LOCALE;
  } catch {
    return SOURCE_LOCALE;
  }
}

const [localeSignal, setLocaleSignal] = createSignal<Locale>(detectSystemLocale());
export const currentLocale = () => localeSignal();

// 语言偏好："" = 跟随系统；"zh-CN" / "en" = 手动覆盖（优先级：手动 > 系统）。
// apply 钩子在 hydrate（T1.5）与 set（T2）两个时点同步 locale signal——与 themeStore 同一接线法。
const languageHandle = settings.define<string>({
  key: PREF_KEY_LANGUAGE,
  default: "",
  validate: (v): v is string =>
    typeof v === "string" && (v === "" || (SUPPORTED_LOCALES as readonly string[]).includes(v)),
  apply: (v) => setLocaleSignal(v === "" ? detectSystemLocale() : (v as Locale)),
});

/** 切换语言：传 "" 回到跟随系统。 */
export function setLanguage(lang: Locale | ""): void {
  languageHandle.set(lang);
}

// 非源语言按需分 chunk，模块加载即后台预取（非阻塞）。
const [enDict, setEnDict] = createSignal<Dict | undefined>(undefined);
void import("./locales/en").then(
  (m) => setEnDict(m.default),
  (e) => console.warn("[i18n] en 字典 chunk 加载失败，回退源语言文案", e),
);

const dict = createMemo<Dict | undefined>(() =>
  localeSignal() === SOURCE_LOCALE ? zhCN : enDict(),
);

const rawT = translator(dict, resolveTemplate);

/** 翻译函数：字典未就绪时回退源语言，源语言也没有则回退 key（键完备性由 satisfies Dict 编译期保证）。 */
export function t(key: I18nKey, args?: Record<string, string | number>): string {
  return rawT(key, args) ?? zhCN[key] ?? key;
}
