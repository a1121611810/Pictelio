// ─── 按压反馈的过渡载体契约（issue #877；契约见 ADR-0211 决策 2 / 决策 8）───
//
// 本门禁守的是**载体覆盖了哪些属性**，不是「有没有 transition」——这是 ADR-0211 决策 2 的原话：
// 把 `transition-colors` 挂到透明度变化上属于**静默失效**（构建全绿、类型过、单测过、
// 真机仍是 0ms 瞬变），因为 `.transition-colors` 的 transition-property 只有
// `background-color, border-color, color`。
//
// ── 判据形态：属性覆盖（property coverage），不是「挂了哪个载体」───
//
// 早先版本判的是「颜色元素挂了 pressColor.className / 透明度元素挂了 inline」，
// 那个形态**在本仓有一个真实反例**：`Ranking.vue` 的模式 chip 选中态走颜色层、未选中态走
// `active:opacity-80`，两条分支落在同一元素上；它只挂一条 inline（`modeChipTransition`），
// 而那条 inline 里**同时**含 background-color 与 opacity —— 载体齐全却被判红。
// ⇒ 判据改成：**元素实际过渡的属性集合 ⊇ 其 active: 形态要求过渡的属性集合**。
// 这既覆盖了「挂两个载体」，也覆盖了「一条 inline 覆盖两个属性」，且不会对载体形态本身设卡。
//
// ── 为什么不用「扫散文找关键词」───
//
// 本轮已有三个门禁因形态脆弱返工（按行扫会因注释换行误红、按段落扫会漏跨行标记、
// 关键词表永远补不完）。故本文件的判据吃**三条结构化输入**：
//   ① 元素形态：`<标签 …>` 的**属性级**解析（引号感知），只认属性值里的类名 token，
//      且剥掉注释 —— 判据面对的是「这个元素有哪些 active: 形态」这一结构事实；
//   ② 载体能力：**Tailwind 构建产物**里 `.transition-colors` 的真实 transition-property
//      （复用 tests/helpers/md3TailwindArtifact.ts，真实 config + postcss AST）；
//      「工具类覆盖哪些属性」不是本文写死的清单，而是从产物读的；
//   ③ 预设语义：**motion.ts 导出的结构化值**（`press({property})` 的返回值 / `MOTION_CLASS`
//      的字面量），inline 载体的属性由它推出，不重抄。
//
// ── Oracle 纪律（禁自证 / 禁把当前值抄成期望）───
//   · 工具类覆盖哪些属性 → Tailwind 产物实测；
//   · inline 载体覆盖哪些属性 → `press({property:'X'}).transition` 的**首 token**（导出值，非本文清单）；
//   · 「哪些形态属状态层」→ 按**类名 token 形态**判定（`bg-` / `opacity-` / `w-` / `h-` / `shadow-`），
//     不维护「文件名 → 期望类名」的关键词表：新增消费点自动入判，不需要改判据。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as motion from '../src/composables/motion'
import { buildTailwindArtifact, ruleForSelector, type TailwindArtifact } from './helpers/md3TailwindArtifact'

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url))
const THIS_GATE = fileURLToPath(import.meta.url)

/** 打真实 Tailwind 构建的耗时看门狗（同 stateLayerOnPrimary.test.ts 的 REAL_SRC_TIMEOUT_MS 量级） */
const ARTIFACT_TIMEOUT_MS = 30_000

function* walkVue(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name)
    if (entry.isDirectory()) yield* walkVue(p)
    else if (entry.name.endsWith('.vue')) yield p
  }
}

/** src 相对、正斜杠分隔（与仓内其余门禁同口径） */
function srcRelative(abs: string): string {
  return relative(SRC_ROOT, abs).split(sep).join('/')
}

const VUE_FILES = [...walkVue(SRC_ROOT)].sort()

