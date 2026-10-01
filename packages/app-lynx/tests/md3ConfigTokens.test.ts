// ─── MD3 配置 / 令牌层取值契约（issues #853~#857 = T05~T09）───
//
// 覆盖范围**只有两个文件**：`tailwind.config.ts` + `src/styles/tokens.css`。
// `.vue` 消费层的清理（方向类圆角、越界缓动、font-bold、自选 leading-*）与真机截图回归
// 不在本门禁内 —— 那些是可变文本的批量改写，由 .vue 层另开票，且它们的判据是「文本形态」
// 而不是「取值是否等于官方令牌」。本文件只回答一个问题：
//   **构建配置与令牌表里的每一个 MD3 数值，是不是官方令牌值？**
//
// Oracle 纪律（本仓硬约束「禁自证」）：期望值一律来自**独立来源**，不抄当前产物。
//   - 形状 6 档 dp      → material-web v0.192 `_md-sys-shape.scss`（4/8/12/16/28/9999）
//   - 排版 15 档四元组  → ADR-0206 决策 1 的官方表（sp/line-height/tracking/weight）
//   - 缓动 4 条曲线     → material-web v0.192 `_md-sys-motion.scss`
//   - 状态层四态 opacity→ material-web v0.192 `_md-sys-state.scss`
//   - elevation 0–5     → 官方 0–5 完整配方表**未能从一手来源取到**，故只门禁「六档齐备 +
//                         0 = none + 4/5 带『外推』标记」，**不**门禁 4/5 的具体数值
//                         （ADR-0207 决策 7；门禁不得依赖一张取不到的表）
// 换算关系写死在测试里（不读项目配置推导）：rpx = sp × 2、vw = dp / 375 × 100。
//
// 「只判存在会放过值错」是这类门禁最常见的假绿，所以每条断言都核对**取值**；
// 每组全称断言都带**抽取器自身的数量下界**（正则塌陷 ⇒ 集合为空 ⇒ 断言恒绿）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { contrastRatio } from './helpers/md3Contrast'
import {
  buildTailwindArtifact,
  declarationsForClass,
  projectTailwindConfig,
  tryDeclarationsForClass,
  type DeclarationBlock,
  type TailwindArtifact,
} from './helpers/md3TailwindArtifact'

const CONFIG_SRC = readFileSync(
  fileURLToPath(new URL('../tailwind.config.ts', import.meta.url)),
  'utf8',
)
/** 去掉 TS 的行注释与块注释后再查「legacy 曲线是否被当作取值使用」：
 *  注释里的**说明文字**不该被判红（配置注释必须能把越界曲线写清楚，否则无法留痕）。 */
const CONFIG_SRC_NO_COMMENTS = CONFIG_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)),
  'utf8',
)

// ═══════════════════════ Oracle：官方令牌值（一手来源，非项目当前值） ═══════════════════════

/** 375 设计稿换算：rpx = sp × 2（glossary-lynx-units.md，与 ADR-0206 决策 1 同一换算） */
const sp2rpx = (sp: number): string => `${sp * 2}rpx`

/** ADR-0206 决策 1 官方表：15 档 × (size sp, line-height sp, tracking sp, weight)
 *  逐条抄自 ADR-0206（其数值源为 material-web v0.192 `_md-sys-typescale.scss`）。 */
const MD3_TYPE_SCALE: ReadonlyArray<
  readonly [tier: string, size: number, lineHeight: number, tracking: number, weight: 'regular' | 'medium']
> = [
  ['display-large', 57, 64, -0.25, 'regular'],
  ['display-medium', 45, 52, 0, 'regular'],
  ['display-small', 36, 44, 0, 'regular'],
  ['headline-large', 32, 40, 0, 'regular'],
  ['headline-medium', 28, 36, 0, 'regular'],
  ['headline-small', 24, 32, 0, 'regular'],
  ['title-large', 22, 28, 0, 'regular'],
  ['title-medium', 16, 24, 0.15, 'medium'],
  ['title-small', 14, 20, 0.1, 'medium'],
  ['body-large', 16, 24, 0.5, 'regular'],
  ['body-medium', 14, 20, 0.25, 'regular'],
  ['body-small', 12, 16, 0.4, 'regular'],
  ['label-large', 14, 20, 0.1, 'medium'],
  ['label-medium', 12, 16, 0.5, 'medium'],
  ['label-small', 11, 16, 0.5, 'medium'],
]

/** ADR-0206 决策 4：旧别名 → 映射到的 M3 档位（值取该档的完整四元组） */
const LEGACY_ALIAS_TARGET: ReadonlyArray<readonly [alias: string, tier: string]> = [
  ['xs', 'label-small'],
  ['sm', 'label-medium'],
  ['base', 'body-medium'],
  ['lg', 'title-small'],
  ['xl', 'label-large'],
  ['2xl', 'title-medium'],
  ['3xl', 'title-large'],
  ['4xl', 'headline-small'],
  ['5xl', 'headline-medium'],
  ['6xl', 'headline-medium'],
]

/** ADR-0207 决策 1：6 档 M3 shape。dp 是官方值；9999 表示 full（无 dp 语义，保持 px） */
const MD3_SHAPE_TIERS: ReadonlyArray<
  readonly [className: string, token: string, dp: number | null]
> = [
  ['rounded-xs', '--md-shape-extra-small', 4],
  ['rounded-sm', '--md-shape-small', 8],
  ['rounded', '--md-shape-medium', 12],
  ['rounded-lg', '--md-shape-large', 16],
  ['rounded-xl', '--md-shape-extra-large', 28],
  ['rounded-full', '--md-shape-full', 9999],
]

/** material-web v0.192 `_md-sys-shape.scss`：dp → 项目 vw（1dp = 1/375×100vw） */
const dp2vw = (dp: number): number => Math.round((dp / 375) * 100 * 1000) / 1000

/** material-web v0.192 `_md-sys-state.scss`：四态 opacity（focus 是 .12 不是 .10） */
const MD3_STATE_OPACITIES: ReadonlyArray<readonly [state: string, opacity: number]> = [
  ['hover', 0.08],
  ['focus', 0.12],
  ['pressed', 0.12],
  ['dragged', 0.16],
]

/** 状态层的 4 个语义色档（ADR-0207 决策 4） */
const STATE_ROLES = ['primary', 'on-surface', 'error', 'surface'] as const

/** material-web v0.192 `_md-sys-motion.scss`：4 条官方曲线。
 *  ⚠️ standard 与 emphasized **同值 (0.2,0,0,1) 是官方事实**（差距分析 §8.1 曾把它误判
 *    为 legacy 并「修正」过一次，方向是反的）。断言它是为了让那次误判无法复发。 */
const MD3_EASINGS: ReadonlyArray<readonly [token: string, value: string]> = [
  ['--motion-standard', 'cubic-bezier(0.2, 0, 0, 1)'],
  ['--motion-emphasized', 'cubic-bezier(0.2, 0, 0, 1)'],
  ['--motion-emphasized-decelerate', 'cubic-bezier(0.05, 0.7, 0.1, 1)'],
  ['--motion-emphasized-accelerate', 'cubic-bezier(0.3, 0, 0.8, 0.15)'],
]

/** MD2 遗留曲线（= easing-legacy）：**不得**出现在任何生效的缓动消费路径上 */
const MD2_LEGACY_EASING = '0.4, 0, 0.2'

// ═══════════════════════ tokens.css 解析（抽取器 + 自身有效性下界） ═══════════════════════

interface CssBlock {
  selector: string
  body: string
}

/** 取 tokens.css 里每个色板块（`page,` / `.theme-X` / `.theme-X.dark`）的 body 文本。
 *  基础块的 selector 在源码里是 `page,` 与 `.theme-sky {` **两行**，故 `page,` 单独起块。 */
