#!/usr/bin/env node
// ─── app-lynx 暗色主题色板生成脚本（spec docs/specs/lynx-night-mode.md T2 §4.7）───
//
// 用途：从 7 个亮色 primary 锚点（`THEMES[].lightPrimaryAnchor`，同时充当暗色方案的 M3 seed
// 输入）经 M3 SchemeTonalSpot 生成 7 套暗色色板（追加到 tokens.css）。
// 亮色版沿用既有手调色板（ADR-0152 / commit f239b065）——保持视觉零回归。
//
// 术语（review round-2 M3 澄清，防「seed」一词两义固化）：
//   - 清单字段 = `lightPrimaryAnchor` = **亮色 --md-primary 值**（双职责：既是亮色主色值，
//     又是暗色方案 SchemeTonalSpot 的 seed 输入）——暗色块注释里写的「从 seed #xxx 派生」
//     指的就是这个锚点作为 M3 seed 输入，两者不矛盾。
//   - 与 docs/specs/app-lynx-theme-color.md 早期「列出的 hex 是 **seed 输入**，生成后的
//     --md-primary 是派生的 tone-40 色（如 violet seed #6750a4 → --md-primary #65558f）」
//     属**历史口径差异**：那批 hex（#6750a4 等）是当年生成亮色板时的输入，与产物不等；
//     本脚本维护的锚点则是**产物侧亮色 primary 值**（#65558f），两套口径不是同一批数。
//
// 决策（spec §4.7 范围内二选一）：暗色版走 `.theme-X.dark` 复合选择器：
//   - 锚点清单在本脚本内维护（见 THEMES）：themeColor.ts 只持有 id → className，不持有锚点
//     值，因此它**不是**锚点的单一事实源（旧注释曾如此声称，与事实不符已更正）
//   - 防漂移：tests/palettes-drift.test.ts 双向锁死 —— (a) tokens.css 自动生成段 ≡ 本脚本
//     `--stdout` 输出；(b) 脚本内 7 个 lightPrimaryAnchor ≡ tokens.css 7 个亮色 .theme-X 的 --md-primary
//   - 根 <page> 同时挂 .theme-X + .dark 两个类 → 复合选择器特异性更高，覆盖亮色版的同名变量
//   - 与既有亮色版正交组合：移除 .dark 类即回到亮色版
//
// 产物：
//   tokens.css 末尾追加 7 个 `.theme-X.dark { ... }` 块；角色集与既有亮色版同构。
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

/** 7 主题 lightPrimaryAnchor 清单（= 既有 .theme-X 亮色版的 --md-primary 值；取自 ADR-0152
 * 锁定的主题色值）。双职责：亮色主色值 + 暗色方案 M3 SchemeTonalSpot 的 seed 输入。
 * 锚点清单由本脚本维护（themeColor.ts 不持有锚点）；与 tokens.css 亮色 --md-primary 的
 * 逐一对等一致性由 tests/palettes-drift.test.ts 断言（正则双向抽取，非人工同步）。
 * 术语口径见文件头「术语」（与 docs/specs/app-lynx-theme-color.md 早期 seed 描述为历史差异）。 */
const THEMES = [
  { id: 'sky', lightPrimaryAnchor: '#1a6fa8' },
  { id: 'violet', lightPrimaryAnchor: '#65558f' },
  { id: 'pink', lightPrimaryAnchor: '#8b4a61' },
  { id: 'green', lightPrimaryAnchor: '#3c6939' },
  { id: 'orange', lightPrimaryAnchor: '#855317' },
  { id: 'teal', lightPrimaryAnchor: '#00696d' },
  { id: 'bili', lightPrimaryAnchor: '#d03171' },
]

