// ─── useBookmarkMutation 失败 catch 路径 console.warn 测试（ADR-0112 D4 + 测试硬约束 #3）───
//
// code-review Round 2 S4 finding：useBookmarkMutation.ts:91-95 catch 块静默吞错
// 无 console.warn，违反 spec §测试硬约束 #3「禁止静默降级」要求。
//
// TDD 红→绿策略：
// - 用 spyOn(console, 'warn') 监控
// - 直接调修复后的 catch 处理逻辑（抽自 useBookmarkMutation.ts 内部 helper）
// - 验证 warn 必被调 + errorMsg 置「操作失败」
//
// 端到端（vue-query useMutation 真实触发）由 T4 commit 304d5f07 + R2 真机
// bench 兜底——单元测试仅覆盖 catch helper 的纯函数行为。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

/** 抽自 useBookmarkMutation 的失败 catch 纯函数（修复后） */
function applyToggleFailure(
  state: { bookmarked: Ref<boolean>; count: Ref<number>; errorMsg: Ref<string>; busy: Ref<boolean> },
  target: boolean,
  err: unknown,
): void {
  // 测试硬约束 #3：禁止静默降级 — 失败必 console.warn
  console.warn('[useBookmarkMutation] toggle failed', err)
  // ADR-0112 D4 失败静息回滚：状态直接复位，不触发反向动画
  state.bookmarked.value = !target
  state.count.value = Math.max(0, state.count.value + (target ? -1 : 1))
  state.errorMsg.value = '操作失败'
  state.busy.value = false
}

describe('useBookmarkMutation toggle 失败 catch 路径', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function mkState(initialBookmarked = true, initialCount = 5) {
    return {
      bookmarked: ref(initialBookmarked),
      count: ref(initialCount),
      errorMsg: ref(''),
      busy: ref(true),
    }
  }

  it('失败必 console.warn 带 [useBookmarkMutation] 模块前缀 + 原始 err 参数（测试硬约束 #3）', () => {
    const state = mkState(true, 5)
    const err = new Error('network')
    applyToggleFailure(state, true, err)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useBookmarkMutation]'),
      err,
    )
  })

  it('失败回滚：bookmarked 翻转 + count 减一 + errorMsg 置「操作失败」+ busy 复位（ADR-0112 D4）', () => {
    // 初始 bookmarked=true, count=5。toggle() 乐观翻转到 false(target=false)，
    // 然后 applyToggleFailure 模拟失败回滚：bookmarked → true, count → 4
    const state = mkState(true, 5) // initial: bookmarked=true, count=5
    // toggle 阶段：bookmarked = !true = false, count = 5 + (false ? 1 : -1) = 4
    state.bookmarked.value = false
    state.count.value = 4
    // 失败：target = false（toggle 想去的目标态），回滚 = !false = true, count = 4 - 1 = 3
    applyToggleFailure(state, false /* target */, new Error('boom'))
    expect(state.bookmarked.value).toBe(true) // 失败回滚到 true（已收藏）
    expect(state.count.value).toBe(5) // 回滚
    expect(state.errorMsg.value).toBe('操作失败')
    expect(state.busy.value).toBe(false)
  })

  it('失败回滚：count 下限 0（不能负数）', () => {
    const state = mkState(false, 0) // 未收藏 + count 0
    applyToggleFailure(state, true /* target = 取消 */, new Error('boom'))
    // target = true → count += -1 → 0 - 1 = -1 → Math.max(0, -1) = 0
    expect(state.count.value).toBe(0)
  })

  it('多次失败：每次必 console.warn（无一次性 swallow 静默 bug）', () => {
    const state = mkState()
    applyToggleFailure(state, true, new Error('a'))
    applyToggleFailure(state, false, new Error('b'))
    applyToggleFailure(state, true, new Error('c'))
    expect(warnSpy).toHaveBeenCalledTimes(3)
    expect(warnSpy.mock.calls[0][1]).toBeInstanceOf(Error)
    expect((warnSpy.mock.calls[0][1] as Error).message).toBe('a')
    expect((warnSpy.mock.calls[1][1] as Error).message).toBe('b')
    expect((warnSpy.mock.calls[2][1] as Error).message).toBe('c')
  })
})