function paletteBlocks(css: string): CssBlock[] {
  const lines = css.split('\n')
  type Mutable = { selector: string; body: string[]; opened: boolean }
  const blocks: Mutable[] = []
  let current: Mutable | null = null
  for (const line of lines) {
    if (!current) {
      // 基础块的选择器在源码里跨两行：`page,` 单独一行，下一行才是 `.theme-sky {`
      if (line === 'page,') {
        current = { selector: 'page,', body: [], opened: false }
        blocks.push(current)
        continue
      }
      if (/^\.theme-[a-z]+(?:\.dark)? \{\s*$/.test(line)) {
        current = { selector: line.replace(/\s*\{$/, ''), body: [], opened: true }
        blocks.push(current)
      }
      continue
    }
    // 基础块已由 `page,` 起头，此处只补上它的 `{`（不再新起一块，否则基础块会被顶掉）
    if (!current.opened) {
      if (line.includes('{')) current.opened = true
      continue
    }
    if (line === '}') current = null
    else current.body.push(line)
  }
  return blocks.map((b) => ({ selector: b.selector, body: b.body.join('\n') }))
}

/** 块内某自定义属性的**声明值**（含行尾注释）。取不到返回 undefined —— 绝不用 '' 冒充 */
function cssVarValue(block: string, name: string): string | undefined {
  const m = new RegExp(`^\\s*${name}:\\s*(.+?);?\\s*(?:/\\*.*)?$`, 'm').exec(block)
  return m?.[1]?.trim()
}

/** 块内全部 `--md-*` 声明名（用于「抽取器非空」下界与角色齐备性） */
function declaredTokens(block: string): string[] {
  return [...new Set([...block.matchAll(/^\s*(--md-[a-z0-9-]+):/gm)].map((m) => m[1]!))]
}

const PALETTES = paletteBlocks(TOKENS_CSS)
const BASE_PALETTE = PALETTES.find((b) => b.selector === 'page,')
const DARK_PALETTES = PALETTES.filter((b) => b.selector.endsWith('.dark'))
/** 亮色主题块 = 6 个（**不含 sky** —— sky 与基础 page 共用同一条规则，是基础块本身） */
const LIGHT_PALETTES = PALETTES.filter(
  (b) => b.selector.startsWith('.theme-') && !b.selector.endsWith('.dark'),
)

// ═══════════════════════ 探针 class 名 ═══════════════════════

const TYPE_PROBES = MD3_TYPE_SCALE.map(([tier]) => `text-${tier}`)
const SHAPE_PROBES = MD3_SHAPE_TIERS.map(([cls]) => cls)
/** 四态 × 四语义色登记在**颜色档位顶层** ⇒ utility 名就是 `bg-layer-<state>-<role>`
 *  （ADR-0207 决策 4 规定的名；见 tailwind.config.ts 同处注释：嵌套在 `state` 组内时
 *    真实类名会多一段 `state-`，而存量代码写的是不带 `state-` 的那个。） */
const STATE_PROBES = MD3_STATE_OPACITIES.flatMap(([state]) =>
  STATE_ROLES.map((role) => `bg-layer-${state}-${role}`),
)
/** 未登记档位（反例档位名）：断言它们在产物里**取不到规则**，证明抽取器不臆造匹配 */
const NEVER_REGISTERED = [
  'rounded-2xl',
  'rounded-3xl',
  'rounded-md',
  'ease-in-out',
  'ease-in',
  'ease-out',
  'text-display-mediumish',
  'bg-layer-swipe-primary',
  'bg-layer-hover-primaryx',
]
const PROBES = [
  ...TYPE_PROBES,
  ...LEGACY_ALIAS_TARGET.map(([alias]) => `text-${alias}`),
  ...SHAPE_PROBES,
  'rounded-b-none',
  ...STATE_PROBES,
  ...NEVER_REGISTERED,
  'transition',
  'transition-all',
  'ease-standard',
  'ease-emphasized',
  'ease-emphasized-decelerate',
  'ease-emphasized-accelerate',
  'font-regular',
  'font-medium',
  'font-bold',
  'bg-surface-tint',
  'bg-surface-container',
  'bg-surface-container-lowest',
  'bg-surface-container-low',
  'bg-surface-container-high',
  'bg-surface-container-highest',
  // 存量写法不回归：嵌套在 state 组内的实色档与 alpha 层别名
  'bg-state-pressed-primary',
  'bg-state-pressed-on-surface',
  'bg-state-layer-pressed-primary',
  'bg-state-layer-pressed-on-surface',
  'bg-state-disabled-container',
  'p-4',
]

const artifactPromise = buildTailwindArtifact(PROBES)

// ═══════════════════════ 违规定��收集器（供真配置与反事实共用同一套判据） ═══════════════════════

function shapeViolations(artifact: TailwindArtifact): string[] {
  const out: string[] = []
  for (const [className, token, dp] of MD3_SHAPE_TIERS) {
    const declarations = tryDeclarationsForClass(artifact, className)
    if (!declarations) {
      out.push(`${className} 未产出规则`)
      continue
    }
    const value = declarations['border-radius']
    if (value === undefined) {
      out.push(`${className} 缺 border-radius 声明`)
      continue
    }
    // 判据 1：必须**整个**是指向 --md-shape-* 令牌的引用。匹配不到即红 —— 含字面量的
    // 任何形态（4px / 0.25rem / var(--md-shape-x), 4px 的回退写法）都被这一条挡住。
    if (!new RegExp(`^var\\(${token}\\)$`).test(value)) {
      out.push(`${className} 的 border-radius=${value} 未整档指向 ${token}`)
    }
    // 判据 2：令牌本身的值必须等于官方 dp 的换算值（tokens.css 侧核对，见 tokens 段）
    if (dp !== null && !/^\d/.test(dp2vw(dp).toFixed(3))) out.push(`dp 换算异常：${dp}`)
  }
  return out
}

function typeScaleViolations(artifact: TailwindArtifact): string[] {
  const out: string[] = []
  for (const [tier, size, lineHeight, tracking] of MD3_TYPE_SCALE) {
    const declarations = tryDeclarationsForClass(artifact, `text-${tier}`)
    if (!declarations) {
      out.push(`text-${tier} 未产出规则`)
      continue
    }
    // 三要素齐备：缺任一即红（「数组形式只写了一半」的形态正是这样漏出来的）
    if (declarations['font-size'] === undefined) out.push(`text-${tier} 缺 font-size`)
    if (declarations['line-height'] === undefined) out.push(`text-${tier} 缺 line-height`)
    if (declarations['letter-spacing'] === undefined) out.push(`text-${tier} 缺 letter-spacing`)
    // 取值 = ADR-0206 官方表 × rpx = sp × 2
    if (declarations['font-size'] !== undefined && declarations['font-size'] !== sp2rpx(size)) {
      out.push(`text-${tier} font-size=${declarations['font-size']} ≠ ${sp2rpx(size)}`)
    }
    if (declarations['line-height'] !== undefined && declarations['line-height'] !== sp2rpx(lineHeight)) {
      out.push(`text-${tier} line-height=${declarations['line-height']} ≠ ${sp2rpx(lineHeight)}`)
    }
    if (declarations['letter-spacing'] !== undefined) {
      const expected = tracking === 0 ? '0' : sp2rpx(tracking)
      if (declarations['letter-spacing'] !== expected) {
        out.push(`text-${tier} letter-spacing=${declarations['letter-spacing']} ≠ ${expected}`)
      }
    }
  }
  return out
}

function legacyAliasViolations(artifact: TailwindArtifact): string[] {
  const out: string[] = []
  const byTier = new Map(MD3_TYPE_SCALE.map((row) => [row[0], row]))
  for (const [alias, tier] of LEGACY_ALIAS_TARGET) {
    const declarations = tryDeclarationsForClass(artifact, `text-${alias}`)
    if (!declarations) {
      out.push(`text-${alias} 未产出规则（旧别名是存量兼容层，不该消失）`)
      continue
    }
    const target = byTier.get(tier)
    if (!target) {
      out.push(`text-${alias} 的映射目标 ${tier} 不在 15 档表内`)
      continue
    }
    const [, size, lineHeight, tracking] = target
    if (declarations['font-size'] !== sp2rpx(size)) {
      out.push(`text-${alias} font-size=${declarations['font-size']} ≠ ${sp2rpx(size)}（映射 ${tier}）`)
    }
    if (declarations['line-height'] !== sp2rpx(lineHeight)) {
      out.push(`text-${alias} line-height=${declarations['line-height']} ≠ ${sp2rpx(lineHeight)}（映射 ${tier}）`)
    }
    const expectedTracking = tracking === 0 ? '0' : sp2rpx(tracking)
    if (declarations['letter-spacing'] !== expectedTracking) {
      out.push(`text-${alias} letter-spacing=${declarations['letter-spacing']} ≠ ${expectedTracking}（映射 ${tier}）`)
    }
  }
  return out
}

function motionViolations(artifact: TailwindArtifact): string[] {
  const out: string[] = []
  // 全站默认缓动：transition-* 实际生效的 timing function 必须是项目 M3 令牌。
  // 断言「每段都等于」而非「整串相等」：lynx preset 会按 transition-property 的每一项
  // 重复同一个 timing function（实测 transition-* 产出 5 段），串级比较会脆。
  for (const className of ['transition', 'transition-all']) {
    const value = declarationsForClass(artifact, className)['transition-timing-function']
    const parts = value === undefined ? [] : value.split(',').map((s) => s.trim())
    if (parts.length === 0) out.push(`${className} 没有 transition-timing-function 声明`)
    for (const [i, part] of parts.entries()) {
      if (part !== 'var(--motion-emphasized)') {
        out.push(`${className} 默认缓动第 ${i + 1} 段=${part} ≠ var(--motion-emphasized)`)
      }
    }
    if (value !== undefined && value.includes(MD2_LEGACY_EASING)) {
      out.push(`${className} 默认缓动含 MD2 legacy 值：${value}`)
    }
  }
  // 四条命名曲线逐条指向对应令牌
  const named: ReadonlyArray<readonly [className: string, token: string]> = [
    ['ease-standard', 'var(--motion-standard)'],
    ['ease-emphasized', 'var(--motion-emphasized)'],
    ['ease-emphasized-decelerate', 'var(--motion-emphasized-decelerate)'],
    ['ease-emphasized-accelerate', 'var(--motion-emphasized-accelerate)'],
  ]
  for (const [className, expected] of named) {
    const value = tryDeclarationsForClass(artifact, className)?.['transition-timing-function']
    if (value !== expected) out.push(`${className}=${value ?? '(无规则)'} ≠ ${expected}`)
  }
  // MD2 legacy 曲线不得作为可消费档位残留（Tailwind 3 默认的 in-out 就是它）
  for (const className of ['ease-in-out', 'ease-in', 'ease-out']) {
    if (tryDeclarationsForClass(artifact, className) !== undefined) {
      out.push(`${className} 仍产出规则（Tailwind 默认档位未清干净）`)
    }
  }
  // 源码级：tailwind.config.ts 的**可执行部分**里不得再出现 legacy 曲线字面量
  // （注释除外 —— 见 CONFIG_SRC_NO_COMMENTS 的说明）
  if (CONFIG_SRC_NO_COMMENTS.includes(MD2_LEGACY_EASING)) {
    out.push(`tailwind.config.ts 源码含 MD2 legacy 缓动字面量「${MD2_LEGACY_EASING}」`)
  }
  return out
}

function stateColorViolations(artifact: TailwindArtifact): string[] {
  const out: string[] = []
  for (const [state] of MD3_STATE_OPACITIES) {
    for (const role of STATE_ROLES) {
      const className = `bg-layer-${state}-${role}`
      const value = tryDeclarationsForClass(artifact, className)?.['background-color']
      const expected = `var(--md-state-layer-${state}-${role})`
      if (value !== expected) out.push(`${className}=${value ?? '(无规则)'} ≠ ${expected}`)
    }
  }
  return out
}

function fontWeightViolations(artifact: TailwindArtifact): string[] {
  const out: string[] = []
  for (const [className, expected] of [
    ['font-regular', '400'],
    ['font-medium', '500'],
  ] as const) {
    const value = tryDeclarationsForClass(artifact, className)?.['font-weight']
    if (value !== expected) out.push(`${className}=${value ?? '(无规则)'} ≠ ${expected}`)
  }
  return out
}

function stateTokenViolations(): string[] {
  const out: string[] = []
  for (const palette of PALETTES) {
    for (const [state, opacity] of MD3_STATE_OPACITIES) {
      for (const role of STATE_ROLES) {
        const name = `--md-state-layer-${state}-${role}`
        const value = cssVarValue(palette.body, name)
        if (value === undefined) {
          out.push(`${palette.selector} 缺 ${name}`)
          continue
        }
        if (role === 'surface') {
          // surface 档 = primary 色相的 var() 别名（口径见 tokens.css 注释）
          if (value !== `var(--md-state-layer-${state}-primary)`) {
            out.push(`${palette.selector} 的 ${name}=${value} 未指回 ${state}-primary`)
          }
          continue
        }
        // 逐态核对 opacity：正则吃下任意空白，但数值必须逐一等于官方值
        const m = /^rgba\(\s*[\d\s,]+,\s*([\d.]+)\s*\)$/.exec(value)
        if (!m) {
          out.push(`${palette.selector} 的 ${name}=${value} 不是 rgba 形态`)
        } else if (Number(m[1]) !== opacity) {
          out.push(`${palette.selector} 的 ${name} opacity=${m[1]} ≠ 官方 ${opacity}`)
        }
      }
    }
  }
  return out
}

function elevationViolations(): string[] {
  const out: string[] = []
  if (!BASE_PALETTE) return ['tokens.css 缺基础 page 色板块']
  for (const level of [0, 1, 2, 3, 4, 5]) {
    const name = `--md-elevation-${level}`
    const value = cssVarValue(BASE_PALETTE.body, name)
    if (value === undefined) out.push(`基础色板缺 ${name}`)
    else if (value === '') out.push(`${name} 取值为空串`)
  }
  // level 0 = none 是官方定义（MD3 level 0 即无阴影），不是外推
  const zero = cssVarValue(BASE_PALETTE.body, '--md-elevation-0')
  if (zero !== 'none') out.push(`--md-elevation-0=${zero} ≠ none`)
  // level 4/5 = 外推值：**必须**在声明行上带「外推」标记，否则后来者会当成官方值引用
  for (const level of [4, 5]) {
    const line = BASE_PALETTE.body
      .split('\n')
      .find((l) => l.trim().startsWith(`--md-elevation-${level}:`))
    if (line !== undefined && !line.includes('外推')) {
      out.push(`--md-elevation-${level} 声明行缺「外推」标记（易被误当官方值）`)
    }
  }
  return out
}

// ═══════════════════════ 1. 抽取器自身有效（防空转恒真） ═══════════════════════

describe('抽取器自身有效（防正则塌陷 → 全称断言静默恒真）', () => {
  /** 14 = 基础块（源码里 `page,` 与 `.theme-sky` 共规则，故 sky 亮色即基础块）+ 6 亮 + 7 暗 */
  const EXPECTED_PALETTE_COUNT = 14

  it('tokens.css 切出 14 个色板块（基础含 sky + 6 亮 + 7 暗），每块都抽到足够多的角色', () => {
    expect(PALETTES.length).toBe(EXPECTED_PALETTE_COUNT)
    expect(LIGHT_PALETTES.length).toBe(6)
    expect(DARK_PALETTES.length).toBe(7)
    expect(BASE_PALETTE).toBeDefined()
    for (const palette of PALETTES) {
      // 下界按 M3 色板规模给：角色数掉到这个量级说明切块或正则坏了
      expect(declaredTokens(palette.body).length, `${palette.selector} 抽到的角色过少`).toBeGreaterThanOrEqual(60)
    }
  })

  it('状态层声明抽到 14 × 16 = 224 条（抽取数量下界，塌陷即红）', () => {
    const total = PALETTES.reduce(
      (sum, p) =>
        sum + MD3_STATE_OPACITIES.flatMap(([s]) => STATE_ROLES.map((r) => p.body.match(new RegExp(`--md-state-layer-${s}-${r}:`)))).filter(Boolean).length,
      0,
    )
    expect(total).toBe(EXPECTED_PALETTE_COUNT * MD3_STATE_OPACITIES.length * STATE_ROLES.length)
    expect(total).toBeGreaterThanOrEqual(224)
  })

  it('产物非空、规则数有下界，探针确实被扫到（不是空壳 CSS）', async () => {
    const artifact = await artifactPromise
    expect(artifact.css.length).toBeGreaterThan(0)
    expect(artifact.ruleCount).toBeGreaterThanOrEqual(
      TYPE_PROBES.length + SHAPE_PROBES.length + STATE_PROBES.length,
    )
    for (const className of ['text-body-medium', 'rounded-full', 'bg-layer-hover-primary']) {
      expect(artifact.css, `产物里找不到 ${className}`).toContain(className)
    }
  })
})

// ═══════════════════════ 2. T05 形状（ADR-0207 决策 1） ═══════════════════════

describe('T05 · 形状档位取值契约（#853）', () => {
  it('6 档 border-radius 整档指向 --md-shape-* 令牌，无一字面量', async () => {
    expect(shapeViolations(await artifactPromise)).toEqual([])
  })

  it('tokens.css 的 6 个 --md-shape-* 取值 = 官方 dp 的 vw 换算值', () => {
    expect(BASE_PALETTE).toBeDefined()
    for (const [, token, dp] of MD3_SHAPE_TIERS) {
      if (dp === null) continue
      const value = cssVarValue(BASE_PALETTE!.body, token)
      expect(value, `${token} 未在基础色板定义`).toBeDefined()
      // 官方 9999（full）不参与 dp→vw；其余逐档核对 4/8/12/16/28dp
      if (token === '--md-shape-full') {
        expect(value).toBe('9999px')
        continue
      }
      expect(Number.parseFloat(value!), `${token} 值不是数值`).toBeCloseTo(dp2vw(dp!), 3)
      expect(value, `${token} 单位应为 vw（随屏宽缩放是 ADR-0207 决策 3 的有意取舍）`).toMatch(/vw$/)
    }
  })

  it('Tailwind 默认的 rem 圆角档位不再产出（rounded-md / 2xl / 3xl 全配置已移除）', async () => {
    const artifact = await artifactPromise
    for (const className of ['rounded-md', 'rounded-2xl', 'rounded-3xl']) {
      expect(tryDeclarationsForClass(artifact, className), `${className} 仍在产出规则`).toBeUndefined()
    }
  })

  it('rounded-none 复位档仍在（存量 2 处 rounded-b-none 依赖它清角）', async () => {
    const artifact = await artifactPromise
    expect(tryDeclarationsForClass(artifact, 'rounded-b-none')?.['border-bottom-left-radius']).toBe(
      '0px',
    )
  })
})

// ═══════════════════════ 3. T06 动效（ADR-0207 决策 6） ═══════════════════════

describe('T06 · 缓动取值契约（#854）', () => {
  it('standard 的正确值就是 (0.2,0,0,1) —— 防再次误判为 MD2 legacy', () => {
    expect(BASE_PALETTE).toBeDefined()
    for (const [token, expected] of MD3_EASINGS) {
      const value = cssVarValue(BASE_PALETTE!.body, token)
      expect(value, `${token} 未定义`).toBeDefined()
      // 只对 cubic-bezier 的四个参数做空白无关比较（`0.2,0,0,1` 与 `0.2, 0, 0, 1` 等价）
      const params = (v: string) => v.replace(/cubic-bezier\(|\)/g, '').split(',').map((s) => s.trim())
      expect(params(value!), `${token}=${value} 取值不对`).toEqual(params(expected))
    }
    // 反向钉死：legacy 值不是任何一条 --motion-* 曲线
    for (const [token] of MD3_EASINGS) {
      const value = cssVarValue(BASE_PALETTE!.body, token)
      expect(value, `${token} 被误设成 MD2 legacy 曲线`).not.toContain(MD2_LEGACY_EASING)
    }
  })

  it('全站默认缓动 = var(--motion-emphasized)，产物里不再出现 MD2 legacy 值', async () => {
    expect(motionViolations(await artifactPromise)).toEqual([])
    const artifact = await artifactPromise
    expect(artifact.css).not.toContain(MD2_LEGACY_EASING)
  })
})

// ═══════════════════════ 4. T07 排版四元组（ADR-0206 决策 1/2/4） ═══════════════════════

describe('T07 · 排版四元组取值契约（#855）', () => {
  it('15 档语义档位 size/lineHeight/letterSpacing 三要素齐备且等于 ADR-0206 换算表', async () => {
    expect(typeScaleViolations(await artifactPromise)).toEqual([])
  })

  it('旧别名 10 档取映射目标的完整四元组（存量兼容层）', async () => {
    expect(legacyAliasViolations(await artifactPromise)).toEqual([])
  })

  // 存量已从 18 处降到 1 处（T07 清理了 7 处），剩下那 1 处是 Login 的**产品字标**，
  // 按 ADR-0206 决策 2 的「label-emphasized 才配 700」属有意保留，带白名单与理由。
  it('字重档位 regular/medium 存在，且 font-bold 未被顶层替换删掉（存量 1 处：Login 字标白名单）', async () => {
    const artifact = await artifactPromise
    expect(fontWeightViolations(artifact)).toEqual([])
    expect(tryDeclarationsForClass(artifact, 'font-bold')?.['font-weight']).toBe('700')
  })

  it('全部 25 个字号档位不使用 rem 相对单位（web-core 预览禁 rem 布局）', async () => {
    const artifact = await artifactPromise
    const violations: string[] = []
    for (const className of [...TYPE_PROBES, ...LEGACY_ALIAS_TARGET.map(([a]) => `text-${a}`)]) {
      const declarations: DeclarationBlock | undefined = tryDeclarationsForClass(artifact, className)
      if (!declarations) continue
      for (const [prop, value] of Object.entries(declarations)) {
        if (/\d\s*rem\b/.test(value)) violations.push(`${className} { ${prop}: ${value} }`)
      }
    }
    expect(violations).toEqual([])
  })
})

// ═══════════════════════ 5. T08 状态层四态（ADR-0207 决策 4） ═══════════════════════

describe('T08 · 状态层四态取值契约（#856）', () => {
  it('15 套色板 × 四态 × 四语义色的 opacity 逐一等于官方值', () => {
    expect(stateTokenViolations()).toEqual([])
  })

  it('disabled 的 12% / 38% 经核对无误（官方 on-surface 容器/内容口径）', () => {
    for (const palette of PALETTES) {
      const container = cssVarValue(palette.body, '--md-state-disabled-container')
      const content = cssVarValue(palette.body, '--md-state-disabled-on-surface')
      const alpha = (v: string) => Number(/,\s*([\d.]+)\s*\)$/.exec(v)?.[1])
      expect(alpha(container!), `${palette.selector} disabled-container opacity 异常`).toBe(0.12)
      expect(alpha(content!), `${palette.selector} disabled-on-surface opacity 异常`).toBe(0.38)
    }
  })

  it('四态 × 四语义色在 Tailwind 颜色档位登记（bg-layer-* utility 可用）', async () => {
    expect(stateColorViolations(await artifactPromise)).toEqual([])
  })

  it('预计算实色（--md-state-pressed-*）保留为伪类受限兜底，注释写明「视觉近似 + 兜底」', () => {
    expect(BASE_PALETTE).toBeDefined()
    for (const role of STATE_ROLES) {
      expect(
        cssVarValue(BASE_PALETTE!.body, `--md-state-pressed-${role}`),
        `--md-state-pressed-${role} 应保留`,
      ).toBeDefined()
    }
    const block = BASE_PALETTE!.body
    expect(block).toContain('视觉近似')
    expect(block).toContain('兜底')
  })

  it('存量 state 组写法不回归（bg-state-pressed-* / bg-state-layer-* 仍产出）', async () => {
    // 嵌套在 state 组内的档位是存量 class 的载体（~20 处 active:bg-state-pressed-*），
    // 本票只把四态**另**登记到顶层，不能顺手把存量写法弄没。
    const artifact = await artifactPromise
    const expected: ReadonlyArray<readonly [className: string, token: string]> = [
      ['bg-state-pressed-primary', 'var(--md-state-pressed-primary)'],
      ['bg-state-pressed-on-surface', 'var(--md-state-pressed-on-surface)'],
      ['bg-state-layer-pressed-primary', 'var(--md-state-layer-pressed-primary)'],
      ['bg-state-layer-pressed-on-surface', 'var(--md-state-layer-pressed-on-surface)'],
      ['bg-state-disabled-container', 'var(--md-state-disabled-container)'],
    ]
    for (const [className, token] of expected) {
      expect(
        declarationsForClass(artifact, className)['background-color'],
        `${className} 存量写法失效`,
      ).toBe(token)
    }
  })
})

// ═══════════════════════ 6. T09 层级（ADR-0207 决策 7） ═══════════════════════

describe('T09 · 层级取值契约（#857）', () => {
  it('elevation 六档齐备；0 = none；4/5 声明行带「外推」标记', () => {
    expect(elevationViolations()).toEqual([])
  })

  it('--md-surface-tint 已登记进颜色档位并产出 utility（**消费**由 PagePickerSheet.test.ts 把关）', async () => {
    // 本文件按抬头声明只覆盖 tailwind.config.ts + tokens.css，**不**扫 .vue。
    // 「有人真的消费了它」由 src/components/PagePickerSheet.test.ts 把关
    // （8 条断言：真实 class 属性 / 非 bg-primary 改名 / 产物有规则 / 反事实两条 /
    //   高度推导 / 不吃点击 / DOM 顺序），并在 T09 验收第 3 条下闭环。
    // 这里只答「令牌可用」；两条断言分工明确，不要把 .vue 扫描塞进本文件 ——
    // 那会悄悄改掉本文件的覆盖范围声明，让下一个人以为这里管着消费面。
    const artifact = await artifactPromise
    expect(declarationsForClass(artifact, 'bg-surface-tint')['background-color']).toBe(
      'var(--md-surface-tint)',
    )
    // 令牌自身在 15 套色板都在位
    for (const palette of PALETTES) {
      expect(
        cssVarValue(palette.body, '--md-surface-tint'),
        `${palette.selector} 缺 --md-surface-tint`,
      ).toBeDefined()
    }
  })

  it('层级主表达是表面色调：surface-container 五档可消费（box-shadow 仅作辅）', async () => {
    const artifact = await artifactPromise
    for (const tier of ['lowest', 'low', '', 'high', 'highest']) {
      const suffix = tier ? `-${tier}` : ''
      const value = declarationsForClass(artifact, `bg-surface-container${suffix}`)[
        'background-color'
      ]
      expect(value).toBe(`var(--md-surface-container${suffix})`)
    }
  })
})

// ═══════════════════════ 7. 否定断言：未登记档位不得凭空产出 ═══════════════════════

describe('否定断言（抽取器不臆造匹配）', () => {
  it('未登记的档位名在产物里全部取不到规则', async () => {
    const artifact = await artifactPromise
    for (const className of NEVER_REGISTERED) {
      expect(tryDeclarationsForClass(artifact, className), `${className} 不该有规则`).toBeUndefined()
    }
  })
})

// ═══════════════════════ 8. 反事实自检（常驻；局部覆盖配置，不写磁盘） ═══════════════════════

describe('反事实自检（拆坏配置 → 对应判据当场转红）', () => {
  it('拆掉某档的 lineHeight → 排版判据转红（改回即恢复）', async () => {
    const real = projectTailwindConfig()
    // 前提自证：真实配置下 15 档全绿，否则下面的「转红」说明不了问题
    expect(typeScaleViolations(await artifactPromise)).toEqual([])

    const fontSize = real.theme?.fontSize as Record<string, unknown>
    const broken = await buildTailwindArtifact(TYPE_PROBES, {
      // 只把 body-medium 降级成裸字符串 size（= 「数组形式只写了一半」的形态）
      theme: { ...real.theme, fontSize: { ...fontSize, 'body-medium': '28rpx' } },
    })
    const violations = typeScaleViolations(broken)
    expect(violations.join('\n')).toContain('text-body-medium 缺 line-height')
    expect(violations.join('\n')).toContain('text-body-medium 缺 letter-spacing')
    // 其它 14 档不受影响 —— 证明判据是逐档的，不是「有一个坏了就全红」
    expect(violations.every((v) => v.startsWith('text-body-medium'))).toBe(true)
  })

  it('把 borderRadius 某档指向字面量 4px → 形状判据转红', async () => {
    const real = projectTailwindConfig()
    expect(shapeViolations(await artifactPromise)).toEqual([])

    const borderRadius = real.theme?.borderRadius as Record<string, string>
    const broken = await buildTailwindArtifact(SHAPE_PROBES, {
      theme: { ...real.theme, borderRadius: { ...borderRadius, sm: '4px' } },
    })
    const violations = shapeViolations(broken)
    expect(violations.join('\n')).toContain('rounded-sm')
    expect(violations.join('\n')).toContain('--md-shape-small')
    expect(violations).toHaveLength(1)
  })

  it('把默认缓动塞回 MD2 legacy 曲线 → 动效判据转红', async () => {
    const real = projectTailwindConfig()
    expect(motionViolations(await artifactPromise)).toEqual([])

    // ⚠️ 必须拆 **extend.transitionTimingFunction.DEFAULT** 而不是顶层那个：
    // preset 的 extend 在顶层 theme 键之后合并，顶层 DEFAULT 会被 extend 覆盖回去
    // （这正是「顶层清干净了却还是 legacy」的机制）。拆错位置这条反事实会恒绿。
    // 探针集与 motionViolations 的覆盖面一致（少探一个 ease-* 就会产生「取不到规则」
    // 的噪声违例，把「只坏在默认缓动这一条路径上」这个结论冲掉）
    const probes = [
      'transition',
      'transition-all',
      'ease-standard',
      'ease-emphasized',
      'ease-emphasized-decelerate',
      'ease-emphasized-accelerate',
      'ease-in-out',
      'ease-in',
      'ease-out',
    ]
    const broken = await buildTailwindArtifact(probes, {
      theme: {
        ...real.theme,
        extend: {
          ...(real.theme?.extend as Record<string, unknown>),
          transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)' },
        },
      },
    })
    const violations = motionViolations(broken)
    expect(violations.join('\n')).toContain('MD2 legacy')
    // 命名曲线不受影响 ⇒ 判据定位在「默认缓动」这一条路径上，不是泛化报错
    expect(violations.every((v) => v.includes('默认缓动'))).toBe(true)
  })
})

