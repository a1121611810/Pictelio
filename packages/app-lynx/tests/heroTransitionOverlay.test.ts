// heroTransition **覆盖层状态机 + 几何**单测（ADR-0211 决策 12 机制 2/4）。
//
// 关注三件事，都是「静默失效就会看不见」的地方：
//   ① 两拍起手：from 态必须先落位再切 to 态，否则过渡没有插值起点（直接跳到终点）；
//   ② 比例差靠**插值布局盒**（width/height）吸收，**不靠 transform: scale** ——
//      断言里显式禁止出现 scale(，这是决策 12 机制 2 的实现口径，也是变形的唯一来源；
//   ③ 收尾计时器与过渡同源（同一 duration 档的数值镜像），且 R1 开启时过渡**根本不生成**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { HERO_HOLD_MS, heroTransitionValue, useHeroOverlay, type HeroPlayInput } from '../src/composables/heroTransition'
import { MOTION_DURATION_MS } from '../src/composables/motion'
import type { BoundingRect } from '../src/primitives/measureRects'

const R = (left: number, top: number, width: number, height: number): BoundingRect => ({
  left,
  top,
  width,
  height,
})
/** 合成输入：缩略图盒是正方形（1:1），hero 盒是 4:5 ⇒ 两者比例**不同**，比例差必须被吸收 */
const THUMB = R(60, 900, 500, 500)
const HERO = R(0, 320, 1080, 1350)
/** 页面根在视口坐标系里 top=40（模拟安全区）⇒ 换算不是恒等映射，能查出「忘了减根原点」 */
const ROOT = R(0, 40, 1080, 2000)
const SRC = 'https://i.pximg.net/proxy.jpg'

const input = (over: Partial<HeroPlayInput> = {}): HeroPlayInput => ({
  from: THUMB,
  to: HERO,
  root: ROOT,
  src: SRC,
  ...over,
})

/** matchMedia 假实现：matches=false = 未开启减弱动效 */
const noPreference = { matchMedia: () => ({ matches: false, addEventListener: () => {} }) }
/** matchMedia 假实现：matches=true = 开启（R1） */
const reduced = { matchMedia: () => ({ matches: true, addEventListener: () => {} }) }

/** 可手工推进的 rAF 队列：两拍起手要断言「第一拍还没到 to」 */
function stubRaf(): { flushOne(): void } {
  const queue: ((t: number) => void)[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => queue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  return {
    flushOne() {
      queue.shift()?.(0)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('覆盖层时序：两拍起手 + 计时器收尾', () => {
  it('from 态先落位（不挂 transition）→ 下一拍才切 to 态并挂过渡', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input())

    // 拍 0：覆盖层已在起点盒上（观感上盖住被点的缩略图 ⇒ 多出的这几帧是连续的）
    expect(overlay.phase.value).toBe('from')
    expect(overlay.style.value).toEqual({
      left: '60px',
      top: '860px',
      width: '500px',
      height: '500px',
      transform: 'translate(0px, 0px)',
    })
    // 关键：from 态**不得**带 transition（带了也没有起点值，等于同义反复）
    expect(overlay.style.value.transition).toBeUndefined()

    raf.flushOne()
    expect(overlay.phase.value, '第一拍只排第二拍，不能提前切 to').toBe('from')

    raf.flushOne()
    expect(overlay.phase.value).toBe('to')
    overlay.dispose()
  })

  it('to 态：宽高按终点盒插值 + 位移走 transform；left/top 保持起点不动', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input())
    raf.flushOne()
    raf.flushOne()

    const style = overlay.style.value
    // 终点盒 1080×1350（比例 4:5）与起点 500×500（1:1）不同 ⇒ 宽高都必须变
    expect(style.width).toBe('1080px')
    expect(style.height).toBe('1350px')
    // 位移只经 transform（left/top 是定位属性，本仓无实证消费面，不参与过渡）
    expect(style.transform).toBe('translate(-60px, -580px)')
    expect(style.left).toBe('60px')
    expect(style.top).toBe('860px')
    expect(style.transition).toContain('transform')
    expect(style.transition).toContain('width')
    expect(style.transition).toContain('height')
    overlay.dispose()
  })

  it('无 rAF 的引擎退到宏任务：仍先提交 from 再切 to（不是同步塌缩）', () => {
    vi.unstubAllGlobals() // node 环境本就无 rAF
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input())
    expect(overlay.phase.value).toBe('from')
    vi.advanceTimersByTime(0)
    expect(overlay.phase.value).toBe('to')
    overlay.dispose()
  })

  it('计时器到点收尾：覆盖层撤下（visible=false）且不留任何过渡声明', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input())
    raf.flushOne()
    raf.flushOne()
    expect(overlay.visible.value).toBe(true)

    vi.advanceTimersByTime(HERO_HOLD_MS - 1)
    expect(overlay.phase.value, '计时器与过渡同源 ⇒ 到点才收尾').toBe('to')

    vi.advanceTimersByTime(1)
    expect(overlay.phase.value).toBe('done')
    expect(overlay.visible.value).toBe(false)
    // 静息态是**空对象**（R1「不挂过渡声明」的最强形态），不是残留的 transform
    expect(overlay.style.value).toEqual({})
    overlay.dispose()
  })

  it('cancel：动画途中被取消（提前返回 / 再次导航）后计时器与 rAF 都失效', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input())
    overlay.cancel('cancelled')
    expect(overlay.phase.value).toBe('idle')
    expect(overlay.visible.value).toBe(false)

    raf.flushOne()
    raf.flushOne()
    vi.advanceTimersByTime(HERO_HOLD_MS * 2)
    expect(overlay.phase.value, '取消后不得再自行推进').toBe('idle')
    overlay.dispose()
  })
})

