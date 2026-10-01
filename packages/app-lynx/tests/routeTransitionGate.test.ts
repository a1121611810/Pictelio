// ─── 路由转场契约门禁（issue #880；对应 ADR-0211 决策 6 的可辨识方向差 + 能力削减登记）───
//
// ── 为什么需要这个文件（背景，别只当格式检查看）───
// 「前进从右滑入 / 后退从左回位」是一条**纯视觉**契约：它没有类型、没有返回值、
// 没有任何编译期信号。把 forward 与 back 写成同一条 keyframes、或把 back 写成 forward
// 的严格镜像，**构建全绿、类型过、单测过、产物里有规则** —— 只有真机录屏才看得出来
// （这正是 #880 这个 issue 本身的存在理由：此前根本没有转场）。
// ⇒ 必须有机器判据把「方向差」钉住，否则下一个改样式的人会无声地把它抹平。
//
// ── 判据纪律（沿用本仓 motionContract.test.ts 的三条）───
// ① 判据形态 = **机器可数的结构**：从 CSS 源里抽 keyframes 帧体的 transform/opacity，
//    不扫散文找关键词（扫散文是脆弱面制造机，本仓已因此连踩三次）。
// ② **每条规则自带阳性对照**：把违规形态喂进同一个判据内核必须被点名。
// ③ **扫描面下界**：抽取器静默塌陷时「零违规」与「真无违规」同形 ⇒ 先证明扫到了东西。
//
// ── 期望值出处（oracle 溯源，禁自洽反推）───
// · 方向差的正负号 = ADR-0211 决策 6 方向表：forward「新页面从右侧滑入」= 正向位移，
//   back「旧页面从左侧回位」= 反向位移。
// · forward 带 fade 而 back 不带 = 同一张表的逐行差异（forward 行写明「+ 轻微 fade」，
//   back 行只写「从左侧回位」）。这同时是「不得是同一段动画正放倒放」的机器化（#880 验收 1）。
// · 帧体零时长/曲线字面量 = ADR-0211 决策 1（时长曲线的唯一入口是 composables/motion.ts）。
// · 零 transform 族工具类 = ADR-0210 路径 E（死类名：产出规则但 --tw-* 从未定义 ⇒ 渲染 none）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ROUTE_TRANSITION_ANIMATION,
  ROUTE_TRANSITION_DURATION,
  ROUTE_TRANSITION_EASING,
} from '../src/composables/routeTransition'

const APP_VUE = fileURLToPath(new URL('../src/App.vue', import.meta.url))
const ROUTER_TS = fileURLToPath(new URL('../src/router.ts', import.meta.url))
const appSrc = readFileSync(APP_VUE, 'utf8')
const routerSrc = readFileSync(ROUTER_TS, 'utf8')

/** 去注释（约束说明本身会画出反面示例，判据必须落在代码本文上） */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

// ── 抽取器（brace 平衡扫描：帧体是嵌套块，非贪婪正则会在第一层 `}` 就截断）───

/** 抽出全部 `@keyframes <name> { … }` 的帧体，键 = 动画名 */
function extractKeyframes(src: string): Record<string, string> {
  const code = stripComments(src)
  const out: Record<string, string> = {}
  const re = /@keyframes\s+([a-zA-Z][\w-]*)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    let depth = 1
    let i = re.lastIndex
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++
      else if (code[i] === '}') depth--
      i++
    }
    out[m[1]!] = code.slice(re.lastIndex, i - 1)
  }
  return out
}

/** 帧体里 `from { … }` 的内容（缺 from 时返回空串） */
function fromFrame(body: string): string {
  const m = /(?:^|\})\s*from\s*\{([^}]*)\}/.exec(body)
  return m?.[1] ?? ''
}

/** `translateX(N%)` 的 N（带符号）；没有则返回 null */
function translateXPercent(frame: string): number | null {
  const m = /translateX\(\s*(-?\d*\.?\d+)%\s*\)/.exec(frame)
  return m ? Number(m[1]) : null
}

