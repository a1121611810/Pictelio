// ─── 弹层壳与两段式退场门禁（issue #878；契约见 ADR-0211 决策 3 / 决策 4）───
//
// ── 判据纪律（沿用本仓已被抓过三次的那三条）───
// ① **只认机器可数的结构，不扫散文找关键词**：
//    · keyframes 判据解析 `@keyframes <name>` 的**定义**（结构化抽取，可与名字登记表对账）；
//    · 接线判据认 `:style="…"` / `:phase` 这类**属性值字面量形态**；
//    · 时长判据认「`animation:` / `transition:` 声明的时长位」，沿用既有门禁
//      `motionDurationTokens.template.test.ts` / `motionContract.test.ts` 的槽位内核；
//    ⇒ 不含任何「关键词表」，新增一类违规写法不需要改本文件。
// ② **每条规则自带阳性对照（反事实）**：向判据内核喂违规形态必须转红。
//    否则「什么都没搜到」无法区分「无违规」与「判据写坏了」。
// ③ **零基线处必须给扫描面下界**：当前命中数为 0 的规则（.ts 消费面）同样要有锚点。
//
// ── 扫描面与规模线───
// 被测对象 = **动效消费面**（唯一入口 motion.ts + 协议模块 useSheetDismiss.ts +
// keyframes 定义方 SheetShell.vue + 7 个弹层组件），不是 SheetShell 这一个小文件。
// ⚠️ 口径陷阱（spec 5.5 已登记同类）：拿单文件当被测对象，30% 上限会小到装不下任何真实判据。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MOTION_DURATION, MOTION_EASING } from '../composables/motion'
import { DIALOG_ANIMATION, SHEET_ANIMATION } from '../composables/useSheetDismiss'

const COMPONENTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const SRC_ROOT = join(COMPONENTS_DIR, '..')
const SHELL_SRC = readFileSync(join(COMPONENTS_DIR, 'SheetShell.vue'), 'utf8')

/** 7 个弹层 + 事实基类（ADR-0211 决策 4 的处置表全集） */
const OVERLAY_FILES = [
  'BottomSheet.vue',
  'SheetShell.vue',
  'SearchSheet.vue',
  'SeriesSheet.vue',
  'CommentOverlay.vue',
  'BookmarkPanel.vue',
  'PagePickerSheet.vue',
  'WatchlistPromptDialog.vue',
] as const

/** 递归列出生产 .vue / .ts（排测试），用于「keyframes 全仓唯一」判据 */
function listSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (statSync(p).isDirectory()) out.push(...listSources(p))
    else if (/\.(vue|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(p)
  }
  return out
}

const SRC_FILES = listSources(SRC_ROOT).map((p) => ({
  name: relative(SRC_ROOT, p).split(sep).join('/'),
  text: readFileSync(p, 'utf8'),
}))

/** 去注释：约束说明本身会提到被禁止的字面量，判据必须落在代码本文上 */
function stripComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** `<style>` 块正文（缺省空串） */
function styleBlock(src: string): string {
  return src.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
}

/** 抽 `@keyframes <name>` 的**定义**（结构化：名字 + 帧体），跨行安全。
 *  ⚠️ 帧体必须在**去注释后的文本**上切片：索引若来自原文而切片来自剥注释后的文本，
 *     两者错位会让帧体随机取到别处的花括号 —— 这正是「判据恒绿/恒红」的典型来源。 */
function keyframeDefs(src: string): { name: string; body: string }[] {
  const code = stripComments(src)
  const out: { name: string; body: string }[] = []
  for (const m of code.matchAll(/@keyframes\s+([a-zA-Z][\w-]*)\s*\{/g)) {
    let depth = 1
    let i = m.index + m[0].length
    const from = i
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++
      else if (code[i] === '}') depth--
      i++
    }
    out.push({ name: m[1]!, body: code.slice(from, i - 1) })
  }
  return out
}

/** 抽出 `animation:` / `transition:` 声明的值部分（时长位判据的输入） */
function motionDeclarations(src: string): string[] {
  const out: string[] = []
  const code = stripComments(src)
  const re = /\b(?:animation|transition)\s*:\s*([^;{}]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const v = m[1]!.trim()
    if (v) out.push(v)
  }
  return out
}