// ═══════════════════════ 9. T14 ① 色角色齐备性（#862 票面验收 ①）═══════════════════════
//
// 为什么单开一段：此前 tokens.css 的门禁只数「切出几个色板块 / 每块抽到几个声明」
// （见 §1），**从不逐板校验角色**。后果是：某个 `.theme-X` 漏声明一个角色时不会有任何
// 断言转红 —— 那个角色会静默回落到 `page,` 基础板（级联同元素命中），表现为「选了橙色主题，
// 某处仍是天蓝」，且没有任何机器证据。
//
// Oracle：M3 色角色全集 = **46 个**，按官方 `ColorScheme` 的角色分组逐组列出（分组与计数
// 抄自 `docs/adr/glossary-md3-alignment.md` §1「色彩」，其一手来源是 material-web v0.192
// `_md-sys-color.scss` / AndroidX Material3 `ColorScheme`）：
//   primary/secondary/tertiary/error 四元组各 4 = 16
//   surface 基础 4（surface / on-surface / surface-variant / on-surface-variant）
//   surface-container 五档 5 · outline 两角色 2 · inverse 三角色 3
//   surface-dim/bright 2 · fixed 族 12（primary/secondary/tertiary × fixed/fixed-dim/on-fixed/on-fixed-variant）
//   scrim 1 · surface-tint 1
//   → 16 + 4 + 5 + 2 + 3 + 2 + 12 + 1 + 1 = **46**
// 46 是**可独立推导的官方角色集规模**，不是「当前 tokens.css 抽到了几个」——后者会随整改漂移，
// 拿它当下界等于把门禁焊死在现状上（改色板就红）。
const MD3_COLOR_ROLE_GROUPS: ReadonlyArray<readonly [group: string, roles: readonly string[]]> = [
  [
    'primary 四元组',
    ['primary', 'on-primary', 'primary-container', 'on-primary-container'],
  ],
  [
    'secondary 四元组',
    ['secondary', 'on-secondary', 'secondary-container', 'on-secondary-container'],
  ],
  [
    'tertiary 四元组',
    ['tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container'],
  ],
  ['error 四元组', ['error', 'on-error', 'error-container', 'on-error-container']],
  ['surface 基础', ['surface', 'on-surface', 'surface-variant', 'on-surface-variant']],
  [
    'surface-container 五档',
    [
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
      'surface-container-highest',
    ],
  ],
  ['outline 两角色', ['outline', 'outline-variant']],
  ['inverse 三角色', ['inverse-surface', 'inverse-on-surface', 'inverse-primary']],
  ['surface dim/bright', ['surface-dim', 'surface-bright']],
  [
    'fixed 族 12',
    [
      'primary-fixed',
      'on-primary-fixed',
      'primary-fixed-dim',
      'on-primary-fixed-variant',
      'secondary-fixed',
      'on-secondary-fixed',
      'secondary-fixed-dim',
      'on-secondary-fixed-variant',
      'tertiary-fixed',
      'on-tertiary-fixed',
      'tertiary-fixed-dim',
      'on-tertiary-fixed-variant',
    ],
  ],
  ['scrim', ['scrim']],
  ['surface-tint', ['surface-tint']],
]
const MD3_COLOR_ROLES: readonly string[] = MD3_COLOR_ROLE_GROUPS.flatMap(([, roles]) =>
  roles.map((role) => `--md-${role}`),
)

