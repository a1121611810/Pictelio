// ─── Tailwind 构建产物契约（issue #849 / T01：MD3 整改的共同验证接缝）───
//
// 接缝本体在 `tests/helpers/md3TailwindArtifact.ts`（加载真实 tailwind.config.ts
// → Tailwind postcss 插件 → CSS 产物 → postcss AST 提声明）。
//
// 本文件只做三件事：
//   ① 证明**抽取器自身有效**（非空 + 数量下界 + 跨 API 交叉校验 + 未登记档位取不到规则）
//   ② 对**当前**配置给出若干条真实断言（不写死「当前值」，只判结构与单位纪律）
//   ③ 内置**反事实自检**：用局部覆盖把某档位拆掉，证明断言验的是产物而不是文本
//
// 为什么不复用 `tests/unit.test.ts` 的文本接缝：那条用
// `split('fontSize: {')[1].split('\n  }')[0]` 切源码，注释自述「重构时若调整键序/缩进
// 需同步此解析，否则会静默误测」。本轮 T05~T09 改的正是被切的那一段 ⇒ 文本接缝与被测
// 改动同生共死。产物接缝对配置写法免疫。
//
// 期望值纪律（对应验收标准「不得硬编码当前错误值」）：
//   - 单位纪律来自**项目既有硬约定**（`tailwind.config.ts` 自述「全配置禁止 rem」——
//     web-core 预览下 rem 布局不可靠；`glossary-lynx-units.md`：spacing=vw / fontSize=rpx）
//   - 档位名清单来自 **ADR-0206 决策 1 / ADR-0207 决策 1**（结构承诺，非当前值）
//   - 颜色 utility 里的 `var(--md-*)` 交叉核对 **`src/styles/tokens.css`**（独立 oracle）
//   - 一律不写 `font-size: 32rpx` / `border-radius: 0.375rem` 这类当前值：T05~T09 会合法地
//     改对它们，写死当前值会让接缝从护栏退化成阻塞
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  buildTailwindArtifact,
  classSelector,
  declarationsForClass,
  projectTailwindConfig,
  ruleForSelector,
  totalDeclarationCount,
  tryDeclarationsForClass,
  unitsOf,
} from './helpers/md3TailwindArtifact'

const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)),
  'utf8',
)

/** ADR-0206 决策 1：15 档里当前**已登记**的 12 档语义名（档位名不变，存量类零改动） */
const MD3_TYPE_TIERS = [
  'label-small',
  'label-medium',
  'body-small',
  'label-large',
  'body-medium',
  'title-small',
  'body-large',
  'title-medium',
  'title-large',
  'headline-small',
  'headline-medium',
  'headline-large',
] as const

/** ADR-0206 决策 4：旧别名兼容层（保留，未来逐步下线 ⇒ 只对「取到的那部分」判单位） */
const LEGACY_TYPE_ALIASES = [
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
] as const

/** ADR-0207 决策 1：注册进 borderRadius 的 6 档（DEFAULT 以裸 `rounded` 表达） */
const MD3_SHAPE_CLASSES = [
  'rounded',
  'rounded-sm',
  'rounded-lg',
  'rounded-xl',
  'rounded-full',
] as const

/** 字号档位名 → utility 类名（档位名不含 `text-` 前缀） */
const textClass = (tier: string): string => `text-${tier}`

/**
 * 「必须存在于产物」的类名白名单。
 * 刻意**不含** `rounded-md` / `rounded-3xl` / `text-display-*` / `rounded-t`：
 * 前两者在 T05 改 borderRadius 后会消失、display 三档在 T07 才会出现、方向类在
 * ADR-0207 决策 2 里要改走带尺寸的写法 —— 把它们列为「必须存在」就是给后续票埋雷。
 */
const MUST_EXIST_CLASSES: readonly string[] = [
  ...MD3_TYPE_TIERS.map(textClass),
  ...MD3_SHAPE_CLASSES,
  'p-4',
  'bg-primary',
  'bg-surface-container-high',
  'transition',
  'transition-all',
]

/** 变体类：选择器带 `:` / 伪类后缀，只能走「按选择器取」那条 API */
const VARIANT_SELECTORS = [
  { name: 'hover:bg-primary', selector: '.hover\\:bg-primary:hover' },
  { name: 'active:bg-primary', selector: '.active\\:bg-primary:active' },
] as const

/**
 * 刻意**永不**会出现在配置里的档位名。
 * 不拿「T07 才补的 display 三档」当反例 —— 那是拿未来合法改动当反例，会让接缝反过来
 * 阻塞整改；反例必须是自己造的、任何票都不会去注册的形态。
 */
const NEVER_REGISTERED_CLASSES: readonly string[] = [
  'text-m3-tier-that-was-never-registered',
  'rounded-m3-shape-that-was-never-registered',
  'p-m3-step-that-was-never-registered',
]

