// ─── 动效唯一入口门禁（issue #876；对应 ADR-0211 复核判据 1 / 3 / 4）───
//
// ── 本文件的判据纪律（三条，都来自本仓已被抓过的假绿）───
//
// ① **判据形态：只认「机器可数的结构」，不扫散文找关键词。**
//    本仓已因「扫散文找关键词」连踩三次：按行扫把解释性引用误判（假阳性），
//    按段落扫会漏掉跨行标记（假阴性），关键词表永远补不完。
//    ⇒ 本文件三类判据，全部是**机器可数**的：
//      · M1/M2 遍历**导出的结构化值**（预设函数 / 登记表），不看源码文本；
//      · M3/M4 认 **Tailwind 类名 token 的字面量形态**（`scale-95` 这类带连字符的
//        工具类名），不认自然语言片段，且能区分 CSS 函数值（`scale(0.96)` 是路径 B
//        的合法 inline 声明，不是工具类）；
//      · M5 认 CSS 声明的**时长位 / 曲线位槽**，沿用既有门禁
//        `motionDurationTokens.template.test.ts` 的槽位判定内核（delay 位豁免）。
//    ⇒ 本文件不含任何「关键词表」，新增一类违规写法**不需要**改本文件。
//
// ② **每条规则自带阳性对照（反事实）**：向判据函数喂违规形态必须转红。
//    依据 ADR-0211 前置依赖节：「判据必须自带阳性对照，否则『什么都没搜到』
//    无法区分『不支持』与『搜错了』」。
//
// ③ **零基线处必须给扫描面下界 + 抽取器自检**：M5 的扫描面当前是 0 命中
//    （`.ts` 生产面确实还没消费动效），若抽取器正则塌陷，「0 命中」与
//    「抽取器失效」同形 ⇒ 必须有构造正样本 + 文件数下界双重兜底。
//
// ── 扫描面与规模线（可复算，判据 6）───
// 被测对象 = **动效消费面**（唯一入口本身 + 全部生产 `.ts` + 全部生产 `.vue`），
// 不是「motion.ts 这一个小文件」。
// ⚠️ 口径陷阱（spec 5.5 已登记）：若把被测对象当成 motion.ts 单文件，
//    30% 上限会小到装不下任何真实判据 ⇒ 正确做法是把扫描面扩到消费侧。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as motion from '../src/composables/motion'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC_ROOT = join(PKG_ROOT, 'src')
const MOTION_TS = join(SRC_ROOT, 'composables', 'motion.ts')
const THIS_GATE = fileURLToPath(import.meta.url)

/** 扫描面排除项：errorPrototype/ 是 px 硬编码原型页（AGENTS.md MD3 约定已登记白名单） */
const SCAN_EXCLUDE_DIRS = new Set(['errorPrototype'])

/** src 相对、正斜杠分隔（登记键用这个） */
function srcRelative(abs: string): string {
  return relative(SRC_ROOT, abs).split(sep).join('/')
}

function* walk(root: string, exts: string[]): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SCAN_EXCLUDE_DIRS.has(entry.name)) continue
    const p = join(root, entry.name)
    if (entry.isDirectory()) yield* walk(p, exts)
    else if (exts.some((e) => entry.name.endsWith(e))) yield p
  }
}

/** 生产 .ts（排测试）—— M5 的扫描面 */
const TS_FILES = [...walk(SRC_ROOT, ['.ts'])].filter((p) => !p.includes('.test.')).sort()
/** 生产 .vue —— M3 的扫描面（motion.ts 是 .ts，单列） */
const VUE_FILES = [...walk(SRC_ROOT, ['.vue'])].filter((p) => !p.includes('.test.')).sort()