/**
 * 按设计**跨板共用**、故亮色块可不逐板声明的 5 个色角色：
 *   - error 组 4 个：tokens.css 基础块注释明示「亮色 7 主题共用同一 error」——error 由独立
 *     errorPalette 派生，与品牌锚点解耦（scripts/generate-theme-palettes.mjs 的 T4 扩展说明）；
 *   - scrim：模式无关的通用遮罩语义（tokens.css 基础块「scrim」行）。
 * ⚠️ 这 5 个是**唯一**允许从基础板继承的色角色。其余 41 个若靠继承 = 静默回落 sky 板。
 * 另有 `--md-scroll-indicator`（平台 affordance，非 M3 角色，见 glossary §1）与 shape/elevation/
 * scrim-overlay 同属「模式无关或有意共用」，同样不在逐板必声明之列。
 */
const SHARED_COLOR_ROLES: ReadonlySet<string> = new Set([
  '--md-error',
  '--md-on-error',
  '--md-error-container',
  '--md-on-error-container',
  '--md-scrim',
])

/** 必须**本块声明**的色角色 = 46 − 5 跨板共用 = 41 */
const PER_PALETTE_COLOR_ROLES: readonly string[] = MD3_COLOR_ROLES.filter(
  (role) => !SHARED_COLOR_ROLES.has(role),
)