/** M3 角色清单（与既有亮色 page 色板同构）。
 * 顺序与 tokens.css 既有 page 块保持一致，方便阅读与 diff。
 *
 * T4 扩展（spec docs/specs/lynx-night-mode-audit.md §4.1）：
 * - 加入 error / error-container / on-error / on-error-container / state-pressed-error
 *   （独立 errorPalette 派生，与品牌锚点解耦）
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
  '--md-statusbar-scrim',
  '--md-shape-extra-small',
  '--md-shape-small',
  '--md-shape-medium',
  '--md-shape-large',
  '--md-shape-extra-large',
  '--md-shape-full',
  '--md-elevation-0',
  '--md-elevation-1',
  '--md-elevation-2',
  '--md-elevation-3',
  '--md-elevation-4',
  '--md-elevation-5',
  '--md-state-pressed-primary',
  '--md-state-pressed-on-surface',
  '--md-state-pressed-surface',
  '--md-state-pressed-error',
  // 状态层四态 alpha 叠加层（ADR-0207 决策 4）：官方 v0.192 _md-sys-state.scss 的
  // hover .08 / focus .12 / pressed .12 / dragged .16，每态 × 四语义色。
  // 「每个色板块自含同一套角色」是 tokens.css 的既有不变量
  // （tests/unit.test.ts「每个主题色板类都覆盖同一套可主题角色」），故本段进 ROLES。
  '--md-state-layer-hover-primary',
  '--md-state-layer-hover-on-surface',
  '--md-state-layer-hover-error',
  '--md-state-layer-hover-surface',
  '--md-state-layer-hover-on-primary',
  '--md-state-layer-focus-primary',
  '--md-state-layer-focus-on-surface',
  '--md-state-layer-focus-error',
  '--md-state-layer-focus-surface',
  '--md-state-layer-focus-on-primary',
  '--md-state-layer-pressed-primary',
  '--md-state-layer-pressed-on-surface',
  '--md-state-layer-pressed-error',
  '--md-state-layer-pressed-surface',
  '--md-state-layer-pressed-on-primary',
  '--md-state-layer-dragged-primary',
  '--md-state-layer-dragged-on-surface',
  '--md-state-layer-dragged-error',
  '--md-state-layer-dragged-surface',
  '--md-state-layer-dragged-on-primary',
  '--md-state-disabled-container',
  '--md-state-disabled-on-surface',
  '--md-scroll-indicator',
]

/** 状态层四态 opacity（官方 v0.192 _md-sys-state.scss，唯一事实源；勿按记忆改） */
const STATE_LAYER_OPACITIES = {
  hover: 0.08,
  focus: 0.12,
  pressed: 0.12,
  dragged: 0.16,
}

/** 与模式无关的常量值（shape 6 档 / elevation 6 档 / scrim / scrim-overlay）——
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
  '--md-elevation-0': 'none',
  '--md-elevation-1': '0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px 1px rgba(0, 0, 0, 0.15)',
  '--md-elevation-2': '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 6px 2px rgba(0, 0, 0, 0.15)',
  '--md-elevation-3': '0 4px 8px 3px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.3)',
  // level 4/5 = **外推、非官方全表**（与 tokens.css 基础块同规则同值，见那里的可复算说明）
  '--md-elevation-4': '0 6px 10px 4px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.3)',
  '--md-elevation-5': '0 8px 12px 5px rgba(0, 0, 0, 0.15), 0 3px 5px rgba(0, 0, 0, 0.3)',
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
    // 出血页状态栏兜底遮罩（#906 / ADR-0214）：首页封面出血到状态栏下后，系统状态栏图标的
    // 底色变成**不可预测的封面像素**，而原生 isAppearanceLightStatusBarsFor(isDarkMode) 把图标
    // 深浅**绑死在 app 主题上**（它无法跟随内容）⇒ 图标颜色对、底色不可控。实测最坏 1.09:1。
    //
    // ⚠️ 刻意把**本色板的 surface 烘焙成字面量**，而不是写 var(--md-surface)：
    //   变量出现在 linear-gradient() 的实参内（B 型写法）在本仓 Lynx **未取证** —— 若引擎在
    //   定义点求值而非使用点，14 个色板会一起取到基础块的浅 surface，且全部门禁仍绿。
    //   烘焙后本 token 内**不含任何 var()**，该平台假设不复存在。
    //   与 --md-scroll-indicator / --md-scrim-overlay 同款（那两者都是扁平 rgba、无嵌套 var）——
    //   这也正是选择烘焙而非嵌套的直接理由。
    // 实测（emulator-5554 / 亮色 sky）：无遮罩时最坏 **1.09:1**（近乎不可见）。
    // 加遮罩后**已留样**的区间是 **5.83:1 … 16.67:1** —— 遮罩在带底约 55% 不透明，
    // 封面像素仍会透上来 ⇒ 带内最坏对比度**随图而变**，没有单一固定值。
    // （此前这里写的 12.03:1 是某一张封面的值，code-review 第 7 轮查出它无样本支撑。）
    // 暗色主题已实测 **13.05:1**（#906 风险⑤ 关闭）。
    // 复现：`node scripts/verify-statusbar-contrast.mjs --page recommended`
    '--md-statusbar-scrim': `linear-gradient(to bottom, ${get(md.surface())} 0%, rgba(0, 0, 0, 0) 100%)`,
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
    // ⚠️ 这里**不能**再单独写 pressed-primary / pressed-on-surface：紧随其后的
    // `...Object.fromEntries(STATE_LAYER_OPACITIES…)` 会用同一对键覆盖它们，
    // 留下的是**死条目** —— 改上面的 STATE_LAYER_OPACITIES 时它们悄悄不动。
    // 状态层四态 alpha 叠加层（ADR-0207 决策 4）：opacity 取自 material-web v0.192
    // `_md-sys-state.scss` = hover .08 / focus .12 / pressed .12 / dragged .16
    // （focus 是 .12 不是 .10，见差距分析 §8.4）。
    // `*-surface` 档用 var() 别名指回 `*-primary`：与亮色基础块同口径（覆盖在 surface
    // 容器上的强调层，色相取 primary），用别名而非重复字面量可让两套色板永远同源。
    // `*-on-primary` 档（#866/#867）取 onPrimary 作色：MD3 语义上「实心 primary 容器上的
    // 状态层用 on-primary」，亮色 7 套的 on-primary 全是 #ffffff，暗色 7 套则由 M3
    // SchemeTonalSpot 逐套派生（**各不相同**）—— 故此段必须由本脚本生成，
    // 手改 tokens.css 会被 tests/palettes-drift.test.ts 的双向锁定判红。
    //
    // ⚠️ #867：on-primary 档**唯一**改为「预合成不透明色」。Tailwind `bg-*` 直接替换
    // `background-color`（不与容器色合成），而 Lynx 不渲染 `color-mix`（真机实测：B 块
    // 按下后 = 容器白，声明彻底失效），所以 alpha 状态层在实心 primary 按钮上按压会让
    // **填色整个消失**（真机 RGB (26,111,168)→(249,251,255) ≈ 页面色）。改为把 onPrimary 按 opacity 直接混进
    // primary，得到与 MD3 叠加等价的不透明色。其余 4 个 role 画在 surface 底上、
    // ΔE 最大仅 16.81（阈值 25），保持 alpha。范围判定见
    // scripts/state-layer-collapse-audit.mjs（阈值由真机两个锚点夹逼，数据空档 46）。
    ...Object.fromEntries(
      Object.entries(STATE_LAYER_OPACITIES).flatMap(([state, opacity]) => [
        [`--md-state-layer-${state}-primary`, `rgba(${hexToRgb(get(md.primary())).join(', ')}, ${opacity})`],
        [`--md-state-layer-${state}-on-surface`, `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, ${opacity})`],
        [`--md-state-layer-${state}-error`, `rgba(${hexToRgb(get(md.error())).join(', ')}, ${opacity})`],
        [`--md-state-layer-${state}-surface`, `var(--md-state-layer-${state}-primary)`],
        [
          `--md-state-layer-${state}-on-primary`,
          mixHex(get(md.primary()), get(md.onPrimary()), opacity),
        ],
      ]),
    ),
    '--md-state-disabled-container': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.12)`,
    '--md-state-disabled-on-surface': `rgba(${hexToRgb(get(md.onSurface())).join(', ')}, 0.38)`,
    // scroll-indicator：暗色按**各主题** outline（M3 暗色 scheme = tone 60）+ 35% alpha 派生，
    // 与 scrollbar thumb 口径一致。亮色 7 主题共用基础 page 块的 M3 基线 neutral 值
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

/** 生成单个暗色色板的 CSS 块（复合选择器 .theme-X.dark）。
 *  注意：下方模板串会**逐字节落到 tokens.css**（tests/palettes-drift.test.ts (a) 比对），
 *  改一个字符都必须重跑本脚本；模板里的「从 seed …」= 锚点作为暗色方案 M3 seed 输入（见文件头「术语」）。 */
