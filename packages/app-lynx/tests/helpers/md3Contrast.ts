// ─── WCAG 2.1 相对亮度 / 对比度计算（issue #862 / T14 票面验收 ②）───
//
// 为什么需要它：MD3 整改票要求「对比度按 WCAG 公式**计算**并断言」，而本仓此前
// 只有差距报告里的一次性静态计算（`docs/research/material-design-3-gap-analysis-2026-09.md`
// §3.1）——那是**报告里的结论**，不是可重复执行的判据。色板一改（生成脚本重跑 / 有人手改
// 一个 hex），没有任何机器防线会发现对比度塌到 1:1。本模块把公式固化成可复用工具，
// 让 `md3ConfigTokens.test.ts` 能对 14 个色板 × N 组配对逐对计算。
//
// 公式来源（一手，非项目自创）：W3C WCAG 2.1 §「relative luminance」/「contrast ratio」
//   - 通道线性化：c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4
//   - 亮度：L = 0.2126R + 0.7152G + 0.0722B
//   - 比值：(L_lighter + 0.05) / (L_darker + 0.05)
// 阈值档位（不是本模块的职责，但调用方必须自己分档）：
//   - 正文类配对 4.5:1 = WCAG 2.1 SC 1.4.3 Contrast (Minimum), Level AA
//   - UI 边界 / 强调类 3:1 = WCAG 2.1 SC 1.4.11 Non-text Contrast, Level AA
//
// **禁静默降级**：解析不了的值一律抛错，绝不返回 0 / 1 / 任何默认比值。
// 一个「解析失败就当 0 亮度」的默认值会把「色板里混进 `var(--md-x)` 或渐变」伪装成
// 「对比度 21:1 全绿」，正是本仓反复在消灭的假绿。

/** 解析出的颜色：0–255 三通道 + 0–1 alpha */
export interface ParsedColor {
  r: number
  g: number
  b: number
  alpha: number
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
/** `rgb(1,2,3)` / `rgba(1,2,3,.4)` / `rgb(1 2 3 / 40%)`（逗号与空格两种分隔都收） */
const RGB_FN = /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i

function channel(raw: string, what: string): number {
  const isPercent = raw.endsWith('%')
  const n = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw)
  if (!Number.isFinite(n)) throw new Error(`[md3Contrast] ${what} 通道无法解析：${raw}`)
  const v = isPercent ? (n / 100) * 255 : n
  if (v < 0 || v > 255) throw new Error(`[md3Contrast] ${what} 通道越界（须 0–255）：${raw}`)
  return v
}

function alphaOf(raw: string | undefined): number {
  // 未给 alpha 视作不透明（CSS 规范：`rgb()` 省略 alpha 即 1）
  if (raw === undefined) return 1
  const isPercent = raw.endsWith('%')
  const n = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw)
  if (!Number.isFinite(n)) throw new Error(`[md3Contrast] alpha 无法解析：${raw}`)
  const v = isPercent ? n / 100 : n
  if (v < 0 || v > 1) throw new Error(`[md3Contrast] alpha 越界（须 0–1）：${raw}`)
  return v
}

/**
 * 解析 CSS 颜色字面量。支持 `#rgb` / `#rrggbb` / `rgb()` / `rgba()`（含空格分隔与百分比通道）。
 * 其余形态（`var(--x)` / 具名色 / `linear-gradient(...)` / 空串）**抛错**——
 * 令牌表里混进这些形态本身就是缺陷，调用方需要看到它，而不是拿到一个假的比值。
 */
export function parseCssColor(value: string): ParsedColor {
  const raw = value.trim()
  const hex3 = HEX3.exec(raw)
  if (hex3) {
    // 三位缩写按 CSS 规范展开为「每字符重复两次」：#abc → #aabbcc
    return {
      r: Number.parseInt(hex3[1]! + hex3[1]!, 16),
      g: Number.parseInt(hex3[2]! + hex3[2]!, 16),
      b: Number.parseInt(hex3[3]! + hex3[3]!, 16),
      alpha: 1,
    }
  }
  const hex6 = HEX6.exec(raw)
  if (hex6) {
    return {
      r: Number.parseInt(hex6[1]!, 16),
      g: Number.parseInt(hex6[2]!, 16),
      b: Number.parseInt(hex6[3]!, 16),
      alpha: 1,
    }
  }
  const fn = RGB_FN.exec(raw)
  if (fn) {
    return {
      r: channel(fn[1]!, 'r'),
      g: channel(fn[2]!, 'g'),
      b: channel(fn[3]!, 'b'),
      alpha: alphaOf(fn[4]),
    }
  }
  throw new Error(`[md3Contrast] 无法解析为 CSS 颜色：${JSON.stringify(value)}`)
}

/**
 * WCAG 2.1 相对亮度。传入字符串时先解析（解析失败按 `parseCssColor` 抛错）。
 *
 * 线性化阈值取 **0.03928**（WCAG 2.1 正文所写值）。注：WCAG 2.0 errata 之后的 sRGB
 * 公式用 0.04045，两者在 8bit 色深下只影响 #0a0a0a（10/255 = 0.039216）这一个通道值 ——
 * 改阈值前先确认这一点，别把它当成「随手调参」。
 */
export function relativeLuminance(color: string | ParsedColor): number {
  const { r, g, b } = typeof color === 'string' ? parseCssColor(color) : color
  const linear = (raw: number): number => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * WCAG 2.1 对比度比值（对称：前景背景不分先后，返回值 ≥ 1）。
 *
 * 半透明色（alpha < 1）**直接抛错**：状态层四态是 alpha 0.08–0.16 的叠加层，
 * 拿它跟不透明背景算比值得到的是「未合成色」的假数字。要比就必须先合成到具体底色，
 * 那是调用方（合成函数）的责任，本模块不替它猜。
 */
export function contrastRatio(foreground: string | ParsedColor, background: string | ParsedColor): number {
  const fg = typeof foreground === 'string' ? parseCssColor(foreground) : foreground
  const bg = typeof background === 'string' ? parseCssColor(background) : background
  if (fg.alpha < 1) {
    throw new Error(`[md3Contrast] 前景色 alpha=${fg.alpha} < 1，需先合成到底色再算对比度`)
  }
  if (bg.alpha < 1) {
    throw new Error(`[md3Contrast] 背景色 alpha=${bg.alpha} < 1，需先合成到底色再算对比度`)
  }
  const lFg = relativeLuminance(fg)
  const lBg = relativeLuminance(bg)
  const lighter = Math.max(lFg, lBg)
  const darker = Math.min(lFg, lBg)
  return (lighter + 0.05) / (darker + 0.05)
}