/**
 * 非颜色但必须齐备的令牌（构成「自含板」的完整角色集 46 + 36 = 82）：
 *   shape 6（官方 v0.192 `_md-sys-shape.scss`，4/8/12/16/28/full）
 *   + elevation 6（level 0–5，ADR-0207 决策 7）
 *   + scrim-overlay 1 + scroll-indicator 1（本项目自引申 / 平台 affordance）
 *   + 状态层四态 × 四语义色 16（官方 `_md-sys-state.scss`，ADR-0207 决策 4）
 *   + pressed 预计算实色 4（伪类受限兜底）
 *   + disabled 2（官方 on-surface 12% 容器 / 38% 内容）
 */
const MD3_NON_COLOR_ROLES: readonly string[] = [
  ...MD3_SHAPE_TIERS.map(([, token]) => token),
  ...[0, 1, 2, 3, 4, 5].map((level) => `--md-elevation-${level}`),
  '--md-scrim-overlay',
  '--md-scroll-indicator',
  ...MD3_STATE_OPACITIES.flatMap(([state]) =>
    STATE_ROLES.map((role) => `--md-state-layer-${state}-${role}`),
  ),
  ...STATE_ROLES.map((role) => `--md-state-pressed-${role}`),
  '--md-state-disabled-container',
  '--md-state-disabled-on-surface',
]

/**
 * 基础板（`page,`）与 7 个暗板是**自含**色板：角色必须本块声明，不靠继承。
 * 6 个亮色板是**覆盖**色板：`.theme-X` 与 `page,` 规则命中同一个根 `<page>` 元素，
 * 未声明的角色由基础板兜底（这是 tokens.css 的既有设计，见各亮色块的注释）。
 */
function isSelfContained(selector: string): boolean {
  return selector === 'page,' || selector.endsWith('.dark')
}

