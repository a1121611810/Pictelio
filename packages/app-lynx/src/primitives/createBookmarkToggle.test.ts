// oracle 溯源：期望值来自 docs/specs/app-lynx-bookmark-animation.md 决策表 D4/D5
// 与 ADR-0112 决策 3/4（乐观触发 / 失败静息回滚 / change 延迟 350ms / busy 锁），非从实现反推。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBookmarkToggle, BOOKMARK_ANIMATION_MS } from './createBookmarkToggle'

function deferred<T>() {
  let resolve!: (v: T | PromiseLike<T>) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createBookmarkToggle（ADR-0112）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('BOOKMARK_ANIMATION_MS = 350（双向最长动画时长，spec D5）', () => {
    expect(BOOKMARK_ANIMATION_MS).toBe(350)
  })

  it('乐观触发：不等 API resolve 即同步翻转 bookmarked/count', () => {
    const d = deferred<void>()
    const add = vi.fn(() => d.promise)
    const bm = createBookmarkToggle(1, false, 10, { add, remove: vi.fn() })
    void bm.toggle()
    // API 仍 pending，状态已翻转
    expect(bm.bookmarked).toBe(true)
    expect(bm.count).toBe(11)
    expect(bm.busy).toBe(true)
    expect(add).toHaveBeenCalledWith(1)
  })

  it('取消收藏乐观翻转：bookmarked false 且 count 减一（下限 0）', () => {
    const d = deferred<void>()
    const bm = createBookmarkToggle(1, true, 0, { add: vi.fn(), remove: () => d.promise })
    void bm.toggle()
    expect(bm.bookmarked).toBe(false)
    expect(bm.count).toBe(0) // 0 - 1  clamp 到 0
  })

  it('change 延迟到动画播完（350ms）后上抛一次，参数为目标态', async () => {
    const onChange = vi.fn()
    const bm = createBookmarkToggle(1, false, 0, {
      add: () => Promise.resolve(),
      remove: vi.fn(),
      onChange,
    })
    await bm.toggle()
    // API 已成功但动画未播完：不上抛
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(BOOKMARK_ANIMATION_MS - 1)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('API 失败：静息回滚 bookmarked/count + errorMsg + 永不上抛 change', async () => {
    const onChange = vi.fn()
    const bm = createBookmarkToggle(1, true, 5, {
      add: vi.fn(),
      remove: () => Promise.reject(new Error('network')),
      onChange,
    })
    await bm.toggle()
    expect(bm.bookmarked).toBe(true) // 回滚
    expect(bm.count).toBe(5)
    expect(bm.errorMsg).toBe('操作失败')
    expect(bm.busy).toBe(false)
    vi.advanceTimersByTime(BOOKMARK_ANIMATION_MS * 2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('busy 锁：API pending 中重复 toggle 不再发请求；释放后可再次切换', async () => {
    const d = deferred<void>()
    const add = vi.fn(() => d.promise)
    const bm = createBookmarkToggle(1, false, 0, { add, remove: vi.fn() })
    const p = bm.toggle()
    void bm.toggle() // busy 中：忽略
    expect(add).toHaveBeenCalledTimes(1)
    d.resolve()
    await p
    expect(bm.busy).toBe(false)
    const d2 = deferred<void>()
    const remove = vi.fn(() => d2.promise)
    const bm2 = createBookmarkToggle(1, true, 3, { add: vi.fn(), remove })
    void bm2.toggle()
    void bm2.toggle()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('成功后再次 toggle 前 errorMsg 清空', async () => {
    const bm = createBookmarkToggle(1, false, 0, {
      add: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined),
      remove: vi.fn(),
    })
    await bm.toggle()
    expect(bm.errorMsg).toBe('操作失败')
    const p = bm.toggle()
    expect(bm.errorMsg).toBe('')
    await p
  })
})
