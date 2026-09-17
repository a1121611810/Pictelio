// ─── useBookmarkMutation 单测（toggle 快速收藏 + saveWith 面板保存变体）───
//
// 历史（保留可追溯性）：
// - R2 S4 finding：catch 块静默吞错无 console.warn（测试硬约束 #3）→ 已修复并有断言；
// - R3 FIX-4 finding：旧 toggle 失败用例把实现内部 helper（applyToggleFailure）手抄进测试
//   再对抄来的副本断言——与真实实现无绑定（同义反复）→ 本文件改为驱动**真实 composable**
//   （useBookmarkMutation）+ vi.spyOn(apiClient, 'post')，只断言可观察行为：post 调用/载荷、
//   bookmarked/count 终值、errorMsg、busy 复位、350ms 后 onChange。
// - R3 FIX-1 finding：toggle add 分支省略 restrict，依赖服务端默认值（仓库内无 oracle）→
//   断言显式 restrict=public（spec D3「恒公开」成为可断言的线上事实），且不带 tags。
// - R3 FIX-2：saveWith 返回 Promise<boolean>（true=成功 / false=失败静息回滚；busy no-op 亦
//   非成功故返回 false）——下方逐条断言，面板据返回值判定成败。
//
// 期望值出处（Oracle 溯源，禁止从被测实现反推）：
// - 六条不变量 = useBookmarkMutation.ts 模块头注（ADR-0112 D4/D5 + spec docs/specs/bookmark-tags.md D9）；
// - toggle add 载荷 restrict=public = spec D3「快速收藏恒公开、零决策」；
// - 载荷字段名 / 序列化（illust_id 字符串、grid `tags[]` 空格 join、空标签集不发 tags 字段）
//   = api/illust.ts addBookmark 契约头注（pixivpy3 `illust_bookmark_add` 差分互证，
//   docs/research/bookmark-tags-similar-clients.md §7.1）；
// - saveWith 覆盖式方向（不先 delete）= spec D2 / ADR-0160 D2；
// - 上下文构造（useQueryClient 需 injection context）= useApiQuery.test.ts 既有先例：
//   createApp + VueQueryPlugin provide + app.runWithContext 包 effectScope.run（无 DOM 需求）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { apiClient } from '../api/client'
import {
  BOOKMARK_ANIMATION_MS,
  useBookmarkMutation,
  type UseBookmarkMutationReturn,
} from './useBookmarkMutation'

