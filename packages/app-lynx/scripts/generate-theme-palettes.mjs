#!/usr/bin/env node
// ─── app-lynx 暗色主题色板生成脚本（spec docs/specs/lynx-night-mode.md T2 §4.7）───
//
// 用途：从 6 个 seed 色经 M3 SchemeTonalSpot 生成 6 套暗色色板（追加到 tokens.css）。
// 亮色版沿用既有手调色板（ADR-0152 / commit f239b065）——保持视觉零回归。
//
// 决策（spec §4.7 范围内二选一）：暗色版走 `.theme-X.dark` 复合选择器：
//   - seed 清单在本脚本内维护（见 THEMES）：themeColor.ts 只持有 id → className，不持有 seed
//     值，因此它**不是** seed 的单一事实源（旧注释曾如此声称，与事实不符已更正）
//   - 防漂移：tests/palettes-drift.test.ts 双向锁死 —— (a) tokens.css 自动生成段 ≡ 本脚本
//     `--stdout` 输出；(b) 脚本内 6 个 seed ≡ tokens.css 6 个亮色 .theme-X 的 --md-primary
//   - 根 <page> 同时挂 .theme-X + .dark 两个类 → 复合选择器特异性更高，覆盖亮色版的同名变量
//   - 与既有亮色版正交组合：移除 .dark 类即回到亮色版
//
// 产物：
//   tokens.css 末尾追加 6 个 `.theme-X.dark { ... }` 块；角色集与既有亮色版同构。
//   state-layer 用 on-surface 12%/38% alpha（暗色 M3 派生标准）；pressed 实色与亮色方向对偶
//   （亮色 = primary + 12% 黑 → 变暗；暗色 = primary + 12% 白 → 变亮）。
//
// 零运行时算色：产物为静态 CSS，Lynx bundle 不引入 material-color-utilities
// （ADR-0152 决策延续：避免 Lynx bundle 增大 + 动态 CSS 变量写入支持面窄）。
//
// 用法：node scripts/generate-theme-palettes.mjs [--dry] [--stdout]
//   --dry     仅打印生成内容，不改写 tokens.css
//   --stdout  打印到 stdout（不改文件）——调用方：tests/palettes-drift.test.ts（产物 ≡ 脚本比对）
//
// 重新生成后必须重跑 pnpm test:app-lynx（unit.test.ts §主题色契约 + palettes-drift.test.ts）。

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 修补 @material/material-color-utilities 0.4.0 在 Node 22+ 的 ESM 解析缺陷：
 * 内部若干 .js 文件 import 时漏写 .js 后缀（TypeScript 源风格），新版 Node 严格 ESM
 * 会报 ERR_MODULE_NOT_FOUND。此补丁遍历包内所有 .js，给所有相对 import 补上 .js 后缀。
 * 仅作用于 devDependencies 中的生成工具，运行时 Lynx bundle 不引用此包。
 *
 * 注意：pnpm 重装会清掉此补丁，因此脚本每次运行都自检 + 自愈一次。
 * 必须在动态 import 之前完成（ESM 顶层 import 会先解析，故此处必须用动态 import 加载目标包）。
 */
function patchMaterialColorUtilities() {
  let entryPath
  try {
    // 用 index.js 解析（package.json 受 exports 限制无法被 import.meta.resolve 解析）
    const pkgMainUrl = import.meta.resolve('@material/material-color-utilities')
    entryPath = dirname(fileURLToPath(pkgMainUrl))
  } catch (e) {
    // 禁静默降级：定位失败会让下方动态 import 直接抛错（错误信息远离根因），必须留痕
    console.warn(
      '[generate-theme-palettes] 无法定位 @material/material-color-utilities，跳过 ESM 后缀补丁：',
      e,
    )
    return
  }
  function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      const stat = statSync(p)
      if (stat.isDirectory()) walk(p)
      else if (f.endsWith('.js')) patch(p)
    }
  }
  function patch(file) {
    let src = readFileSync(file, 'utf-8')
    const before = src
    src = src.replace(/from '(\.\.?\/[^']+?)';/g, (m, p1) => {
      if (p1.endsWith('.js') || p1.endsWith('.json') || p1.startsWith('node:')) return m
      return `from '${p1}.js';`
    })
    if (src !== before) writeFileSync(file, src)
  }
  walk(entryPath)
}

patchMaterialColorUtilities()

// 动态 import 必须在 patch 之后（ESM 顶层 import 会先解析，故放动态 import）
const { SchemeTonalSpot, MaterialDynamicColors, Hct, hexFromArgb, argbFromHex } = await import(
  '@material/material-color-utilities'
)

/** 6 主题 seed（与既有 .theme-X 亮色版的 primary 值一一对应；取自 ADR-0152 锁定的主题色值）。
 * seed 清单由本脚本维护（themeColor.ts 不持有 seed）；与 tokens.css 亮色 --md-primary 的
 * 逐一对等一致性由 tests/palettes-drift.test.ts 断言（正则双向抽取，非人工同步）。 */
const THEMES = [
  { id: 'sky', seed: '#1a6fa8' },
  { id: 'violet', seed: '#65558f' },
  { id: 'pink', seed: '#8b4a61' },
  { id: 'green', seed: '#3c6939' },
  { id: 'orange', seed: '#855317' },
  { id: 'teal', seed: '#00696d' },
]

