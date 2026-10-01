// ─── 时长令牌化门禁（#854 验收 3「散落的硬编码动画时长改为时长令牌」；本轮修判据盲区）───
//
// 扫描面：**全仓生产 .vue**（src 递归，排除 *.test.* 与 src/errorPrototype 原型页）。
// 判据：animation / transition 声明的**时长槽**必须是 tokens.css 的时长令牌；stagger 延迟按验收条件可留字面量。
//
// 期望值出处（Oracle 溯源，禁自证）：
// - 替换清单 = 差距报告 §2 #14 逐字点名（`RefreshableList.vue:246` 硬编码 200ms、`:264-271`
//   硬编码 250ms + 60/120ms stagger；`App.vue:161`、`GlobalFab.vue:152` 亦有硬编码），
//   报告同时给出目标令牌：`var(--durationNormal)` / `var(--durationMedium1)`；
// - 令牌取值不写死在测试里：当场解析 tokens.css 的 `--duration*` 定义，并与「替换前的字面量」
//   比对，从而**自证「替换不改观感」**：令牌值必须等于被换掉的字面量，否则这次替换是行为变更。
// - `stagger 延迟`（0/60/120ms、GlobalFab 的 30ms/step）无 M3 官方值（#854 验收 3 明确可留），
//   故按「时序里位于 timing function 之后」从判据里排除。
//
// ── 本轮修的两处判据盲区（两者都曾让「时长槽零字面量」这条全称断言恒真）───
// ① **扫描面只覆盖 3 个文件**（旧 SOURCES 硬编码 RefreshableList / GlobalFab / App），
//    其余 70+ 组件的 animation/transition 声明根本不在判据内。⇒ 改为 src 递归全量，
//    并新增「扫描面下界」（文件数下界 + 点名嵌套目录的锚点）防「walk 静默塌成 0」。
// ② **var() 回退实参被整段摘掉**（旧正则 `var\(...\)` → 空格）。回退实参是变量**未定义时真正生效的值**，
//    整段抹掉 ⇒ `animation: var(--shimmer-motion, shimmer 1.5s linear infinite)` 里的
//    `1.5s` 既不算违规、也不进登记表 ⇒ 对这条路径判据恒真。⇒ 改为**只摘变量名**，
//    回退内容留在声明里继续受判。旧口径在下方「反事实」用例里原样复刻作对照，
//    证明新判据确实多抓了旧判据抓不到的东西（而不是「一律更红」）。
import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relative, sep } from 'node:path'

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TOKENS_CSS = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')

/** 不进扫描面的子目录：errorPrototype/ 是 px 硬编码原型页，已登记白名单（AGENTS.md MD3 约定） */
const SCAN_EXCLUDE_DIRS = new Set(['errorPrototype'])

/** 目录列举的最小契约（可注入 ⇒ 不可读/畸形返回这些降级路径可被单测覆盖，不必真的造坏磁盘） */
interface DirEntryLike {
  name: string
  isDirectory(): boolean
}
type DirLister = (dir: string) => DirEntryLike[]
type FileReader = (path: string) => string

const defaultListDir: DirLister = (dir) => readdirSync(dir, { withFileTypes: true })

/** src 相对、正斜杠分隔的路径（登记键用这个：`App.vue` / `components/GlobalFab.vue`） */
function srcRelative(abs: string): string {
  return relative(SRC_ROOT, abs).split(sep).join('/')
}

/** 递归收集生产 .vue 的绝对路径。
 *  降级必须出声（禁静默降级）：目录读不到时若默默返回已扫部分，扫出 0 个违规与「真无违规」同形。 */
function walkVueFiles(root: string, listDir: DirLister = defaultListDir): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    let entries: DirEntryLike[]
    try {
      entries = listDir(dir)
    } catch (err) {
      console.warn(`[durationGate] 目录不可读，已跳过：${dir}（${(err as Error).message}）`)
      return
    }
    if (!Array.isArray(entries)) {
      console.warn(`[durationGate] 目录列举返回非数组，已跳过：${dir}`)
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SCAN_EXCLUDE_DIRS.has(entry.name)) visit(`${dir}/${entry.name}`)
      } else if (entry.name.endsWith('.vue') && !entry.name.includes('.test.')) {
        out.push(`${dir}/${entry.name}`)
      }
    }
  }
  visit(root)
  return out.sort()
}

/** 扫描面 = 上述路径逐个读成源码（读失败逐个跳过 + warn，不整体崩、不静默） */
function readSources(
  root: string,
  listDir: DirLister = defaultListDir,
  readFile: FileReader = (p) => readFileSync(p, 'utf8'),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const abs of walkVueFiles(root, listDir)) {
    try {
      out[srcRelative(abs)] = readFile(abs)
    } catch (err) {
      console.warn(`[durationGate] 文件不可读，已跳过：${abs}（${(err as Error).message}）`)
    }
  }
  return out
}