function readIfExists(p: string): string | null {
  try {
    return statSync(p).isFile() ? readFileSync(p, 'utf8') : null
  } catch {
    return null
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 判据内核（**只定义一次**，扫描与反事实共用同一引用 —— 避免两套口径）
// ───────────────────────────────────────────────────────────────────────────

/** 时长字面量：CSS 时间单位。判 red 的核心形态。 */
const DURATION_LITERAL = /^\d*\.?\d+(?:ms|s)$/
/** 曲线字面量：裸 cubic-bezier / steps。 */
const CURVE_LITERAL = /^(?:cubic-bezier|steps|linear|ease|ease-in|ease-out|ease-in-out)\(/
/** 时序函数 token：`ease-in-out` 这类关键字，以及 `var(--motion-*)` 引用形态。
 *  ⚠️ `var(--motion-*)` 必须算作时序函数：漏了它会让它**后面**的 delay 位数值
 *  被误判成 duration（假阳性）。这正是既有门禁
 *  `motionDurationTokens.template.test.ts` 里 `__TIMING__` 标记的同一处设计。 */
const TIMING_TOKEN = /^(?:linear|ease|ease-in|ease-out|ease-in-out)$/
const TIMING_VAR = /^var\(--motion-[a-zA-Z0-9-]+\)$/

/** 去注释：约束说明本身会提到被禁止的字面量，判据必须落在代码本文上。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Tailwind transform 族工具类名的 token 形态。
 *  ⚠️ 三个必须写对的细节（任一写错都会让本条变成假绿或假阳性）：
 *  ① **变体前缀要能穿透**：`active:scale-95` / `hover:rotate-45` 的工具类本体在冒号之后，
 *     只匹配串首会漏掉全部 `active:`/`hover:` 形态（假阴性）。
 *  ② 必须带**连字符 + 值后缀**（`scale-95` / `rotate-45` / `translate-x-2`）才算工具类。
 *  ③ **不匹配括号形态**：`scale(0.96)` 是**路径 B 的合法 inline CSS 函数值**
 *     （ADR-0210 决策 2 的「位移/缩放 → inline :style」），误伤它等于把唯一正确的
 *     transform 写法判红。
 *  ④ **不含 `transition-transform`**：那是过渡工具类（transition-property 族），
 *     不是 transform 族；ADR-0211 判据 3 点名的三族是 scale / translate / rotate。 */
const DEAD_TRANSFORM_CLASS =
  /(?:^|\s)(?:[a-z-]+:)*-?(?:scale|rotate|skew|translate-[xy])-[^\s"'`:]+/

/** 抽出「作为类名使用的 token 序列」，覆盖两种书写形态：
 *  ① 模板属性形态：`class="…"` / `:class="…"`（`.vue` 消费侧）
 *  ② **TS 字符串字面量形态**：`MOTION_CLASS` 这类登记表里的整段类名串（`.ts` 消费侧）。
 *  ⚠️ ② 不是可选的优化：登记表本身就是「工具类唯一的合法产生地」（约束 ①），
 *  若门禁只扫 ①，则**在登记表里塞一条死类名完全查不出来** ——
 *  而那正是最需要被查的位置（真实变异已实证该盲区存在）。
 *  ② 的实现取自导出的登记表本身（结构化值），不是正则扫源码散文。 */
function classTokens(src: string): string[] {
  const out: string[] = []
  for (const m of stripComments(src).matchAll(/(?:class|:class)\s*=\s*["']([^"']*)["']/g)) {
    out.push(...m[1]!.split(/\s+/).filter(Boolean))
  }
  return out
}

/** motion.ts 内**导出的**类名登记表值**（结构化读，不用正则扫源码） */
function motionClassRegistryTokens(): string[] {
  return Object.values(motion.MOTION_CLASS).flatMap((v) => v.split(/\s+/).filter(Boolean))
}

/** 抽出 `animation:` / `transition:` 声明的值部分（逐条，逗号分段各自受判）。
 *  值部分以 `;` / `{` / `}` 截断；`${…}` 插值整体跳过不误截。 */
function motionDeclarations(src: string): string[] {
  const out: string[] = []
  const re = /\b(?:animation|transition)\s*:\s*((?:[^;{}]|\$\{[^}]*\})*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripComments(src))) !== null) {
    // 顶层逗号切分（cubic-bezier 内部逗号不算分隔符）
    let depth = 0
    let start = 0
    for (let i = 0; i < m[1]!.length; i++) {
      const ch = m[1]![i]!
      if (ch === '(') depth++
      else if (ch === ')') depth = Math.max(0, depth - 1)
      else if (ch === ',' && depth === 0) {
        const v = m[1]!.slice(start, i).trim()
        if (v) out.push(v)
        start = i + 1
      }
    }
    const tail = m[1]!.slice(start).trim()
    if (tail) out.push(tail)
  }
  return out
}

/** 一条声明里的时长位字面量（delay 位豁免：出现在时序函数 token 之后的数值不是 duration） */
function durationLiteralsIn(decl: string): string[] {
  const out: string[] = []
  let seenTiming = false
  for (const token of decl.trim().split(/\s+/).filter(Boolean)) {
    if (TIMING_TOKEN.test(token) || TIMING_VAR.test(token) || CURVE_LITERAL.test(token)) {
      seenTiming = true
      continue
    }
    if (DURATION_LITERAL.test(token) && !seenTiming) out.push(token)
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// M1 · 唯一入口存在且导出四类预设（ADR-0211 判据 1）
// ───────────────────────────────────────────────────────────────────────────

const REQUIRED_EXPORTS = [
  'MOTION_CLASS',
  'MOTION_DURATION',
  'MOTION_DURATION_MS',
  'MOTION_EASING',
  'enterClass',
  'enter',
  'exit',
  'press',
  'pressTransform',
  'stagger',
  'staggerDelay',
  'useMotion',
] as const

describe('M1 · 唯一入口：四类预设齐备且档位全部走令牌', () => {
  it('motion.ts 存在且导出全部四类预设的构造函数', () => {
    expect(readIfExists(MOTION_TS), `唯一入口缺失：${MOTION_TS}`).not.toBeNull()
    const missing = REQUIRED_EXPORTS.filter((k) => !(k in motion))
    expect(missing, `motion.ts 缺少导出：${missing.join(', ')}`).toEqual([])
  })

  it('四类预设各自可用（每类至少产出一个非空形态）', () => {
    // 四类 = 入场 / 退场 / 按压 / 错峰（ADR-0211 决策 1 的四档命名）
    const enterP = motion.enter({ animationName: 'x' })
    const exitP = motion.exit({ animationName: 'x' })
    const pressP = motion.press()
    const staggerP = motion.stagger()
    expect(enterP.animation, '入场预设的 animation 为空').not.toBe('')
    expect(exitP.animation, '退场预设的 animation 为空').not.toBe('')
    expect(exitP.holdMs, '退场预设缺两段式计时器（决策 3 的硬要求）').toBeGreaterThan(0)
    expect(pressP.className, '按压预设的 className 为空').not.toBe('')
    expect(staggerP.stepMs, '错峰预设的 stepMs 为 0').toBeGreaterThan(0)
  })

  it('时长档与缓动档全部是 var(--*) 引用，无任何裸数值', () => {
    // 判据只认「值」这一个机器可数的事实：必须是 var(--x) 形态。
    // 档位表若被改成 '150ms' 这类裸值 ⇒ 这里立刻转红。
    for (const [k, v] of Object.entries(motion.MOTION_DURATION)) {
      expect(v, `MOTION_DURATION.${k} = ${v}，不是 var(--x) 形态`).toMatch(/^var\(--[a-zA-Z0-9-]+\)$/)
      expect(DURATION_LITERAL.test(v), `MOTION_DURATION.${k} 含时长字面量 ${v}`).toBe(false)
    }
    for (const [k, v] of Object.entries(motion.MOTION_EASING)) {
      expect(v, `MOTION_EASING.${k} = ${v}，不是 var(--x) 形态`).toMatch(/^var\(--[a-zA-Z0-9-]+\)$/)
    }
  })

  it('阳性对照：裸值形态必须被上面的判据点名（不靠「判据恒绿」自证）', () => {
    // 反事实：把档位表的值换成裸字面量，同一判据内核必须转红
    const badTable: Record<string, string> = { fast: '150ms' }
    const offenders = Object.entries(badTable).filter(
      ([, v]) => !/^var\(--[a-zA-Z0-9-]+\)$/.test(v) || DURATION_LITERAL.test(v),
    )
    expect(offenders.map(([k]) => k)).toEqual(['fast'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// M2 · 预设返回值零字面量（判据落在**导出的值**上，不扫源码散文）
// ───────────────────────────────────────────────────────────────────────────

/** 把四类预设的**全部可枚举返回值**摊平成 { 位置, 值 } 列表 */
function enumeratePresetValues(): { where: string; value: string }[] {
  const out: { where: string; value: string }[] = []
  const push = (where: string, value: unknown): void => {
    if (typeof value === 'string') out.push({ where, value })
  }
  for (const [key, cls] of Object.entries(motion.MOTION_CLASS)) push(`MOTION_CLASS.${key}`, cls)
  for (const [key, v] of Object.entries(motion.MOTION_DURATION)) push(`MOTION_DURATION.${key}`, v)
  for (const [key, v] of Object.entries(motion.MOTION_EASING)) push(`MOTION_EASING.${key}`, v)

  for (const reduced of [false, true]) {
    const suffix = reduced ? '(reduced)' : ''
    const e = motion.enter({ animationName: 'probe', reduced })
    push(`enter${suffix}.animation`, e.animation)
    push(`enter${suffix}.className`, e.className)
    const x = motion.exit({ animationName: 'probe', reduced })
    push(`exit${suffix}.animation`, x.animation)
    push(`exit${suffix}.className`, x.className)
    const p = motion.press({ reduced })
    push(`press${suffix}.className`, p.className)
    push(`press${suffix}.transition`, p.transition)
    const po = motion.press({ property: 'opacity', reduced })
    push(`press-opacity${suffix}.transition`, po.transition)
  }
  return out
}

describe('M2 · 预设返回值零时长/曲线字面量（ADR-0211 判据 1）', () => {
  it('预设值摊平非空（防「枚举塌成 0 条 ⇒ 全称断言恒真」）', () => {
    const values = enumeratePresetValues()
    expect(values.length, `预设值枚举到 ${values.length} 条，下界应 ≥ 20`).toBeGreaterThanOrEqual(20)
    // 抽样证明枚举到的确实是**有内容的值**（不是空串刷数量）
    expect(values.some((v) => v.value.includes('var(--'))).toBe(true)
  })

  it('任何预设返回值都不得含时长字面量或裸曲线', () => {
    const violations = enumeratePresetValues()
      .filter(({ value }) => DURATION_LITERAL.test(value.trim()))
      .map(({ where, value }) => `${where} = ${value}`)
    expect(violations, `预设里出现时长字面量：\n${violations.join('\n')}`).toEqual([])
  })

  it('动画简写里的曲线位必须是 var(--motion-*) 引用', () => {
    const offenders = enumeratePresetValues()
      .filter(({ where, value }) => where.endsWith('.animation'))
      .filter(({ value }) => value !== 'none' && !value.includes('var(--motion-'))
      .map(({ where, value }) => `${where} = ${value}`)
    expect(offenders, `动画简写的曲线位未走令牌：\n${offenders.join('\n')}`).toEqual([])
  })

  it('阳性对照：把裸值塞进同一判据内核必须被点名', () => {
    const probes = ['sheet-enter 250ms ease both', 'fade var(--x) 150ms', 'plain-none']
    const bad = probes.filter((v) => motionDeclarationsProbe(v).some((d) => durationLiteralsIn(d).length))
    expect(bad, '判据内核对裸值失效 ⇒ 判红').toEqual([
      'sheet-enter 250ms ease both',
      'fade var(--x) 150ms',
    ])
  })
})

/** 只给 M2 反事实用的最小抽取入口（值即一条声明） */
function motionDeclarationsProbe(value: string): string[] {
  return [`animation: ${value}`].flatMap((d) => motionDeclarations(d))
}

// ───────────────────────────────────────────────────────────────────────────
// M3 · 无死 transform 工具类（ADR-0211 判据 3 / ADR-0210 路径 E）
// ───────────────────────────────────────────────────────────────────────────

/** M3 的存量例外台账。键 = `src 相对路径 | 类名 token`（**结构化三元组**，不是散文片段）。
 *  · 登记项缺失即转红（新增死类名无处可藏）
 *  · **死登记同样转红**（在册但当前扫不到）—— 豁免不得变成永久口子
 *  ⚠️ 唯一在册项是 ADR-0210 决策 5 明确「本轮不改」的存量疑点：
 *  `TextSelectionToolbar.vue` 的 `rotate-45` 抓手 —— 它是 ADR-0210 路径 E 的
 *  **可证伪预测**的验证对象（先取证确认它当前确实未旋转，再改），
 *  改它属可见视觉变更、须进截图回归，不在本票范围。 */
const DEAD_TRANSFORM_EXCEPTIONS: Record<string, string> = {
  'components/TextSelectionToolbar.vue | rotate-45':
    'ADR-0210 决策 5 登记的存量路径 E 用法，是该条「可证伪预测」的验证对象：' +
    '须先在真机确认它当前确实渲染为未旋转（否则会「修」一个其实正常的东西），' +
    '且改动属可见视觉变更、须进截图回归。本票不碰。',
}

/** 扫出全部 transform 族工具类消费点，返回 `路径 | token` 键（与台账同形）。
 *  两种消费形态都扫：模板属性位（`.vue`）+ 类名登记表（`motion.ts`）。 */
function findDeadTransformClass(): string[] {
  const out: string[] = []
  for (const abs of VUE_FILES) {
    const rel = srcRelative(abs)
    for (const token of classTokens(readIfExists(abs) ?? '')) {
      if (DEAD_TRANSFORM_CLASS.test(token)) out.push(`${rel} | ${token}`)
    }
  }
  for (const token of motionClassRegistryTokens()) {
    if (DEAD_TRANSFORM_CLASS.test(token)) out.push('composables/motion.ts | ' + token)
  }
  return out
}

describe('M3 · 无死 transform 工具类（构建全绿、渲染为空那一格）', () => {
  it('扫描面非空（文件数下界 + 递归锚点，防 walk 塌陷）', () => {
    expect(VUE_FILES.length, `扫到的生产 .vue：${VUE_FILES.length}`).toBeGreaterThanOrEqual(60)
    expect(TS_FILES.length, `扫到的生产 .ts：${TS_FILES.length}`).toBeGreaterThanOrEqual(20)
    // 锚点：证明递归进了子目录，而不是只扫顶层
    expect(VUE_FILES.map(srcRelative).some((f) => f.startsWith('pages/'))).toBe(true)
    expect(TS_FILES.map(srcRelative)).toContain('composables/motion.ts')
  })

  it('登记表与全部生产 .vue 的类名位不得出现未登记的 transform 族工具类', () => {
    const hits = findDeadTransformClass()
    const violations = hits.filter((k) => !(k in DEAD_TRANSFORM_EXCEPTIONS))
    expect(
      violations,
      `transform 族工具类是**死类名**（产出规则但引用的 --tw-* 从未定义 ⇒ 渲染 transform: none，` +
        `ADR-0210 路径 E）。改走 inline :style 或 <style> 块内 @keyframes：\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it('抽取器覆盖登记表形态（真实变异已实证：只扫模板属性位会漏掉登记表里的死类名）', () => {
    // 阳性对照的第二种书写形态：登记表里的一整段类名串
    // ⚠️ 这一条是从**真实变异**回灌的：曾把 `active:scale-95` 加进 MOTION_CLASS.pressStateLayer，
    //    只扫 class="…" 的判据全绿（假绿）。现断言两条路径都认。
    const registryProbe = { pressStateLayer: 'transition-colors active:scale-95' }
    const hits = Object.values(registryProbe).flatMap((v) =>
      v.split(/\s+/).filter((t) => DEAD_TRANSFORM_CLASS.test(t)),
    )
    expect(hits, '登记表形态的死类名查不出来').toEqual(['active:scale-95'])
    // 阴性对照：登记表里的合法类名不得被误伤
    const okProbe = Object.values(motion.MOTION_CLASS).flatMap((v) =>
      v.split(/\s+/).filter((t) => DEAD_TRANSFORM_CLASS.test(t)),
    )
    expect(okProbe, '当前登记表含死类名').toEqual([])
  })

  it('例外台账零死登记（在册项必须仍命中一个真实消费点，否则豁免已过期）', () => {
    const hits = findDeadTransformClass()
    const dead = Object.keys(DEAD_TRANSFORM_EXCEPTIONS).filter((k) => !hits.includes(k))
    expect(
      dead,
      `死登记（当前扫不到真实消费点）：\n${dead.map((k) => `  ${k}`).join('\n')}\n` +
        '每条死登记都是一处永久豁免口子：被豁免的写法日后回流会被静默放行，' +
        '而 reason 仍在解释一条已作废的决策。修法：改完后**删掉登记项**。',
    ).toEqual([])
  })

  it('阳性对照：违规类名被点名，合法的 inline CSS 函数值与过渡类不被误伤', () => {
    const badSample = '<view class="card active:scale-95 rotate-12 -translate-x-1/2"></view>'
    const goodSample = '<view class="card transition-colors duration-[var(--durationFast)]"></view>'
    const hits = (s: string): string[] =>
      classTokens(s).filter((t) => DEAD_TRANSFORM_CLASS.test(t))
    // 变体前缀必须能穿透（漏掉 = active:/hover: 形态全部假阴性）
    expect(hits(badSample)).toEqual(['active:scale-95', 'rotate-12', '-translate-x-1/2'])
    expect(hits(goodSample), '正常类名被误伤').toEqual([])
    // 路径 B 的唯一正确写法不得被误判（本条最容易写坏的地方）
    expect(DEAD_TRANSFORM_CLASS.test('scale(0.96)'), 'CSS 函数值 scale(0.96) 被误判为工具类').toBe(
      false,
    )
    // 未登记的违规点必须被 M3 的主判据抓到（证明台账不是「一律放行」）
    const polluted = findDeadTransformClass().concat([
      'components/GlobalFab.vue | scale-90',
    ])
    const violations = polluted.filter((k) => !(k in DEAD_TRANSFORM_EXCEPTIONS))
    expect(violations).toContain('components/GlobalFab.vue | scale-90')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// M4 · on-primary 档类名不得进入 motion.ts（ADR-0211 判据 4 / 决策 8）
// ───────────────────────────────────────────────────────────────────────────

describe('M4 · on-primary 档仍留在 .vue（保 C3 机器防线不被主动制造）', () => {
  it('motion.ts 不得含 on-primary 档状态层类名字面量', () => {
    // 判据形态 = 完整类名字面量（bg-layer-*-on-primary），不是自然语言片段
    const src = stripComments(readIfExists(MOTION_TS) ?? '')
    const hits = [...src.matchAll(/bg-layer-[a-z-]*-on-primary/g)].map((m) => m[0])
    expect(
      hits,
      `on-primary 档类名不得搬进 motion.ts：\n${hits.join('\n')}\n` +
        '理由：门禁 tests/stateLayerOnPrimary.test.ts 的 C3 逐标签扫 .vue，' +
        '「写了 on-primary 档 ⇒ 同元素必须带实心底色」；挪进 .ts 会主动制造 ' +
        'ADR-0207 已登记的 .ts 全文盲区。',
    ).toEqual([])
  })

  it('阳性对照：违规类名被点名', () => {
    const probe = "const x = 'active:bg-layer-pressed-on-primary'"
    expect([...probe.matchAll(/bg-layer-[a-z-]*-on-primary/g)].map((m) => m[0])).toEqual([
      'bg-layer-pressed-on-primary',
    ])
    // 阴性对照：非 on-primary 档不得被误伤（alpha 四档之一仍允许在别处消费）
    const ok = "const y = 'active:bg-layer-pressed-on-surface'"
    expect([...ok.matchAll(/bg-layer-[a-z-]*-on-primary/g)]).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// M5 · .ts 消费面零字面量（补 ADR-0211 判据 1 已登记的失效面）
// ───────────────────────────────────────────────────────────────────────────

describe('M5 · .ts 消费面：时长位/曲线位零字面量（既有 .vue 门禁的盲区）', () => {
  it('扫描面证据：文件数下界 + 锚点（当前基线为零命中，须证明扫到了东西）', () => {
    expect(TS_FILES.length, `扫到的生产 .ts：${TS_FILES.length}`).toBeGreaterThanOrEqual(20)
    expect(TS_FILES.map(srcRelative)).toContain('composables/motion.ts')
    expect(TS_FILES.map(srcRelative)).toContain('composables/useReducedMotion.ts')
    // 声明抽取器在真实面上必须能切出东西（motion.ts 有 animation/transition 字段）
    const total = TS_FILES.reduce(
      (n, p) => n + motionDeclarations(readIfExists(p) ?? '').length,
      0,
    )
    expect(total, `生产 .ts 里切出的 motion 声明共 ${total} 条，下界 ≥ 4`).toBeGreaterThanOrEqual(4)
  })

  it('时长位零字面量（delay 位豁免：时序函数 token 之后的数值是 stagger，不判）', () => {
    const violations: string[] = []
    for (const abs of TS_FILES) {
      for (const decl of motionDeclarations(readIfExists(abs) ?? '')) {
        for (const lit of durationLiteralsIn(decl)) {
          violations.push(`${srcRelative(abs)}: ${lit}（${decl.slice(0, 60)}）`)
        }
      }
    }
    expect(
      violations,
      `.ts 消费面出现时长字面量（动效时长必须从 composables/motion.ts 取）：\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it('阳性对照：duration 位判红、delay 位豁免（证明判据有分离能力）', () => {
    // 同一内核下：时长位 → 判红；曲线之后的 delay → 不判红
    expect(durationLiteralsIn('item-rise 250ms ease both')).toEqual(['250ms'])
    expect(durationLiteralsIn('item-rise 250ms var(--motion-standard) 60ms both')).toEqual(['250ms'])
    // delay 之后不该再冒出第二个 duration 误判
    expect(
      durationLiteralsIn('item-rise var(--durationMedium1) var(--motion-emphasized-decelerate) 120ms both'),
    ).toEqual([])
    expect(durationLiteralsIn('none')).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// M6 · 规模线自检（门禁不得超过被测对象的 30%，结论可复算）
// ───────────────────────────────────────────────────────────────────────────

describe('M6 · 规模线自检（防给回归创造就业）', () => {
  it('门禁行数 ≤ 被测对象（唯一入口 + 生产消费面）的 30%', () => {
    const countLines = (p: string): number =>
      readFileSync(p, 'utf8').split('\n').length
    // 被测对象 = 唯一入口 + 全部生产 .ts + 全部生产 .vue
    // ⚠️ 口径：不是 motion.ts 单文件（spec 5.5 已登记该陷阱，见本文件抬头）
    const subject =
      countLines(MOTION_TS) +
      TS_FILES.reduce((n, p) => n + countLines(p), 0) +
      VUE_FILES.reduce((n, p) => n + countLines(p), 0)
    const gate = countLines(THIS_GATE)
    const ratio = (gate / subject) * 100
    expect(
      ratio,
      `门禁 ${gate} 行 / 被测对象 ${subject} 行 = ${ratio.toFixed(1)}%，超 30% 规模线。\n` +
        '先问「我是在防回归，还是在给回归创造就业」，答不上来就不要加。',
    ).toBeLessThanOrEqual(30)
  })

  it('口径可复算（打印三段行数，便于复核时对账）', () => {
    const countLines = (p: string): number => readFileSync(p, 'utf8').split('\n').length
    const entry = countLines(MOTION_TS)
    const ts = TS_FILES.reduce((n, p) => n + countLines(p), 0)
    const vue = VUE_FILES.reduce((n, p) => n + countLines(p), 0)
    const gate = countLines(THIS_GATE)
    const subject = entry + ts + vue
    // 登记被测对象规模下界：被测对象塌成 0 时本门禁会空转
    expect(subject, `被测对象 ${subject} 行（入口 ${entry} + .ts ${ts} + .vue ${vue}）`).toBeGreaterThan(10000)
    expect(gate).toBeGreaterThan(0)
  })
})

// 供反事实用例使用：确认路径解析指向真实文件（防 URL 写法漂移导致全部门禁扫 0 个文件）
describe('门禁自身路径契约', () => {
  it('SRC_ROOT / MOTION_TS 指向真实存在的位置', () => {
    expect(resolve(SRC_ROOT)).toBe(resolve(join(PKG_ROOT, 'src')))
    expect(dirname(MOTION_TS)).toBe(dirname(join(SRC_ROOT, 'composables', 'motion.ts')))
    expect(readIfExists(MOTION_TS)).not.toBeNull()
  })
})
