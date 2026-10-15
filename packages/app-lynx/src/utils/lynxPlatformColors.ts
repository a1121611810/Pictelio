/**
 * Lynx 平台属性专用颜色常量（不能走 CSS 通道的属性在此收口，禁止在模板散写十六进制）。
 *
 * 平台约束（FIX-5 实测，BookmarkPanel.template.test.ts 锁定）：placeholder-color 是
 * Lynx **平台属性**（非 CSS）——编译产物把它原样落入属性通道，var() 只在 CSS/style
 * 通道解析，平台属性不解析；web-core 预览会把它映射为 CSS 自定义属性而「假绿」。
 *
 * ⚠️ 这条约束使下表**只能承载字面量**，取不到 `var(--md-on-surface-variant)`。
 *   代价是 tokens.css 与本文件之间没有任何编译期联系，因此
 *   `lynxPlatformColors.test.ts` 承担「表 ≡ tokens.css」的守值职责（issue #693）。
 *
 * ⚠️ **平台升级风险（#537 结论，本轮登记）**：`placeholder-color` 已不在 Lynx 当前官方文档的
 *   input 属性表里——它是 elements 插件随客户端分发的**遗留属性**，本仓 runtime（LynxView 4.0.1）
 *   实测仍接受。升级 LynxView / elements 后该属性**可能无声移除**，表现是 placeholder 回落平台默认灰：
 *   无类型报错、无文档预警、构建与单测**全绿**。
 *   ⇒ 升级 SDK 时**必须**复跑走查矩阵 T4-6（对比度判据），不能只看 CI 绿。
 */

import type { ThemeColorId } from './themeColor'

/**
 * input 占位符颜色（**亮色**：按主题色取，issue #1015 亮色令牌保真）。
 *
 * 值契约：逐项 = tokens.css `.theme-{id}` 亮色段的 `--md-on-surface-variant`；
 * **唯一例外 bili = `#5a5f66`（clamp，见下）**。
 *
 * **bili clamp 规则**（spec §4.2）：该档 on-surface-variant（`#61666d`）在其亮底
 * `--md-surface-container-highest`（`#d6d9dc`）上仅 **4.08:1**，低于 WCAG AA 4.5；
 * clamp = 「令牌值向深色方向加深至 ≥4.5 的最小步」⇒ `#5a5f66` = 4.54。若像素实测 <4.5，
 * 升档 `#53585f`（5.0）重测。值守由 `lynxPlatformColors.test.ts` 钉死（锁输出值不锁规则）。
 *
 * 决策依据留档（#1015 Grill Round 1）：亮色逐主题化后 6 档对比度持平或微降
 * （on-surface-variant 对 `surface` 定义，输入框实际坐 `surface-container-highest`），
 * 全部仍在 AAA；本表交付的是语义对齐与可审计性，不是对比度提升。
 *
 * 用 `Record<ThemeColorId, string>` 而非查表 + 兜底：主题 id 的新增/改名会在这里**编译期报错**，
 * 而兜底分支会静默吞掉（测试硬约束 #3：禁静默降级）。
 * 运行时非法 id 由 settingsStore 写入侧校验拦下（`themeColor.ts` 的 `isThemeColorId` + console.warn），
 * 故本表不做运行时兜底。
 */
export const INPUT_PLACEHOLDER_LIGHT_COLOR: Record<ThemeColorId, string> = {
  sky: '#41474e',
  violet: '#49454e',
  pink: '#514347',
  green: '#424940',
  orange: '#50453a',
  teal: '#3f4949',
  bili: '#5a5f66',
}

/**
 * input 占位符颜色（**暗色**：按主题色取）。
 *
 * 值契约：逐项 = tokens.css `.theme-{id}.dark` 段的 `--md-on-surface-variant`。
 * 对 `--md-surface-container-highest` 的实测对比度 7.20~7.29（修复前为 1.31，见 issue #693）。
 *
 * 用 `Record<ThemeColorId, string>` 而非查表 + 兜底：主题 id 的新增/改名会在这里**编译期报错**，
 * 而兜底分支会静默吞掉（测试硬约束 #3：禁静默降级）。
 * 运行时非法 id 由 settingsStore 写入侧校验拦下（`themeColor.ts` 的 `isThemeColorId` + console.warn），
 * 故本表不做运行时兜底。
 */
export const INPUT_PLACEHOLDER_DARK_COLOR: Record<ThemeColorId, string> = {
  sky: '#c2c7cf',
  violet: '#cac4cf',
  pink: '#d5c2c6',
  green: '#c2c8bd',
  orange: '#d5c3b5',
  teal: '#bec8c9',
  bili: '#d6c2c5',
}