/**
 * `setTimeout(<fn>, <delay>)` 的**第二个实参**里出现的裸数字（违规形态）。
 * ⚠️ 括号配平扫描，不是正则硬匹配：第一个实参几乎总是箭头函数（`() => …`），
 *    用 `[^,()]+` 之类的正则会在函数体带括号时整个匹配不上 ⇒ 判据假阴性
 *    （本条的正性对照就是从实测这个洞里长出来的）。
 */
function setTimeoutDelayLiterals(src: string): string[] {
  const code = stripComments(src)
  const out: string[] = []
  for (const m of code.matchAll(/setTimeout\(/g)) {
    let i = m.index + m[0].length
    let depth = 1
    let start = i
    const args: string[] = []
    while (i < code.length) {
      const ch = code[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          args.push(code.slice(start, i))
          break
        }
      } else if (ch === ',' && depth === 1) {
        args.push(code.slice(start, i))
        start = i + 1
      }
      i++
    }
    const delay = (args[1] ?? '').trim()
    if (/^\d+$/.test(delay)) out.push(delay)
  }
  return out
}

/** 退场计时器时长是否取自退场预设（而非另抄一份数值）——S2 主判据与反事实共用 */
function holdMsSourcedFromExitPreset(code: string): boolean {
  return /const holdMs = exit\(\{[\s\S]*?\}\)\.holdMs/.test(stripComments(code))
}

/**
 * 弹层模板里 `:style` 绑定的相位驱动性判定（结构化小数据流，不认关键词表）。
 * 返回**未被相位驱动**的绑定值清单；清单为空且至少有一个绑定 ⇒ 接线闭环。
 * 两种合法写法都被认：
 *   ① `:style="dismiss.panelStyle(dismiss.phase)"` —— 自绘壳直接调协议模块；
 *   ② `:style="panelStyle"` + 同文件 `const panelStyle = computed(() => motion.panelStyle(props.phase))`
 *      —— 壳把「相位 prop → 样式」的映射收在脚本侧（BottomSheet / SheetShell 的形态）。
 */
function unDrivenStyleBindings(code: string): { total: number; unDriven: string[] } {
  const c = stripComments(code)
  // 只看**动画**绑定：值是标识符或函数调用形态。对象字面量（`{ height: safeBottom + 'px' }`
  // 这类安全区垫片）不是动效通道，纳入判据会把无关代码判红（实测踩过）。
  const bindings = [...c.matchAll(/:style="([^"]+)"/g)]
    .map((m) => m[1]!.trim())
    .filter((v) => !v.startsWith('{'))
  const unDriven: string[] = []
  for (const b of bindings) {
    if (b.includes('(')) {
      if (!/\.(?:panelStyle|scrimStyle)\([^)]*phase/i.test(b)) unDriven.push(b)
      continue
    }
    // ⚠️ 相位 prop 名是驼峰的 `motionPhase`，小写 `phase` 匹配不到（实测踩过：判据恒红）
    const def = new RegExp(
      `const\\s+${b}\\s*=\\s*computed[\\s\\S]{0,200}?\\.(?:panelStyle|scrimStyle)\\([^)]*phase`,
      'i',
    )
    if (!def.test(c)) unDriven.push(b)
  }
  return { total: bindings.length, unDriven }
}

/**
 * 弹层里的数字延迟计时器豁免台账（键 = `文件名 | 用途`）。
 * 收窄口径的原因（实测）：SearchSheet 有 50ms 的**输入框聚焦**计时器（ADR-0132 自动聚焦），
 * 与动效无关 —— 无差别禁会把合法代码判红。
 * 禁的仍然是「承载弹层时序的那类计时器」：另写一个 `setTimeout(() => emit('close'), 200)`
 * 就是第二份退场时序，动画还在播、弹层已卸载（或反过来卡一段空窗）。
 * 豁免**不得变成永久口子**：在册项若扫不到真实消费点，同样转红（与 motionContract M3 同款）。
 */
const NUMERIC_TIMER_EXCEPTIONS: Record<string, string> = {
  'SearchSheet.vue | 50':
    'ADR-0132 弹层打开后自动聚焦输入框：原生 input 尚未完成挂载，需延迟一帧 focus。' +
    '与弹层进退场时序无关（不 emit、不改相位），且 onBeforeUnmount 会 clearTimeout。',
}