/** 探针全量：白名单 + 旧别名 + 变体 + 反例档位 */
const PROBE_CLASSES: readonly string[] = [
  ...MUST_EXIST_CLASSES,
  ...LEGACY_TYPE_ALIASES.map(textClass),
  ...VARIANT_SELECTORS.map((v) => v.name),
  ...NEVER_REGISTERED_CLASSES,
]

/** 一次构建、全文件复用（内容扫描是本接缝唯一耗时项，重复跑没有额外信息量） */
const artifactPromise = buildTailwindArtifact(PROBE_CLASSES)

/** 项目单位约定：rpx 数值（22rpx / 32rpx / 1.5rpx 都算） */
const RPX_VALUE = /^[\d.]+rpx$/
/** 项目单位约定：vw 数值（spacing 档位） */
const VW_VALUE = /^[\d.]+vw$/

describe('Tailwind 构建产物接缝自身有效（#849 T01）', () => {
  it('产物非空且规则数、声明条数都有数量下界（防空转恒真）', async () => {
    const artifact = await artifactPromise
    expect(artifact.css.length).toBeGreaterThan(0)
    // 下界按 MUST_EXIST 推导并留余量：任一档位被删、被改名、或 content 扫描器空转，这里先红
    expect(artifact.ruleCount).toBeGreaterThanOrEqual(MUST_EXIST_CLASSES.length)
    expect(totalDeclarationCount(artifact)).toBeGreaterThanOrEqual(MUST_EXIST_CLASSES.length)
    // 产物必须真的含探针类名生成的选择器，证明「扫到了内容」而不是空壳 CSS
    for (const className of ['text-body-large', 'rounded-full', 'p-4']) {
      expect(artifact.css).toContain(classSelector(className))
    }
  })

  it('白名单里每个类名都能取到非空声明块（任一档位消失即红）', async () => {
    const artifact = await artifactPromise
    let declarationTotal = 0
    for (const className of MUST_EXIST_CLASSES) {
      const declarations = declarationsForClass(artifact, className)
      expect(Object.keys(declarations).length, `${className} 取到空声明块`).toBeGreaterThan(0)
      declarationTotal += Object.keys(declarations).length
    }
    expect(declarationTotal).toBeGreaterThanOrEqual(MUST_EXIST_CLASSES.length)
  })

  it('按选择器取与按 class 名取对同一规则结果一致（两条 API 互为交叉校验）', async () => {
    const artifact = await artifactPromise
    const byClass = declarationsForClass(artifact, 'text-body-large')
    const bySelector = ruleForSelector(artifact, classSelector('text-body-large'))
    expect(bySelector).toBeDefined()
    expect(bySelector).toEqual(byClass)
    // 变体类：选择器带 `:` 伪类后缀，只能走按选择器取（顺带证明 class 名转义没把 `:` 吃掉）
    for (const variant of VARIANT_SELECTORS) {
      expect(ruleForSelector(artifact, variant.selector), `${variant.name} 选择器取不到`).toBeDefined()
    }
  })

  it('否定断言：从未登记的档位名在产物里取不到规则（抽取器不臆造匹配）', async () => {
    const artifact = await artifactPromise
    for (const className of NEVER_REGISTERED_CLASSES) {
      expect(tryDeclarationsForClass(artifact, className), `${className} 不该有规则`).toBeUndefined()
    }
  })

  it('否定断言：非排版档位的产物里不会凭空长出 line-height（选择器不串味）', async () => {
    const artifact = await artifactPromise
    // 这就是 T07 落地后要翻转的那条判据的**同款形状**（`not.toHaveProperty('line-height')`），
    // 但探针刻意选 spacing / 颜色档位：T07 只会让 `text-*` 带上 line-height，不会让
    // `padding` 带上。若抽取器退化成「找到任意规则就返回」，本条会先于 T07 转红。
    expect(declarationsForClass(artifact, 'p-4')).not.toHaveProperty('line-height')
    expect(declarationsForClass(artifact, 'bg-primary')).not.toHaveProperty('line-height')
  })
})

describe('Tailwind 产物 · 排版档位（#849 T01）', () => {
  it('12 档 MD3 语义字号全部产出 rpx font-size（全称，缺一档即红）', async () => {
    const artifact = await artifactPromise
    for (const tier of MD3_TYPE_TIERS) {
      const declarations = declarationsForClass(artifact, textClass(tier))
      expect(declarations, `${textClass(tier)} 没有 font-size 声明`).toHaveProperty('font-size')
      // 只判单位形态、不判具体数值：T07 会给这 12 档补 line-height/letterSpacing，
      // 但 size 的单位约定（rpx）不变 —— 写死 32rpx 这类当前值才是给未来埋雷
      expect(declarations['font-size'], `text-${tier} 的 font-size 不符合 rpx 约定`)
        .toMatch(RPX_VALUE)
    }
  })

  it('否定断言：任何被产出的 text-* 档位都不得使用 rem（web-core 预览禁 rem）', async () => {
    const artifact = await artifactPromise
    const probed = [...MD3_TYPE_TIERS, ...LEGACY_TYPE_ALIASES]
    const violations: string[] = []
    for (const tier of probed) {
      const className = textClass(tier)
      const declarations = tryDeclarationsForClass(artifact, className)
      // 旧别名是「存量兼容层、逐步下线」，取不到就跳过；取到的必须守单位纪律
      if (!declarations) continue
      for (const [prop, value] of Object.entries(declarations)) {
        if (unitsOf(value).includes('rem')) violations.push(`${className} { ${prop}: ${value} }`)
      }
    }
    expect(violations).toEqual([])
    // 否定断言的否定：被检查的集合本身不能是空的，否则全称断言空转恒真
    expect(MD3_TYPE_TIERS.length + LEGACY_TYPE_ALIASES.length).toBeGreaterThanOrEqual(20)
  })
})

