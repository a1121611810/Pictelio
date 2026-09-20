#!/usr/bin/env node
// ─── app-lynx 暗色主题色板生成脚本（spec docs/specs/lynx-night-mode.md T2 §4.7）───
//
// 用途：从 6 个 seed 色经 M3 SchemeTonalSpot 生成 6 套暗色色板（追加到 tokens.css）。
// 亮色版沿用既有手调色板（ADR-0152 / commit f239b065）——保持视觉零回归。
//
// 决策（spec §4.7 范围内二选一）：暗色版走 `.theme-X.dark` 复合选择器：
//   - 单一事实源 = themeColor.ts 的 THEME_COLOR_OPTIONS（id 派生 className + seed）
//   - 根 <page> 同时挂 .theme-X + .dark 两个类 → 复合选择器特异性更高，覆盖亮色版的同名变量
//   - 与既有亮色版正交组合：移除 .dark 类即回到亮色版
//
// 产物：
//   tokens.css 末尾追加 6 个 `.theme-X.dark { ... }` 块；角色集与既有亮色版同构。
//   state-layer 用 on-surface 12%/38% alpha（暗色 M3 派生标准），与亮色版 12% primary 区分。
//
// 零运行时算色：产物为静态 CSS，Lynx bundle 不引入 material-color-utilities
// （ADR-0152 决策延续：避免 Lynx bundle 增大 + 动态 CSS 变量写入支持面窄）。
//
// 用法：node scripts/generate-theme-palettes.mjs [--dry] [--stdout]
//   --dry     仅打印生成内容，不改写 tokens.css
//   --stdout  打印到 stdout（供 CI/测试调用）
//
// 重新生成后必须重跑 pnpm test:app-lynx（unit.test.ts §暗色色板契约）确认完整覆盖。

import { SchemeTonalSpot, MaterialDynamicColors, Hct, hexFromArgb, argbFromHex } from '@material/material-color-utilities'
import { readFileSync, writeFileSync } from 'node:fs'

/** 6 主题 seed（与既有 .theme-X 亮色版的 primary 值一一对应；派生自 ADR-0152
 * themeColor.ts 的 THEME_COLOR_OPTIONS 锁定值）。这里硬编码一份以保证脚本
 * 独立可跑；单元测试会从 tokens.css 与 themeColor.ts 双向校验一致性。 */
const THEMES = [
  { id: 'sky', seed: '#1a6fa8' },
  { id: 'violet', seed: '#65558f' },
  { id: 'pink', seed: '#8b4a61' },
  { id: 'green', seed: '#3c6939' },
  { id: 'orange', seed: '#855317' },
  { id: 'teal', seed: '#00696d' },
]

/** M3 角色清单（与既有亮色 page 色板同构；排除 error/scrim/shape/elevation）。
 * 顺序与 tokens.css 既有 page 块保持一致，方便阅读与 diff。 */
const ROLES = [
  '--md-primary',
  '--md-on-primary',
  '--md-primary-container',
  '--md-on-primary-container',
  '--md-secondary',
  '--md-on-secondary',
  '--md-secondary-container',
  '--md-on-secondary-container',
  '--md-tertiary',
  '--md-on-tertiary',
  '--md-tertiary-container',
  '--md-on-tertiary-container',
  '--md-surface',
  '--md-on-surface',
  '--md-surface-variant',
  '--md-on-surface-variant',
  '--md-outline',
  '--md-outline-variant',
  '--md-surface-container-lowest',
  '--md-surface-container-low',
  '--md-surface-container',
  '--md-surface-container-high',
  '--md-surface-container-highest',
  '--md-inverse-surface',
  '--md-inverse-on-surface',
  '--md-inverse-primary',
  '--md-surface-dim',
  '--md-surface-bright',
  '--md-primary-fixed',
  '--md-on-primary-fixed',
  '--md-primary-fixed-dim',
  '--md-on-primary-fixed-variant',
  '--md-secondary-fixed',
  '--md-on-secondary-fixed',
  '--md-secondary-fixed-dim',
  '--md-on-secondary-fixed-variant',
  '--md-tertiary-fixed',
  '--md-on-tertiary-fixed',
  '--md-tertiary-fixed-dim',
  '--md-on-tertiary-fixed-variant',
  '--md-surface-tint',
  '--md-state-pressed-primary',
  '--md-state-pressed-on-surface',
  '--md-state-pressed-surface',
  '--md-state-layer-pressed-primary',
  '--md-state-layer-pressed-on-surface',
  '--md-state-disabled-container',
  '--md-state-disabled-on-surface',
]