const SOURCES = readSources(SRC_ROOT)

/** 扫描面下界：防「walk 静默塌陷 / 正则塌陷」让全称断言恒真。
 *  ① 文件数下界——只有 3 个文件的旧扫描面在全仓 75 个生产 .vue 下必然不达标；
 *  ② 递归锚点——点名 src **子目录**里的文件，证明白名单式的「只读顶层」也过不去；
 *  ③ 声明条数总量下界——按条数（逗号分段的多值 transition 各自算一条），不是按行数。 */
const SOURCE_COUNT_LOWER_BOUND = 60
const NESTED_SCAN_ANCHORS = ['App.vue', 'components/GlobalFab.vue', 'components/RefreshableList.vue']
const NESTED_DIR_ANCHOR = /^pages\/.*\.vue$/
/** 各文件切出的声明条数下界（防正则塌陷）。按**条数**计（逗号分段的多值 transition 各自算一条）。
 *  实测：全仓 75 个生产 .vue 里只有这 5 个用 CSS / 脚本对象字面量声明 animation/transition
 *  （其余组件要么无动效，要么走 useReducedMotion 的 :style 绑定），故下界贴齐现状、不虚高。
 *  这张表同时是「文件掉出扫描面」的哨兵：某文件被删/被改名后 count 变 0 即转红。 */
const DECLARATION_LOWER_BOUND: Record<string, number> = {
  'App.vue': 1,
  'components/BookmarkButton.vue': 4,
  'components/GlassCard.vue': 1,
  'components/GlobalFab.vue': 4,
  'components/RefreshableList.vue': 6,
}
const DECLARATION_TOTAL_LOWER_BOUND = 15

/** 无 M3 令牌可映射的时长字面量 → 理由。键 = `src 相对路径 | 声明标识（类名）| 字面量`：
 *  登记项缺失即转红（新增硬编码时长无处可藏）；**多余（死）登记项同样转红**——
 *  死登记不是无害的：一旦被豁免的写法日后回流，它会静默放行，而 reason 仍在解释一条已作废的决策。 */
const LITERAL_EXCEPTIONS: Record<string, string> = {
  'App.vue | .shimmer | 1.5s':
    'var() **回退实参**里的字面量，周期与 M3 duration scale 的 1000ms 档（--durationExtraLong4）不同。' +
    '常态路径不走它：tokens.css 已定义 --shimmer-motion（= animation 简写整体，周期 1000ms），' +
    '只有令牌表缺席时才落到这条兜底（fail-open 方向由 App.vue 注释与真机实测背书）。' +
    '回退实参被 src/shimmerGate.test.ts 与 src/composables/useReducedMotion.test.ts 逐字锁死，' +
    '改周期属产品决策，故登记而非令牌化。',
}

/** 时序函数 token：出现在它**之后**的数值时间才是 delay（stagger），不是时长 */
const TIMING_TOKEN = /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(.*\))$/

/** 去注释（约束说明本身会提到被禁止的字面量，判据必须落在代码本文上） */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 按括号深度切分值部分里的顶层逗号（`cubic-bezier(.05,.7,.1,1)` 内部的逗号不算分隔符） */
function splitTopLevelCommas(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      out.push(value.slice(start, i))
      start = i + 1
    }
  }
  out.push(value.slice(start))
  return out
}

/** 抽出 `animation:` / `transition:` 声明的值部分（逐条，含脚本侧内联声明）。
 *  三种书写形态必须落在同一口径上——少认一种就是一处 fail-open：
 *  ① **单行**：`transition: all 200ms;`（最常见形态，时长是**末位** token）；
 *  ② **多行**：`transition:\n  opacity 200ms\n  ease-in-out;`（按行切会把它切成两半，
 *     时长落在没有属性名前缀的那一半，整条声明随之不可见）；
 *  ③ **多值**：`transition: color 200ms, opacity 300ms;`（逗号分段各自独立受判）。
 *  值部分以 `;` / `{` / `}` 截断：分号因此**不会**粘在末位 token 上——`200ms;` 匹配不上
 *  `/^\d*\.?\d+(ms|s)$/`，那是「末位槽漏检」的根因；`${…}` 插值整体跳过不误截。 */
const MOTION_VALUE_RE = /\b(?:animation|transition)\s*:\s*((?:[^;{}]|\$\{[^}]*\})*)/g

function motionDeclarations(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  MOTION_VALUE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MOTION_VALUE_RE.exec(code)) !== null) {
    for (const part of splitTopLevelCommas(match[1]!)) {
      const value = part.trim()
      if (value) out.push(value)
    }
  }
  return out
}

/** `var(...)` 内层第一个**顶层**逗号（回退本身可含逗号，如 `cubic-bezier(a,b,c,d)`） */
function firstTopLevelComma(inner: string): number {
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) return i
  }
  return -1
}

