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
import { createApp, effectScope, ref, type Ref } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { apiClient } from '../api/client'
import {
  BOOKMARK_ANIMATION_MS,
  useBookmarkMutation,
  type UseBookmarkMutationReturn,
} from './useBookmarkMutation'

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

// ─── saveWith 面板保存变体端到端测试（spec docs/specs/bookmark-tags.md D5/D6/D9
// + ADR-0160 D2/D6，GitHub ticket #533）───
//
// 真实 vue-query useMutation 触发（补齐上方历史注释所指的端到端缺口）：
// - 上下文构造：useQueryClient 需 injection context → createApp + VueQueryPlugin
//   provide + app.runWithContext 包 effectScope.run（无 DOM 需求，node 环境可跑）
// - api mock 先例：useApiQuery.test.ts §B 的 spyOn(apiClient, 'post')——toggle 直调
//   apiClient.post，saveWith 经 addBookmark 也落到同一 post，一处 spy 覆盖双路径
// - oracle：载荷字面量来自 T3 addBookmark 契约（pixivpy3 illust_bookmark_add：
//   空格 join 单值 + `tags[]` 字段名，见 api/illust.ts 头注）；状态机断言来自
//   模块头注六条不变量。
describe('useBookmarkMutation saveWith（面板保存变体）', () => {
  let cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups.forEach((fn) => fn())
    cleanups = []
  })

  /** 挂载 composable：runWithContext 提供 injection context，effectScope 收纳副作用 */
  function setupComposable(opts: {
    initialBookmarked?: boolean
    initialCount?: number
    onChange?: (bookmarked: boolean) => void
  } = {}) {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined as never)
    const app = createApp({ render: () => null })
    app.use(VueQueryPlugin, { queryClient: new QueryClient() })
    const scope = effectScope()
    let ret!: UseBookmarkMutationReturn
    app.runWithContext(() => {
      scope.run(() => {
        ret = useBookmarkMutation({
          illustId: 42,
          initialBookmarked: opts.initialBookmarked ?? false,
          initialCount: opts.initialCount ?? 0,
          onChange: opts.onChange,
        })
      })
    })
    cleanups.push(() => {
      scope.stop()
      postSpy.mockRestore()
    })
    return { ret, postSpy }
  }

  it('载荷正确：restrict + tags 经 addBookmark 序列化到 post（oracle = T3 契约：空格 join + tags[] 字段）', async () => {
    const { ret, postSpy } = setupComposable()
    await ret.saveWith('private', ['風景', '東方Project'])
    expect(postSpy).toHaveBeenCalledOnce()
    expect(postSpy).toHaveBeenCalledWith('/v2/illust/bookmark/add', {
      illust_id: '42',
      restrict: 'private',
      'tags[]': '風景 東方Project',
    })
  })

  it('空标签集不发 tags[] 字段（spec D1 序列化语义透传）', async () => {
    const { ret, postSpy } = setupComposable()
    await ret.saveWith('public', [])
    expect(postSpy).toHaveBeenCalledWith('/v2/illust/bookmark/add', {
      illust_id: '42',
      restrict: 'public',
    })
  })

  it('原未收藏：乐观置 bookmarked=true + count+1（不变量 #1）', async () => {
    const { ret } = setupComposable({ initialBookmarked: false, initialCount: 2 })
    await ret.saveWith('private', ['a'])
    expect(ret.bookmarked.value).toBe(true)
    expect(ret.count.value).toBe(3)
  })

  it('原已收藏（覆盖式编辑）：count 不再 +1，直接重发 add 不先 delete（spec D2）', async () => {
    const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
    await ret.saveWith('public', ['x'])
    expect(ret.bookmarked.value).toBe(true)
    expect(ret.count.value).toBe(5)
    expect(postSpy).toHaveBeenCalledOnce()
    expect(postSpy).toHaveBeenCalledWith(
      '/v2/illust/bookmark/add',
      expect.objectContaining({ illust_id: '42' }),
    )
  })

  it('失败静息回滚到原态 + errorMsg + console.warn 带模块前缀（不变量 #3 + 硬约束 #3）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
    postSpy.mockRejectedValueOnce(new Error('boom'))
    await ret.saveWith('private', ['a'])
    expect(ret.bookmarked.value).toBe(true) // 回滚到保存前原态
    expect(ret.count.value).toBe(5)
    expect(ret.errorMsg.value).toBe('操作失败')
    expect(ret.busy.value).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useBookmarkMutation]'),
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })

  it('失败回滚：原未收藏时 bookmarked 还原 false + count 还原', async () => {
    const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 2 })
    postSpy.mockRejectedValueOnce(new Error('boom'))
    await ret.saveWith('public', [])
    expect(ret.bookmarked.value).toBe(false)
    expect(ret.count.value).toBe(2)
    expect(ret.errorMsg.value).toBe('操作失败')
  })

  it('成功后 350ms 才触发 onChange(true)（不变量 #4）', async () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { ret } = setupComposable({ onChange })
      await ret.saveWith('public', ['a'])
      expect(onChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(BOOKMARK_ANIMATION_MS)
      expect(onChange).toHaveBeenCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('再次调用前 errorMsg 清空（不变量 #5）：失败一次后成功 → errorMsg 复位空串', async () => {
    const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
    postSpy.mockRejectedValueOnce(new Error('boom'))
    await ret.saveWith('private', [])
    expect(ret.errorMsg.value).toBe('操作失败')
    await ret.saveWith('public', [])
    expect(ret.errorMsg.value).toBe('')
  })

  it('busy 互斥：saveWith pending 期间 toggle / saveWith 均 no-op（不变量 #2）', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { ret, postSpy } = setupComposable()
    postSpy.mockImplementation(() => gate)
    const pending = ret.saveWith('private', ['a'])
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1))
    expect(ret.busy.value).toBe(true)
    await ret.toggle()
    await ret.saveWith('public', [])
    expect(postSpy).toHaveBeenCalledTimes(1) // 只有第一次 saveWith 发出请求
    expect(ret.bookmarked.value).toBe(true) // toggle no-op，状态未被翻转
    release()
    await pending
    expect(ret.busy.value).toBe(false)
  })

  it('busy 互斥（反向）：toggle pending 期间 saveWith no-op', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 1 })
    postSpy.mockImplementation(() => gate)
    const pending = ret.toggle()
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1))
    expect(ret.busy.value).toBe(true)
    await ret.saveWith('public', ['a'])
    expect(postSpy).toHaveBeenCalledTimes(1) // 只有 toggle 的 delete 发出
    expect(postSpy).toHaveBeenCalledWith('/v1/illust/bookmark/delete', { illust_id: '42' })
    release()
    await pending
  })

  it('toggle 快速收藏路径行为不变：add 不带 restrict/tags payload（spec D3 恒公开、零决策）', async () => {
    const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 0 })
    await ret.toggle()
    expect(postSpy).toHaveBeenCalledOnce()
    expect(postSpy).toHaveBeenCalledWith('/v2/illust/bookmark/add', { illust_id: '42' })
    expect(ret.bookmarked.value).toBe(true)
    expect(ret.count.value).toBe(1)
  })
})