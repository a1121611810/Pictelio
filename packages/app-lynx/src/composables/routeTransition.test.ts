// ─── 路由转场时序单测（issue #880；契约见 ADR-0211 决策 6 / 决策 3）───
//
// 期望值出处（oracle 溯源，禁自洽反推）：
// · 时长/曲线档位 → 断言的是**对 `src/styles/tokens.css` 的引用形态**（`var(--durationGentle)` /
//   `var(--motion-emphasized-decelerate)`），令牌**值**现场解析，不在本文件抄数字；
//   同时断言 `--durationGentle` = 300ms（M3 duration scale 的 medium2 档，shared axis X 的官方时长）。
// · 两段式计时器 → 必须等于**同一档**的数值镜像 `MOTION_DURATION_MS`（决策 3 的「令牌同源」），
//   不是另抄的一份数值。
// · 方向语义 → ADR-0211 决策 6 的方向表：forward 从右侧滑入（正向位移）、back 从左侧回位（反向位移）。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nextTick } from 'vue'
import {
  ROUTE_TRANSITION_ANIMATION,
  ROUTE_TRANSITION_DURATION,
  ROUTE_TRANSITION_EASING,
  ROUTE_TRANSITION_HOLD_MS,
  beginRouteTransition,
  decideRouteDirection,
  resetRouteTransitionForTest,
  routeTransitionDirection,
  useRouteTransition,
} from './routeTransition'
import { MOTION_DURATION_MS } from './motion'

const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
  'utf8',
)

/** 现场解析 tokens.css 某变量的值（oracle 不写死在本文件） */
function tokenValue(name: string): string {
  return TOKENS_CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? ''
}

/** 注入一个可控的 matchMedia（单测注入口，见 useReducedMotion 头注） */
function fakeMatchMedia(matches: boolean) {
  return () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} })
}

/** 动画简写里的时长位字面量（判据形态：CSS 时间单位 token） */
const DURATION_LITERAL = /^\d*\.?\d+(?:ms|s)$/

