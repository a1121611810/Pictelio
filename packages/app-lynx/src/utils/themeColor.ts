// ─── 主题色（app-lynx 动态配色）───
// 可选主题色清单为单一事实源：id 用于持久化与校验，className 对应 tokens.css
// 中预生成/基础的主题色板类。色板值为构建期静态 CSS（M3 TonalSpot 从 seed 生成），
// 避免在 Lynx 运行时做颜色计算或动态写 CSS 变量。
// 默认 sky 使用 `.theme-sky`：其选择器与基础 `page` 色板共用同一条 CSS 规则
// （见 tokens.css），页面观感零变化，同时默认色块预览可显式复用它。
export const THEME_COLOR_OPTIONS = [
  { id: "sky", className: "theme-sky" },
  { id: "violet", className: "theme-violet" },
  { id: "pink", className: "theme-pink" },
  { id: "green", className: "theme-green" },
  { id: "orange", className: "theme-orange" },
  { id: "teal", className: "theme-teal" },
] as const

export type ThemeColorId = (typeof THEME_COLOR_OPTIONS)[number]["id"]
export type ThemeColorOption = (typeof THEME_COLOR_OPTIONS)[number]

/** 全部可选主题色 id（由清单派生，避免第二份 id 列表漂移） */
export const THEME_COLOR_IDS: readonly ThemeColorId[] = THEME_COLOR_OPTIONS.map((o) => o.id)

export const DEFAULT_THEME_COLOR: ThemeColorId = "sky"

const ID_SET: ReadonlySet<string> = new Set<string>(THEME_COLOR_IDS)

/**
 * 持久化值校验：非法值不得写入状态。
 * 静默降级规则：调用方（settingsStore.loadSettings）对非法值输出 console.warn。
 */
export function isThemeColorId(value: string): value is ThemeColorId {
  return ID_SET.has(value)
}

/** 主题色 → tokens.css 色板类（未知 id 回退默认色板并 warn，禁止静默降级） */
export function themeColorClass(id: ThemeColorId): string {
  const option = THEME_COLOR_OPTIONS.find((o) => o.id === id)
  if (!option) {
    console.warn("[themeColor] 未知主题色 id，回退默认色板:", id)
    return THEME_COLOR_OPTIONS[0].className
  }
  return option.className
}
