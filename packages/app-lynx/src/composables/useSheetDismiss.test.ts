// ─── 弹层两段式退场状态机单测（issue #878；契约见 ADR-0211 决策 3）───
//
// 仓库无 vue-lynx 渲染器（vitest node 环境），故按既有约定测**外部行为**：
// 相位序列、计时器何时到点、重复关闭请求、偏好降级、卸载清理。
// 组件侧只做「把返回的样式绑到模板」，那部分由 `SheetShell.test.ts` 的接线判据覆盖。
//
// 期望值出处（oracle 溯源，非从实现反推）：
// - 相位三态 `enter` / `exit` / `gone` 与「到点才 emit close」= ADR-0211 决策 3 的协议正文；
// - 计时器时长 = `exit()` 预设的 `holdMs`（断言直接取该预设的值，不在本文件抄毫秒数）；
// - R1 降级时 `holdMs` 同步归零 = 决策 3 点名的失效形态（「关弹层卡住一段空窗期」）；
// - 幂等（退场中重复请求不再起第二个计时器）= 同一决策的「显式建模」要求：
//   两次 close 会把宿主的打开状态一起吃掉，是可复现的状态机缺陷，不是风格问题。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { enter, exit } from './motion'
import type { MediaQueryListLike } from './useReducedMotion'
import {
  DIALOG_ANIMATION,
  SHEET_ANIMATION,
  useSheetDismiss,
  useSheetMotion,
} from './useSheetDismiss'

/** 可控 matchMedia 假实现：注入偏好，覆盖「开 / 关 / 运行中切换」三条路径 */
function fakeMatchMedia(initial: boolean) {
  const state = { matches: initial }
  let listener: (() => void) | undefined
  const mql: MediaQueryListLike = {
    get matches() {
      return state.matches
    },
    addEventListener: (_type, fn) => {
      if (_type === 'change') listener = fn
    },
    removeEventListener: () => {
      listener = undefined
    },
  }
  return {
    mql,
    set(next: boolean) {
      state.matches = next
      listener?.()
    },
  }
}

/** 退场预设的 holdMs = 计时器时长的唯一事实源（不抄数值，见抬头 oracle 纪律） */
const EXIT_HOLD_MS = exit({ animationName: 'probe' }).holdMs

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('两段式退场：相位序列 enter → exit → gone', () => {
  it('请求关闭后先进 exit 相位（不立刻卸载），到计时器时长才 gone 并回调终态动作', () => {
    const onDismissed = vi.fn()
    const d = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed, matchMedia: () => fakeMatchMedia(false).mql })

    expect(d.phase.value, '初始相位').toBe('enter')
    d.requestClose()
    expect(d.phase.value, '请求关闭后应先挂退场动画，不得瞬撤').toBe('exit')
    expect(d.exiting.value).toBe(true)
    expect(onDismissed, '退场动画还没播完就卸载 = 退场不可见').not.toHaveBeenCalled()

    vi.advanceTimersByTime(EXIT_HOLD_MS - 1)
    expect(d.phase.value, '计时器未到点就卸载').toBe('exit')
    expect(onDismissed).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(d.phase.value, '计时器到点后应卸载').toBe('gone')
    expect(onDismissed, '到点未回调终态动作 ⇒ 宿主永不卸载（弹层卡死在屏上）').toHaveBeenCalledTimes(1)
  })

  it('计时器时长与退场动画同源：holdMs 来自 exit 预设，不是另抄的数值', () => {
    // 决策 3 的「计时器时长必须从令牌读」：这里断言两者恒等，不断言具体毫秒数
    const holdMs = exit({ animationName: SHEET_ANIMATION.exit }).holdMs
    const onDismissed = vi.fn()
    const d = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed, matchMedia: () => fakeMatchMedia(false).mql })
    d.requestClose()
    vi.advanceTimersByTime(holdMs)
    expect(onDismissed, '按预设 holdMs 推进仍未到点 ⇒ 计时器时长与动画脱钩').toHaveBeenCalledTimes(1)
    expect(holdMs).toBeGreaterThan(0)
  })

  it('幂等：退场中重复关闭请求不再起第二个计时器（连点 / 返回键与遮罩同时）', () => {
    const onDismissed = vi.fn()
    const d = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed, matchMedia: () => fakeMatchMedia(false).mql })
    d.requestClose()
    d.requestClose()
    d.requestClose()
    vi.advanceTimersByTime(EXIT_HOLD_MS)
    expect(onDismissed, '重复请求导致多次 emit close ⇒ 宿主打开状态被一起吃掉').toHaveBeenCalledTimes(1)
  })

  it('reopen 取消未到点的退场（弹层被复用再次显示，不留悬挂计时器）', () => {
    const onDismissed = vi.fn()
    const d = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed, matchMedia: () => fakeMatchMedia(false).mql })
    d.requestClose()
    d.reopen()
    expect(d.phase.value).toBe('enter')
    vi.advanceTimersByTime(EXIT_HOLD_MS * 3)
    expect(onDismissed, 'reopen 后旧计时器仍在跑 ⇒ 弹层刚重开就被卸载').not.toHaveBeenCalled()
    expect(d.phase.value).toBe('enter')
  })

  it('dispose 清掉未到点的计时器（组件卸载后不得再 emit）', () => {
    const onDismissed = vi.fn()
    const d = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed, matchMedia: () => fakeMatchMedia(false).mql })
    d.requestClose()
    d.dispose()
    vi.advanceTimersByTime(EXIT_HOLD_MS * 3)
    expect(onDismissed, '卸载后再 emit close').not.toHaveBeenCalled()
    // 幂等：重复 dispose 不抛
    expect(() => d.dispose()).not.toThrow()
  })

  it('syncOpen：open=false 走退场、open=true 拉回入场（自管挂载弹层的接线口）', () => {
    const onDismissed = vi.fn()
    const d = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed, matchMedia: () => fakeMatchMedia(false).mql })
    d.syncOpen(false)
    expect(d.phase.value).toBe('exit')
    d.syncOpen(true)
    expect(d.phase.value).toBe('enter')
    vi.advanceTimersByTime(EXIT_HOLD_MS * 3)
    expect(onDismissed).not.toHaveBeenCalled()
  })
})