/** 扫出弹层里的数字延迟计时器，返回 `文件名 | setTimeout(…, N)` */
function numericTimersInOverlays(): string[] {
  const out: string[] = []
  for (const f of OVERLAY_FILES) {
    for (const n of setTimeoutDelayLiterals(readFileSync(join(COMPONENTS_DIR, f), 'utf8'))) {
      out.push(`${f} | ${n}`)
    }
  }
  return out
}

/**
 * 取 `const <name> = computed(...)` 的**实参**（括号配平，不是正则拉到下一个 `\n)` ——
 * 贪心匹配会越过表达式本体、把后面 watch 里的 `props.open` 一起吞进来 ⇒ 判据恒绿）。
 */
function computedArg(code: string, name: string): string {
  const head = `const ${name} = computed(`
  const start = stripComments(code).indexOf(head)
  if (start < 0) return ''
  const from = start + head.length
  let depth = 1
  let i = from
  while (i < code.length && depth > 0) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') depth--
    i++
  }
  return stripComments(code).slice(from, i - 1)
}

/**
 * `:phase` / `:motion-phase` 绑定是否由协议模块的相位驱动。
 * ⚠️ 合法写法是**顶层 computed**：Vue 只解包顶层 setup 绑定，`dismiss.phase` 是普通对象的内嵌 Ref，
 *    模板里不解包 ⇒ prop 会收到 Ref 实例（vue-tsc TS2325 已实证）。本判据认这两种形态：
 *    ① 直接调用形态 `:phase="dismiss.phase.value"`；
 *    ② 顶层 computed 形态 `:phase="motionPhase"` + 同文件 `const motionPhase = computed(… .phase …)`。
 */
function phasePropDriven(code: string, attr: 'phase' | 'motion-phase'): boolean {
  const c = stripComments(code)
  const m = new RegExp(`:${attr}="([^"]+)"`).exec(c)
  if (!m) return false
  const v = m[1]!.trim()
  if (v.includes('(')) return /\.phase\b/i.test(v)
  const def = new RegExp(`const\\s+${v}\\s*=\\s*computed[\\s\\S]{0,200}?\\.phase\\b`, 'i')
  return def.test(c)
}

/** 动画接线形态：自绘壳（bound）/ 壳消费方下传相位（passed）/ 未接（none） */
function wiringKindOf(code: string): 'bound' | 'passed' | 'none' {
  const c = stripComments(code)
  const { total, unDriven } = unDrivenStyleBindings(c)
  if (total > 0 && unDriven.length === 0) return 'bound'
  if (phasePropDriven(c, 'phase') || phasePropDriven(c, 'motion-phase')) return 'passed'
  return 'none'
}