/** 某个色板块的「生效角色集」= 本块声明 ∪ 基础板声明（级联兜底） */
function effectiveRoles(palette: CssBlock, base: CssBlock | undefined): Set<string> {
  return new Set([...(base ? declaredTokens(base.body) : []), ...declaredTokens(palette.body)])
}

/** 某个色板块内某自定义属性的**全部**声明值（不去重）——用于查重复声明 */
function duplicateValuesInBlock(block: string, name: string): string[] {
  return [
    ...block.matchAll(new RegExp(`^\\s*${name}:\\s*(.+?);?\\s*(?:/\\*.*)?$`, 'gm')),
  ].map((m) => m[1]!.trim())
}

/**
 * 每块**至少**要抽到的角色数下界。
 *
 * 组成全部来自上面的官方角色集推导（不是「当前实测值」）：41 逐板色角色
 * + 状态层四态 × 四语义色 16 + disabled 2 = **59**。
 * 刻意不计 shape / elevation / scrim-overlay / scroll-indicator / pressed 实色：
 * 前四者按设计由基础板共用（§T05/T09 已逐档门禁其**取值**），pressed 实色按 error 组
 * 可声明 3 或 4 档。留出的余量让「整改后再加角色」不会变红，而「切块/正则塌陷」（抽到 0）
 * 必红。
 */
const PER_BLOCK_ROLE_COUNT_LOWER_BOUND =
  PER_PALETTE_COLOR_ROLES.length + MD3_STATE_OPACITIES.length * STATE_ROLES.length + 2

/** 每块角色数下界违例（空集合 = 每块都够） */
function roleCountLowerBoundViolations(css: string = TOKENS_CSS): string[] {
  return paletteBlocks(css)
    .map((palette) => [palette, declaredTokens(palette.body).length] as const)
    .filter(([, count]) => count < PER_BLOCK_ROLE_COUNT_LOWER_BOUND)
    .map(
      ([palette, count]) =>
        `${palette.selector} 只抽到 ${count} 个角色 < 下界 ${PER_BLOCK_ROLE_COUNT_LOWER_BOUND}`,
    )
}

/**
 * 「已登记的同值冗余声明」：`[色板 | 角色, 两遍取值（以 ' vs ' 连接）]`。
 *
 * 来源：本次 T14 齐备性巡检顺带查出 —— 6 个亮色板各把 `--md-state-layer-pressed-primary`
 * 与 `--md-state-layer-pressed-on-surface` **写了两遍**（块首一组、块尾 hover/focus 组内一组）。
 * 两遍取值逐字相同 ⇒ CSS 后者覆盖前者、渲染结果不变，故**不是缺陷**，但确属冗余。
 * tokens.css 不在本票可改范围，故登记在册而不是顺手改掉；登记同时把「冗余」与「分歧」分开：
 * 同值冗余在册放行，两遍取值一旦不同（或新增重复）立即转红。
 */
const REDUNDANT_DECLARATIONS: ReadonlyArray<readonly [key: string, values: string]> = [
  [
    '.theme-violet | --md-state-layer-pressed-primary',
    'rgba(101, 85, 143, 0.12) vs rgba(101, 85, 143, 0.12)',
  ],
  [
    '.theme-violet | --md-state-layer-pressed-on-surface',
    'rgba(29, 27, 32, 0.12) vs rgba(29, 27, 32, 0.12)',
  ],
  [
    '.theme-pink | --md-state-layer-pressed-primary',
    'rgba(139, 74, 97, 0.12) vs rgba(139, 74, 97, 0.12)',
  ],
  [
    '.theme-pink | --md-state-layer-pressed-on-surface',
    'rgba(34, 25, 28, 0.12) vs rgba(34, 25, 28, 0.12)',
  ],
  [
    '.theme-green | --md-state-layer-pressed-primary',
    'rgba(60, 105, 57, 0.12) vs rgba(60, 105, 57, 0.12)',
  ],
  [
    '.theme-green | --md-state-layer-pressed-on-surface',
    'rgba(25, 29, 23, 0.12) vs rgba(25, 29, 23, 0.12)',
  ],
  [
    '.theme-orange | --md-state-layer-pressed-primary',
    'rgba(133, 83, 23, 0.12) vs rgba(133, 83, 23, 0.12)',
  ],
  [
    '.theme-orange | --md-state-layer-pressed-on-surface',
    'rgba(33, 26, 20, 0.12) vs rgba(33, 26, 20, 0.12)',
  ],
  [
    '.theme-teal | --md-state-layer-pressed-primary',
    'rgba(0, 105, 109, 0.12) vs rgba(0, 105, 109, 0.12)',
  ],
  [
    '.theme-teal | --md-state-layer-pressed-on-surface',
    'rgba(22, 29, 29, 0.12) vs rgba(22, 29, 29, 0.12)',
  ],
  [
    '.theme-bili | --md-state-layer-pressed-primary',
    'rgba(208, 49, 113, 0.12) vs rgba(208, 49, 113, 0.12)',
  ],
  [
    '.theme-bili | --md-state-layer-pressed-on-surface',
    'rgba(24, 25, 28, 0.12) vs rgba(24, 25, 28, 0.12)',
  ],
]

/** 逐板校验：缺哪个角色就报「哪个色板缺哪个角色」 */
function colorRoleCompletenessViolations(css: string = TOKENS_CSS): string[] {
  const out: string[] = []
  const palettes = paletteBlocks(css)
  const base = palettes.find((b) => b.selector === 'page,')
  if (!base) return ['tokens.css 缺基础 page 色板块（级联兜底无从谈起）']
  for (const palette of palettes) {
    const declared = new Set(declaredTokens(palette.body))
    const effective = effectiveRoles(palette, base)
    for (const role of MD3_COLOR_ROLES) {
      if (declared.has(role)) continue
      if (effective.has(role)) {
        // 只允许 5 个跨板共用的角色走到这一支；其余落到这里就是「静默回落基础板」
        if (!SHARED_COLOR_ROLES.has(role)) {
          out.push(
            `${palette.selector} 未声明色角色 ${role}（色相派生角色必须本块声明，继承基础板 = 静默回落 sky 板）`,
          )
        }
        continue
      }
      out.push(`${palette.selector} 缺色角色 ${role}`)
    }
    if (isSelfContained(palette.selector)) {
      for (const role of MD3_NON_COLOR_ROLES) {
        if (!declared.has(role)) out.push(`${palette.selector} 缺 ${role}（自含色板不得靠继承）`)
      }
    }
  }
  return out
}

// ═══════════════════════ 10. T14 ② WCAG 对比度（#862 票面验收 ②）═══════════════════════
//
// 阈值分档的依据（不是「挑一个让现状全绿的数」）：
//   - 4.5:1 = WCAG 2.1 SC 1.4.3 Contrast (Minimum) Level AA，用于**正文**类配对；
//   - 3:1   = WCAG 2.1 SC 1.4.11 Non-text Contrast Level AA，用于**非文本**（控件边界、
//     强调/装饰色）类配对。M3 对 `primary` on `surface` 的设计目标本就是 ~3:1 而非 4.5:1。
// ⚠️ 不得假设「官方 MD3 色板一定达标」：`outline-variant` 就是 M3 角色设计导致的全板未达标项，
//   它登记在下面的「已知未达标」表里，并由表与实测值互相锁死。
const WCAG_TEXT_TIER = 4.5
const WCAG_NON_TEXT_TIER = 3

/** 配对清单：前景角色 / 背景角色 / 分档阈值 / 为什么落这一档 */
const WCAG_PAIRS: ReadonlyArray<
  readonly [fg: string, bg: string, tier: number, why: string]
> = [
  ['on-surface', 'surface', WCAG_TEXT_TIER, '正文'],
  ['on-surface', 'surface-container-low', WCAG_TEXT_TIER, '正文（卡片/列表容器上的常规文字）'],
  ['on-surface-variant', 'surface', WCAG_TEXT_TIER, '次级文字（说明、时间戳）'],
  [
    'on-surface-variant',
    'surface-container-high',
    WCAG_TEXT_TIER,
    '次级文字落在 elevated 容器上（bili 板在此最紧，差距报告 §3.1 记 4.58）',
  ],
  [
    'on-primary',
    'primary',
    WCAG_TEXT_TIER,
    '主按钮标签：label-large 14sp 属正文档（非大字），SC 1.4.3 不给大字豁免',
  ],
  ['on-primary-container', 'primary-container', WCAG_TEXT_TIER, '选中 chip / 强调容器上的文字'],
  ['on-secondary-container', 'secondary-container', WCAG_TEXT_TIER, '次强调容器上的文字'],
  ['on-tertiary-container', 'tertiary-container', WCAG_TEXT_TIER, '第三强调容器上的文字'],
  ['on-error', 'error', WCAG_TEXT_TIER, '错误态按钮标签（同主按钮）'],
  ['on-error-container', 'error-container', WCAG_TEXT_TIER, '错误提示条文字'],
  ['inverse-on-surface', 'inverse-surface', WCAG_TEXT_TIER, 'inverse 面（snackbar）上的文字'],
  ['outline', 'surface', WCAG_NON_TEXT_TIER, '控件边界：SC 1.4.11 非文本对比度'],
  [
    'outline-variant',
    'surface',
    WCAG_NON_TEXT_TIER,
    '装饰性分隔线：M3 角色定义如此，WCAG 1.4.11 对「非识别控件所必需」的视觉信息有豁免',
  ],
  [
    'primary',
    'surface',
    WCAG_NON_TEXT_TIER,
    '强调色 / 链接：M3 对该配对的设计目标即 ~3:1，按非文本档判定',
  ],
]

