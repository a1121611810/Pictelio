/**
 * Lynx 平台属性专用颜色常量（不能走 CSS 通道的属性在此收口，禁止在模板散写十六进制）。
 *
 * 平台约束（FIX-5 实测，BookmarkPanel.template.test.ts 锁定）：placeholder-color 是
 * Lynx **平台属性**（非 CSS）——编译产物把它原样落入属性通道，var() 只在 CSS/style
 * 通道解析，平台属性不解析；web-core 预览会把它映射为 CSS 自定义属性而「假绿」。
 */

/**
 * input 占位符颜色。
 *
 * 值契约：= tokens.css 亮色段 `--md-on-surface-variant`（#41474e）。
 * 改色时同步更新 tokens.css 对应变量与本常量（模板测试守值）。
 */
export const INPUT_PLACEHOLDER_COLOR = '#41474e'