/** 帧体是否带 opacity 变化（`from` 与 `to` 的 opacity 不同，或 from 显式给了 opacity） */
function hasOpacityChange(body: string): boolean {
  return /\bopacity\s*:/.test(fromFrame(body))
}

/** 帧体里是否出现时长/曲线字面量（决策 1：时长曲线只能来自 motion.ts） */
function motionLiteralsIn(body: string): string[] {
  const out: string[] = []
  for (const tok of body.split(/[\s;{}]+/).filter(Boolean)) {
    if (/^\d*\.?\d+(?:ms|s)$/.test(tok)) out.push(tok)
    if (/^(?:cubic-bezier|steps|linear|ease)\(/.test(tok)) out.push(tok)
  }
  return out
}

// ── Tailwind transform 族工具类（与 motionContract M3 同款 token 形态；`scale(0.96)` 这类
//    路径 B 的合法 inline CSS 函数值**不**算工具类，括号形态必须放行）───
const DEAD_TRANSFORM_CLASS =
  /(?:^|\s)(?:[a-z-]+:)*-?(?:scale|rotate|skew|translate-[xy])-[^\s"'`:]+/

// ───────────────────────────────────────────────────────────────────────────
// C1 · 方向差：两方向的位移必须异号（#880 验收 1）
// ───────────────────────────────────────────────────────────────────────────

/** 一对方向帧体的判红清单（正向判据，与反事实用例共用同一实现） */
function findDirectionViolations(
  frames: Record<string, string>,
  fwd: readonly [string, string],
  bck: readonly [string, string],
): string[] {
  const violations: string[] = []
  for (const [tag, pair] of [
    ['forward', fwd],
    ['back', bck],
  ] as const) {
    for (const name of pair) {
      const body = frames[name]
      if (body === undefined) {
        violations.push(`${tag}: 缺 @keyframes ${name}（抽取器没扫到定义方）`)
        continue
      }
      const x = translateXPercent(fromFrame(body))
      if (x === null) {
        violations.push(`${name}: from 帧没有 translateX(…)（滑动方向不可判定）`)
        continue
      }
      const wantPositive = tag === 'forward'
      if (wantPositive ? x <= 0 : x >= 0) {
        violations.push(
          `${name}: from 位移 ${x}% 方向错误 —— ` +
            `${wantPositive ? 'forward 必须为正（从右侧滑入）' : 'back 必须为负（从左侧回位）'}`,
        )
      }
    }
  }
  return violations
}

describe('C1 · 前进/后退有可辨识的方向差（#880 验收 1）', () => {
  it('扫描面下界：抽取器真的抽到了 4 条 route keyframes（防正则静默塌陷）', () => {
    const frames = extractKeyframes(appSrc)
    const names = Object.keys(frames)
    for (const pair of [ROUTE_TRANSITION_ANIMATION.forward, ROUTE_TRANSITION_ANIMATION.back]) {
      for (const n of pair) {
        expect(frames[n], `App.vue 里找不到 @keyframes ${n}（唯一定义方丢了？）`).toBeTypeOf('string')
        expect(frames[n]!.length, `${n} 帧体为空`).toBeGreaterThan(0)
      }
    }
    // 锚点：证明抽取器认得本仓既有的全局 keyframes（同一形态的对照组）
    expect(names).toContain('shimmer')
    expect(frames['shimmer']).toContain('background-position')
    // 变体必须帧体不同名（重播机制），且两方向各 2 条
    expect(ROUTE_TRANSITION_ANIMATION.forward[0]).not.toBe(ROUTE_TRANSITION_ANIMATION.forward[1])
    expect(ROUTE_TRANSITION_ANIMATION.back[0]).not.toBe(ROUTE_TRANSITION_ANIMATION.back[1])
  })

  it('App.vue 的两个方向帧体异号：forward 正 / back 负（ADR-0211 决策 6 方向表）', () => {
    const violations = findDirectionViolations(
      extractKeyframes(appSrc),
      ROUTE_TRANSITION_ANIMATION.forward,
      ROUTE_TRANSITION_ANIMATION.back,
    )
    expect(violations, `方向差失效：\n${violations.join('\n')}`).toEqual([])
  })

  it('不得是「同一段动画正放倒放」：forward 带 fade 而 back 纯位移', () => {
    const frames = extractKeyframes(appSrc)
    const fwd = ROUTE_TRANSITION_ANIMATION.forward[0]!
    const bck = ROUTE_TRANSITION_ANIMATION.back[0]!
    expect(
      hasOpacityChange(frames[fwd]!),
      'forward 应带轻微 fade（ADR-0211 决策 6 方向表 forward 行）',
    ).toBe(true)
    expect(
      hasOpacityChange(frames[bck]!),
      'back 带上了 fade ⇒ 两个方向退化成同一段动画的正放/倒放（#880 验收 1 明确不接受）',
    ).toBe(false)
  })

  it('变体帧体与本体逐字同形（重播机制，不得漂成另一种动画）', () => {
    const frames = extractKeyframes(appSrc)
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
    expect(norm(frames[ROUTE_TRANSITION_ANIMATION.forward[1]!])).toBe(
      norm(frames[ROUTE_TRANSITION_ANIMATION.forward[0]!]),
    )
    expect(norm(frames[ROUTE_TRANSITION_ANIMATION.back[1]!])).toBe(
      norm(frames[ROUTE_TRANSITION_ANIMATION.back[0]!]),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// C2 · 帧体零字面量 + 零死类名（ADR-0211 决策 1 / ADR-0210 路径 E）
// ───────────────────────────────────────────────────────────────────────────

describe('C2 · 位移与时长只走已验证通道', () => {
  it('帧体里不得出现时长/曲线字面量（唯一入口是 composables/motion.ts）', () => {
    const frames = extractKeyframes(appSrc)
    const violations: string[] = []
    for (const [name, body] of Object.entries(frames)) {
      if (!name.startsWith('route-')) continue
      for (const lit of motionLiteralsIn(body)) violations.push(`${name}: ${lit}`)
    }
    expect(
      violations,
      `转场帧体里出现时长/曲线字面量（应经 motion.ts 的 enter() 拼装后 inline 下发）：\n` +
        violations.join('\n'),
    ).toEqual([])
  })

  it('转场容器不得挂 transform 族 Tailwind 工具类（死类名，ADR-0210 路径 E）', () => {
    const line = appSrc
      .split('\n')
      .find((l) => l.includes(':style="routeTransition.style.value"'))
    expect(line, 'App.vue 里找不到绑 routeTransition.style 的容器（转场接线断了）').toBeDefined()
    const classAttr = /class="([^"]*)"/.exec(line!)?.[1] ?? ''
    const dead = classAttr.split(/\s+/).filter((t) => DEAD_TRANSFORM_CLASS.test(t))
    expect(
      dead,
      `transform 族工具类是**死类名**（产出规则但引用的 --tw-* 从未定义 ⇒ 渲染 transform: none）：${dead.join(', ')}`,
    ).toEqual([])
  })

  it('App.vue 不出现 animation 简写字面量（时长曲线不得旁路 motion.ts）', () => {
    const code = stripComments(appSrc)
    const decls = [...code.matchAll(/\banimation\s*:\s*([^;{}]+)/g)].map((m) => m[1]!.trim())
    // 本仓既有 animation 声明只有 .shimmer 一条（走 --shimmer-motion 令牌），转场不得新增
    const routeish = decls.filter((d) => d.startsWith('route-'))
    expect(routeish, `App.vue 出现转场 animation 简写字面量：${routeish.join(' | ')}`).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// C3 · 接线契约：方向必须从导航层到达页面容器（#880 验收 2）
// ───────────────────────────────────────────────────────────────────────────

describe('C3 · 转场在导航层自建，零逐页改动', () => {
  it('App.vue：包裹层在 RouterView 槽内、KeepAlive 仍在其内（缓存语义不被破坏）', () => {
    const code = stripComments(appSrc)
    const slot = /<RouterView[^>]*>([\s\S]*?)<\/RouterView>/.exec(code)?.[1] ?? ''
    expect(slot, 'App.vue 里找不到 RouterView 槽').not.toBe('')
    const wrapAt = slot.indexOf(':style="routeTransition.style.value"')
    const keepAliveAt = slot.indexOf('<KeepAlive')
    const compAt = slot.indexOf('<component :is="Component"')
    expect(wrapAt, '转场容器不在 RouterView 槽内').toBeGreaterThan(-1)
    expect(keepAliveAt, 'KeepAlive 从 RouterView 槽里消失了').toBeGreaterThan(-1)
    expect(compAt, '动态组件从 RouterView 槽里消失了').toBeGreaterThan(-1)
    // 顺序：容器 ⊃ KeepAlive ⊃ 组件（顺序错 = 缓存被容器重挂载打断）
    expect(wrapAt, '转场容器必须包在 KeepAlive 外层').toBeLessThan(keepAliveAt)
    expect(keepAliveAt).toBeLessThan(compAt)
  })

  it('router.ts：三条导航出口都写了方向意图，且方向由 afterEach 落成', () => {
    const code = stripComments(routerSrc)
    // 负向断言把函数**声明**排除掉（声明长得也像调用点，不排掉会把计数口径搞脏）
    const intents = [...code.matchAll(/(?<!function )requestRouteTransition\(([^)]*)\)/g)].map(
      (m) => m[1]!,
    )
    // ① 无匹配兜底 replace('/login') ② replace 分支 ③ push 分支 ④⑤ goBack 的两条分支
    expect(intents.length, `navigate/goBack 的方向入口数 = ${intents.length}，应为 5`).toBe(5)
    expect(
      intents.filter((i) => i.includes("declared: 'back'")).length,
      'goBack 的两条分支都必须显式声明 back（返回手势的语义覆盖物理实现）',
    ).toBe(2)
    expect(
      intents.filter((i) => i.includes('replace: true')).length,
      'replace 出口必须走 replace 档（深链直达不挂转场，#880 验收 4）',
    ).toBe(2)
    // 方向落成点必须在 afterEach（时序：新页首帧即带动画）
    expect(code).toMatch(/router\.afterEach\(\(to, _from, failure\)/)
    expect(code).toContain('commitRouteTransition(to.fullPath, failure)')
  })

  it('档位是令牌引用（无时长/曲线字面量写进源码）', () => {
    const code = stripComments(readFileSync(
      fileURLToPath(new URL('../src/composables/routeTransition.ts', import.meta.url)),
      'utf8',
    ))
    // 档位以标识符形式声明（值由 motion.ts 的档位表给出）
    expect(code).toMatch(/ROUTE_TRANSITION_DURATION:\s*MotionDurationKey\s*=/)
    expect(code).toMatch(/ROUTE_TRANSITION_EASING:\s*MotionEasingKey\s*=/)
    // 不得出现 var(--durationX) 之外的自造时长：直接断言无裸时间单位
    const literals = code.split(/[\s;()]+/).filter((t) => /^\d*\.?\d+(?:ms|s)$/.test(t))
    expect(literals, `routeTransition.ts 出现时长字面量：${literals.join(', ')}`).toEqual([])
    // 档位名必须是 motion.ts 真实存在的档（防拼错档名静默取到 undefined）
    expect(['fast', 'normal', 'medium', 'gentle', 'longer', 'loop']).toContain(
      ROUTE_TRANSITION_DURATION,
    )
    expect(['standard', 'emphasized', 'accelerate', 'decelerate']).toContain(ROUTE_TRANSITION_EASING)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 反事实（阳性 + 阴性对照）：判据必须自带可被证伪的对照组
// ───────────────────────────────────────────────────────────────────────────

describe('反事实 · 判据内核对已知坏输入必须转红', () => {
  it('阳性：back 写成与 forward 同号 ⇒ 方向差判红', () => {
    // 真实会犯的错：复制 forward 的帧体改成 back，只改了名字没改符号
    const bad = {
      'route-forward-in': 'from { opacity: 0; transform: translateX(8%); } to { opacity: 1; }',
      'route-forward-in-alt': 'from { opacity: 0; transform: translateX(8%); } to { opacity: 1; }',
      'route-back-in': 'from { opacity: 0; transform: translateX(8%); } to { opacity: 1; }',
      'route-back-in-alt': 'from { opacity: 0; transform: translateX(8%); } to { opacity: 1; }',
    }
    const violations = findDirectionViolations(
      bad,
      ROUTE_TRANSITION_ANIMATION.forward,
      ROUTE_TRANSITION_ANIMATION.back,
    )
    expect(violations, '同号 back 未被点名 ⇒ C1 是假绿').toEqual(
      expect.arrayContaining([expect.stringContaining('back 必须为负')]),
    )
  })

  it('阳性：两个方向都没有位移（退化成纯 fade）⇒ 方向差判红', () => {
    const bad = {
      'route-forward-in': 'from { opacity: 0; } to { opacity: 1; }',
      'route-forward-in-alt': 'from { opacity: 0; } to { opacity: 1; }',
      'route-back-in': 'from { opacity: 0; } to { opacity: 1; }',
      'route-back-in-alt': 'from { opacity: 0; } to { opacity: 1; }',
    }
    expect(findDirectionViolations(bad, ROUTE_TRANSITION_ANIMATION.forward, ROUTE_TRANSITION_ANIMATION.back))
      .toHaveLength(4)
  })

  it('阳性：缺一条 keyframes 定义 ⇒ 判红（而不是「扫不到就放过」）', () => {
    const partial = { 'route-forward-in': 'from { transform: translateX(8%); } to { transform: none; }' }
    expect(
      findDirectionViolations(partial, ROUTE_TRANSITION_ANIMATION.forward, ROUTE_TRANSITION_ANIMATION.back),
    ).toEqual(expect.arrayContaining([expect.stringContaining('缺 @keyframes')]))
  })

  it('阴性：合法的异号帧体零违规（证明上一条不是「一律点名」）', () => {
    const good = {
      'route-forward-in': 'from { opacity: 0; transform: translateX(8%); } to { opacity: 1; }',
      'route-forward-in-alt': 'from { opacity: 0; transform: translateX(8%); } to { opacity: 1; }',
      'route-back-in': 'from { transform: translateX(-8%); } to { transform: none; }',
      'route-back-in-alt': 'from { transform: translateX(-8%); } to { transform: none; }',
    }
    expect(findDirectionViolations(good, ROUTE_TRANSITION_ANIMATION.forward, ROUTE_TRANSITION_ANIMATION.back))
      .toEqual([])
  })

  it('阳性：帧体里写死时长 / 挂死类名 ⇒ C2 判红', () => {
    expect(motionLiteralsIn('from { transform: translateX(8%); animation-timing: 250ms; }')).toEqual([
      '250ms',
    ])
    expect(
      'absolute inset-0 translate-x-8 scale-95'.split(/\s+/).filter((t) => DEAD_TRANSFORM_CLASS.test(t)),
    ).toEqual(['translate-x-8', 'scale-95'])
  })

  it('阴性：帧体里的合法 CSS 值不被误伤（translateX / 路径 B 的 scale 函数）', () => {
    expect(motionLiteralsIn('from { transform: translateX(-8%); } to { transform: translateX(0); }'))
      .toEqual([])
    expect(DEAD_TRANSFORM_CLASS.test('scale(0.96)'), '路径 B 的合法 inline 值被误判').toBe(false)
    expect(DEAD_TRANSFORM_CLASS.test('w-full'), '正常类名被误判').toBe(false)
  })
})