beforeEach(() => {
  resetRouteTransitionForTest()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('decideRouteDirection · 方向裁决（纯函数，node 可单测）', () => {
  it('push（未声明）= forward：进入更深层级', () => {
    expect(decideRouteDirection({})).toBe('forward')
    expect(decideRouteDirection()).toBe('forward')
  })

  it('replace = none：登录/登出/首路由/深链 benchNav/tab 切换都不是层级进出', () => {
    // #880 验收 4：深链直达（benchNav 走 navigate(target, { replace: true })）不得出现转场
    expect(decideRouteDirection({ replace: true })).toBe('none')
  })

  it('显式 back 覆盖默认档：返回手势即使物理上走 replace-to-root 语义仍是 back', () => {
    expect(decideRouteDirection({ declared: 'back' })).toBe('back')
  })

  it('replace 优先于显式声明（replace 档是「不挂转场」的硬闸）', () => {
    expect(decideRouteDirection({ replace: true, declared: 'back' })).toBe('none')
    expect(decideRouteDirection({ replace: true, declared: 'forward' })).toBe('none')
  })
})

describe('useRouteTransition · 入场时序（两段式，计时器与动画同源）', () => {
  it('方向落定 → phase enter + 容器挂上入场 animation', async () => {
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(false) })
    beginRouteTransition('forward')
    await nextTick()
    expect(t.phase.value).toBe('enter')
    expect(t.style.value.animation).toContain(ROUTE_TRANSITION_ANIMATION.forward[0])
    t.dispose()
  })

  it('时长/曲线档位全部走令牌引用，动画简写里零字面量', async () => {
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(false) })
    beginRouteTransition('forward')
    await nextTick()
    const anim = t.style.value.animation!
    // oracle = 对 tokens.css 同名令牌的引用形态（不抄数值）
    expect(anim).toContain(`var(--${toDurationTokenName()})`)
    expect(anim).toContain('var(--motion-emphasized-decelerate)')
    // 全称断言：时长位不得出现任何裸字面量
    const literals = anim.split(/\s+/).filter((tok) => DURATION_LITERAL.test(tok))
    expect(literals, `动画简写里出现时长字面量：${literals.join(', ')}`).toEqual([])
    t.dispose()
  })

  it('令牌值现场对账：--durationGentle = 300ms（M3 shared axis X 的 medium2 档）', () => {
    expect(tokenValue(toDurationTokenName())).toBe('300ms')
  })

  it('两段式计时器 = 同一档的数值镜像（决策 3 的令牌同源，不是另抄一份数值）', () => {
    expect(ROUTE_TRANSITION_HOLD_MS).toBe(MOTION_DURATION_MS[ROUTE_TRANSITION_DURATION])
    expect(ROUTE_TRANSITION_HOLD_MS).toBeGreaterThan(0)
  })

  it('到点归位：计时器到期 → phase idle + :style 回到空对象（transform 摘除）', async () => {
    vi.useFakeTimers()
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(false) })
    beginRouteTransition('forward')
    await nextTick()
    expect(t.style.value).not.toEqual({})
    vi.advanceTimersByTime(ROUTE_TRANSITION_HOLD_MS - 1)
    await nextTick()
    expect(t.phase.value, '未到点就归位 = 动画会被截断').toBe('enter')
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(t.phase.value).toBe('idle')
    // 归位后元素上不留任何过渡声明（否则 transform 常驻 ⇒ 容器一直是 absolute 后代的包含块）
    expect(t.style.value).toEqual({})
    t.dispose()
  })

  it('同向连续两次导航必须换 animation-name（同名 animation 在同元素上不重放）', async () => {
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(false) })
    beginRouteTransition('forward')
    await nextTick()
    const first = t.animationName.value
    beginRouteTransition('forward')
    await nextTick()
    const second = t.animationName.value
    // 判据是「两次取到不同的名」这个不变量，而不是某一次恰好落在哪个变体
    // （epoch 奇偶取决于此前发生过几次导航，写死变体下标会把判据绑到无关的计数上）
    expect(ROUTE_TRANSITION_ANIMATION.forward).toContain(first)
    expect(ROUTE_TRANSITION_ANIMATION.forward).toContain(second)
    expect(second, '连续两次同向导航拿到同一个 animation-name ⇒ 第二次不会重播').not.toBe(first)
    t.dispose()
  })

  it('方向变 none（深链直达 / tab 切换）立即摘除挂着的 animation', async () => {
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(false) })
    beginRouteTransition('forward')
    await nextTick()
    expect(t.style.value).not.toEqual({})
    beginRouteTransition('none')
    await nextTick()
    expect(t.phase.value).toBe('idle')
    expect(t.style.value).toEqual({})
    t.dispose()
  })

  it('减弱动效：动效本身不生成（不挂任何过渡声明），且不留空窗期', async () => {
    vi.useFakeTimers()
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(true) })
    beginRouteTransition('forward')
    await nextTick()
    // #880 验收 3：偏好开启时不挂过渡
    expect(t.style.value).toEqual({})
    expect(t.phase.value, 'R2：关键帧动效不生成，不是「挂 0ms」').toBe('idle')
    expect(t.reduced.value).toBe(true)
    // 空窗期判据 = 可观察后果（不依赖全局计时器计数，那会测到整个 realm 的其它计时器）：
    // 走完整个 hold 窗口，容器上仍然没有任何过渡声明。
    vi.advanceTimersByTime(ROUTE_TRANSITION_HOLD_MS * 3)
    await nextTick()
    expect(t.style.value, '降级路径出现「动画已停但声明未摘」的空窗期').toEqual({})
    expect(t.phase.value).toBe('idle')
    t.dispose()
  })

  it('back 与 forward 是不同方向（animation 名不同 ⇒ 视觉可辨识）', async () => {
    const t = useRouteTransition({ matchMedia: fakeMatchMedia(false) })
    beginRouteTransition('back')
    await nextTick()
    expect(t.style.value.animation).toContain(ROUTE_TRANSITION_ANIMATION.back[0])
    expect(routeTransitionDirection.value).toBe('back')
    t.dispose()
  })
})

/** 档位名 → tokens.css 变量名（`medium` → `durationMedium1`；本档为 `gentle` → `durationGentle`） */
function toDurationTokenName(): string {
  return `duration${ROUTE_TRANSITION_DURATION.charAt(0).toUpperCase()}${ROUTE_TRANSITION_DURATION.slice(1)}`
}