const pairKey = (fg: string, bg: string): string => `${fg} on ${bg}`

/**
 * 「已知未达标」登记表：`[配对, 色板, 实测比值]`。
 *
 * 为什么允许在册项存在、却不等于放水：M3 把 `outline-variant` 定义为**装饰性分隔线**
 * （非控件唯一边界），全板 1.26–2.00:1 属角色设计本身，glossary §1「Outline 两角色」与
 * 差距分析 §3.1 早有留痕。登记表是**活契约**，由两条断言双向锁死：
 *   1. 实测未达标集合必须**恰好等于**在册集合 —— 新增未达标项 ⇒ 红（必须决策后登记），
 *      在册项转正 ⇒ 同样红（必须从表里删掉，否则它会永久豁免）。
 *   2. 在册项的实测值必须与登记值一致到两位小数 —— 数值漂移（如某个 hex 被改）⇒ 红。
 * 绝不允许的写法：把阈值调到刚好让现状全绿，或用恒真断言糊过去。
 */
const KNOWN_BELOW_TIER: ReadonlyArray<readonly [pair: string, palette: string, measured: number]> =
  [
    ['outline-variant on surface', 'page,', 1.63],
    ['outline-variant on surface', '.theme-violet', 1.62],
    ['outline-variant on surface', '.theme-pink', 1.62],
    ['outline-variant on surface', '.theme-green', 1.62],
    ['outline-variant on surface', '.theme-orange', 1.62],
    ['outline-variant on surface', '.theme-teal', 1.63],
    ['outline-variant on surface', '.theme-bili', 1.26],
    ['outline-variant on surface', '.theme-sky.dark', 1.98],
    ['outline-variant on surface', '.theme-violet.dark', 1.99],
    ['outline-variant on surface', '.theme-pink.dark', 1.98],
    ['outline-variant on surface', '.theme-green.dark', 2.0],
    ['outline-variant on surface', '.theme-orange.dark', 1.99],
    ['outline-variant on surface', '.theme-teal.dark', 2.0],
    ['outline-variant on surface', '.theme-bili.dark', 1.98],
  ]
const KNOWN_BELOW_TIER_PAIRS: ReadonlySet<string> = new Set(KNOWN_BELOW_TIER.map(([pair]) => pair))

interface ContrastSample {
  palette: string
  pair: string
  /** 未定义 = 角色缺失或颜色无法解析（错误文本在 error 里） */
  ratio: number | undefined
  error?: string
}

/**
 * 逐板逐配对实测。取值走**生效值**（本块声明 ∪ 基础板兜底）——与浏览器里真实级联一致：
 * 色板类与 `page,` 规则命中同一个根 `<page>` 元素，未声明的角色由基础板提供。
 * 解析失败（`var()` / 渐变 / 越界）不吞掉，记成 error 让断言转红 —— 禁静默降级。
 */
function measureContrast(css: string = TOKENS_CSS): ContrastSample[] {
  const palettes = paletteBlocks(css)
  const base = palettes.find((b) => b.selector === 'page,')
  const samples: ContrastSample[] = []
  for (const palette of palettes) {
    for (const [fg, bg] of WCAG_PAIRS) {
      const key = pairKey(fg, bg)
      const pick = (role: string): string | undefined =>
        cssVarValue(palette.body, `--md-${role}`) ??
        (base ? cssVarValue(base.body, `--md-${role}`) : undefined)
      const fgValue = pick(fg)
      const bgValue = pick(bg)
      if (fgValue === undefined || bgValue === undefined) {
        samples.push({
          palette: palette.selector,
          pair: key,
          ratio: undefined,
          error: `缺角色 ${fgValue === undefined ? fg : bg}`,
        })
        continue
      }
      try {
        samples.push({ palette: palette.selector, pair: key, ratio: contrastRatio(fgValue, bgValue) })
      } catch (error) {
        samples.push({
          palette: palette.selector,
          pair: key,
          ratio: undefined,
          error: `${fgValue} on ${bgValue} 无法计算（${(error as Error).message}）`,
        })
      }
    }
  }
  return samples
}

/** 阈值表：配对 → 分档阈值 */
const WCAG_TIER_BY_PAIR: ReadonlyMap<string, number> = new Map(
  WCAG_PAIRS.map(([fg, bg, tier]) => [pairKey(fg, bg), tier]),
)

/** 在册豁免之外、低于分档阈值的配对（即真·缺陷；已登记的豁免项不计入） */
function contrastViolations(samples: ContrastSample[]): string[] {
  const out: string[] = []
  for (const sample of samples) {
    if (sample.ratio === undefined) {
      out.push(`${sample.palette} 的 ${sample.pair}：${sample.error ?? '无法计算'}`)
      continue
    }
    const tier = WCAG_TIER_BY_PAIR.get(sample.pair)
    if (tier === undefined) {
      out.push(`${sample.palette} 的 ${sample.pair} 不在阈值表内（配对清单与阈值表不同步）`)
      continue
    }
    if (KNOWN_BELOW_TIER_PAIRS.has(sample.pair)) continue
    if (sample.ratio < tier) {
      out.push(`${sample.palette} 的 ${sample.pair} = ${sample.ratio.toFixed(2)} < ${tier}`)
    }
  }
  return out
}

describe('T14 ① · 色角色齐备性（#862）', () => {
  it('Oracle 自身有效：M3 色角色 46 个 = 各官方角色组计数之和', () => {
    expect(MD3_COLOR_ROLES.length, '色角色全集应为 46（MD3 ColorScheme 色角色）').toBe(46)
    // 逐组核对计数：组表被改小（如漏掉 fixed 族）时 46 仍可能对不上，故逐组也钉住
    expect(Object.fromEntries(MD3_COLOR_ROLE_GROUPS.map(([g, r]) => [g, r.length]))).toEqual({
      'primary 四元组': 4,
      'secondary 四元组': 4,
      'tertiary 四元组': 4,
      'error 四元组': 4,
      'surface 基础': 4,
      'surface-container 五档': 5,
      'outline 两角色': 2,
      'inverse 三角色': 3,
      'surface dim/bright': 2,
      'fixed 族 12': 12,
      scrim: 1,
      'surface-tint': 1,
    })
    expect(SHARED_COLOR_ROLES.size).toBe(5)
    expect(PER_PALETTE_COLOR_ROLES.length, '46 − 5 跨板共用 = 41').toBe(41)
    // 非颜色角色集的规模同样来自官方表（shape 6 / elevation 6 / 四态 16 / pressed 4 / disabled 2 / scrim-overlay 1 / scroll-indicator 1）
    expect(MD3_NON_COLOR_ROLES.length).toBe(36)
  })

  it('14 个色板 × 46 个 M3 色角色齐备，缺谁报「哪个色板缺哪个角色」', () => {
    expect(colorRoleCompletenessViolations()).toEqual([])
  })

  it('抽取器下界有效：每块抽到的角色数 ≥ 59（官方角色集应有规模，非当前实测值）', () => {
    // 下界 59 = 41 逐板色角色 + 16 状态层 + 2 disabled（见 PER_BLOCK_ROLE_COUNT_LOWER_BOUND），
    // 比现状（62）低 3 档余量，防「整改后就变红」；同时远高于「切块/正则塌陷」产生的 0
    expect(PER_BLOCK_ROLE_COUNT_LOWER_BOUND).toBe(59)
    expect(roleCountLowerBoundViolations()).toEqual([])
  })

  it('重复声明只允许是已登记的同值冗余（本次巡检发现：6 亮板各重复 2 条 pressed 层）', () => {
    // `declaredTokens` 自带去重，重复声明会被它悄悄吃掉 —— 而「同一块里同名角色写两遍」
    // 若两遍**取值不同**就是静默分歧（后者覆盖前者，判红）。故这里用未去重的匹配还原现场：
    // 重复集合必须恰好等于在册集合，且在册项两遍取值必须逐字相同。
    const duplicates = new Map<string, string[]>()
    for (const palette of paletteBlocks(TOKENS_CSS)) {
      for (const name of declaredTokens(palette.body)) {
        const values = duplicateValuesInBlock(palette.body, name)
        for (const value of values) {
          const list = duplicates.get(name) ?? []
          list.push(value)
          duplicates.set(name, list)
        }
      }
    }
    const found: Array<[string, string]> = []
    for (const palette of paletteBlocks(TOKENS_CSS)) {
      for (const name of declaredTokens(palette.body)) {
        const values = duplicateValuesInBlock(palette.body, name)
        if (values.length > 1) found.push([`${palette.selector} | ${name}`, values.join(' vs ')])
      }
    }
    // 反塌陷：抽取为空时「无重复」会恒真，故先自证确实抽到了声明
    expect([...duplicates.values()].reduce((sum, v) => sum + v.length, 0), '声明抽取塌陷').toBeGreaterThan(
      0,
    )
    expect(found.map(([key]) => key).sort()).toEqual(
      REDUNDANT_DECLARATIONS.map(([key]) => key).sort(),
    )
    // 在册项必须是**同值**冗余：两遍取值不同 ⇒ 判红（那才是静默分歧）
    for (const [key, recorded] of REDUNDANT_DECLARATIONS) {
      const [, values] = found.find(([k]) => k === key)!
      expect(values, `${key} 的两遍取值不再相同（此前是同值冗余）`).toBe(recorded)
    }
  })

  it('反事实：删掉 .theme-teal.dark 的一个色角色 → 齐备性判据当场转红', () => {
    expect(colorRoleCompletenessViolations()).toEqual([])
    // 自含板（基础板 + 7 暗板）删角色 = 真的没有这个值（无级联可兜底）
    const broken = TOKENS_CSS.replace('  --md-outline: #899393;\n', '')
    expect(broken, '改动没落到 tokens.css 上，反事实无效').not.toBe(TOKENS_CSS)
    const violations = colorRoleCompletenessViolations(broken)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('.theme-teal.dark')
    expect(violations[0]).toContain('--md-outline')
    // 改回即恢复
    expect(colorRoleCompletenessViolations(TOKENS_CSS)).toEqual([])
  })

  it('反事实：亮色板漏声明一个色相派生角色 → 判红（否则会静默回落 sky 板）', () => {
    expect(colorRoleCompletenessViolations()).toEqual([])
    const broken = TOKENS_CSS.replace('  --md-primary: #855317;\n', '')
    expect(broken, '改动没落到 tokens.css 上，反事实无效').not.toBe(TOKENS_CSS)
    const violations = colorRoleCompletenessViolations(broken)
    expect(violations.join('\n')).toContain('.theme-orange')
    expect(violations.join('\n')).toContain('--md-primary')
    expect(violations).toHaveLength(1)
    expect(colorRoleCompletenessViolations(TOKENS_CSS)).toEqual([])
  })

  it('反事实：抽取器塌陷（某块声明被清空）→ 数量下界当场转红', () => {
    expect(roleCountLowerBoundViolations()).toEqual([])
    // 把 .theme-teal 的整块声明换成空块：抽取器仍能切出 14 块（§1 的块数断言照样绿），
    // 唯独数量下界会红 —— 这正是「只判块数」的老门禁放过的那类塌陷
    const broken = TOKENS_CSS.replace(/\.theme-teal \{[^}]*\}/, '.theme-teal {\n  /* 空块 */\n}')
    expect(broken, '改动没落到 tokens.css 上，反事实无效').not.toBe(TOKENS_CSS)
    expect(paletteBlocks(broken).length, '块数不变，旧的块数断言看不出问题').toBe(14)
    const violations = roleCountLowerBoundViolations(broken)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('.theme-teal')
    expect(roleCountLowerBoundViolations(TOKENS_CSS)).toEqual([])
  })
})

