// useScrollIndicator 单测（滚动指示条状态原语，spec #319 / ticket #321 T2）。
// fake timers（默认 toFake 覆盖 Date：节流依赖 Date.now 需随时钟推进）。
//
// mock 策略（T1 层）：vi.mock 把 calcScrollIndicator 包成 vi.fn(真实实现)——
// 返回值 = 真实几何（契约测试真实样例原则：payload 形状/值来自真机捕获，与 T1 测试同源），
// 同时可断言调用次数（节流）。禁止 mock 出「手工自洽」的期望值，断言期望来自
// 独立 oracle（T1 已知：height = 580*(580/5000) = 67.28，top = 580*(100/5000) = 11.6）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { calcScrollIndicator } from "./calcScrollIndicator"
import { HIDE_DELAY_MS, THROTTLE_MS, useScrollIndicator } from "./useScrollIndicator"

vi.mock("./calcScrollIndicator", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./calcScrollIndicator")>()
  return { ...mod, calcScrollIndicator: vi.fn(mod.calcScrollIndicator) }
})

// ─── 真机捕获 payload 形状（ScrollPayload 三字段；值 = 真机量级，与 T1 测试同源） ───
const REAL_PAYLOAD = { scrollTop: 100, scrollHeight: 5000, listHeight: 580 }
const REAL_EVENT = { detail: REAL_PAYLOAD }

/** 创建被测原语并清空 T1 mock 的调用计数 */
function createIndicator() {
  const indicator = useScrollIndicator()
  vi.mocked(calcScrollIndicator).mockClear()
  return indicator
}

beforeEach(() => {
  vi.useFakeTimers()
  // useScrollIndicator 内部注册 onUnmounted（契约）；node 单测无组件实例 → Vue 生命周期
  // warn 属预期噪音，静音防污染（本模块路径无其他 warn 来源，非掩盖真实错误）。
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("useScrollIndicator", () => {
  it("正常 payload：top/height 更新、visible=true（几何 = T1 oracle 值）", () => {
    const s = createIndicator()
    expect(s.topPx.value).toBe(0)
    expect(s.heightPx.value).toBe(0)
    expect(s.visible.value).toBe(false)

    s.onScroll(REAL_EVENT)
    // T1 oracle：height = 580 * (580/5000) = 67.28；top = 580 * (100/5000) = 11.6
    expect(s.topPx.value).toBeCloseTo(11.6, 5)
    expect(s.heightPx.value).toBeCloseTo(67.28, 5)
    expect(s.visible.value).toBe(true)
  })

  it("33ms 节流：窗口内（10ms）第二次 onScroll 只计算一次、不覆盖 refs", () => {
    const s = createIndicator()
    s.onScroll(REAL_EVENT)
    expect(vi.mocked(calcScrollIndicator)).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10) // 节流窗口内（10ms < 33ms）
    s.onScroll({ detail: { scrollTop: 200, scrollHeight: 5000, listHeight: 580 } })
    expect(vi.mocked(calcScrollIndicator)).toHaveBeenCalledTimes(1) // 未计算
    expect(s.topPx.value).toBeCloseTo(11.6, 5) // 未被第二次 payload 覆盖

    // 窗口结束（≥33ms）：恢复计算
    vi.advanceTimersByTime(THROTTLE_MS - 10 + 1)
    s.onScroll({ detail: { scrollTop: 200, scrollHeight: 5000, listHeight: 580 } })
    expect(vi.mocked(calcScrollIndicator)).toHaveBeenCalledTimes(2)
    expect(s.topPx.value).toBeCloseTo(23.2, 5) // 580 * (200/5000)
  })

  it("500ms 后 visible=false（淡出），timer 消费后不残留", () => {
    const s = createIndicator()
    s.onScroll(REAL_EVENT)
    expect(s.visible.value).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(HIDE_DELAY_MS - 1)
    expect(s.visible.value).toBe(true) // 499ms 仍可见

    vi.advanceTimersByTime(1)
    expect(s.visible.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("滚动中每帧事件（16.7ms 间隔）：timer 被重置不叠加，可见性保持", () => {
    const s = createIndicator()
    for (let i = 0; i < 20; i++) {
      s.onScroll({ detail: { scrollTop: 100 + i * 17, scrollHeight: 5000, listHeight: 580 } })
      vi.advanceTimersByTime(16.7) // 每帧 ~60Hz（节流后每 2 帧真实更新一次）
    }
    // 20 帧全程滚动：距最后一次真实更新 < 500ms → 仍可见
    expect(s.visible.value).toBe(true)
    expect(vi.getTimerCount()).toBe(1) // 重置而非叠加（永远只有一个 hide timer）

    // 滚动停止：500ms 后淡出
    vi.advanceTimersByTime(HIDE_DELAY_MS)
    expect(s.visible.value).toBe(false)
  })

  it("dispose() 清理 timer：清理后推时 1000ms 不触发淡出 flip", () => {
    const s = createIndicator()
    s.onScroll(REAL_EVENT)
    expect(s.visible.value).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    s.dispose() // 清 timer，不主动改 visible
    expect(vi.getTimerCount()).toBe(0)
    expect(s.visible.value).toBe(true)

    vi.advanceTimersByTime(HIDE_DELAY_MS * 2) // 原淡出时刻已过
    expect(s.visible.value).toBe(true) // timer 已清 → 无 flip
  })

  it("初始未滚动：dispose() 幂等（无 timer 可清，不崩溃）", () => {
    const s = createIndicator()
    s.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(s.visible.value).toBe(false)
  })

  it("calcScrollIndicator 返回 null（scrollHeight=0）：状态不变、不启动 timer、不消耗节流窗口", () => {
    const s = createIndicator()
    s.onScroll({ detail: { scrollTop: 100, scrollHeight: 0, listHeight: 580 } })
    expect(s.topPx.value).toBe(0)
    expect(s.heightPx.value).toBe(0)
    expect(s.visible.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0) // 无有效信号 → 不建 hide timer

    // null 不消耗节流窗口：紧随其后的有效 payload 立即可更新（首屏方向）
    s.onScroll(REAL_EVENT)
    expect(vi.mocked(calcScrollIndicator)).toHaveBeenCalledTimes(2) // null 那次也计算了
    expect(s.topPx.value).toBeCloseTo(11.6, 5)
    expect(s.visible.value).toBe(true)
  })

  it("calcScrollIndicator 返回 null：已可见时不动可见性（不闪烁）、原淡出 timer 不受影响", () => {
    const s = createIndicator()
    s.onScroll(REAL_EVENT) // visible=true，hide timer（t=+500）
    vi.advanceTimersByTime(THROTTLE_MS + 1) // 越过节流窗口

    s.onScroll({ detail: { scrollTop: 100, scrollHeight: 0, listHeight: 580 } }) // null → return
    expect(s.visible.value).toBe(true) // 可见性保持（不闪烁）
    expect(vi.getTimerCount()).toBe(1) // 原 timer 未被重置/清除

    vi.advanceTimersByTime(HIDE_DELAY_MS) // 原淡出时刻已过
    expect(s.visible.value).toBe(false) // 照常淡出
  })
})
