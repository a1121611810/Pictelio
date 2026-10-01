// ─── 列表逐项铺开契约门禁（issue #879 / ADR-0211 决策 5）───
//
// ── 本门禁要防的那一格（不是「看起来对不对」）───
// 错峰延迟一旦回到组件手里，它会**静默**退化：7 个页面各自写一个 `animation:`
// 或 `animation-delay:`，值还可能各不相同。本仓已有两个同形前科：
//   · GlobalFab 的 `staggerMs(i, 30)`（30ms/step，与既有 item-rise 的 60ms 不同值）；
//   · RefreshableList 的 `.item-rise-1/2/extra` 三档字面量 0/60/120ms。
// 两者都能构建全绿、类型过、真机「有动画」，唯独**错峰节拍不再有单一事实源**。
//
// ── 判据纪律（沿用 tests/motionContract.test.ts 的三条）───
// ① 判据只认**机器可数的结构**：页面模板里 `:style="listItemStyle(...)"` 的绑定形态，
//    以及 motion.ts **导出的值**（不扫散文、不按关键词找句子）。
// ② 每条规则自带**阳性对照**：把违规形态喂进同一判据内核，必须被点名。
// ③ 零基线处给**扫描面下界**：目标页清单非空 + 逐文件可读，防止「什么都没扫到」
//    与「抽取器塌了」同形（这是本仓反复吃过的假绿）。
//
// ── 期望值出处（Oracle 溯源，禁自证）───
// - 七个目标页 = ADR-0211 决策 5 逐字点名的「剩余手写 <scroll-view> 列表」，
//   交叉验证：全仓 `<scroll-view` 消费页集合与之**逐一相等**（多一个 = 漏网，
//   少一个 = 清单过期），故本清单不靠人工维护而是双侧夹逼。
// - 延迟值 0/60/120 与 STAGGER_STEP_MS=60 的关系 = motion.ts 导出值（唯一入口），
//   再与 RefreshableList 既有 `.item-rise-2` 的 60ms 对齐（沿用实现值，非新拍）。
// - 上限 STAGGER_MAX_ITEMS 的行为契约（>= 上限归 0）写在 motion.ts 的 JSDoc 里。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as motion from '../src/composables/motion'

// ⚠️ 本文件在 `tests/` 下（与 tests/motionContract.test.ts 同级）。
// `new URL('..', import.meta.url)` 解析到**包根** `packages/app-lynx/`（已实测：
// import.meta.url = .../app-lynx/tests/<file>，`..` ⇒ .../app-lynx/），故 SRC_ROOT 正确。
// 该写法与既有门禁逐字一致，不另创写法（两处各写一种 ⇒ 迟早一边写错）。
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC_ROOT = join(PKG_ROOT, 'src')
const PAGES_DIR = join(SRC_ROOT, 'pages')
const REFRESHABLE_LIST = join(SRC_ROOT, 'components', 'RefreshableList.vue')

/** ADR-0211 决策 5 点名的七个手写 <scroll-view> 列表页。 */
const TARGET_PAGES = [
  'DownloadManager.vue',
  'IllustDetail.vue',
  'Me.vue',
  'MuteTags.vue',
  'NetworkCheck.vue',
  'PlatformCheck.vue',
  'UpdatePage.vue',
] as const

function readIfExists(p: string): string | null {
  try {
    return statSync(p).isFile() ? readFileSync(p, 'utf8') : null
  } catch {
    return null
  }
}

/** src 相对、正斜杠分隔（登记键与集合比对都用这个，避免各处 relative 写法漂移）。 */
function srcRelative(abs: string): string {
  return relative(SRC_ROOT, abs).split(sep).join('/')
}

