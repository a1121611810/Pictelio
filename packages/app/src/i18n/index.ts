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

/** 翻译函数：字典未就绪时回退源语言，源语言也没有则回退 key（键完备性由 satisfies Dict 编译期保证）。
 * 回退链同样走插值——字典未就绪窗口不得吐原始模板（B1 实测教训）。 */
export function t(key: I18nKey, args?: Record<string, string | number>): string {
  const rendered = rawT(key, args);
  if (rendered !== undefined) {
    return rendered;
  }
  const fallback = zhCN[key] ?? key;
  return args ? resolveTemplate(fallback, args) : fallback;
}

/** ApiError 展示文案：messageKey 优先（i18n 渲染），message 快照回退（B1）。 */
export function apiErrorMessage(e: {
  messageKey?: string;
  message: string;
  params?: Record<string, string | number>;
}): string {
  return e.messageKey ? t(e.messageKey as I18nKey, e.params) : e.message;
}

/** 原生桥注入有效 locale（B10）：WebView 会异步重置应用 locale（Google #37113860），
 * navigator.language 不可信——native 环境启动后经 ClientInfo 桥校正「跟随系统」态。
 * 手动覆盖（handle ≠ ""）时不校正；web dev / 插件不可用静默维持 navigator 兜底。 */
export async function refreshSystemLocaleFromBridge(): Promise<void> {
  if (languageHandle.value() !== "") return;
  try {
    const { ClientInfo } = await import("@/native/ClientInfo");
    const { languageTag } = await ClientInfo.getLocale();
    const mapped: Locale = languageTag?.startsWith("en") ? "en" : SOURCE_LOCALE;
    if (mapped !== localeSignal()) {
      setLocaleSignal(mapped);
    }
  } catch {
    // 插件不可用（web dev）：维持 navigator 兜底，属预期
  }
}