/** 从 DynamicScheme 读角色 → hex 字符串（on*Container 强制走 tone 10 = 与基础 page 同模式） */
function readScheme(scheme) {
  const md = new MaterialDynamicColors()
  const get = (dynColor) => hexFromArgb(dynColor.getArgb(scheme))
  const onPrimaryContainer = hexFromArgb(md.onPrimaryContainer().getArgb(scheme))
  const onSecondaryContainer = hexFromArgb(md.onSecondaryContainer().getArgb(scheme))
  const onTertiaryContainer = hexFromArgb(md.onTertiaryContainer().getArgb(scheme))
  return {
    '--md-primary': get(md.primary()),
    '--md-on-primary': get(md.onPrimary()),
    '--md-primary-container': get(md.primaryContainer()),
    '--md-on-primary-container': onPrimaryContainer,
    '--md-secondary': get(md.secondary()),
    '--md-on-secondary': get(md.onSecondary()),
    '--md-secondary-container': get(md.secondaryContainer()),
    '--md-on-secondary-container': onSecondaryContainer,
    '--md-tertiary': get(md.tertiary()),
    '--md-on-tertiary': get(md.onTertiary()),
    '--md-tertiary-container': get(md.tertiaryContainer()),
    '--md-on-tertiary-container': onTertiaryContainer,
    '--md-surface': get(md.surface()),
    '--md-on-surface': get(md.onSurface()),
    '--md-surface-variant': get(md.surfaceVariant()),
    '--md-on-surface-variant': get(md.onSurfaceVariant()),
    '--md-outline': get(md.outline()),
    '--md-outline-variant': get(md.outlineVariant()),
    '--md-surface-container-lowest': get(md.surfaceContainerLowest()),
    '--md-surface-container-low': get(md.surfaceContainerLow()),
    '--md-surface-container': get(md.surfaceContainer()),
    '--md-surface-container-high': get(md.surfaceContainerHigh()),
    '--md-surface-container-highest': get(md.surfaceContainerHighest()),
    '--md-inverse-surface': get(md.inverseSurface()),
    '--md-inverse-on-surface': get(md.inverseOnSurface()),
    '--md-inverse-primary': get(md.inversePrimary()),
    '--md-surface-dim': get(md.surfaceDim()),
    '--md-surface-bright': get(md.surfaceBright()),
    '--md-primary-fixed': get(md.primaryFixed()),
    '--md-on-primary-fixed': get(md.onPrimaryFixed()),
    '--md-primary-fixed-dim': get(md.primaryFixedDim()),
    '--md-on-primary-fixed-variant': get(md.onPrimaryFixedVariant()),
    '--md-secondary-fixed': get(md.secondaryFixed()),
    '--md-on-secondary-fixed': get(md.onSecondaryFixed()),
    '--md-secondary-fixed-dim': get(md.secondaryFixedDim()),
    '--md-on-secondary-fixed-variant': get(md.onSecondaryFixedVariant()),
    '--md-tertiary-fixed': get(md.tertiaryFixed()),
    '--md-on-tertiary-fixed': get(md.onTertiaryFixed()),
    '--md-tertiary-fixed-dim': get(md.tertiaryFixedDim()),
    '--md-on-tertiary-fixed-variant': get(md.onTertiaryFixedVariant()),
    '--md-surface-tint': get(md.surfaceTint()),
    // state-layer 色：暗色版走 M3 标准的 on-surface 12%/38% alpha
    '--md-state-pressed-primary': get(md.primary()),
    '--md-state-pressed-on-surface': get(md.onSurface()),
    '--md-state-pressed-surface': get(md.surfaceContainerHigh()),
    '--md-state-layer-pressed-primary': `rgba(${hexToRgb(get(md.primary())).join(', ')}, 0.12)`,
    '--md-state-layer-pressed-on-surface': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.12)`,
    '--md-state-disabled-container': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.12)`,
    '--md-state-disabled-on-surface': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.38)`,
  }
}

/** #rrggbb → [r,g,b] */
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** 把角色对象格式化为 CSS 声明行（保证稳定顺序便于 diff） */
function formatRoleBlock(roleMap, indent = '  ') {
  return ROLES.map((name) => `${indent}${name}: ${roleMap[name]};`).join('\n')
}

/** 生成单个暗色色板的 CSS 块（复合选择器 .theme-X.dark） */
function generateBlock(themeId, seedHex) {
  const seedArgb = argbFromHex(seedHex)
  // isDark = true：M3 SchemeTonalSpot 派生暗色 scheme
  const scheme = new SchemeTonalSpot(Hct.fromInt(seedArgb), true, 0.0)
  const roleMap = readScheme(scheme)
  const classSelector = `.theme-${themeId}.dark`
  return `/* ─── ${themeId} 主题暗色板（spec lynx-night-mode T2，从 seed ${seedHex} 经 M3 SchemeTonalSpot 派生 isDark=true） ─── */