/** M3 角色清单（与既有亮色 page 色板同构）。
 * 顺序与 tokens.css 既有 page 块保持一致，方便阅读与 diff。
 *
 * T4 扩展（spec docs/specs/lynx-night-mode-audit.md §4.1）：
 * - 加入 error / error-container / on-error / on-error-container / state-pressed-error
 *   （独立 errorPalette 派生，与 brand seed 解耦）
 * - 加入 scrim / scrim-overlay（明暗同值但暗色块显式声明防回落到 light 单一来源）
 * - 加入 shape-* / elevation-* / scroll-indicator（同上：与亮色同值但显式声明）
 */
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
  '--md-error',
  '--md-on-error',
  '--md-error-container',
  '--md-on-error-container',
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
  '--md-scrim',
  '--md-scrim-overlay',
  '--md-shape-extra-small',
  '--md-shape-small',
  '--md-shape-medium',
  '--md-shape-large',
  '--md-shape-extra-large',
  '--md-shape-full',
  '--md-elevation-1',
  '--md-elevation-2',
  '--md-elevation-3',
  '--md-state-pressed-primary',
  '--md-state-pressed-on-surface',
  '--md-state-pressed-surface',
  '--md-state-pressed-error',
  '--md-state-layer-pressed-primary',
  '--md-state-layer-pressed-on-surface',
  '--md-state-disabled-container',
  '--md-state-disabled-on-surface',
  '--md-scroll-indicator',
]

/** 与模式无关的常量值（shape 6 档 / elevation 3 档 / scrim / scrim-overlay）——
 * 暗色色板与亮色同值，但显式声明以防 token 隐式重构时漏改（M3 shape 不分模式；
 * elevation 用纯黑 rgba 阴影；scrim 为通用遮罩语义）。 */
const MODE_INDEPENDENT_VALUES = {
  '--md-scrim': 'rgba(0, 0, 0, 0.5)',
  '--md-scrim-overlay': 'linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0.2) 45%, rgba(0, 0, 0, 0))',
  '--md-shape-extra-small': '1.067vw',
  '--md-shape-small': '2.133vw',
  '--md-shape-medium': '3.2vw',
  '--md-shape-large': '4.267vw',
  '--md-shape-extra-large': '7.467vw',
  '--md-shape-full': '9999px',
  '--md-elevation-1': '0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px 1px rgba(0, 0, 0, 0.15)',
  '--md-elevation-2': '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 6px 2px rgba(0, 0, 0, 0.15)',
  '--md-elevation-3': '0 4px 8px 3px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.3)',
}

/** 从 DynamicScheme 读角色 → hex 字符串（on*Container 强制走 tone 10 = 与基础 page 同模式）
 *
 * T4 扩展：
 * - 加入 error / error-container / on-error / on-error-container / state-pressed-error
 *   （errorPalette 独立派生；state-pressed-error 走 on-error container）
 * - 加入 scroll-indicator（outline + 35% alpha，与 scrollbar thumb 一致） */
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
    '--md-error': get(md.error()),
    '--md-on-error': get(md.onError()),
    '--md-error-container': get(md.errorContainer()),
    '--md-on-error-container': get(md.onErrorContainer()),
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
    // state-layer 色：暗色版走 M3 标准的 on-surface 12%/38% alpha。
    // pressed 实色与亮色版**方向对偶**：亮色 = primary + 12% 黑（更暗），暗色 = primary + 12% 白
    // （更亮）。这里若直接取 primary，主按钮暗色按下会与常态逐字相等（零视觉反馈），
    // 由 tests/unit/utils/appearanceClasses.test.ts + tests/palettes-drift.test.ts 双向钉住。
    '--md-state-pressed-primary': mixHex(get(md.primary()), '#FFFFFF', 0.12),
    '--md-state-pressed-on-surface': get(md.onSurface()),
    '--md-state-pressed-surface': get(md.surfaceContainerHigh()),
    '--md-state-pressed-error': get(md.onErrorContainer()),
    '--md-state-layer-pressed-primary': `rgba(${hexToRgb(get(md.primary())).join(', ')}, 0.12)`,
    '--md-state-layer-pressed-on-surface': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.12)`,
    '--md-state-disabled-container': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.12)`,
    '--md-state-disabled-on-surface': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.38)`,
    // scroll-indicator：暗色按**各主题** outline（M3 暗色 scheme = tone 60）+ 35% alpha 派生，
    // 与 scrollbar thumb 口径一致。亮色 6 主题共用基础 page 块的 M3 基线 neutral 值
    // （≈ onSurfaceVariant，有意设计：中性滚动条不随主题染色）——见 tokens.css 基础块注释。
    '--md-scroll-indicator': `rgba(${hexToRgb(get(md.outline())).join(', ')}, 0.35)`,
    // 与模式无关的常量（shape / elevation / scrim）
    ...MODE_INDEPENDENT_VALUES,
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

/** [r,g,b] → #rrggbb（小写两位补零） */
function rgbToHex(rgb) {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** base 与 overlay 按 weight（overlay 占比）线性混合 → #rrggbb。
 * 与亮色手调口径同源：weight=0.12 + overlay=#000000 即 round(base × 0.88)（逐通道取整）。 */
function mixHex(baseHex, overlayHex, weight) {
  const base = hexToRgb(baseHex)
  const overlay = hexToRgb(overlayHex)
  return rgbToHex(base.map((v, i) => Math.round(v * (1 - weight) + overlay[i] * weight)))
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
 * seed 清单在脚本内维护（THEMES）；产物与亮色 --md-primary 由 tests/palettes-drift.test.ts 双向锁死。
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