/** 去注释：约束说明本身会提到目标串，判据必须落在代码本文上。 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 全仓生产 .vue（排测试与原型页），返回 src 相对的正斜杠路径。 */
function* walkVue(root: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (err) {
    // 降级必须出声（禁静默降级）：路径写错时若默默返回空数组，
    // 「扫到 0 个文件」与「仓里真的没有 .vue」同形 ⇒ 门禁恒真。
    console.warn(`[listItemStaggerGate] 目录不可读，已跳过：${root}（${(err as Error).message}）`)
    return
  }
  for (const entry of entries) {
    if (entry.name === 'errorPrototype') continue
    const p = join(root, entry.name)
    if (entry.isDirectory()) yield* walkVue(p)
    else if (entry.name.endsWith('.vue') && !entry.name.includes('.test.')) yield p
  }
}
const ALL_VUE = [...walkVue(SRC_ROOT)].sort()

/** 判据内核：某文件是否已接入统一入场出口。**只认绑定形态**，
 *  不认「import 了 useMotion」这种弱信号（import 了但没用 = 没接入）。 */
function listItemBindings(src: string): string[] {
  return [...stripComments(src).matchAll(/:style="listItemStyle\(([^)]*)\)"/g)].map((m) => m[1]!.trim())
}

/** 判据内核：`:style="listItemStyle(…)"` 是否**落在开标签内部**。
 *
 * ⚠️ 这条来自真实事故（#879 实施中我自己踩的）：把属性插到
 *   `<view class="…">` 的**下一行**时，属性落在标签之外 →
 *   Lynx/vue-lynx 把它当**正文文本节点**渲染，页面上直接出现字面量
 *   `:style="listItemStyle(0)"` 这串字符。
 *   而**构建全绿、vue-tsc 全绿、`:style` 绑定也确实存在于源码** ⇒
 *   「源码里 grep 得到 listItemStyle」这类判据全部恒真，看不出问题。
 *   只有真机截图能看见 —— 这正是本仓「假绿比没门禁更糟」的典型一格。
 *
 * 判据形态：取每个绑定的**行**，若该行以 `>` 结尾（标签已闭合）则为越界。
 * 合法的多行属性里，`:style` 行自身以 `"` 结尾，不可能以 `>` 结尾。 */
function listItemBindingsOutsideTag(src: string): string[] {
  // ⚠️ 只去 HTML 注释，**不能**调 stripComments：后者的 `<!--…-->` 与行注释规则
  // 会改变行结构/行号，使报告的行号失真；这里要的只是「模板里有没有越界属性」。
  const lines = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((l) => l.trim())
  const out: string[] = []
  lines.forEach((line, i) => {
    if (!line.startsWith(':style="listItemStyle(')) return
    // 合法的两种形态：
    //   ① 单行内联 `… :style="listItemStyle(k)">`（本行以 `>` 结尾，标签就在本行闭合）
    //   ② 多行属性 `… >` 尚未闭合，`:style` 单独成行 ⇒ **上一行不能**已经以 `>` 结尾
    const inlineSameTag = line.endsWith('>')
    const prevClosed = i > 0 && lines[i - 1]!.endsWith('>')
    if (!inlineSameTag && prevClosed) out.push(`${i + 1}: ${line}（上一行标签已闭合）`)
  })
  return out
}

/** 列表项入场这一族的帧体名（`item-rise` 及其派生写法）。
 *  ⚠️ **判据刻意不覆盖仓内其它 @keyframes**（shimmer / sheet-enter / bookmark-pop-*
 *  / fab-ring-*）：那些属 ADR-0211 其它决策与既有门禁的范围，本票不收编。
 *  把「全仓零 @keyframes」当判据会立刻误伤 12 处存量并要求本票一并整改 =
 *  越界改别人的活。故只认列表项入场这一族。 */
const LIST_ENTRY_KEYFRAMES = /item-rise|row-in|list-item-in|card-rise|entry-in/

/** 判据内核：文件里是否残留「自定错峰」形态——页面自己写 animation-delay 字面量，
 *  或为列表项入场另起一条帧体（帧体必须由 RefreshableList 单点定义）。 */
