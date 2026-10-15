// ─── input 占位符颜色的主题化（issue #693 / spec docs/specs/lynx-placeholder-theme-color.md）───
//
// `placeholder-color` 是 Lynx **平台属性**，不解析 `var()`（FIX-5 实测，见 ADR-0180 代价段），
// 所以它取不到 `--md-on-surface-variant`，只能绑一个字面量。暗色若沿用亮色基线值，
// 在 `--md-surface-container-highest` 上对比度仅 **1.31:1**（远低于 WCAG AA 4.5）。
// ⇒ 本 composable 把「当前主题色 + 当前明暗」翻成该字面量，9 处消费点统一从这里取。
//
// ── 为什么读 `resolvedDark` 而**不是** `currentDarkMode` ──
// `currentDarkMode` 只在 `system` 分支被消费；手动切 `light`/`dark` 时它**不动**
// （settingsStore.ts:1002 注释：哑桥 ref）。读它会让「手动切到暗色」这条最常见的路径
// 拿到陈旧的亮色值 —— 且这种错误在亮色下不可见，只在用户切暗色时才显形。
// `resolvedDark`（settingsStore.ts:397）是三态归一后的唯一出口，手动与系统跟随都在此汇合。
//
// ── 为什么不做非法值兜底 ──
// 主题 id 的校验与 `console.warn` 在 settingsStore 写入侧（`themeColor.ts` 的 `isThemeColorId`）；
// 类型层面 `Record<ThemeColorId, string>` 已让新增/改名主题在编译期暴露。
// 在本层再加 `?? 默认值` 就是一条静默降级路径（测试硬约束 #3 禁静默降级），
// 会把「store 写入侧漏校验」这个真 bug 藏成一个安静的错误颜色。
import { computed, type ComputedRef } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import {
  INPUT_PLACEHOLDER_COLOR,
  INPUT_PLACEHOLDER_DARK_COLOR,
} from '../utils/lynxPlatformColors'

export interface UseInputPlaceholderColorReturn {
  /**
   * 当前生效的 `placeholder-color` 字面量。
   *
   * 亮色：单值 `INPUT_PLACEHOLDER_COLOR`（不逐主题，理由见该常量注释 / spec §4.3）。
   * 暗色：按 `themeColor` 取 `INPUT_PLACEHOLDER_DARK_COLOR`（对比度 7.20~7.29）。
   */
  placeholderColor: ComputedRef<string>
}

export function useInputPlaceholderColor(): UseInputPlaceholderColorReturn {
  const settings = useSettingsStore()

  const placeholderColor = computed<string>(() =>
    settings.resolvedDark === 'dark'
      ? INPUT_PLACEHOLDER_DARK_COLOR[settings.themeColor]
      : INPUT_PLACEHOLDER_COLOR,
  )

  return { placeholderColor }
}