describe('覆盖层降级（宁可没有连续性，也不要一个空白矩形在屏幕上放大）', () => {
  it('R1 减弱动效：过渡**根本不生成**（不是挂 0ms）', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(reduced)
    overlay.play(input())
    expect(overlay.phase.value).toBe('idle')
    expect(overlay.style.value).toEqual({})
    raf.flushOne()
    raf.flushOne()
    expect(overlay.phase.value).toBe('idle')
    overlay.dispose()
  })

  it('起点在视口外（横向轮播的非当前页）→ 降级，不从屏外起飞', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input({ from: R(-4000, 900, 500, 500) }))
    expect(overlay.phase.value).toBe('idle')
    expect(overlay.visible.value).toBe(false)
    overlay.dispose()
  })

  it('尺寸非法（0 高）→ 降级', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input({ to: R(0, 320, 1080, 0) }))
    expect(overlay.phase.value).toBe('idle')
    overlay.dispose()
  })

  it('没有图片地址 → 降级（覆盖层画不出那张图）', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input({ src: '' }))
    expect(overlay.phase.value).toBe('idle')
    overlay.dispose()
  })
})

describe('时长/曲线契约（oracle = tokens.css 与 motion.ts 档位表，不是实现自身）', () => {
  it('heroTransitionValue 只列三条已实证通道，且零时长/曲线字面量', () => {
    const value = heroTransitionValue()
    expect(value).toBe(
      [
        `transform ${'var(--durationGentle)'} var(--motion-emphasized-decelerate)`,
        `width ${'var(--durationGentle)'} var(--motion-emphasized-decelerate)`,
        `height ${'var(--durationGentle)'} var(--motion-emphasized-decelerate)`,
      ].join(', '),
    )
    // 决策 1：时长与曲线的唯一入口是 motion.ts ⇒ 产物里不得出现任何字面量
    expect(value).not.toMatch(/[0-9]+m?s\b/)
    expect(value).not.toContain('cubic-bezier')
    // 定位属性不参与过渡（ADR-0210：未验证的路径不押注）
    expect(value).not.toContain('left')
    expect(value).not.toContain('top')
  })

  it('比例差由插值布局盒吸收：全程不出现 scale(（非等比缩放会把已裁好的位图再拉伸 = 变形）', () => {
    const raf = stubRaf()
    const overlay = useHeroOverlay(noPreference)
    overlay.play(input())
    expect(overlay.style.value.transform).not.toContain('scale')
    raf.flushOne()
    raf.flushOne()
    expect(overlay.style.value.transform).not.toContain('scale')
    expect(heroTransitionValue()).not.toContain('scale')
    overlay.dispose()
  })

  it('HERO_HOLD_MS = 300ms，与 tokens.css 的 --durationGentle 逐字一致（独立事实源）', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/styles/tokens.css'), 'utf-8')
    const declared = /--durationGentle:\s*(\d+)ms/.exec(css)
    expect(declared, 'tokens.css 未声明 --durationGentle').not.toBeNull()
    expect(HERO_HOLD_MS).toBe(Number(declared![1]))
    // 同时钉住「与动画同源」：镜像值必须等于该档的数值
    expect(HERO_HOLD_MS).toBe(MOTION_DURATION_MS.gentle)
  })
})