describe('Tailwind 产物 · 形状与空间档位（#849 T01）', () => {
  it('5 档形状 utility 全部产出 border-radius 声明（结构存在；值归 T05 判）', async () => {
    const artifact = await artifactPromise
    for (const className of MD3_SHAPE_CLASSES) {
      // 只判「有没有 border-radius」：ADR-0207 决策 1 会把这 5 档从 Tailwind 默认 rem
      // 改指 var(--md-shape-*)，结构不变 ⇒ 这条在 T05 前后都应绿；T05 只需在此基础上
      // 追加「值必须是 --md-shape-* 令牌」的收紧断言，不必重建接缝
      expect(declarationsForClass(artifact, className), `${className} 无 border-radius 声明`)
        .toHaveProperty('border-radius')
    }
  })

  it('间距 utility 产出 vw 形态的 padding（否定：不得回退到 rem）', async () => {
    const artifact = await artifactPromise
    const padding = declarationsForClass(artifact, 'p-4')['padding']
    expect(padding).toBeDefined()
    expect(padding).toMatch(VW_VALUE)
    expect(unitsOf(padding)).not.toContain('rem')
  })

  it('颜色 utility 产出的 var(--md-*) 全部在 tokens.css 有定义（跨接缝交叉核对）', async () => {
    const artifact = await artifactPromise
    const referenced = new Set<string>()
    for (const className of ['bg-primary', 'bg-surface-container-high']) {
      for (const value of Object.values(declarationsForClass(artifact, className))) {
        for (const m of value.matchAll(/var\((--md-[a-z0-9-]+)\)/g)) referenced.add(m[1]!)
      }
    }
    // 抽取器有效性：跨接缝抽出来的令牌集合不能是空的
    expect(referenced.size).toBeGreaterThanOrEqual(2)
    // Oracle = tokens.css（ADR-0205 决策「tokens.css 是 M3 变量单一事实源」），不是配置文本
    const undefinedTokens = [...referenced].filter((token) => !TOKENS_CSS.includes(`${token}:`))
    expect(undefinedTokens).toEqual([])
  })
})

describe('反事实自检（#849 T01 验收：证明接缝验的是产物）', () => {
  it('把 fontSize 的一档拆掉后，该档位在产物里消失且断言转红（改回即恢复）', async () => {
    const real = projectTailwindConfig()
    // 局部覆盖，不动磁盘上的 tailwind.config.ts：这条是**常驻**的反事实，
    // 任何人对 fontSize 的误改（拆档、写错单位、把语义档删掉）都会先在生产配置上
    // 撞上前面两条断言，再在这里撞上「产物与配置必须一一对应」的反向检查
    const broken = await buildTailwindArtifact(MD3_TYPE_TIERS.map(textClass), {
      theme: { ...real.theme, fontSize: { 'label-small': '22rpx' } },
    })

    // 前提自证：完整配置下 12 档齐备（证明下面的「消失」确实是拆档造成的，不是本来就缺）
    const intact = await artifactPromise
    for (const tier of MD3_TYPE_TIERS) {
      expect(intact.rules.has(classSelector(textClass(tier))), `基线缺 ${textClass(tier)}`).toBe(
        true,
      )
    }

    expect(tryDeclarationsForClass(broken, 'text-body-large')).toBeUndefined()
    expect(tryDeclarationsForClass(broken, 'text-label-small')).toBeDefined()
    expect(broken.ruleCount).toBeLessThan(intact.ruleCount)
  })

  it('把某档位的单位改坏后，产物值不再匹配 rpx 约定（断言当场转红）', async () => {
    const real = projectTailwindConfig()
    const broken = await buildTailwindArtifact(['text-body-large'], {
      theme: { ...real.theme, fontSize: { 'body-large': '1.5rem' } },
    })
    const fontSize = declarationsForClass(broken, 'text-body-large')['font-size']
    // 这条断言在真实配置上成立、在拆坏的配置上转红 ⇒ 证明「rpx 纪律」验的是产物不是文本
    expect(fontSize).not.toMatch(RPX_VALUE)
    expect(unitsOf(fontSize)).toContain('rem')
    const intact = await artifactPromise
    expect(declarationsForClass(intact, 'text-body-large')['font-size']).toMatch(RPX_VALUE)
  })
})