function generateBlock(themeId, anchorHex) {
  const seedArgb = argbFromHex(anchorHex)
  // isDark = true：M3 SchemeTonalSpot 派生暗色 scheme
  const scheme = new SchemeTonalSpot(Hct.fromInt(seedArgb), true, 0.0)
  const roleMap = readScheme(scheme)
  const classSelector = `.theme-${themeId}.dark`
  return `/* ─── ${themeId} 主题暗色板（spec lynx-night-mode T2，从 seed ${anchorHex} 经 M3 SchemeTonalSpot 派生 isDark=true） ─── */
${classSelector} {
${formatRoleBlock(roleMap)}
}
`
}

/** 生成 header 注释 */
function generateHeader() {
  return `/* ════════════════════════════════════════════════════════════════════════════
 * 自动生成段（spec docs/specs/lynx-night-mode.md T2 §4.7）：勿手改
 * 由 scripts/generate-theme-palettes.mjs 产出，覆盖 7 主题暗色版（复合选择器 .theme-X.dark）。
 * 亮色 primary 锚点清单在脚本内维护（THEMES[].lightPrimaryAnchor）；产物与亮色 --md-primary 由 tests/palettes-drift.test.ts 双向锁死。
 * 亮色版沿用既有手调色板（ADR-0152 / commit f239b065）——保持视觉零回归。
 * 重新生成：node scripts/generate-theme-palettes.mjs。
 * ════════════════════════════════════════════════════════════════════════════ */
`
}

/** 生成 7 套暗色色板 */
function generateAll() {
  let out = generateHeader()
  for (const theme of THEMES) {
    out += generateBlock(theme.id, theme.lightPrimaryAnchor) + '\n'
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