/** 去注释：约束说明本身会提到被禁止的类名，判据必须落在代码本文上。
 *  三类注释都要剥（模板 / 块 / 行），缺一类就留下误伤口（同 stateLayerOnPrimary C3 的教训）。 */
const stripComments = (s: string): string =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

// ═══════════════════════ ① 形态：认类名 token 形态，不认关键词表 ═══════════════════════

/**
 * `active:` 变体 token → 它改动的 CSS 属性。
 * 返回 null = 不是需要过渡的状态层形态（阴影档见 ADR 决策 2「不引入过渡」；其余工具类）。
 * ⚠️ `active:bg-white/10` 归 background-color：它改的仍是 background-color，载体判定同构
 *   （ADR-0211 决策 10 单列处置 —— 本门禁只判载体，不改它的口径）。
 */
function propertyOfToken(token: string): string | null {
  const m = /^active:(bg-|opacity-|w-|h-|shadow-)/.exec(token)
  if (!m) return null
  switch (m[1]) {
    case 'bg-':
      return 'background-color'
    case 'opacity-':
      return 'opacity'
    case 'w-':
      return 'width'
    case 'h-':
      return 'height'
    default:
      // shadow-：ADR-0211 决策 2 明确「不引入过渡」，故不要求任何属性被过渡
      return null
  }
}

// ═══════════════════════ ② / ③ 载体能力：产物实测 + motion.ts 导出值 ═══════════════════════

/**
 * `.transition-colors` 真实覆盖的属性集合。
 * ⚠️ **这是本门禁的核心 oracle，且必须来自产物**：决策 2 的映射表是依据「产物实测」写的，
 *  若哪天 preset 改了 transition-property，本判据会**自动**跟随，而不是按一份陈旧手抄清单判红。
 */