/** 一条声明里的时长位字面量（时序函数 token 之后的数值是 delay 位，豁免） */
function durationLiteralsIn(decl: string): string[] {
  const out: string[] = []
  let seenTiming = false
  for (const token of decl.trim().split(/\s+/).filter(Boolean)) {
    if (/^(?:linear|ease|ease-in|ease-out|ease-in-out)$/.test(token) || /^var\(--motion-[\w-]+\)$/.test(token) || /^(?:cubic-bezier|steps)\(/.test(token)) {
      seenTiming = true
      continue
    }
    if (/^\d*\.?\d+(?:ms|s)$/.test(token) && !seenTiming) out.push(token)
  }
  return out
}

/** Tailwind transform 族工具类（死类名，ADR-0210 路径 E）：与 motionContract M3 同一条内核 */
const DEAD_TRANSFORM_CLASS =
  /(?:^|\s)(?:[a-z-]+:)*-?(?:scale|rotate|skew|translate-[xy])-[^\s"'`:]+/

/** 类名 token（模板 class 属性位） */
function classTokens(src: string): string[] {
  const out: string[] = []
  for (const m of stripComments(src).matchAll(/(?:class|:class)\s*=\s*["']([^"']*)["']/g)) {
    out.push(...m[1]!.split(/\s+/).filter(Boolean))
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// S1 · keyframes 资产：定义方唯一、名字与登记表对账、帧体确有位移/透明度
// ───────────────────────────────────────────────────────────────────────────

const OWNED_NAMES = [
  SHEET_ANIMATION.enter,
  SHEET_ANIMATION.exit,
  SHEET_ANIMATION.scrimEnter,
  SHEET_ANIMATION.scrimExit,
  DIALOG_ANIMATION.enter,
  DIALOG_ANIMATION.exit,
]

describe('S1 · 弹层 keyframes 资产（SheetShell.vue 是唯一定义方）', () => {
  it('扫描面证据：确实扫到了 7 个弹层与唯一入口（文件数下界 + 点名锚点，防 walk 塌陷）', () => {
    const names = SRC_FILES.map((f) => f.name)
    expect(names.length, `扫到的生产源文件：${names.length}`).toBeGreaterThanOrEqual(60)
    for (const f of OVERLAY_FILES) {
      expect(names, `弹层文件缺失：components/${f}`).toContain(`components/${f}`)
    }
    expect(names).toContain('composables/motion.ts')
    expect(names).toContain('composables/useSheetDismiss.ts')
  })

  it('SheetShell 定义的名字与 useSheetDismiss 的登记表逐条对账（不多不少不少名）', () => {
    const defs = keyframeDefs(styleBlock(SHELL_SRC))
    expect(
      defs.map((d) => d.name).sort(),
      'SheetShell 的 @keyframes 集合与登记表不一致（新增动画忘了登记，或登记表指向不存在的帧体）',
    ).toEqual([...OWNED_NAMES].sort())
    // 每条登记表名字都必须真的有一副帧体（否则内联 animation 简写指向空气 = 静默无动效）
    for (const name of OWNED_NAMES) {
      expect(defs.some((d) => d.name === name), `缺少 @keyframes ${name}`).toBe(true)
    }
  })

  it('这 6 个名字全仓唯一（跨组件复用一个 keyframes 是既有先例，但必须是显式的同一副帧体）', () => {
    const defined = SRC_FILES.flatMap((f) =>
      keyframeDefs(f.text).map((d) => `${f.name} | ${d.name}`),
    )
    for (const name of OWNED_NAMES) {
      const owners = defined.filter((k) => k.endsWith(`| ${name}`))
      expect(
        owners,
        `@keyframes ${name} 的定义方必须唯一（实际：${owners.join(', ')}）——` +
          '同名两处定义时后加载者覆盖前者，动画行为取决于打包顺序',
      ).toEqual([`components/SheetShell.vue | ${name}`])
    }
  })

  it('面板那对帧体确有 transform 位移，遮罩那对只有 opacity（遮罩跟着位移即为缺陷）', () => {
    const defs = new Map(keyframeDefs(styleBlock(SHELL_SRC)).map((d) => [d.name, d.body]))
    for (const name of [SHEET_ANIMATION.enter, SHEET_ANIMATION.exit, DIALOG_ANIMATION.enter, DIALOG_ANIMATION.exit]) {
      expect(defs.get(name) ?? '', `@keyframes ${name} 帧体没有 transform ⇒ 面板不滑`).toMatch(
        /transform:\s*(?:translate|scale)/,
      )
    }
    for (const name of [SHEET_ANIMATION.scrimEnter, SHEET_ANIMATION.scrimExit]) {
      const body = defs.get(name) ?? ''
      expect(body, `@keyframes ${name} 帧体没有 opacity ⇒ 遮罩不淡入`).toMatch(/opacity:/)
      expect(body, `@keyframes ${name} 带 transform ⇒ 遮罩会跟着位移`).not.toMatch(/transform:/)
    }
  })

  it('帧体只写 transform / opacity，零 animation / transition 简写（时长曲线只能来自 motion.ts）', () => {
    // 结构化判据：帧体里出现 animation:/transition: 声明 = 0 条。
    // 这条同时把「帧体里藏裸时长」的可能性结构性排除掉（无处可写）。
    const decls = keyframeDefs(styleBlock(SHELL_SRC)).flatMap((d) => motionDeclarations(d.body))
    expect(decls, `帧体里出现动效简写：\n${decls.join('\n')}`).toEqual([])
    const raw = styleBlock(SHELL_SRC)
    expect(raw, '帧体里出现时长字面量').not.toMatch(/\d+(?:ms|s)\b/)
    expect(raw, '帧体里出现裸曲线').not.toMatch(/cubic-bezier|steps\(/)
  })

  it('每个动画名登记表都有真实消费方（孤儿帧体 = 死资产，必须跟着调用方一起删）', () => {
    // 反向对账：只查「登记表 ⊆ 帧体」不够 —— 调用方全部改用别的档位后，
    // 旧的 keyframes 会变成永远没人引用的孤儿资产（ADR-0210 决策 5 的同类问题）。
    // 判据：两张登记表各自至少被一个弹层组件引用（组件按名字引用常量，不写字面量）。
    for (const [constName, reg] of [
      ['SHEET_ANIMATION', SHEET_ANIMATION],
      ['DIALOG_ANIMATION', DIALOG_ANIMATION],
    ] as const) {
      const users = OVERLAY_FILES.filter((f) =>
        stripComments(readFileSync(join(COMPONENTS_DIR, f), 'utf8')).includes(constName),
      )
      expect(
        users,
        `登记表 ${constName}（${Object.values(reg).join(', ')}）已无任何消费方：` +
          '删掉对应帧体，否则是永远没人引用的死资产',
      ).not.toEqual([])
    }
    // 帧体数与名字数恒等（6 = 6）：多一副没人用的帧体就是孤儿
    expect(keyframeDefs(styleBlock(SHELL_SRC))).toHaveLength(OWNED_NAMES.length)
  })

  it('自管挂载的弹层：可见性必须同时受宿主 open 与本地相位约束', () => {
    // 唯一自管挂载的弹层（WatchlistPromptDialog：宿主不加 v-if，用 open 表达显隐）。
    // 两种单边约束都是实测踩过的坑：
    //   只看相位（`phase !== 'gone'`）⇒ 相位初值 enter，宿主传 open=false 时**首帧闪现**；
    //   只看 open ⇒ open 变 false 的瞬间隐藏，退场动画一帧都播不到。
    const code = stripComments(
      readFileSync(join(COMPONENTS_DIR, 'WatchlistPromptDialog.vue'), 'utf8'),
    )
    const visible = computedArg(code, 'visible')
    expect(visible, '找不到 visible 的定义').not.toBe('')
    expect(visible, 'visible 只看本地相位 ⇒ 宿主 open=false 时首帧闪现').toMatch(/props\.open/)
    expect(visible, 'visible 不看相位 ⇒ 退场动画一帧都播不到').toMatch(/dismiss\.phase\.value/)
    expect(code, '模板 v-if 未绑 visible').toContain('v-if="visible"')
    // 抽取器自检：表达式本体之外的代码不得被算进来（否则上面两条恒绿）
    expect(computedArg('const v = computed(() => a)\nconst w = () => (b)', 'v')).toBe('() => a')
  })

  it('阳性对照：判据内核对「帧体里塞裸时长 / 遮罩带 transform / 重名定义」会转红', () => {
    const badStyle = `@keyframes ${SHEET_ANIMATION.enter} {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; }
}
.sheet-enter { animation: sheet-enter 250ms ease both; }`
    // ① 帧体里的简写被时长位判据抓到
    expect(motionDeclarations(badStyle).flatMap((d) => durationLiteralsIn(d))).toEqual(['250ms'])
    // ② 重名定义被抓到（两个定义方）
    const dup = [
      { name: 'components/SheetShell.vue', text: styleBlock(SHELL_SRC) },
      { name: 'components/Other.vue', text: `@keyframes ${SHEET_ANIMATION.enter} { from { opacity: 0 } }` },
    ]
    const owners = dup
      .flatMap((f) => keyframeDefs(f.text).map((d) => `${f.name} | ${d.name}`))
      .filter((k) => k.endsWith(`| ${SHEET_ANIMATION.enter}`))
    expect(owners).toHaveLength(2)
    expect(owners).not.toEqual([`components/SheetShell.vue | ${SHEET_ANIMATION.enter}`])
    // ③ 遮罩带 transform 被判红
    const scrimBody = keyframeDefs(`@keyframes ${SHEET_ANIMATION.scrimEnter} { from { opacity: 0; transform: translateY(10px) } to { opacity: 1 } }`)[0]!.body
    expect(scrimBody).toMatch(/transform:/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// S2 · 两段式接线：7 个弹层都必须经协议模块，且不自带计时器字面量
// ───────────────────────────────────────────────────────────────────────────

describe('S2 · 两段式退场接线（进入 / 退场 / 计时器 / 偏好降级）', () => {
  it('每个弹层都经 composables/useSheetDismiss 接入（不自建第二套时序）', () => {
    const missing = OVERLAY_FILES.filter((f) => {
      const code = stripComments(
        readFileSync(join(COMPONENTS_DIR, f), 'utf8'),
      )
      return !code.includes("from '../composables/useSheetDismiss'")
    })
    expect(
      missing,
      `这些弹层没有接入两段式协议（手写退场 = 退场必然不同步或根本不播）：\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('动画接线闭环：壳消费方必须把相位下传给 BottomSheet / SheetShell', () => {
    // 相位传去别处 = 动画无人渲染（弹层看起来正常，实则零动效 —— 只能真机发现）
    for (const f of ['SeriesSheet.vue', 'CommentOverlay.vue', 'SearchSheet.vue', 'PagePickerSheet.vue']) {
      const code = readFileSync(join(COMPONENTS_DIR, f), 'utf8')
      const target = /<(BottomSheet|SheetShell)\b/.exec(stripComments(code))?.[1]
      expect(target, `${f} 没有把相位下传给 BottomSheet / SheetShell`).toBeTruthy()
      const attr = target === 'SheetShell' ? 'phase' : 'motion-phase'
      expect(phasePropDriven(code, attr), `${f} 的 :${attr} 不是协议相位驱动的`).toBe(true)
      expect(wiringKindOf(code), `${f} 相位既没下传也没自绑`).not.toBe('none')
    }
  })

  it('动画宿主绑定的是协议模块给出的样式（不是裸 animation 串）', () => {
    // 判据是「每个弹层至少有一个相位驱动的 :style 绑定」+「所有 :style 绑定都相位驱动」，
    // 两者都可机器数；绑定的合法性由 unDrivenStyleBindings 逐条核（不接受裸 animation 串）。
    const rows = OVERLAY_FILES.map((f) => {
      const { total, unDriven } = unDrivenStyleBindings(readFileSync(join(COMPONENTS_DIR, f), 'utf8'))
      return { file: f, total, unDriven }
    })
    const bad = rows.filter((r) => r.unDriven.length > 0)
    expect(
      bad,
      '这些 :style 绑定不由相位驱动（弹层仍是「砸出来」，或退场时动画不变）：\n' +
        bad.map((r) => `${r.file}: ${r.unDriven.join(', ')}`).join('\n'),
    ).toEqual([])
    // 壳消费方自己不需要 :style（动画由壳渲染），其余必须至少有一个动画宿主
    const shells = new Set(['BottomSheet.vue', 'SheetShell.vue', 'BookmarkPanel.vue', 'WatchlistPromptDialog.vue'])
    for (const r of rows) {
      if (shells.has(r.file)) {
        expect(r.total, `${r.file} 没有任何 :style 动画绑定`).toBeGreaterThan(0)
      }
    }
  })

  it('弹层层零数字延迟计时器（退场窗口只能由协议模块的 holdMs 决定）', () => {
    // 台账只豁免「与弹层时序无关」的既有计时器；新增的这类计时器必须先说明理由再登记。
    const hits = numericTimersInOverlays()
    const violations = hits.filter((k) => !(k in NUMERIC_TIMER_EXCEPTIONS))
    expect(
      violations,
      '这些弹层自带数字延迟计时器 ⇒ 第二份时序（动画与卸载脱钩）：\n' +
        violations.join('\n') +
        '\n确属与时序无关的（如输入聚焦）请在 NUMERIC_TIMER_EXCEPTIONS 登记并写明理由。',
    ).toEqual([])
    // 死登记同样转红：豁免不得变成永久口子（在册项必须仍命中一个真实消费点）
    const dead = Object.keys(NUMERIC_TIMER_EXCEPTIONS).filter((k) => !hits.includes(k))
    expect(dead, `豁免已过期（当前扫不到对应计时器，请删登记项）：\n${dead.join('\n')}`).toEqual([])
  })

  it('退场计时器只有一个实现点，且时长不是字面量（令牌同源计时器）', () => {
    // ⚠️ 口径（实测踩出来的）：**不能**写成「组件层零 setTimeout 字面量」——
    //    SearchSheet 有一个 50ms 的输入框聚焦计时器（ADR-0132 自动聚焦），与动效无关，
    //    那种判据会把合法代码判红 ⇒ 收窄到「承载退场的那一个计时器」。
    //    判据形态 = 全仓扫描面上，以 holdMs 为延迟的 setTimeout 只有一个文件：
    //    协议模块（ADR-0211 决策 3：计时器时长必须取与退场动画同源的令牌值）。
    const holdMsTimers = SRC_FILES.filter((f) =>
      // 剥注释：motion.ts 的用法示例里就写着 `setTimeout(…, holdMs)`，扫原文会把注释当实现
      /setTimeout\([\s\S]{0,300}?\bholdMs\b/.test(stripComments(f.text)),
    ).map((f) => f.name)
    expect(
      holdMsTimers,
      '退场计时器必须只有协议模块一处（多处 = 又一份时序，退场窗口会彼此不同步）：\n' +
        holdMsTimers.join('\n'),
    ).toEqual(['composables/useSheetDismiss.ts'])
    // 协议模块内不得出现数字延迟
    const composable = readFileSync(join(SRC_ROOT, 'composables', 'useSheetDismiss.ts'), 'utf8')
    const literals = setTimeoutDelayLiterals(composable)
    expect(literals, `协议模块出现数字延迟：${literals.join(', ')}`).toEqual([])
  })

  it('协议模块自身的计时器时长与退场预设同源（不是另一份数值）', () => {
    const code = readFileSync(join(SRC_ROOT, 'composables', 'useSheetDismiss.ts'), 'utf8')
    // holdMs 必须从 exit() 预设对象上取，而不是 MOTION_DURATION_MS 之类另抄一份
    expect(holdMsSourcedFromExitPreset(code), 'holdMs 未取自退场预设（与动画脱钩的两份数值）').toBe(
      true,
    )
    // 时长位零字面量（唯一入口纪律）
    const literals = motionDeclarations(code).flatMap((d) => durationLiteralsIn(d))
    expect(literals, `协议模块出现时长字面量：${literals.join(', ')}`).toEqual([])
  })

  it('阳性对照：判据内核对「setTimeout 写死 200」「holdMs 另抄」「两处退场计时器」会转红', () => {
    // ① 第一个实参是带括号的箭头函数：早期版本的正则 `[^,()]+` 在这里匹配不上（假阴性）
    expect(setTimeoutDelayLiterals('setTimeout(() => (open.value = false), 200)')).toEqual(['200'])
    expect(setTimeoutDelayLiterals('setTimeout(() => hide(), holdMs)')).toEqual([])
    expect(setTimeoutDelayLiterals('setTimeout(finish, 200)')).toEqual(['200'])
    // ② 另抄一份时长
    expect(holdMsSourcedFromExitPreset('const holdMs = MOTION_DURATION_MS.fast')).toBe(false)
    expect(holdMsSourcedFromExitPreset('const holdMs = exit({ animationName: "x" }).holdMs')).toBe(
      true,
    )
    // ③ 组件里自己写退场计时器 ⇒ 「唯一实现点」判据点名两个文件
    const polluted = [
      { name: 'composables/useSheetDismiss.ts', text: 'setTimeout(finish, holdMs)' },
      { name: 'components/BottomSheet.vue', text: 'setTimeout(() => emit("close"), holdMs)' },
    ]
    expect(
      polluted.filter((f) => /setTimeout\([\s\S]{0,300}?\bholdMs\b/.test(f.text)).map((f) => f.name),
    ).toHaveLength(2)
    // ④ 相位 prop 未接 / 传的不是相位：两种都判红
    expect(phasePropDriven('<BottomSheet :motion-phase="phase" />', 'motion-phase')).toBe(false)
    expect(phasePropDriven('<BottomSheet />', 'motion-phase')).toBe(false)
    expect(
      phasePropDriven(
        'const motionPhase = computed(() => (dismiss.phase.value === "enter" ? "enter" : "exit"))\n<BottomSheet :motion-phase="motionPhase" />',
        'motion-phase',
      ),
    ).toBe(true)
    // 未接线 / 已接线两态可分（判据不是恒真）
    expect(wiringKindOf('<view class="a" />')).toBe('none')
    expect(wiringKindOf('<BottomSheet :motion-phase="phase" />')).toBe('none')
    expect(wiringKindOf('<view :style="scrimStyle" />')).toBe('none')
    expect(
      wiringKindOf(
        'const scrimStyle = computed(() => dismiss.scrimStyle(dismiss.phase.value))\n<view :style="scrimStyle" />',
      ),
    ).toBe('bound')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// S3 · 降级与死类名：R1 归零、R2 置 none、transform 工具类零新增
// ───────────────────────────────────────────────────────────────────────────

describe('S3 · 降级通路与死类名（构建全绿、渲染为空那一格）', () => {
  it('7 个弹层的 :style 绑定只经 animation 通道，无 opacity/transform 过渡类挂载', () => {
    // `.transition-colors` 的 transition-property 不含 opacity/transform（ADR-0211 决策 2），
    // 挂上去是静默失效 ⇒ 判据是「弹层文件里不出现 transition-* 类 token」。
    const hits: string[] = []
    for (const f of OVERLAY_FILES) {
      for (const token of classTokens(readFileSync(join(COMPONENTS_DIR, f), 'utf8'))) {
        if (/^transition(?:-|$)/.test(token)) hits.push(`${f} | ${token}`)
      }
    }
    expect(
      hits,
      `弹层上挂了 transition 类（Lynx 侧 opacity/transform 过渡不覆盖它，静默失效）：\n${hits.join('\n')}`,
    ).toEqual([])
  })

  it('7 个弹层零死 transform 工具类（必须走 inline :style 或 @keyframes）', () => {
    const hits: string[] = []
    for (const f of OVERLAY_FILES) {
      for (const token of classTokens(readFileSync(join(COMPONENTS_DIR, f), 'utf8'))) {
        if (DEAD_TRANSFORM_CLASS.test(token)) hits.push(`${f} | ${token}`)
      }
    }
    expect(
      hits,
      'transform 族工具类是死类名（规则引用的 --tw-* 从未定义 ⇒ 渲染 transform: none，ADR-0210 路径 E）：\n' +
        hits.join('\n'),
    ).toEqual([])
    // 阴性对照：帧体里的 CSS 函数值不得被误判成工具类
    expect(DEAD_TRANSFORM_CLASS.test('translateY(100%)')).toBe(false)
    expect(DEAD_TRANSFORM_CLASS.test('scale(0.92)')).toBe(false)
  })

  it('降级形态来自 motion.ts 预设本身（弹层不得自行判断偏好）', () => {
    // 协议模块只调 enter()/exit()，reduced 由 useMotion 的 ref 喂进去；
    // 弹层文件里若出现自建 matchMedia / 媒体查询串即为第二份实现。
    const selfBuilt = OVERLAY_FILES.filter((f) =>
      /matchMedia\(|\(prefers-reduced-motion/.test(
        stripComments(readFileSync(join(COMPONENTS_DIR, f), 'utf8')),
      ),
    )
    expect(selfBuilt, `弹层自建偏好读取：${selfBuilt.join(', ')}`).toEqual([])
    // 档位来自令牌表：enter/exit 两档的时长与曲线都在 motion.ts 的登记表里
    expect(MOTION_DURATION.medium).toMatch(/^var\(--duration/)
    expect(MOTION_DURATION.fast).toMatch(/^var\(--duration/)
    expect(MOTION_EASING.decelerate).toMatch(/^var\(--motion-/)
    expect(MOTION_EASING.accelerate).toMatch(/^var\(--motion-/)
  })

  it('阳性对照：判据内核对「自建 matchMedia」「死类名」「transition 挂 opacity」会转红', () => {
    const probe = '<view class="card active:scale-95 transition-opacity" @tap="x" />'
    expect(classTokens(probe).filter((t) => DEAD_TRANSFORM_CLASS.test(t))).toEqual([
      'active:scale-95',
    ])
    expect(classTokens(probe).filter((t) => /^transition(?:-|$)/.test(t))).toEqual([
      'transition-opacity',
    ])
    expect(/matchMedia\(/.test('const m = window.matchMedia(x)')).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// S4 · 规模线自检（门禁不得超过被测对象的 30%）
// ───────────────────────────────────────────────────────────────────────────

describe('S4 · 规模线自检（防给回归创造就业）', () => {
  it('门禁行数 ≤ 动效消费面行数的 30%', () => {
    const countLines = (p: string): number => readFileSync(p, 'utf8').split('\n').length
    const subject =
      countLines(join(SRC_ROOT, 'composables', 'motion.ts')) +
      countLines(join(SRC_ROOT, 'composables', 'useSheetDismiss.ts')) +
      OVERLAY_FILES.reduce((n, f) => n + countLines(join(COMPONENTS_DIR, f)), 0)
    const gate = countLines(fileURLToPath(import.meta.url))
    const ratio = (gate / subject) * 100
    expect(subject, `被测对象 ${subject} 行，下界应 ≥ 800`).toBeGreaterThanOrEqual(800)
    expect(
      ratio,
      `门禁 ${gate} 行 / 被测对象 ${subject} 行 = ${ratio.toFixed(1)}%，超 30% 规模线。\n` +
        '先问「我是在防回归，还是在给回归创造就业」，答不上来就不要加。',
    ).toBeLessThanOrEqual(30)
  })
})