describe('减弱动效降级（R1：R2 关键帧置 none + 计时器同步归零）', () => {
  it('偏好开启：退场无动画且 holdMs=0 ⇒ 同一 tick 内完成卸载，不卡空窗期', () => {
    const media = fakeMatchMedia(true)
    const onDismissed = vi.fn()
    const d = useSheetDismiss({
      names: SHEET_ANIMATION,
      onDismissed,
      matchMedia: () => media.mql,
    })
    expect(d.reduced.value, '偏好未生效（注入点失效）').toBe(true)
    d.requestClose()
    // 决策 3 点名的失效形态：动画已 none 但计时器仍 150ms ⇒ 关弹层卡一段空窗
    expect(d.panelStyle('exit').animation, 'R2 降级时退场动画应为 none').toBe('none')
    expect(d.scrimStyle('exit').animation, 'R2 降级时遮罩动画应为 none').toBe('none')
    vi.advanceTimersByTime(0)
    expect(d.phase.value, 'holdMs 未归零 ⇒ 偏好开启仍卡一段空窗期').toBe('gone')
    expect(onDismissed).toHaveBeenCalledTimes(1)
  })

  it('偏好关闭：进 / 退场动画都是令牌简写（不是 none，也不是裸值）', () => {
    const media = fakeMatchMedia(false)
    const d = useSheetDismiss({ names: SHEET_ANIMATION, matchMedia: () => media.mql })
    expect(d.panelStyle('exit').animation).toBe(exit({ animationName: SHEET_ANIMATION.exit }).animation)
    expect(d.panelStyle('enter').animation).toBe(enter({ animationName: SHEET_ANIMATION.enter }).animation)
  })

  it('运行中切换偏好：样式与相位随偏好翻转（订阅而非读一次）', () => {
    const media = fakeMatchMedia(false)
    const d = useSheetDismiss({ names: SHEET_ANIMATION, matchMedia: () => media.mql })
    expect(d.panelStyle('exit').animation).not.toBe('none')
    media.set(true)
    expect(d.panelStyle('exit').animation, '切换后仍拿旧档位 ⇒ 快照形态').toBe('none')
    d.dispose()
  })
})

describe('相位 → 动画样式的映射（面板 / 遮罩分离）', () => {
  it('enter 与 exit 相位分别挂入场 / 退场简写，gone 与 enter 同形（不挂退场动画）', () => {
    const d = useSheetMotion({ names: SHEET_ANIMATION, matchMedia: () => fakeMatchMedia(false).mql })
    expect(d.panelStyle('enter').animation.startsWith(`${SHEET_ANIMATION.enter} `)).toBe(true)
    expect(d.panelStyle('exit').animation.startsWith(`${SHEET_ANIMATION.exit} `)).toBe(true)
    expect(d.panelStyle('gone').animation).toBe(d.panelStyle('enter').animation)
    expect(d.scrimStyle('enter').animation.startsWith(`${SHEET_ANIMATION.scrimEnter} `)).toBe(true)
    expect(d.scrimStyle('exit').animation.startsWith(`${SHEET_ANIMATION.scrimExit} `)).toBe(true)
  })

  it('面板与遮罩用不同 keyframes（共用一条 ⇒ 遮罩会跟着位移）', () => {
    expect(SHEET_ANIMATION.enter).not.toBe(SHEET_ANIMATION.scrimEnter)
    expect(SHEET_ANIMATION.exit).not.toBe(SHEET_ANIMATION.scrimExit)
  })

  it('居中对话框与底部弹层分名（对话框入场是 scale+fade，不是上滑）', () => {
    expect(DIALOG_ANIMATION.enter).not.toBe(SHEET_ANIMATION.enter)
    expect(DIALOG_ANIMATION.exit).not.toBe(SHEET_ANIMATION.exit)
    // 遮罩那对与几何无关，可共用
    expect(DIALOG_ANIMATION.scrimEnter).toBe(SHEET_ANIMATION.scrimEnter)
  })

  it('样式值只经 `animation` 一个通道（Lynx 侧唯一无歧义的 inline 通道）', () => {
    const d = useSheetMotion({ names: DIALOG_ANIMATION, matchMedia: () => fakeMatchMedia(false).mql })
    expect(Object.keys(d.panelStyle('enter'))).toEqual(['animation'])
    expect(Object.keys(d.scrimStyle('exit'))).toEqual(['animation'])
  })
})