function transitionColorsProperties(artifact: TailwindArtifact): Set<string> {
  const rule = ruleForSelector(artifact, '.transition-colors')
  expect(rule, '`.transition-colors` 在真实产物里零规则 —— 载体前提失效，本门禁会全体空转').toBeDefined()
  const value = rule!['transition-property'] ?? ''
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

/** 产物探针：工具类 + 时长/曲线值类，确保三者都进产物（否则下面的判据会误判「没挂」） */
let artifactPromise: Promise<TailwindArtifact> | null = null
function artifact(): Promise<TailwindArtifact> {
  artifactPromise ??= buildTailwindArtifact([
    motion.MOTION_CLASS.pressStateLayer,
    'transition-colors',
    'duration-[var(--durationFast)]',
    'ease-[var(--motion-standard)]',
  ])
  return artifactPromise
}

/**
 * `press({property:'X'})` 的 transition 值覆盖的属性 = **首 token**（导出值，不是本文清单）。
 * ⚠️ 走 motion.ts 的导出函数而非硬编码映射：档位表改了这里自动跟随。
 */
function pressProperty(property: string): string {
  return motion.press({ property: property as 'opacity' | 'width' | 'height' }).transition.split(/\s+/)[0]!
}

/** motion.ts 暴露给模板的三个按压预设 → 它们各自覆盖的属性集合 */
function presetProperties(preset: 'pressColor' | 'pressOpacity' | 'pressSize', tw: TailwindArtifact): Set<string> {
  switch (preset) {
    case 'pressColor':
      // 颜色预设绑的是工具类，覆盖面 = 产物里 `.transition-colors` 的 transition-property
      return transitionColorsProperties(tw)
    case 'pressOpacity':
      return new Set([pressProperty('opacity')])
    case 'pressSize':
      return new Set([pressProperty('width')])
  }
}

// ═══════════════════════ 元素解析：属性级、引号感知 ═══════════════════════

interface Element {
  /** src 相对路径（报错用） */
  readonly file: string
  /** 行号（1 基） */
  readonly line: number
  /** 标签原文 */
  readonly tag: string
  /** 该元素上的全部类名 token（静态 class + :class + v-bind:class 的属性值内） */
  readonly tokens: readonly string[]
  /** 该元素 inline :style 绑定的**标识符名**（`:style="foo"` / `:style="{ transition: foo }"`） */
  readonly inlineBindings: readonly string[]
}

const ATTR_RE = /(?<![\w-])(?:class|:class|v-bind:class)\s*=\s*(["'])([\s\S]*?)\1/g
const STYLE_RE = /(?<![\w-])(?::style|v-bind:style)\s*=\s*(["'])([\s\S]*?)\1/g

/**
 * 从一个 class 属性值里抽类名 token。
 *
 * ⚠️ **不能直接 `value.split(/\s+/)`** —— 这是本门禁第一版的真实缺陷（由阳性对照抓到）：
 *  数组/三元形态的绑定里每个类名都被单引号包着且带尾逗号，
 * `:class="[a, disabled ? 'opacity-50' : 'active:opacity-70', b]"` 直接切出的是
 * `'active:opacity-70',` —— **首字符是引号**，于是 `^active:` 永远不命中，
 *  整档形态从扫描面上静默消失、门禁恒绿（假绿，且恰好发生在本票新写的绑定形态上）。
 * ⇒ 判据先抽**引号内的字符串字面量**再切词；无引号的形态（`class="a b"`）由外层双引号
 *   本身就是一个字面量，同样覆盖。
 */
function classTokensOf(value: string): string[] {
  const literals: string[] = []
  for (const m of value.matchAll(/'([^']*)'|"([^"]*)"/g)) literals.push(m[1] ?? m[2] ?? '')
  // 两条分支都要留：内层有引号（数组 / 三元）⇒ 取字面量；内层无引号（最朴素的
  // `class="a b c"`，外层那对引号已被属性正则吃掉）⇒ 直接切词。
  // 只做前者会让静态 class 形态整个扫不到；只做后者就是上面记的那个假绿。
  if (literals.length === 0) return value.split(/\s+/).filter(Boolean)
  return literals.flatMap((l) => l.split(/\s+/).filter(Boolean))
}

/**
 * 抽出一个标签的类名 token 与 inline style 绑定。
 * ⚠️ **必须引号感知**：属性值里出现 `>` 或空格是常态
 * （`:class="a > b ? 'x' : 'y'"`），`[^>]*` 会在中途截断，把 class 所在处切掉
 * （真实绕过面见 stateLayerOnPrimary.test.ts C3 的注释）。
 */
function parseElement(file: string, line: number, tag: string): Element {
  const tokens: string[] = []
  for (const m of tag.matchAll(ATTR_RE)) tokens.push(...classTokensOf(m[2]!))
  const inlineBindings: string[] = []
  for (const m of tag.matchAll(STYLE_RE)) {
    // 取值里出现的标识符：`{ transition: modeChipTransition }` → modeChipTransition
    for (const id of m[2]!.matchAll(/[A-Za-z_$][\w$]*/g)) inlineBindings.push(id[0])
  }
  return { file, line, tag, tokens, inlineBindings }
}

/** 逐文件抽「带 active: 变体」的元素（剥注释后再解析，避免注释里的示例标签进扫描面） */
function elementsOf(absFile: string): Element[] {
  const src = stripComments(readFileSync(absFile, 'utf8'))
  const file = srcRelative(absFile)
  const out: Element[] = []
  for (const m of src.matchAll(/<[A-Za-z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const parsed = parseElement(file, src.slice(0, m.index).split('\n').length, m[0])
    if (parsed.tokens.some((t) => t.startsWith('active:'))) out.push(parsed)
  }
  return out
}

const ALL_ELEMENTS: readonly Element[] = VUE_FILES.flatMap(elementsOf)

/** 元素要求被过渡的属性集合（不含阴影档——ADR 决策 2「不引入过渡」） */
function requiredProperties(el: Element): Set<string> {
  const out = new Set<string>()
  for (const t of el.tokens) {
    const p = propertyOfToken(t)
    if (p) out.add(p)
  }
  return out
}

// ═══════════════════════ 本文件内局部标识符 → 它引用了哪些按压预设 ═══════════════════════

/**
 * 解析一个 .vue 的 `<script setup>`，得出「局部 const → 它引用到的预设集合」。
 *
 * 为什么需要这一层：模板里 `:style="{ transition: modeChipTransition }"` 只有一个标识符，
 * 它覆盖哪些属性写在 script 的 computed 里。要判「inline 载体覆盖了哪些属性」，
 * 就必须从标识符追到它的定义 —— 否则只能看到「挂了 inline」这一事实（回退到载体形态判定，
 * 也就是上面记的那个对混合元素判红的形态）。
 *
 * 判据吃的是**结构**：`const <name> = computed(...)` 的定义体里出现了哪个 `pressXxx` 成员访问 /
 * `press({property:'X'})` 调用。不扫散文、不维护「标识符 → 属性」表（新增 computed 自动入判）。
 */
function presetRefsOf(script: string, name: string): Set<string> {
  // 取 `const <name> = …` 到下一个顶层 `const` / `function` / `</script>` 之前的定义体
  const start = script.search(new RegExp(`\\bconst\\s+${name}\\s*=`))
  if (start < 0) return new Set()
  const rest = script.slice(start)
  const end = rest.slice(1).search(/\n(?:const|let|function|async function|\/\*\*|\/\/)/)
  const body = end > 0 ? rest.slice(0, end + 1) : rest
  const refs = new Set<string>()
  for (const m of body.matchAll(/\bpress(Color|Opacity|Size)\b/g)) refs.add(`press${m[1]}`)
  // `press({ property: 'height' })` 这类直接调用：按实参取属性
  for (const m of body.matchAll(/\bpress\(\s*\{[^}]*property:\s*'([a-z-]+)'/g)) {
    refs.add(`property:${m[1]}`)
  }
  return refs
}

/** 元素的 inline 载体最终覆盖哪些属性（沿标识符追到 script 定义） */
function inlinePropertiesOf(el: Element, script: string, tw: TailwindArtifact): Set<string> {
  const out = new Set<string>()
  for (const id of el.inlineBindings) {
    // 直接内联形态：`:style="{ transition: pressOpacity.transition }"` → 成员访问里已含预设名
    for (const m of el.tag.matchAll(/\bpress(Color|Opacity|Size)\b/g)) {
      for (const p of presetProperties(`press${m[1]}` as 'pressColor', tw)) out.add(p)
    }
    for (const m of el.tag.matchAll(/\bpress\(\s*\{[^}]*property:\s*'([a-z-]+)'/g)) {
      out.add(pressProperty(m[1]!))
    }
    // 标识符形态：追进 script
    for (const ref of presetRefsOf(script, id)) {
      if (ref.startsWith('property:')) out.add(pressProperty(ref.slice('property:'.length)))
      else for (const p of presetProperties(ref as 'pressColor', tw)) out.add(p)
    }
  }
  return out
}

/** 元素的工具类载体覆盖哪些属性（`:class` 里的 `pressColor.className` ⇒ 颜色预设） */
function classPropertiesOf(el: Element, tw: TailwindArtifact): Set<string> {
  const out = new Set<string>()
  for (const m of el.tag.matchAll(/\bpress(Color|Opacity|Size)\b(?!\s*:)/g)) {
    for (const p of presetProperties(`press${m[1]}` as 'pressColor', tw)) out.add(p)
  }
  return out
}

/** 一个元素实际会被过渡的属性集合（工具类 ∪ inline） */
function coveredProperties(el: Element, script: string, tw: TailwindArtifact): Set<string> {
  return new Set([...classPropertiesOf(el, tw), ...inlinePropertiesOf(el, script, tw)])
}

const SCRIPT_OF = new Map<string, string>(
  VUE_FILES.map((p) => [srcRelative(p), stripComments(readFileSync(p, 'utf8'))]),
)

/**
 * 判据内核（A 段与 C 段阳性对照**共用同一份**——绝不允许在自检里另写一份「等价的」判据，
 * 那样自检保护的是空气；同 stateLayerOnPrimary C6 的教训）。返回违规说明，空数组 = 通过。
 */
function judge(el: Element, script: string, tw: TailwindArtifact): string[] {
  const required = requiredProperties(el)
  if (required.size === 0) return []
  const covered = coveredProperties(el, script, tw)
  return [...required].filter((p) => !covered.has(p)).map((p) => `未过渡属性：${p}`)
}

// ═══════════════════════ A · 载体正确性（核心判据） ═══════════════════════

describe('A · 按压反馈的载体覆盖其形态（ADR-0211 决策 2）', () => {
  it('A1 扫描面证据：确实扫到了带 active: 的元素（逐属性下界，防抽取器失效）', async () => {
    expect(VUE_FILES.length, `扫到的 .vue：${VUE_FILES.length}`).toBeGreaterThanOrEqual(50)
    const withActive = ALL_ELEMENTS.filter((e) => requiredProperties(e).size > 0)
    expect(
      withActive.length,
      `带 active: 状态层形态的元素数：${withActive.length}`,
    ).toBeGreaterThanOrEqual(30)

    const counts = new Map<string, number>()
    for (const e of withActive) {
      for (const p of requiredProperties(e)) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    // 三种属性各有非空下界：任一为 0 说明该形态的抽取器失效（而不是「该形态已清零」）
    for (const p of ['background-color', 'opacity', 'width', 'height']) {
      expect(counts.get(p) ?? 0, `要求过渡 ${p} 的元素数：${counts.get(p) ?? 0}`).toBeGreaterThanOrEqual(1)
    }
    expect((await artifact()).ruleCount).toBeGreaterThan(0)
  }, ARTIFACT_TIMEOUT_MS)

  it('A2 每个 active: 状态层元素的载体都覆盖了它要求过渡的全部属性', async () => {
    const tw = await artifact()
    const violations: string[] = []
    for (const el of ALL_ELEMENTS) {
      const script = SCRIPT_OF.get(el.file) ?? ''
      for (const msg of judge(el, script, tw)) {
        // ⚠️ requiredProperties 返回 Set —— Set 没有 .join，直接调用会 TypeError
        // 把「元素确实有违规」这条信息吞成异常，掩盖真正的违规列表。
        // 这里是本判据**唯一的**违规输出通道，必须能打印形态。
        violations.push(
          `${el.file}:${el.line} ${msg}（形态：${[...requiredProperties(el)].join(',')}）`,
        )
      }
    }
    expect(violations, `载体未覆盖形态（挂错载体 = 静默失效那一格）：\n${violations.join('\n')}`).toEqual([])
  }, ARTIFACT_TIMEOUT_MS)

  it('A3 前提被推翻时判据会自己叫停（而不是继续按旧前提判红/判绿）', async () => {
    // 把「为什么颜色档可以用工具类、透明度档必须 inline」钉在**产物**上：
    // 引擎若哪天真的让 `.transition-colors` 覆盖了 opacity / width / height，
    // A2 的结论就要重新评估——本条让这个变化以「前提失效」的形式显式暴露，而不是被静默吸收。
    const props = transitionColorsProperties(await artifact())
    expect(
      props.has('background-color'),
      `前提失效：.transition-colors 不覆盖 background-color（实际：${[...props].join(',')}）—— ` +
        '颜色档的工具类载体依据不成立，ADR-0211 决策 2 映射表需重估',
    ).toBe(true)
    for (const absent of ['opacity', 'width', 'height', 'box-shadow']) {
      expect(
        props.has(absent),
        `前提被推翻：.transition-colors 现在覆盖了 ${absent} —— ` +
          '「透明度/尺寸必须 inline」的结论需重新评估，而不是继续按旧前提判红',
      ).toBe(false)
    }
  }, ARTIFACT_TIMEOUT_MS)

  it('A4 阴影档不引入过渡（box-shadow 无可用工具类，颜色反馈由同元素的状态层承担）', async () => {
    // ADR 决策 2 明确「不引入过渡」：`.transition-colors` 与 `.transition` 均不含 box-shadow，
    // 而 `transition-shadow` 在产物里 0 条（未验证 ⇒ 不押注）。
    const violations: string[] = []
    for (const el of ALL_ELEMENTS) {
      // 过渡声明里出现 box-shadow 即判红（不许写 `transition: box-shadow …`）
      if (/(?:^|[;"'\s])transition\s*:[^;"']*box-shadow/.test(el.tag)) {
        violations.push(`${el.file}:${el.line} 给阴影档引入了 box-shadow 过渡（ADR 决策 2：不引入）`)
      }
    }
    expect(violations, `阴影档被误加过渡：\n${violations.join('\n')}`).toEqual([])
  })
})

// ═══════════════════════ B · 实色档口径归正（ADR-0211 决策 8） ═══════════════════════

describe('B · 实色档口径归正（ADR-0211 决策 8 / 复核判据 5）', () => {
  it('B1 `active:bg-state-pressed-*` 的 .vue 侧消费归零（零消费即通过）', () => {
    // 判**消费面（类名）**，不判定义面（`--md-state-pressed-*` 令牌）：
    // 令牌族按 ADR 决策 11 **保留**为「能力储备」，`tailwind.config.ts` 仍以 4 条 `var()` 引用它们。
    const offenders = ALL_ELEMENTS.filter((e) => e.tokens.some((t) => /^active:bg-state-pressed-/.test(t)))
    expect(
      offenders.map((e) => `${e.file}:${e.line}`),
      '实色档消费未归零（应迁至 alpha 正路 active:bg-layer-pressed-*）',
    ).toEqual([])
  })

  it('B2 归正后的按压类名全部落在 alpha 正路上（不存在第三种口径）', () => {
    // 反向自查：若有人把按压写成别的形状（如 `active:bg-[var(--md-state-pressed-*)]`），这里会点到。
    const offenders = ALL_ELEMENTS.filter((e) =>
      e.tokens.some((t) => /^active:bg-\[/.test(t) && /state-pressed|state-layer/.test(t)),
    )
    expect(
      offenders.map((e) => `${e.file}:${e.line}`),
      '出现第三种按压口径（内联 var() 形态），应走 bg-layer-* 工具类',
    ).toEqual([])
  })
})

// ═══════════════════════ C · 阳性对照（证明判据有分离能力） ═══════════════════════

describe('C · 阳性对照：载体写错必须判红（证明 A 段不是恒绿）', () => {
  const tw = buildSyncArtifact()

  /** 与 A 段同一个 judge() —— 不是另写一份等价判据 */
  const check = (tag: string): string[] => {
    const el = parseElement('synthetic.vue', 1, tag)
    return judge(el, '', tw)
  }

  it('C1 正确载体 ⇒ 通过（颜色挂工具类、透明度挂 inline、尺寸挂 inline）', () => {
    expect(check('<view class="active:bg-layer-pressed-primary" :class="pressColor.className" />')).toEqual([])
    expect(
      check('<view class="active:opacity-80" :style="{ transition: pressOpacity.transition }" />'),
    ).toEqual([])
    expect(
      check('<view class="active:w-[7.467vw]" :style="{ transition: pressSize.transition }" />'),
    ).toEqual([])
  })

  it('C2 颜色档漏挂工具类 ⇒ 判红', () => {
    expect(check('<view class="active:bg-layer-pressed-primary" />')).toEqual([
      '未过渡属性：background-color',
    ])
  })

  it('C3 透明度档漏挂 inline ⇒ 判红（**挂工具类不算数**——那正是静默失效那一格）', () => {
    // 本门禁存在的理由：把 transition-colors 挂到 opacity 上，看起来「处理过了」，
    // 实际 transition-property 不含 opacity，真机仍是 0ms 闪变。
    expect(
      check(
        '<view class="active:opacity-80 transition-colors duration-[var(--durationFast)] ease-[var(--motion-standard)]" />',
      ),
    ).toEqual(['未过渡属性：opacity'])
  })

  it('C4 尺寸档只过渡一个轴 ⇒ 判红（active:w- 与 active:h- 是两个独立属性）', () => {
    expect(
      check('<view class="active:w-[7.467vw] active:h-[7.467vw]" :style="{ transition: pressSize.transition }" />'),
    ).toEqual(['未过渡属性：height'])
    // 两个轴都覆盖（走 motion.ts 的两个 press 预设拼接，与 M3Switch.thumbTransition 同构）⇒ 通过。
    // ⚠️ 这里刻意**不**写裸属性名当期望：判据认的是「引用了哪个预设」，裸 `width, height …`
    //   绕开了唯一入口，正是本门禁要防的形态之一。
    expect(
      check(
        '<view class="active:w-[7.467vw] active:h-[7.467vw]" :style="{ transition: pressSize.transition, press({ property: \'height\' }).transition }" />',
      ),
    ).toEqual([])
  })

  it('C5 混形态只覆盖一半 ⇒ 判红（另一半仍是闪变）', () => {
    // 真实形态（Ranking.vue 模式 chip）：颜色 + 透明度同元素。
    expect(
      check('<view class="active:bg-layer-pressed-on-primary active:opacity-80" :class="pressColor.className" />'),
    ).toEqual(['未过渡属性：opacity'])
    expect(
      check('<view class="active:bg-layer-pressed-on-primary active:opacity-80" :style="{ transition: pressOpacity.transition }" />'),
    ).toEqual(['未过渡属性：background-color'])
    // 一条 inline 同时覆盖两者 ⇒ 通过（这正是 Ranking.vue 的实际形态）
    expect(
      check(
        '<view class="active:bg-layer-pressed-on-primary active:opacity-80" :style="{ transition: pressColor.transition, pressOpacity.transition }" />',
      ),
    ).toEqual([])
  })

  it('C6 抽取器对真实形态有分离能力（propertyOfToken 认 token 形态，不是关键词表）', () => {
    expect(propertyOfToken('active:bg-layer-pressed-primary')).toBe('background-color')
    expect(propertyOfToken('active:bg-white/10')).toBe('background-color')
    expect(propertyOfToken('active:opacity-80')).toBe('opacity')
    expect(propertyOfToken('active:w-[7.467vw]')).toBe('width')
    expect(propertyOfToken('active:h-[7.467vw]')).toBe('height')
    // 阴影档：ADR 决策 2「不引入过渡」⇒ 不要求任何属性
    expect(propertyOfToken('active:shadow-[var(--md-elevation-1)]')).toBeNull()
    // 非 active: 变体 / 非状态层工具类 → null（不会被误判成需要载体）
    expect(propertyOfToken('bg-layer-pressed-primary')).toBeNull()
    expect(propertyOfToken('active:scale-95')).toBeNull()
  })

  it('C7 注释里的示例标签不进扫描面（元素属性级判定 + 剥注释）', () => {
    // 判据读标签属性值，模板注释在 parseElement 之前已被剥掉 ⇒ 注释里的「正确写法」不影响判定。
    const src = stripComments(
      '<template>\n' +
        '  <!-- <view class="active:bg-layer-pressed-primary" :class="pressColor.className" /> -->\n' +
        '  <view class="active:bg-layer-pressed-primary" />\n' +
        '</template>',
    )
    const els = [...src.matchAll(/<[A-Za-z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)]
      .map((m) => parseElement('synthetic.vue', 1, m[0]))
      .filter((e) => e.tokens.some((t) => t.startsWith('active:')))
    expect(els, '注释里的示例标签进了扫描面').toHaveLength(1)
    expect(judge(els[0]!, '', tw)).toEqual(['未过渡属性：background-color'])
  })

  it('C8 标识符追溯有分离能力（script 里的局部 computed 决定 inline 覆盖哪些属性）', () => {
    const script = [
      "const { pressColor, pressOpacity } = useMotion()",
      'const modeChipTransition = computed(() =>',
      '  motionReduced.value ? "none" : `${pressColor.value.transition}, ${pressOpacity.value.transition}`,',
      ')',
      'const colorOnlyTransition = computed(() => pressColor.value.transition)',
    ].join('\n')
    const both = parseElement(
      'synthetic.vue',
      1,
      '<view class="active:bg-layer-pressed-on-primary active:opacity-80" :style="{ transition: modeChipTransition }" />',
    )
    expect(judge(both, script, tw)).toEqual([])
    const half = parseElement(
      'synthetic.vue',
      1,
      '<view class="active:bg-layer-pressed-on-primary active:opacity-80" :style="{ transition: colorOnlyTransition }" />',
    )
    expect(judge(half, script, tw)).toEqual(['未过渡属性：opacity'])
  })
})

/** C 段是同步用例（不跑真实 Tailwind 构建）；这里用**产物接缝的声明值**代替，
 *  与 A 段共用同一个 `transitionColorsProperties` 读取路径，只是喂给它一份已知 artifact。
 *  ⚠️ 之所以能这样：`.transition-colors` 的 transition-property 是**引擎事实**，
 *  A3 已用真实产物独立确认过它不含 opacity/width/height；
 *  C 段要验的是「判据内核的分离能力」，不需要再打一次构建。 */
function buildSyncArtifact(): TailwindArtifact {
  const rule = ruleForSelector(SYNC_ARTIFACT_PLACEHOLDER, '.transition-colors')
  return { ...SYNC_ARTIFACT_PLACEHOLDER, rules: new Map([['.transition-colors', rule ?? {}]]) }
}
/** C 段的同步 artifact：`transition-property` 取自 Tailwind `transition-colors` 的既定值
 *  （与 A3 的真实产物断言同一事实；ADR-0211 前置依赖表已把这条记为「已验证」）。 */
const SYNC_ARTIFACT_PLACEHOLDER: TailwindArtifact = {
  css: '',
  ruleCount: 1,
  probedClasses: ['transition-colors'],
  rules: new Map([
    [
      '.transition-colors',
      {
        'transition-property': 'background-color, border-color, color',
        'transition-duration': '150ms, 150ms, 150ms',
        'transition-timing-function': 'var(--motion-emphasized), var(--motion-emphasized), var(--motion-emphasized)',
      },
    ],
  ]),
}

// ═══════════════════════ D · 规模线自检（防给回归创造就业） ═══════════════════════

describe('D · 规模线自检', () => {
  it('D1 门禁行数 ≤ 被测对象（状态层消费面所在的生产 .vue）的 30%', () => {
    const countLines = (p: string): number => readFileSync(p, 'utf8').split('\n').length
    const subject = VUE_FILES.reduce((n, p) => n + countLines(p), 0)
    const gate = countLines(THIS_GATE)
    const ratio = (gate / subject) * 100
    expect(
      ratio,
      `门禁 ${gate} 行 / 被测对象 ${subject} 行 = ${ratio.toFixed(1)}%，超 30% 规模线。\n` +
        '先问「我是在防回归，还是在给回归创造就业」，答不上来就不要加。',
    ).toBeLessThanOrEqual(30)
    expect(subject, `被测对象 ${subject} 行（下界防扫描面塌成 0 ⇒ 比例恒绿）`).toBeGreaterThan(10000)
  })
})
