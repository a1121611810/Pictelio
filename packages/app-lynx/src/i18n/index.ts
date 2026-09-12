// 副端 i18n 核心（抽取原型，wayfinder #496）：手写 message 模块——Lynx 运行时无 Intl/无 DOM，
// vue-i18n 的 $d/$n 直踩平台缺口（选型票 #494 实证）。locale 为模块级 ref：t() 在模板/computed
// 内调用即建立响应依赖，切换即时生效。副端 bundle 小，双语言静态内联（Lynx 动态 import chunk
// 机制未验证，懒加载属 spec 决策）。
import { ref } from "vue"
import zhCN, { type Dict, type I18nKey } from "./locales/zh-CN"
import en from "./locales/en"

export type { Dict, I18nKey }

export type Locale = "zh-CN" | "en"
export const SOURCE_LOCALE: Locale = "zh-CN"
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en"]

function detectSystemLocale(): Locale {
  // LynxView 原生模式下 navigator 可能不存在（node/worker 环境同）；真实系统语言
  // 须经原生桥注入（spec 项，主端同因 WebView 异步重置 locale 也走桥）。
  try {
    return navigator.language?.startsWith("en") ? "en" : SOURCE_LOCALE
  } catch {
    return SOURCE_LOCALE
  }
}

export const locale = ref<Locale>(detectSystemLocale())

const DICTS: Record<Locale, Dict> = { "zh-CN": zhCN, en }

/** 切换语言（原型不持久化——接线 lynx settingsStore 属 spec 范围）。 */
export function setLocale(l: Locale): void {
  locale.value = l
}

function applyVars(tpl: string, vars?: Record<string, string | number>): string {
  if (!vars) return tpl
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/** 翻译函数：缺 key 回退源语言并 console.warn（禁静默降级），源也没有则回退 key 本身。 */
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  const tpl = DICTS[locale.value][key]
  if (typeof tpl !== "string") {
    // 类型上不可达（Dict 键完备由 satisfies 保证）；运行时防御按禁静默降级处理
    console.warn(`[i18n] missing key: ${String(key)} (locale=${locale.value})`)
    return key
  }
  return applyVars(tpl, vars)
}

/** ApiError 展示文案：messageKey 优先（i18n 渲染），message 快照回退（B1）。 */
export function apiErrorMessage(e: {
  messageKey?: string
  message: string
  params?: Record<string, string | number>
}): string {
  return e.messageKey ? t(e.messageKey as I18nKey, e.params) : e.message
}