/** 展开单个 `var(...)` → 回退实参原文（无回退则空串）+ 结束下标；括号不配对返回 null */
function unfoldVarAt(src: string, start: number): { text: string; end: number } | null {
  let depth = 0
  for (let i = start + 'var('.length; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '(') depth++
    else if (ch === ')') {
      if (depth > 0) {
        depth--
        continue
      }
      const inner = src.slice(start + 'var('.length, i)
      const comma = firstTopLevelComma(inner)
      return { text: comma === -1 ? '' : inner.slice(comma + 1).trim(), end: i + 1 }
    }
  }
  return null
}

/** **只摘变量名、保留回退实参内容**参与判据。
 *  为什么不能整段抹掉：回退实参是变量未定义时**真正生效**的值，`var(--x, 200ms)` 里的
 *  `200ms` 就是一条真实时长。旧实现 `var\(...\)` → 空格 把它连同回退一起吃掉，
 *  于是「回退即实际值」这条路径对判据恒真（App.vue 的 `.shimmer` 1.5s 即该形态）。
 *  摘名后剩下的回退内容与无回退时的普通 token 走**同一套**时长/延迟判据，不另开特例。 */
function unfoldVars(s: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const v = s.indexOf('var(', i)
    if (v === -1) return out + s.slice(i)
    out += s.slice(i, v)
    const unfolded = unfoldVarAt(s, v)
    if (!unfolded) {
      out += 'var(' // 括号不配对：原样留着，不吞后续内容
      i = v + 'var('.length
      continue
    }
    out += unfolded.text ? unfoldVars(unfolded.text) : ' '
    i = unfolded.end
  }
}

/** 旧口径原样复刻——**只供反事实对照**，不进生产判据（留着它，「新判据更严」才有证据）。 */
function legacyBare(decl: string): string {
  return decl
    .replace(/cubic-bezier\([^)]*\)/g, ' __TIMING__ ')
    .replace(/var\(--motion-[^)]*\)/g, ' __TIMING__ ')
    .replace(/var\([^()]*(?:\([^()]*\))?[^()]*\)/g, ' ')
}

/** 时长槽判定的公共内核（归一化方式由调用方给，便于新旧口径共用同一套 token 判读） */
function scanNormalized(
  file: string,
  bare: string,
  violations: string[],
  hits: string[],
): void {
  // 声明标识 = 归一化后的首 token（= 动画名，如 fab-spin / fab-ring-spin / item-rise / shimmer）
  const name = bare.trim().split(/\s+/)[0] ?? ''
  let seenTiming = false
  for (const token of bare.split(/\s+/).filter(Boolean)) {
    if (token === '__TIMING__' || TIMING_TOKEN.test(token)) {
      seenTiming = true
      continue
    }
    if (/^var\(--duration/.test(token)) continue // 时长槽已是令牌
    if (!/^\d*\.?\d+(ms|s)$/.test(token)) continue
    if (seenTiming) continue // delay 槽（stagger）—— #854 验收 3 明确可留
    const key = `${file} | .${name} | ${token}`
    const reason = LITERAL_EXCEPTIONS[key]
    if (!reason) violations.push(`${key}（${bare.slice(0, 80)}）`)
    else {
      hits.push(key)
      expect(reason, '例外必须写明理由').toMatch(/M3 duration scale/)
    }
  }
}

/** 时长槽扫描结果：违规列表 + 实际命中的例外登记键（后者用于「死登记」判据） */
function scanDurations(
  file: string,
  src: string,
): { violations: string[]; hits: string[] } {
  const violations: string[] = []
  const hits: string[] = []
  for (const decl of motionDeclarations(src)) {
    // 顺序不能反，两步各司其职：
    // ① 无回退的 motion 令牌整体标成 __TIMING__——它是时序函数，决定「后面的数值是 delay 还是
    //    时长」，若随 var() 一起被摘掉就会把 60/120ms 误判成时长；
    // ② 其余 var() 只摘变量名（回退实参**留在声明里继续受判**）；
    // ③ 最后把行内 cubic-bezier 也标成 __TIMING__——② 展开后回退里的缓动才看得到。
    const marked = unfoldVars(decl.replace(/var\(--motion-[A-Za-z0-9-]*\)/g, ' __TIMING__ '))
    scanNormalized(file, marked.replace(/cubic-bezier\([^()]*\)/g, ' __TIMING__ '), violations, hits)
  }
  return { violations, hits }
}

/** 旧判据的等价复刻（同一套 token 内核 + 旧的整段摘除归一化）——反事实对照组 */
function legacyScanDurations(src: string): string[] {
  const violations: string[] = []
  for (const decl of motionDeclarations(src)) {
    scanNormalized('Legacy.vue', legacyBare(decl), violations, [])
  }
  return violations
}

/** 死登记键 = 在册、但当前扫描面命中不到的登记项（台账与真实违规必须一一对应）。
 *  抽成函数是为了让「死登记判据自己会点名」这件事**可被证伪**：台账条目只剩一条时，
 *  内联写 `.filter((key) => !hits.includes(key))` 会与「dead 恒为 []」的坏实现同形。 */
function deadExceptionKeys(ledger: Record<string, string>, hits: string[]): string[] {
  return Object.keys(ledger).filter((key) => !hits.includes(key))
}

/** tokens.css 里 value 等于给定缓动的 motion 令牌（`var(--motion-*)` 形态） */
function motionTokensWithValue(value: string): string[] {
  return [...TOKENS_CSS.matchAll(/(--motion-[a-z-]+):\s*cubic-bezier\(([^)]*)\)/g)]
    .filter((m) => m[2]!.split(',').map((p) => Number(p.trim())).join(',') === value)
    .map((m) => `var(${m[1]!})`)
}