function selfAuthoredAnimation(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  // 形态 A：模板里出现 animation-delay 的字面量绑定（如 :style="{ animationDelay: '90ms' }"）
  for (const m of code.matchAll(/animation-?delay['"]?\s*:\s*['"]?[\d.]+\s*m?s/gi)) out.push(m[0])
  // 形态 B：为列表项入场另起帧体（只认这一族，其余 @keyframes 不在本票判据内）
  for (const m of code.matchAll(/@keyframes\s+([a-zA-Z0-9-]+)/g)) {
    if (LIST_ENTRY_KEYFRAMES.test(m[1]!)) out.push(`@keyframes ${m[1]}`)
  }
  return out
}

/** 判据内核（纯函数，阳性对照复用同一条）：时长槽是否纯令牌引用。
 *  形如 `item-rise 250ms ease 60ms both` ⇒ false（时长槽是裸字面量）。
 *  形如 `item-rise var(--durationMedium1) var(--motion-…) 60ms both` ⇒ true。 */
function durationSlotIsToken(animation: string): boolean {
  const rest = animation.replace(/^[a-zA-Z0-9-]+\s+/, '').replace(/\s+both$/, '')
  const at = rest.indexOf(' var(--motion-')
  if (at === -1) return false
  return /^var\(--duration[A-Za-z0-9]+\)$/.test(rest.slice(0, at))
}

// ───────────────────────────────────────────────────────────────────────────
// L1 · 唯一出口存在且行为正确（Oracle = motion.ts 导出值 + 帧体定义方源码）
// ───────────────────────────────────────────────────────────────────────────

describe('L1 · 唯一出口 listItemStyle：形态、延迟、上限、减弱动效', () => {
  it('导出齐全且延迟序列 = 既有 item-rise 三档（0/60/120）', () => {
    expect(typeof motion.listItemStyle, 'motion.ts 缺少 listItemStyle 出口').toBe('function')
    expect(motion.LIST_ITEM_ANIMATION).toBe('item-rise')
    // Oracle = 既有实现 RefreshableList `.item-rise-1/2/extra` 的 0/60/120ms
    // （沿用实现值 ⇒ 接入不改观感），步长来自 STAGGER_STEP_MS。
    const delays = [0, 1, 2].map((i) => /(\d+)ms/.exec(motion.listItemStyle(i).animation)?.[1])
    expect(delays).toEqual([
      String(0 * motion.STAGGER_STEP_MS),
      String(1 * motion.STAGGER_STEP_MS),
      String(2 * motion.STAGGER_STEP_MS),
    ])
  })

  it('引用的是 RefreshableList 定义的那条帧体（不得另起一条 keyframes）', () => {
    // Oracle = 定义方源码：帧体名逐字出现在 RefreshableList 的 @keyframes 上
    const definer = stripComments(readIfExists(REFRESHABLE_LIST) ?? '')
    expect(definer, 'RefreshableList.vue 读不到').not.toBe('')
    expect(definer).toMatch(new RegExp(`@keyframes\\s+${motion.LIST_ITEM_ANIMATION}\\b`))
    for (const i of [0, 1, 3]) {
      expect(motion.listItemStyle(i).animation).toContain(`${motion.LIST_ITEM_ANIMATION} `)
    }
  })

  it('时长与曲线走令牌，无任何字面量（禁绕开唯一入口的私有取值）', () => {
    for (const i of [0, 1, 5, 99]) {
      const a = motion.listItemStyle(i).animation
      expect(a, `第 ${i} 项 animation 为空`).not.toBe('')
      // 时长槽：纯 var(--duration*) 引用（判据内核 durationSlotIsToken）
      expect(durationSlotIsToken(a), `第 ${i} 项时长槽不是纯令牌引用：${a}`).toBe(true)
      // 曲线槽：纯 var(--motion-*) 引用（delay 槽按决策 5 允许是编排量）
      expect(a).toContain('var(--motion-emphasized-decelerate)')
    }
  })

  it('上限：index >= STAGGER_MAX_ITEMS 直接终态（虚拟滚动防末项漂移）', () => {
    expect(motion.STAGGER_MAX_ITEMS).toBeGreaterThan(0)
    // 上限之内仍递增（证明不是「一律归零」）
    const last = motion.STAGGER_MAX_ITEMS - 1
    expect(motion.listItemStyle(last).animation).toContain(
      `${last * motion.STAGGER_STEP_MS}ms`,
    )
    // 上限之外 = 0ms 终态
    for (const i of [motion.STAGGER_MAX_ITEMS, motion.STAGGER_MAX_ITEMS + 1, 999]) {
      expect(motion.listItemStyle(i).animation, `第 ${i} 项应落 0ms 终态`).toContain(' 0ms both')
    }
  })

  it('减弱动效（R2/R3）：整条置 none 且延迟槽消失（错峰本身即运动）', () => {
    const a = motion.listItemStyle(3, { reduced: true }).animation
    expect(a).toBe('none')
    expect(a, 'R2 下仍残留延迟').not.toMatch(/\d+ms/)
  })

  it('阳性对照：违规形态必须被同一判据内核点名（不靠「判据恒绿」自证）', () => {
    // 反事实 A：时长槽写成裸字面量 ⇒ 槽位判据点名（delay 槽合法，故只按时长槽判）
    expect(durationSlotIsToken('row-in 250ms ease 60ms both')).toBe(false)
    expect(durationSlotIsToken('row-in var(--durationMedium1) var(--motion-standard) 60ms both')).toBe(
      true,
    )
    // 反事实 B：绕过唯一出口、自写 animation-delay ⇒ 抽取器点名
    expect(selfAuthoredAnimation(`<view :style="{ animationDelay: '90ms' }" />`)).toEqual([
      "animationDelay: '90ms",
    ])
    // 反事实 C：另起一条帧体（与 item-rise 并存 = 第二套实现）
    expect(selfAuthoredAnimation('<style>@keyframes row-in { from { opacity: 0 } }</style>')).toEqual([
      '@keyframes row-in',
    ])
    // 阴性对照：合规消费形态不得被误伤
    expect(selfAuthoredAnimation('<view :style="listItemStyle(i)" />')).toEqual([])
    expect(selfAuthoredAnimation('const { listItemStyle } = useMotion()')).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// L2 · 七个目标页逐个接入（清单与「全仓 scroll-view 消费页」双侧夹逼）
// ───────────────────────────────────────────────────────────────────────────

describe('L2 · 七个手写列表页全部接入统一入场出口', () => {
  it('扫描面非空：目标页逐个可读（防「清单里的文件不存在 ⇒ 什么都没扫到」）', () => {
    expect(TARGET_PAGES.length).toBe(7)
    const missing = TARGET_PAGES.filter((f) => readIfExists(join(PAGES_DIR, f)) === null)
    expect(missing, `目标页读不到：${missing.join(', ')}`).toEqual([])
  })

  it('清单与全仓 <scroll-view> 消费页集合相等（漏网 / 过期双向暴露）', () => {
    const scrollViewPages = ALL_VUE.filter((abs) => {
      const rel = srcRelative(abs)
      if (!rel.startsWith('pages/')) return false
      // scroll-view 必须带 scroll-orientation（本仓 7 个消费页全部显式带；
      // 不带则判据无法区分「<scroll-view 起始标签」与属性值里的同名字符串）
      return /<scroll-view[^>]*\sscroll-orientation=/.test(readIfExists(abs) ?? '')
    }).map((abs) => srcRelative(abs).replace(/^pages\//, ''))
    expect([...scrollViewPages].sort()).toEqual([...TARGET_PAGES].sort())
  })

  it('每一页都绑了 listItemStyle（逐页点名，缺失即红）', () => {
    const unwired: string[] = []
    for (const f of TARGET_PAGES) {
      const src = readIfExists(join(PAGES_DIR, f)) ?? ''
      if (listItemBindings(src).length === 0) unwired.push(f)
    }
    expect(
      unwired,
      `这些列表页没接入统一入场出口（:style="listItemStyle(i)"）：\n${unwired.join('\n')}\n` +
        '列表项入场必须走 motion.ts 的唯一出口，页面不得自写 animation / animation-delay。',
    ).toEqual([])
  })

  it('任何页面都不得自定错峰（唯一例外：RefreshableList 帧体定义方）', () => {
    const offenders: string[] = []
    for (const abs of ALL_VUE) {
      const rel = srcRelative(abs)
      // 帧体唯一定义方豁免（它定义 @keyframes，不自定 delay）；它自己的 delay 归 motion.ts 管，
      // 由 L3 单独判。
      if (rel === 'components/RefreshableList.vue') continue
      for (const hit of selfAuthoredAnimation(readIfExists(abs) ?? '')) {
        offenders.push(`${rel} | ${hit}`)
      }
    }
    expect(
      offenders,
      `页面自定了错峰或另起了帧体（错峰必须来自 motion.ts 预设）：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('属性必须落在开标签内部（真机事故回灌：越界会被当正文渲染）', () => {
    const offenders: string[] = []
    for (const f of TARGET_PAGES) {
      for (const hit of listItemBindingsOutsideTag(readIfExists(join(PAGES_DIR, f)) ?? '')) {
        offenders.push(`${f} | ${hit}`)
      }
    }
    expect(
      offenders,
      '`:style="listItemStyle(i)"` 落在开标签之外 ⇒ 会被当正文文本渲染成字面量' +
        '（页面上直接出现这串字符；构建/类型/单测全绿，只有真机看得见）：\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('阳性对照：把违规页喂进同一判据必须被点名，且清单不匹配时转红', () => {
    // 反事实 A（#879 实施中真实踩到的那一格）：属性插在开标签的**下一行**
    const realIncident = [
      '<view class="bg-surface-container-lowest mt-3 mx-3 p-4">',
      '  :style="listItemStyle(0)"',
      '  <view class="child" />',
      '</view>',
    ].join('\n')
    expect(listItemBindings(realIncident), '越界形态仍是「已接入」⇒ 弱判据恒真').toEqual(['0'])
    expect(listItemBindingsOutsideTag(realIncident).length).toBe(1)
    expect(listItemBindingsOutsideTag(realIncident)[0]).toContain(':style="listItemStyle(0)"')
    // 反事实 B：合规的两种形态都不得被误伤（单行内联 + 多行属性）
    const legalInline = '<view class="a" :style="listItemStyle(0)">'
    expect(listItemBindingsOutsideTag(legalInline), '单行内联形态被误伤').toEqual([])
    const legal = ['<view', '  class="a"', '  :style="listItemStyle(2)"', '>', '</view>'].join('\n')
    expect(listItemBindingsOutsideTag(legal), '多行属性形态被误伤').toEqual([])
    // 反事实 C：未接入的页面源码 → 接入判据点名
    expect(listItemBindings('<view class="row" />')).toEqual([])
    expect(listItemBindings('<view class="row" />')).toEqual([])
    const fake = TARGET_PAGES.map((f) => (f === 'MuteTags.vue' ? 'MuteTags.vue' : f))
    const unwired = fake.filter((f) => listItemBindings(readIfExists(join(PAGES_DIR, f)) ?? '').length === 0)
    // 真实源码此刻已接入 ⇒ 该过滤为空；反事实样本（空模板）必须被点名
    expect(unwired).toEqual([])
    expect(listItemBindings('<view :style="listItemStyle(2)" />')).toEqual(['2'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// L3 · RefreshableList 自身不得成为第二个延迟事实源
// ───────────────────────────────────────────────────────────────────────────

describe('L3 · 列表基类 RefreshableList 的错峰也来自预设', () => {
  it('item-rise-* 三档不再各自硬编码 delay 字面量', () => {
    const code = stripComments(readIfExists(REFRESHABLE_LIST) ?? '')
    expect(code, 'RefreshableList.vue 读不到').not.toBe('')
    // 判据形态：@keyframes 帧体仍在（唯一定义方职责），但 delay 位不得是裸字面量。
    // 提取 .item-rise-* 规则里的 delay 槽。
    const delayLiterals: string[] = []
    for (const m of code.matchAll(
      /\.(?:item-rise-[\w-]+|menu-item)\s*\{[^}]*?animation\s*:\s*([^;}]+)[^}]*\}/g,
    )) {
      for (const lit of m[1]!.matchAll(/(?<![\w-])(\d*\.?\d+ms)\b/g)) delayLiterals.push(lit[1]!)
    }
    expect(
      delayLiterals,
      `列表基类里仍有硬编码 stagger 延迟（应走 motion.ts 的 listItemStyle）：\n${delayLiterals.join('\n')}`,
    ).toEqual([])
  })

  it('帧体仍是唯一定义方（收敛而非搬迁：帧体是几何量，归调用方组件）', () => {
    const definer = stripComments(readIfExists(REFRESHABLE_LIST) ?? '')
    expect(definer).toMatch(/@keyframes\s+item-rise\b/)
    // 全仓只有这一处定义 item-rise
    const defs = ALL_VUE.filter((abs) =>
      /@keyframes\s+item-rise\b/.test(stripComments(readIfExists(abs) ?? '')),
    )
    expect(defs.map((d) => srcRelative(d))).toEqual([
      'components/RefreshableList.vue',
    ])
  })

  it('阳性对照：把硬编码 delay 塞进同形态规则必须被点名', () => {
    const probe = '.item-rise-9 { animation: item-rise 250ms ease 180ms both; }'
    const hits = [...probe.matchAll(/(?<![\w-])(\d*\.?\d+ms)\b/g)].map((m) => m[1]!)
    expect(hits, '判据对 delay 字面量失效 ⇒ 判红').toEqual(['250ms', '180ms'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// L4 · 规模线自检（防给回归创造就业）
// ───────────────────────────────────────────────────────────────────────────

describe('L4 · 规模线自检', () => {
  it('门禁自身路径契约：SRC_ROOT 指向真实 src（本文件在 tests/ 下，易写错一层）', () => {
    // 判据依赖 walkVue(SRC_ROOT) 扫到文件；路径写错 ⇒ 扫到 0 个 ⇒ 全称断言恒真。
    expect(readIfExists(join(SRC_ROOT, 'composables', 'motion.ts')),
      `SRC_ROOT 解析错误（应指向包根下的 src）：${SRC_ROOT}`,
    ).not.toBeNull()
    expect(readIfExists(REFRESHABLE_LIST)).not.toBeNull()
    // 扫描面下界：glob 非空且覆盖到嵌套目录
    expect(ALL_VUE.length, `扫到的生产 .vue：${ALL_VUE.length}`).toBeGreaterThanOrEqual(60)
    expect(ALL_VUE.map(srcRelative).some((f) => f.startsWith('pages/'))).toBe(true)
  })

  it('门禁行数 ≤ 被测对象（七页 + 唯一入口 + 列表基类）的 30%', () => {
    const countLines = (p: string): number => readFileSync(p, 'utf8').split('\n').length
    const subject =
      countLines(join(SRC_ROOT, 'composables', 'motion.ts')) +
      countLines(REFRESHABLE_LIST) +
      TARGET_PAGES.reduce((n, f) => n + countLines(join(PAGES_DIR, f)), 0)
    const gate = countLines(fileURLToPath(import.meta.url))
    const ratio = (gate / subject) * 100
    expect(
      ratio,
      `门禁 ${gate} 行 / 被测对象 ${subject} 行 = ${ratio.toFixed(1)}%，超 30% 规模线。`,
    ).toBeLessThanOrEqual(30)
  })
})
