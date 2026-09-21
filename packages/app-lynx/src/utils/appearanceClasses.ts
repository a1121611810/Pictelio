// ─── 根 <page> 类绑定（spec docs/specs/lynx-night-mode.md T2 §4.7）───
// 输入 themeColorId + resolvedDark → 根类数组。
// - 亮色模式：返回 ['theme-X']
// - 暗色模式：返回 ['theme-X', 'dark']（复合选择器 .theme-X.dark 特异性更高，覆盖亮色版同名变量）
// - id → className（含未知回退 + warn）复用 themeColor.ts 的 themeColorClass：**单一实现**
//   （本地镜像会产生第二份 warn 前缀，非法值告警来源分裂）
//
// 设计约束：
// - 根 <page> 同时挂 .theme-X 与 .dark 两个类 → 复合选择器特异性 0,2,0 > 0,1,0，CSS 变量
//   即时覆盖，零运行时算色（tokens.css 已静态生成 6 套暗色色板）；
// - 状态栏图标色（spec T3）只读 resolvedDark，不重复派生；
// - 切换瞬时：根类变化 → 整树 CSS 变量重算，Lynx 元素重排；
// - a11y / i18n / Me.vue 入口的色块预览均消费 resolvedDark，与根类严格同步。
import { themeColorClass } from "./themeColor"
import type { ResolvedDark } from "./darkMode"

/** 暗色附加类（spec §4.7 决策：与 .theme-X 复合组成 .theme-X.dark） */
export const DARK_CLASS = "dark"

/**
 * 根 <page> 类数组（亮色 / 暗色 二选一）。
 * Vue 模板直接 :class="appearanceClasses(themeColor, resolvedDark)" 即可。
 *
 * 行为约束：
 * - 未知 themeColorId → console.warn + 回退默认 + 单类返回（静默降级禁；告警前缀
 *   `[themeColor]` —— 与 themeColorClass 同一条实现，非本模块自有前缀）
 * - resolvedDark === 'dark' → 附加 .dark 类（与既有 .theme-X 复合）
 * - resolvedDark === 'light' → 仅 .theme-X 单类
 */
export function appearanceClasses(themeColorId: string, resolvedDark: ResolvedDark): string[] {
  const themeClass = themeColorClass(themeColorId)
  if (resolvedDark === "dark") return [themeClass, DARK_CLASS]
  return [themeClass]
}