/** tokens.css 里某变量的声明值原文（oracle：测试不抄数字，一律现场解析） */
function tokenValue(name: string): string {
  return TOKENS_CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? ''
}

describe('时长令牌化（#854 验收 3）：全仓生产 .vue 的 animation/transition 时长槽', () => {
  it('扫描面覆盖全仓生产 .vue（文件数下界 + 递归锚点，防 walk 静默塌陷）', () => {
    const files = Object.keys(SOURCES)
    expect(files.length, `扫描到的 .vue：${files.length} 个`).toBeGreaterThanOrEqual(
      SOURCE_COUNT_LOWER_BOUND,
    )
    for (const anchor of NESTED_SCAN_ANCHORS) {
      expect(files, `扫描面缺锚点 ${anchor}`).toContain(anchor)
    }
    // 递归锚点：src/**子目录**（pages/）必须有文件进来。
    // 只扫顶层的话 files 会含 App.vue 但一条 pages/ 都没有 ⇒ 旧式硬编码扫描面在此转红。
    const nested = files.filter((f) => NESTED_DIR_ANCHOR.test(f))
    expect(nested.length, `pages/ 下扫到的 .vue：${nested.length} 个`).toBeGreaterThanOrEqual(10)
    // 排除项必须真的被排除（否则白名单形同虚设，errorPrototype 的 px 硬编码会污染判据）
    expect(files.some((f) => f.includes('errorPrototype/'))).toBe(false)
    expect(files.some((f) => f.includes('.test.'))).toBe(false)
  })

  it('判据有效：声明抽取器真的切出了声明（逐文件 + 总量下界防正则塌陷与文件掉出扫描面）', () => {
    const counts: Record<string, number> = {}
    for (const [file, src] of Object.entries(SOURCES)) counts[file] = motionDeclarations(src).length
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const dump = JSON.stringify(
      Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)),
    )
    for (const [file, bound] of Object.entries(DECLARATION_LOWER_BOUND)) {
      expect(
        counts[file] ?? 0,
        `${file} 切出的 animation/transition 声明：${counts[file] ?? 0}（下界 ${bound}）` +
          `｜当前有声明的文件：${dump}`,
      ).toBeGreaterThanOrEqual(bound)
    }
    expect(total, `全仓切出 ${total} 条｜当前有声明的文件：${dump}`).toBeGreaterThanOrEqual(
      DECLARATION_TOTAL_LOWER_BOUND,
    )
  })

  it('时长槽零字面量：全部走 tokens.css 的时长令牌（stagger 延迟除外）', () => {
    const violations = Object.entries(SOURCES).flatMap(
      ([f, src]) => scanDurations(f, src).violations,
    )
    expect(violations, `仍硬编码时长的声明：\n${violations.join('\n')}`).toEqual([])
  })

  it('字面量例外登记制：每条登记都必须当前命中一个真实违规（防死登记变成永久豁免口子）', () => {
    const hits = Object.entries(SOURCES).flatMap(([f, src]) => scanDurations(f, src).hits)
    // 扫描面非空 + 点名锚点：没有下界时，「全仓零命中」与「例外匹配逻辑整体失效」同形
    expect(hits.length, `当前命中的例外登记：${hits.join(', ')}`).toBeGreaterThanOrEqual(1)
    expect(hits).toContain('App.vue | .shimmer | 1.5s')
    const dead = deadExceptionKeys(LITERAL_EXCEPTIONS, hits)
    expect(
      dead,
      '死登记（当前命中不到任何真实违规）：\n' +
        dead.map((k) => `  ${k}`).join('\n') +
        '\n每条死登记都是一处永久豁免口子：被豁免的写法日后回流会被静默放行，' +
        '而 reason 仍在解释一条已作废的决策。修法：令牌化该写法后**删掉登记项**。',
    ).toEqual([])
  })

  it('反事实：往台账塞一条命不中的登记 → 死登记判据当场点名它（不靠「dead 恒为 []」自证）', () => {
    // hits 取自**真实源码**（不是合成声明串）：台账的死活只在真实扫描面上判。
    const hits = Object.entries(SOURCES).flatMap(([f, src]) => scanDurations(f, src).hits)
    expect(hits, '真实源码上必须命中断言之外的那条活登记，否则下面全是空转').toContain(
      'App.vue | .shimmer | 1.5s',
    )
    // 阳性对照：与真登记同形（路径 | 声明名 | 字面量）但命不中的条目必须被点名。
    // components/RefreshableList.vue 的 .item-rise 已令牌化到 var(--durationMedium1)，
    // 故这条登记永远命中不了——它就是「死登记」的定义形态。
    const deadKey = 'components/RefreshableList.vue | .item-rise | 250ms'
    const polluted = { ...LITERAL_EXCEPTIONS, [deadKey]: '阳性对照用（M3 duration scale 无此档）' }
    expect(deadExceptionKeys(polluted, hits), '死登记未被点名 ⇒ 判据恒空，豁免口子不可见').toEqual([
      deadKey,
    ])
    // 阴性对照：活登记不被误判（证明上一条不是「一律点名」）
    expect(deadExceptionKeys(LITERAL_EXCEPTIONS, hits)).toEqual([])
    // 同形对照的第二种死法：台账条目指向扫描面外的文件（按名取值的判据天然命不中）
    expect(
      deadExceptionKeys(
        { ...LITERAL_EXCEPTIONS, 'NotInSources.vue | .x | 1s': 'x（M3 duration scale）' },
        hits,
      ),
    ).toEqual(['NotInSources.vue | .x | 1s'])
  })

  it('反事实：var() 回退实参里的时长字面量 → 新判据转红、旧口径放行（这就是本轮修掉的盲区）', () => {
    const decl = '.a { animation: var(--shimmer-motion, shimmer 1.5s linear infinite); }'
    // 现行判据：回退实参留在声明里 ⇒ 1.5s 落在时长槽（`linear` 在它之后）⇒ 违规
    expect(scanDurations('Synthetic.vue', decl).violations.join('|')).toContain('1.5s')
    // 旧口径：var(...) 连回退整段抹成空格 ⇒ 零违规。**同一份源码、同一个内核**，
    // 唯一差别是归一化方式 ⇒ 这条断言就是「盲区确实存在过」的证据，不是换个写法重测。
    expect(legacyScanDurations(decl), '旧口径对回退实参本应放行；若此处也红则对照失效').toEqual([])

    // 承重对照：新判据不是「一律更红」。朴素字面量在**新旧两套口径下都红**，
    // 证明上一条红的是「回退内容」这个形态本身，而不是「判据变严 ⇒ 什么都红」。
    const naive = '.a { animation: spin 1s linear infinite; }'
    expect(scanDurations('Synthetic.vue', naive).violations.join('|')).toContain('1s')
    expect(legacyScanDurations(naive).join('|')).toContain('1s')

    // 回退里的 stagger（时序之后）仍按验收条件豁免：判据只摘变量名，不越权改 delay 语义
    expect(
      scanDurations('Synthetic.vue', '.a { animation: spin var(--x, 1.5s) linear 60ms; }')
        .violations.join('|'),
    ).toContain('1.5s')
    expect(
      scanDurations('Synthetic.vue', '.a { animation: spin var(--x) linear 60ms; }').violations,
    ).toEqual([])
    // 无回退的 motion 令牌仍是时序函数（否则 60/120ms stagger 会被误判成时长）
    expect(
      scanDurations('Synthetic.vue', '.a { animation: rise var(--durationNormal) var(--motion-standard) 60ms both; }')
        .violations,
    ).toEqual([])
    // motion 令牌**带回退**时按内容判：回退若是时长就是违规（缓动回退仍由 cubic-bezier 归一化豁免）
    expect(
      scanDurations('Synthetic.vue', '.a { animation: rise var(--motion-custom, 300ms); }')
        .violations.join('|'),
    ).toContain('300ms')
    expect(
      scanDurations(
        'Synthetic.vue',
        '.a { animation: rise var(--motion-custom, cubic-bezier(0.05, 0.7, 0.1, 1)); }',
      ).violations,
    ).toEqual([])
  })

  it('反事实：扫描面收窄成旧白名单（只扫那 3 个文件）→ 子目录里的硬编码时长当场漏检', () => {
    // 判别力必须在**扫描面**这一层证明：门禁扩面是本轮的另一半修复，若「扩面」不承重，
    // 那它就只是把 SOURCES 写长了一点。旧实现的 SOURCES 是 App.vue / RefreshableList /
    // GlobalFab 三个文件——下面用同一套扫描+判据复刻那个面，看它对第 4 个文件里的违规是否**瞎**。
    // 合成目录树（注入 lister，不落盘、不碰任何他人在写的文件）：
    //   根/            App.vue、components/
    //   components/    RefreshableList.vue、GlobalFab.vue
    //   pages/         Detail.vue            ← 旧扫描面里没有这一支
    const CLEAN = '.a { animation: spin var(--durationNormal) linear infinite; }'
    const BAKED = '.a { animation: spin 300ms linear infinite; }'
    const dir = (name: string): DirEntryLike => ({ name, isDirectory: () => true })
    const file = (name: string): DirEntryLike => ({ name, isDirectory: () => false })
    const tree: Record<string, DirEntryLike[]> = {
      [SRC_ROOT]: [file('App.vue'), dir('components'), dir('pages')],
      [`${SRC_ROOT}/components`]: [file('RefreshableList.vue'), file('GlobalFab.vue')],
      [`${SRC_ROOT}/pages`]: [file('Detail.vue')],
    }
    const read = (p: string): string => (p.endsWith('Detail.vue') ? BAKED : CLEAN)

    // ① 现行扫描面（含 pages/）⇒ 抓得到，且违规行明确指向那个文件
    const wide = readSources(SRC_ROOT, (d) => tree[d] ?? [], read)
    expect(Object.keys(wide)).toContain('pages/Detail.vue')
    const wideHits = Object.entries(wide).flatMap(([f, s]) => scanDurations(f, s).violations)
    expect(wideHits.join('|')).toContain('300ms')
    expect(wideHits.join('|'), '违规必须归属到具体文件，否则报错指不到人').toContain(
      'pages/Detail.vue | .spin | 300ms',
    )

    // ② 旧白名单口径（根下没有 pages/ 这一支）⇒ 同一处硬编码**零违规**：这就是修复前的盲区，
    //    且它与「全仓真的干净」在旧门禁下完全同形。
    const narrow = readSources(
      SRC_ROOT,
      (d) => (d === SRC_ROOT ? [file('App.vue'), dir('components')] : (tree[d] ?? [])),
      read,
    )
    expect(Object.keys(narrow)).toEqual(['App.vue', 'components/GlobalFab.vue', 'components/RefreshableList.vue'])
    expect(
      Object.entries(narrow).flatMap(([f, s]) => scanDurations(f, s).violations),
      '旧扫描面对 pages/ 里的硬编码时长是瞎的——这正是本轮修掉的第二个盲区',
    ).toEqual([])
  })

  it('IO 边界（测试硬约束 #1/#3）：目录/文件读不到必须跳过 + warn，不得静默降级', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // ① 根目录不可读（ENOENT 形态）⇒ 空扫描面 + 一次 warn。
    //    静默返回 [] 会让「全仓零违规」与「压根没扫」同形，那是本门禁最贵的假绿。
    const rootGone = readSources(`${SRC_ROOT}/__not_a_dir__`, () => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    })
    expect(rootGone).toEqual({})
    expect(warn.mock.calls.flat().join('|')).toContain('目录不可读')

    // ② 目录列举返回畸形值（非数组）⇒ 跳过 + warn，不当数组迭代炸掉整个测试
    warn.mockClear()
    const malformed = readSources(SRC_ROOT, () => 'not-an-array' as unknown as DirEntryLike[])
    expect(malformed).toEqual({})
    expect(warn.mock.calls.flat().join('|')).toContain('返回非数组')

    // ③ 子目录不可读 ⇒ **只丢那一支**，兄弟目录照常进扫描面（降级是局部的，不是全盘放弃）
    warn.mockClear()
    const partial = readSources(
      SRC_ROOT,
      (dir) => {
        if (dir.endsWith('/pages')) throw new Error('EACCES: permission denied')
        return defaultListDir(dir)
      },
    )
    expect(Object.keys(partial).some((f) => f.startsWith('pages/'))).toBe(false)
    expect(Object.keys(partial).some((f) => f.startsWith('components/'))).toBe(true)
    expect(warn.mock.calls.flat().join('|')).toContain('目录不可读')

    // ④ 单个文件读失败 ⇒ 该文件出局，其余照旧（部分降级不能退化成零扫描面）
    warn.mockClear()
    const noShimmer = readSources(SRC_ROOT, defaultListDir, (p) => {
      if (p.endsWith('/App.vue')) throw new Error('EISDIR: illegal read on a directory')
      return readFileSync(p, 'utf8')
    })
    expect(Object.keys(noShimmer)).not.toContain('App.vue')
    expect(Object.keys(noShimmer).length).toBeGreaterThanOrEqual(SOURCE_COUNT_LOWER_BOUND)
    expect(warn.mock.calls.flat().join('|')).toContain('文件不可读')

    // 阴性对照：默认参数（真磁盘）扫出 App.vue ⇒ 上面几档降级是注入造成的，不是环境本身坏了
    expect(Object.keys(SOURCES)).toContain('App.vue')
    warn.mockRestore()
  })

  it('替换不改观感：所用令牌的值 = 被换掉的字面量', () => {
    // oracle = tokens.css 自身定义（不是测试里抄一份数字）
    expect(tokenValue('durationNormal')).toBe('200ms')
    expect(tokenValue('durationGentle')).toBe('300ms')
    expect(tokenValue('durationMedium1')).toBe('250ms')

    const refreshable = stripComments(SOURCES['components/RefreshableList.vue']!)
    expect(refreshable).toMatch(/\.scrim-in \{[^}]*animation: scrim-in var\(--durationNormal\)/)
    for (const cls of ['item-rise-1', 'item-rise-2', 'item-rise-extra']) {
      expect(refreshable).toMatch(
        new RegExp(`\\.${cls} \\{[^}]*animation: item-rise var\\(--durationMedium1\\)`),
      )
    }
    // stagger 延迟按验收条件保留字面量（改了就红：不是本票授权的改动面）
    expect(refreshable).toMatch(/\.item-rise-2 \{[^}]*animation: item-rise var\(--durationMedium1\) var\(--motion-emphasized-decelerate\) 60ms both;/)
    expect(refreshable).toMatch(/\.item-rise-extra \{[^}]*animation: item-rise var\(--durationMedium1\) var\(--motion-emphasized-decelerate\) 120ms both;/)

    const fab = stripComments(SOURCES['components/GlobalFab.vue']!)
    // 缓动槽的 oracle 取自 tokens.css：与被换掉的行内 cubic-bezier **等值**的 motion 令牌。
    // 用「值相等」而非「名字相等」⇒ 换一枚等值令牌不误红，换一枚不等值的必红。
    const easing = motionTokensWithValue('0.05,0.7,0.1,1')
    expect(easing, 'tokens.css 里没有与被换掉的行内缓动等值的 motion 令牌').toHaveLength(1)
    const motion = easing[0]!
    expect(fab).toContain('`fab-ring-in var(--durationGentle) ' + motion + ' ${delay}ms both`')
    expect(fab).toContain('transform var(--durationNormal) ' + motion)

    // 无限转圈的 1s → --durationExtraLong4：令牌值必须等于**被换掉的那个字面量**（1s），
    // 否则这次替换是行为变更而不是「不改观感」。oracle 的独立来源 = 替换前的源码字面量。
    const REPLACED_SPIN_LITERAL = '1s'
    const toMs = (v: string): number => {
      const m = /^([\d.]+)(ms|s)$/.exec(v)
      return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : Number.NaN
    }
    expect(toMs(tokenValue('durationExtraLong4')), 'tokens.css 未定义 --durationExtraLong4').not.toBeNaN()
    expect(
      toMs(tokenValue('durationExtraLong4')),
      '令牌值与被换掉的字面量不等 ⇒ 替换改了观感',
    ).toBe(toMs(REPLACED_SPIN_LITERAL))
    for (const file of ['components/RefreshableList.vue', 'components/GlobalFab.vue']) {
      expect(stripComments(SOURCES[file]!), `${file} 应共用 --durationExtraLong4`).toMatch(
        /animation: (?:fab-spin|fab-ring-spin) var\(--durationExtraLong4\) linear infinite;/,
      )
      // 登记已删 ⇒ 字面量也不许留在原地（这半句是给未来的自己：别把它塞回去）
      expect(stripComments(SOURCES[file]!), `${file} 仍有 1s 字面量`).not.toMatch(
        /(?:fab-spin|fab-ring-spin) 1s/,
      )
    }
  })

  it('--shimmer-motion 的默认值在令牌表里，且是**整条 animation 简写**（缺 name 会不播）', () => {
    const value = tokenValue('shimmer-motion')
    expect(value, 'tokens.css 未定义 --shimmer-motion ⇒ App.vue 的回退实参仍是实际生效值').not.toBe('')
    // 判别力：简写只给时长（`1000ms`）会丢掉 animation-name ⇒ 取 none ⇒ 骨架屏不播，
    // 而这种写法在本判据下「既没有字面量违规、也不违反任何形状检查」——必须单独挡住。
    const hasAnimationName = (v: string): boolean => /\bshimmer\b/.test(v)
    expect(hasAnimationName(value), `--shimmer-motion 缺 animation-name：${value}`).toBe(true)
    expect(hasAnimationName('1000ms'), '对照失效：裸时长形态本该被判不合格').toBe(false)
    expect(value).toContain('var(--durationExtraLong4)')
    expect(value).toContain('infinite')
    // 根 <page> 的内联注入仍是覆盖本条的唯一通道（偏好看板 = none），机制不能被令牌化顺手废掉
    const app = stripComments(SOURCES['App.vue']!)
    expect(app).toMatch(/const SHIMMER_MOTION_VAR = '--shimmer-motion'/)
    expect(app).toMatch(/\.\.\.\(animationStyle\.value \? \{ \[SHIMMER_MOTION_VAR\]: animationStyle\.value \} : \{\}\)/)
    expect(app).toMatch(/animation: var\(--shimmer-motion, shimmer 1\.5s linear infinite\);/)
  })

  it('反事实：把令牌塞回字面量（250ms / 200ms / 300ms）→ 判据当场转红', () => {
    for (const [file, src] of Object.entries(SOURCES)) {
      expect(scanDurations(file, src).violations, `${file} 真实源码当前必须无违规`).toEqual([])
    }
    const listPath = 'components/RefreshableList.vue'
    const brokenList = SOURCES[listPath]!.replace(
      'animation: item-rise var(--durationMedium1) var(--motion-emphasized-decelerate) 60ms both;',
      'animation: item-rise 250ms var(--motion-emphasized-decelerate) 60ms both;',
    )
    expect(brokenList, '改动没落到源码上，反事实无效').not.toBe(SOURCES[listPath])
    expect(scanDurations(listPath, brokenList).violations.join('|')).toContain('250ms')

    const fabPath = 'components/GlobalFab.vue'
    const motion = motionTokensWithValue('0.05,0.7,0.1,1')[0]!
    const brokenFab = SOURCES[fabPath]!.replace(
      'transform var(--durationNormal) ' + motion,
      'transform 200ms ' + motion,
    )
    expect(brokenFab, '改动没落到源码上，反事实无效').not.toBe(SOURCES[fabPath])
    expect(scanDurations(fabPath, brokenFab).violations.join('|')).toContain('200ms')

    // 已被令牌化的无限转圈若回退成字面量，同样必须转红（登记已删 ⇒ 没有豁免口子）
    const brokenSpin = SOURCES[fabPath]!.replace(
      'animation: fab-ring-spin var(--durationExtraLong4) linear infinite;',
      'animation: fab-ring-spin 1s linear infinite;',
    )
    expect(brokenSpin, '改动没落到源码上，反事实无效').not.toBe(SOURCES[fabPath])
    expect(scanDurations(fabPath, brokenSpin).violations.join('|')).toContain('1s')

    // 只改 stagger 延迟（验收条件允许留）不得转红——判据不越权
    const delayOnly = SOURCES[listPath]!.replace(
      'var(--motion-emphasized-decelerate) 60ms both;',
      'var(--motion-emphasized-decelerate) 90ms both;',
    )
    expect(scanDurations(listPath, delayOnly).violations).toEqual([])
  })

  it('反事实：末位时长槽 / 多行写法 / 多值逗号分段——三种形态都必须转红', () => {
    const hits = (decl: string) => scanDurations('Synthetic.vue', decl).violations.join(' | ')

    // ① 末位槽 + **无缓动槽**：`transition: all 200ms;` 是 CSS 里最常见的硬编码过渡形态。
    //    旧抽取器把分号留在末位 token 上（`200ms;` 匹配不上时间字面量）⇒ 整条放行。
    expect(hits('.a { transition: all 200ms; }')).toContain('200ms')
    expect(hits('.a { transition: color 200ms; }')).toContain('200ms')
    expect(hits('.a { animation: spin 1s; }')).toContain('1s')
    // 阴性对照：同一形态但已令牌化 ⇒ 不转红（证明上面抓的不是「transition 三个字」）
    expect(hits('.a { transition: all var(--durationNormal); }')).toEqual('')

    // ② 多行写法：属性名在首行、值在次行。旧抽取器只保留含 `transition:` 的那一行，
    //    次行没有属性名前缀 ⇒ 时长落在被丢弃的那一半，整条声明不可见。
    expect(hits('.a {\n  transition:\n    opacity 200ms\n    ease-in-out;\n}')).toContain('200ms')
    expect(hits('.a { animation:\n    spin 1s\n    linear\n    infinite; }')).toContain('1s')
    expect(
      hits('.a {\n  transition:\n    opacity var(--durationNormal)\n    ease-in-out;\n}'),
    ).toEqual('')

    // ③ 多值逗号分段：第二段与第一段同样受判（`cubic-bezier()` 内的逗号不算分隔符）
    expect(hits('.a { transition: color 200ms, opacity 300ms; }')).toContain('200ms')
    expect(hits('.a { transition: color 200ms, opacity 300ms; }')).toContain('300ms')
    expect(
      scanDurations('Synthetic.vue', '.a { transition: color var(--durationNormal), opacity 400ms; }')
        .violations,
    ).toHaveLength(1)
    // var() 回退里的逗号不构成分段：`var(--x, 200ms)` 是一条声明里的一个时长，不是两段
    expect(scanDurations('Synthetic.vue', '.a { transition: color var(--x, 200ms); }').violations)
      .toHaveLength(1)
  })
})