${classSelector} {
${formatRoleBlock(roleMap)}
}
`
}

/** 生成 header 注释 */
function generateHeader() {
  return `/* ════════════════════════════════════════════════════════════════════════════
 * 自动生成段（spec docs/specs/lynx-night-mode.md T2 §4.7）：勿手改
 * 由 scripts/generate-theme-palettes.mjs 产出，覆盖 6 主题暗色版（复合选择器 .theme-X.dark）。
 * 单一事实源 = src/utils/themeColor.ts（THEME_COLOR_OPTIONS 派生 className）。
 * 亮色版沿用既有手调色板（ADR-0152 / commit f239b065）——保持视觉零回归。
 * 重新生成：node scripts/generate-theme-palettes.mjs。
 * ════════════════════════════════════════════════════════════════════════════ */
`
}

/** 生成 6 套暗色色板 */
function generateAll() {
  let out = generateHeader()
  for (const theme of THEMES) {
    out += generateBlock(theme.id, theme.seed) + '\n'
  }
  return out
}

/** 把生成段追加到 tokens.css（替换既有的 "/* ═══ 自动生成段" 标记） */
function injectIntoTokens(tokensPath, generated) {
  const src = readFileSync(tokensPath, 'utf-8')
  const marker = '/* ════════════════════════════════════════════════════════════════════════════\n * 自动生成段'
  const endMarker = '/* END auto-generated */'
  const startIdx = src.indexOf(marker)
  if (startIdx === -1) {
    // 首次注入：追加到文件末尾
    const trailer = generated.trimEnd() + '\n' + endMarker + '\n'
    writeFileSync(tokensPath, src.replace(/\s+$/, '') + '\n\n' + trailer)
    return
  }
  // 已存在：替换
  const endIdx = src.indexOf(endMarker, startIdx)
  const safeEnd = endIdx === -1 ? src.length : endIdx
  const before = src.slice(0, startIdx)
  const after = endIdx === -1 ? '' : src.slice(endIdx + endMarker.length)
  const trailer = generated.trimEnd() + '\n' + endMarker
  writeFileSync(tokensPath, before + trailer + after)
}

// CLI
const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const toStdout = args.includes('--stdout')

if (toStdout) {
  process.stdout.write(generateAll())
  process.exit(0)
}

if (dryRun) {
  console.log(generateAll())
  process.exit(0)
}

const tokensPath = new URL('../src/styles/tokens.css', import.meta.url).pathname
injectIntoTokens(tokensPath, generateAll())
console.log(`[generate-theme-palettes] OK: ${tokensPath}`)
