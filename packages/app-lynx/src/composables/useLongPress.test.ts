// ─── useLongPress 单测（T5 / issue #534，spec docs/specs/bookmark-tags.md D3）───
// 期望值出处（Oracle 溯源）：
// - 500ms 时长与「到点即触发（不等松手）」= spec D3「新增长按 500ms 打开收藏面板，
//   口径与 webview 一致」+ webview 实现 packages/app/src/routes/IllustDetail.tsx
//   onBookmarkPointerDown（setTimeout 500）——独立于本实现的第二来源；
// - 位移容差语义 = 触摸位移判定（滚动/拖拽不构成长按），阈值为本模块导出的命名常量
//   （LONG_PRESS_MOVE_TOLERANCE_PX，边界用例手写字面量 10/11 交叉核对）；
// - 吞 tap 语义 = 双轨收藏互斥：长按已开面板时同一次手势不得再走快速收藏（spec US1/US2）。
// 环境：node（无真实 DOM 手势）——本模块即「计时逻辑抽为可测纯函数/composable」的落地，
// 用 vi 假计时器驱动触摸序列（不依赖 Lynx 渲染器）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LONG_PRESS_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  isLongPressHeld,
  useLongPress,
  type TouchLikeEvent,
} from './useLongPress'

/** 单点触摸事件构造（Lynx detail 形状：touches[0].clientX/clientY） */
function touch(x: number, y: number): TouchLikeEvent {
  return { touches: [{ clientX: x, clientY: y }] }
}

describe('useLongPress.isLongPressHeld（纯函数：时长 × 位移双条件）', () => {
  it('时长边界：499ms 未达 → false；500ms 恰好达 → true（>= 语义）', () => {
    expect(isLongPressHeld(LONG_PRESS_MS - 1, 0)).toBe(false)
    expect(isLongPressHeld(LONG_PRESS_MS, 0)).toBe(true)
  })

  it('位移边界：容差内 → true；超容差 → false（手写字面量 10/11 交叉核对常量）', () => {
    expect(LONG_PRESS_MOVE_TOLERANCE_PX).toBe(10)
    expect(isLongPressHeld(LONG_PRESS_MS, 10)).toBe(true)
    expect(isLongPressHeld(LONG_PRESS_MS, 11)).toBe(false)
  })

  it('双条件同时成立才为长按（够久但移动过 → false）', () => {
    expect(isLongPressHeld(600, 40)).toBe(false)
    expect(isLongPressHeld(100, 0)).toBe(false)
  })
})

describe('useLongPress 触摸序列（假计时器驱动）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function mk() {
    const onTrigger = vi.fn()
    return { onTrigger, lp: useLongPress({ onTrigger }) }
  }

  it('按住满 500ms → 触发一次，且 consumeLongPress() 读清标记（吞掉随后的 tap）', () => {
    const { onTrigger, lp } = mk()
    lp.onTouchStart(touch(100, 100))
    expect(onTrigger).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(lp.consumeLongPress()).toBe(true)
    expect(lp.consumeLongPress()).toBe(false)
  })

  it('不足 500ms 松手（快速点按）→ 不触发，且标记为 false（tap 走快速收藏）', () => {
    const { onTrigger, lp } = mk()
    lp.onTouchStart(touch(100, 100))
    vi.advanceTimersByTime(300)
    lp.onTouchEnd()
    vi.advanceTimersByTime(1000)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(lp.consumeLongPress()).toBe(false)
  })

  it('位移超容差（滚动/拖拽）→ 取消计时，即使按住超过 500ms 也不触发', () => {
    const { onTrigger, lp } = mk()
    lp.onTouchStart(touch(100, 100))
    lp.onTouchMove(touch(100, 140)) // 40px > 10px 容差
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(lp.consumeLongPress()).toBe(false)
  })

  it('位移在容差内（手指抖动）→ 仍判长按（不误伤正常按压）', () => {
    const { onTrigger, lp } = mk()
    lp.onTouchStart(touch(100, 100))
    lp.onTouchMove(touch(104, 103)) // 5px，容差内
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('cancel()（组件卸载）→ 在途计时作废且标记复位', () => {
    const { onTrigger, lp } = mk()
    lp.onTouchStart(touch(100, 100))
    lp.cancel()
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(lp.consumeLongPress()).toBe(false)
  })

  it('新手势复位标记：上一次长按的「已触发」不泄漏到下一次快速点按', () => {
    const { onTrigger, lp } = mk()
    lp.onTouchStart(touch(0, 0))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    // 同一次手势的 tap 被吞
    expect(lp.consumeLongPress()).toBe(true)
    // 下一次触摸 = 新手势（未满 500ms 松手）→ 不应被误判为长按
    lp.onTouchStart(touch(0, 0))
    vi.advanceTimersByTime(100)
    lp.onTouchEnd()
    expect(lp.consumeLongPress()).toBe(false)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })
})