describe('useBookmarkMutation（驱动真实 composable + spyOn(apiClient.post)）', () => {
  let cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups.forEach((fn) => fn())
    cleanups = []
    vi.restoreAllMocks()
  })

  /** 挂载真实 composable：runWithContext 提供 injection context，effectScope 收纳副作用 */
  function setupComposable(opts: {
    initialBookmarked?: boolean
    initialCount?: number
    onChange?: (bookmarked: boolean) => void
    targetKind?: 'illust' | 'novel'
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
          targetKind: opts.targetKind,
        })
      })
    })
    cleanups.push(() => {
      scope.stop()
      postSpy.mockRestore()
    })
    return { ret, postSpy }
  }

  function silenceWarn(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  // ─── 快速收藏路径（spec D3 + 六条不变量）───
  describe('toggle 快速收藏', () => {
    it('add 分支显式发 restrict=public 且不带 tags（spec D3 恒公开；省略默认值无 oracle，必须显式）', async () => {
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 0 })
      await ret.toggle()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v2/illust/bookmark/add', {
        illust_id: '42',
        restrict: 'public',
      })
      // 零决策：快速收藏不携带收藏标签字段（空标签集不发 tags[]，见 addBookmark 契约）
      expect(Object.keys(postSpy.mock.calls[0]?.[1] as object)).not.toContain('tags[]')
      expect(ret.bookmarked.value).toBe(true)
      expect(ret.count.value).toBe(1)
    })

    it('delete 分支（取消收藏）载荷仅 illust_id，不带 restrict/tags', async () => {
      const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
      await ret.toggle()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v1/illust/bookmark/delete', { illust_id: '42' })
      expect(ret.bookmarked.value).toBe(false)
      expect(ret.count.value).toBe(4)
    })

    it('乐观触发：API 未结算前状态已翻转（不变量 1）', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 3 })
      postSpy.mockImplementation(() => gate)
      const pending = ret.toggle()
      expect(ret.bookmarked.value).toBe(true)
      expect(ret.count.value).toBe(4)
      expect(ret.busy.value).toBe(true)
      release()
      await pending
      expect(postSpy).toHaveBeenCalledOnce()
      expect(ret.busy.value).toBe(false)
    })

    it('成功后 350ms 才触发 onChange(target)（不变量 4）', async () => {
      vi.useFakeTimers()
      try {
        const onChange = vi.fn()
        const { ret } = setupComposable({ initialBookmarked: false, initialCount: 0, onChange })
        await ret.toggle()
        expect(onChange).not.toHaveBeenCalled()
        vi.advanceTimersByTime(BOOKMARK_ANIMATION_MS)
        expect(onChange).toHaveBeenCalledWith(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('失败必 console.warn 带 [useBookmarkMutation] 模块前缀 + 原始 err 参数（测试硬约束 #3）', async () => {
      const warnSpy = silenceWarn()
      const err = new Error('network')
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 0 })
      postSpy.mockRejectedValueOnce(err)
      await ret.toggle()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[useBookmarkMutation]'), err)
    })

    it('失败静息回滚：bookmarked 复位原态 + count 反向 + errorMsg=操作失败 + busy 复位（不变量 3）', async () => {
      silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
      postSpy.mockRejectedValueOnce(new Error('boom'))
      await ret.toggle()
      expect(ret.bookmarked.value).toBe(true) // 回滚到已收藏
      expect(ret.count.value).toBe(5)
      expect(ret.errorMsg.value).toBe('操作失败')
      expect(ret.busy.value).toBe(false)
    })

    it('失败回滚 count 不出现负数（不变量 6）：原未收藏 count=0 的失败 add 终值仍 0', async () => {
      silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 0 })
      postSpy.mockRejectedValueOnce(new Error('boom'))
      await ret.toggle()
      expect(ret.count.value).toBe(0)
      expect(ret.count.value).toBeGreaterThanOrEqual(0)
    })

    it('初始 count 为负数时按 0 clamp（不变量 6）', () => {
      const { ret } = setupComposable({ initialBookmarked: false, initialCount: -5 })
      expect(ret.count.value).toBe(0)
    })

    it('多次失败：每次必 console.warn（无一次性 swallow 静默 bug）', async () => {
      const warnSpy = silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 0 })
      postSpy.mockRejectedValueOnce(new Error('a'))
      await ret.toggle()
      postSpy.mockRejectedValueOnce(new Error('b'))
      await ret.toggle()
      postSpy.mockRejectedValueOnce(new Error('c'))
      await ret.toggle()
      expect(warnSpy).toHaveBeenCalledTimes(3)
      expect(warnSpy.mock.calls.map((call: unknown[]) => (call[1] as Error).message)).toEqual([
        'a',
        'b',
        'c',
      ])
    })

    it('再次触发前 errorMsg 清空（不变量 5）：失败一次后成功 → errorMsg 复位空串', async () => {
      silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 0 })
      postSpy.mockRejectedValueOnce(new Error('boom'))
      await ret.toggle()
      expect(ret.errorMsg.value).toBe('操作失败')
      await ret.toggle()
      expect(ret.errorMsg.value).toBe('')
      expect(postSpy).toHaveBeenCalledTimes(2)
    })
  })

  // ─── saveWith 面板保存变体（spec D5/D6/D9 + ADR-0160 D2/D6，GitHub ticket #533）───
  describe('saveWith 面板保存变体', () => {
    it('载荷正确：restrict + tags 经 addBookmark 序列化到 post（oracle = T3 契约：空格 join + tags[] 字段）', async () => {
      const { ret, postSpy } = setupComposable()
      expect(await ret.saveWith('private', ['風景', '東方Project'])).toBe(true)
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

    it('失败返回 false（显式成败通道）+ 回滚到原态 + errorMsg + console.warn 带模块前缀（不变量 #3 + 硬约束 #3 + FIX-2）', async () => {
      const warnSpy = silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
      postSpy.mockRejectedValueOnce(new Error('boom'))
      expect(await ret.saveWith('private', ['a'])).toBe(false)
      expect(ret.bookmarked.value).toBe(true) // 回滚到保存前原态
      expect(ret.count.value).toBe(5)
      expect(ret.errorMsg.value).toBe('操作失败')
      expect(ret.busy.value).toBe(false)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[useBookmarkMutation]'),
        expect.any(Error),
      )
    })

    it('失败回滚：原未收藏时 bookmarked 还原 false + count 还原（返回值 false）', async () => {
      silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, initialCount: 2 })
      postSpy.mockRejectedValueOnce(new Error('boom'))
      expect(await ret.saveWith('public', [])).toBe(false)
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
      silenceWarn()
      const { ret, postSpy } = setupComposable({ initialBookmarked: true, initialCount: 5 })
      postSpy.mockRejectedValueOnce(new Error('boom'))
      await ret.saveWith('private', [])
      expect(ret.errorMsg.value).toBe('操作失败')
      expect(await ret.saveWith('public', [])).toBe(true)
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
      // busy no-op 不是成功：保守返回 false（面板据此不回滚也不关面板，保持打开态）
      expect(await ret.saveWith('public', [])).toBe(false)
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
      expect(await ret.saveWith('public', ['a'])).toBe(false)
      expect(postSpy).toHaveBeenCalledTimes(1) // 只有 toggle 的 delete 发出
      expect(postSpy).toHaveBeenCalledWith('/v1/illust/bookmark/delete', { illust_id: '42' })
      release()
      await pending
    })
  })

  // ─── 小说收藏（spec #585 / 票 #587：targetKind='novel' 端点分派）───
  // Oracle：端点/载荷逐字对齐 webview api/novel.ts addBookmark/deleteBookmark
  //（POST /v2/novel/bookmark/add {novel_id, restrict}、POST /v1/novel/bookmark/delete {novel_id}）。
  describe("targetKind='novel' 端点分派", () => {
    it('toggle add 走 /v2/novel/bookmark/add 且恒 public（同 D3 语义）', async () => {
      const { ret, postSpy } = setupComposable({ initialBookmarked: false, targetKind: 'novel' })
      await ret.toggle()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v2/novel/bookmark/add', {
        novel_id: '42',
        restrict: 'public',
      })
      expect(ret.bookmarked.value).toBe(true)
    })

    it('toggle delete 走 /v1/novel/bookmark/delete 带 novel_id（非 illust_id）', async () => {
      const { ret, postSpy } = setupComposable({ initialBookmarked: true, targetKind: 'novel' })
      await ret.toggle()
      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith('/v1/novel/bookmark/delete', { novel_id: '42' })
      expect(ret.bookmarked.value).toBe(false)
    })

    it('novel saveWith 不支持 tags：显式 warn（禁静默丢载荷）+ 按 restrict 保存', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { ret, postSpy } = setupComposable({ targetKind: 'novel' })
      const ok = await ret.saveWith('private', ['tagA', 'tagB'])
      expect(ok).toBe(true)
      expect(warnSpy).toHaveBeenCalled()
      expect(postSpy).toHaveBeenCalledWith('/v2/novel/bookmark/add', {
        novel_id: '42',
        restrict: 'private',
      })
      warnSpy.mockRestore()
    })
  })
})