describe('T14 ② · WCAG 对比度（#862）', () => {
  it('14 个色板 × 14 组配对：正文类 ≥ 4.5:1、非文本类 ≥ 3:1（WCAG 2.1 AA）', () => {
    const samples = measureContrast()
    // 先自证测量面：样本数 = 色板数 × 配对数（少一格就说明抽取塌了，恒真断言就长出来了）
    expect(samples.length).toBe(paletteBlocks(TOKENS_CSS).length * WCAG_PAIRS.length)
    expect(samples.every((s) => s.ratio !== undefined)).toBe(true)
    expect(contrastViolations(samples)).toEqual([])
  })

  it('「已知未达标」表与实测双向锁死：集合必须相等，且在册实测值不得漂移', () => {
    const samples = measureContrast()
    // 判据 1：实测未达标集合 ≡ 在册集合（新增未达标 / 在册项转正，都会转红）
    const belowTier = samples
      .filter((s) => {
        const tier = WCAG_TIER_BY_PAIR.get(s.pair)
        return s.ratio !== undefined && tier !== undefined && s.ratio < tier
      })
      .map((s) => [s.pair, s.palette] as const)
      .map(([pair, palette]) => `${palette} | ${pair}`)
      .sort()
    const registered = KNOWN_BELOW_TIER.map(
      ([pair, palette]) => `${palette} | ${pair}`,
    ).sort()
    expect(belowTier).toEqual(registered)
    // 判据 2：在册项的实测比值必须与登记值一致到两位小数（数值漂移即红）
    const measured = new Map(samples.map((s) => [`${s.palette} | ${s.pair}`, s.ratio]))
    for (const [pair, palette, value] of KNOWN_BELOW_TIER) {
      expect(measured.get(`${palette} | ${pair}`), `${palette} 的 ${pair} 未实测到`).toBeDefined()
      expect(measured.get(`${palette} | ${pair}`)!).toBeCloseTo(value, 2)
    }
  })

  it('在册未达标项只有 outline-variant/surface —— M3 装饰性分隔线角色，WCAG 1.4.11 豁免', () => {
    // 显式点名在册项的语义依据：豁免只覆盖这一条，不是一张「都放行」的名单
    expect([...KNOWN_BELOW_TIER_PAIRS]).toEqual(['outline-variant on surface'])
    const outlineSamples = measureContrast().filter((s) => s.pair === 'outline on surface')
    expect(outlineSamples.length).toBe(14)
    expect(Math.min(...outlineSamples.map((s) => s.ratio ?? 0))).toBeGreaterThan(3)
  })

  it('反事实：把某色改成同色（对比度 1:1）→ 对比度判据当场转红', () => {
    expect(contrastViolations(measureContrast())).toEqual([])
    // .theme-pink.dark 的 on-surface 改成与 surface 同值（= 1:1，教科书最坏情况）
    const broken = TOKENS_CSS.replace(
      '  --md-on-surface: #efdfe1;\n',
      '  --md-on-surface: #191113;\n',
    )
    expect(broken).not.toBe(TOKENS_CSS)
    const violations = contrastViolations(measureContrast(broken))
    expect(violations.join('\n')).toContain('.theme-pink.dark')
    expect(violations.join('\n')).toContain('on-surface on surface')
    expect(contrastViolations(measureContrast(TOKENS_CSS))).toEqual([])
  })

  it('反事实：新增一个未达标项（未登记）→ 阈值判据与登记表判据同时转红', () => {
    expect(contrastViolations(measureContrast())).toEqual([])
    // .theme-violet 的 on-primary 改成与 primary 同值（#65558f）⇒ 1:1，远低于 4.5 档
    const broken = TOKENS_CSS.replace(
      '  --md-primary: #65558f;\n  --md-on-primary: #ffffff;\n',
      '  --md-primary: #65558f;\n  --md-on-primary: #65558f;\n',
    )
    expect(broken, '改动没落到 tokens.css 上，反事实无效').not.toBe(TOKENS_CSS)
    // 判据 A：阈值判据红，且指得出是哪块哪一组
    const violations = contrastViolations(measureContrast(broken))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('.theme-violet')
    expect(violations[0]).toContain('on-primary on primary')
    // 判据 B：登记表判据也红 —— 未达标集合多出一项未登记的，强制重新决策而不是默默放过
    const belowTier = measureContrast(broken)
      .filter((s) => (s.ratio ?? 21) < (WCAG_TIER_BY_PAIR.get(s.pair) ?? 21))
      .map((s) => `${s.palette} | ${s.pair}`)
    expect(belowTier).toContain('.theme-violet | on-primary on primary')
    expect(KNOWN_BELOW_TIER.map(([p, pal]) => `${pal} | ${p}`)).not.toContain(
      '.theme-violet | on-primary on primary',
    )
  })

  it('反事实：在册项数值漂移 → 登记表判据转红（阈值不许被悄悄调低）', () => {
    // 前提自证：真实取值下在册项确实是 1.26（登记值与实测同源校验，不是随手写的数）
    const real = measureContrast().find(
      (s) => s.palette === '.theme-bili' && s.pair === 'outline-variant on surface',
    )!
    expect(real.ratio).toBeCloseTo(1.26, 2)

    // 把在册的 bili 亮色 outline-variant 改成与 surface 同色 ⇒ 实测塌到 1.00
    const broken = TOKENS_CSS.replace(
      '  --md-outline-variant: #e3e5e7;\n',
      '  --md-outline-variant: #ffffff;\n',
    )
    expect(broken, '改动没落到 tokens.css 上，反事实无效').not.toBe(TOKENS_CSS)
    const drifted = measureContrast(broken).find(
      (s) => s.palette === '.theme-bili' && s.pair === 'outline-variant on surface',
    )!
    expect(drifted.ratio).toBeCloseTo(1, 2)
    // 登记值 1.26 与实测 1.00 对不上 ⇒ 「判据 2：在册实测值不得漂移」这条断言会转红
    expect(drifted.ratio).not.toBeCloseTo(1.26, 2)
  })
})
