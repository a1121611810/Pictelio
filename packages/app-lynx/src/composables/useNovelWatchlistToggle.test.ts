// ─── useNovelWatchlistToggle 单测（追更直击切换 · 6 条不变量 + 边界 9 case）───
//
// 测试硬约束（违反视为违规）：
// - 真实样例 mock：addNovelWatchlist / deleteNovelWatchlist 是 api/novel.ts 真实端点函数
//   （Oracle = api/novel.ts:104-111，POST /v1/watchlist/novel/add | delete，{series_id: String(...)}）；
//   vi.mock 仅替换为 vi.fn()，不重写语义
// - 期望值可追溯 oracle：6 条不变量 = spec #734 §4 US2 关键不变量（spec 已锁定，2026-09-26）
// - 禁止静默降级：失败路径必 console.warn 带 [useNovelWatchlistToggle] 模块前缀
// - 跨入口共享断言：setWatchState spy + getWatchState() 双重验证（spy 与真实调用两条独立路径）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import * as watchlistStore from '../stores/watchlistStore'
import { toSeriesId } from '../api/id'
import { setLocale } from '../i18n'
import {
  WATCHLIST_ANIMATION_MS,
  useNovelWatchlistToggle,
  type UseNovelWatchlistToggleReturn,
} from './useNovelWatchlistToggle'

// ─── vi.mock 拦截 api/novel ───
// vi.hoisted 保证 mock 变量在 import 之前实例化（vitest 工厂内可见）
const { addNovelWatchlist, deleteNovelWatchlist } = vi.hoisted(() => ({
  addNovelWatchlist: vi.fn(),
  deleteNovelWatchlist: vi.fn(),
}))

vi.mock('../api/novel', () => ({
  addNovelWatchlist,
  deleteNovelWatchlist,
}))

describe('useNovelWatchlistToggle', () => {
  let cleanups: Array<() => void> = []

  beforeEach(() => {
    // 锁定 zh-CN locale（spec #734 T5 已补 useNovelWatchlistToggle.actionFailed 中英文案，
    // 错误信息断言依赖固定 locale 以保证可重复）
    setLocale('zh-CN')
    // 清空跨用例 watchlistStore 状态（spy / getWatchState 串扰隔离）
    watchlistStore.resetWatchlistStoreForTest()
    addNovelWatchlist.mockReset()
    deleteNovelWatchlist.mockReset()
  })

  afterEach(() => {
    cleanups.forEach((fn) => fn())
    cleanups = []
    vi.restoreAllMocks()
  })

  /** 挂载真实 composable：runWithContext 提供 injection context，effectScope 收纳副作用 */
  function setupComposable(
    opts: {
      seriesId?: number
      initialAdded?: boolean
      onChange?: (added: boolean) => void
    } = {},
  ) {
    const seriesId = opts.seriesId ?? 7777
    const app = createApp({ render: () => null })
    app.use(VueQueryPlugin, { queryClient: new QueryClient() })
    const scope = effectScope()
    let ret!: UseNovelWatchlistToggleReturn
    app.runWithContext(() => {
      scope.run(() => {
        ret = useNovelWatchlistToggle({
          seriesId,
          initialAdded: opts.initialAdded ?? false,
          onChange: opts.onChange,
        })
      })
    })
    cleanups.push(() => scope.stop())
    return { ret, seriesId }
  }

  /** 静默 i18n 缺失警告（i18n 自身在 missing key 时 warn，避免测试噪音；断言靠 spyOn 校验模块前缀） */
  function silenceWarn(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  // ─── 不变量 1：乐观翻转 ───
  it('toggle 后 added 立即翻转（无需等待 API）（不变量 1）', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    addNovelWatchlist.mockImplementation(() => gate)
    const { ret } = setupComposable({ initialAdded: false })
    const pending = ret.toggle()
    // API 未结算前状态已翻转（不变量 1：乐观触发）
    expect(ret.added.value).toBe(true)
    expect(ret.busy.value).toBe(true)
    release()
    await pending
    expect(ret.busy.value).toBe(false)
  })

  // ─── 不变量 2：busy 锁 ───
  it('busy 中第二次 toggle no-op，不调 API（不变量 2）', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    addNovelWatchlist.mockImplementation(() => gate)
    const { ret } = setupComposable({ initialAdded: false })
    const pending = ret.toggle()
    expect(ret.busy.value).toBe(true)
    // busy 锁：第二次 toggle no-op（不变量 2）
    await ret.toggle()
    expect(ret.added.value).toBe(true) // 没被二次翻转
    expect(addNovelWatchlist).toHaveBeenCalledTimes(1) // 只调一次 API
    release()
    await pending
  })

  // ─── 不变量 3：失败静息回滚 + warn ───
  it('API 失败后 added 翻回原态 + errorMsg 设置 + console.warn 带模块前缀（不变量 3 + 测试硬约束 #3）', async () => {
    const warnSpy = silenceWarn()
    const err = new Error('network')
    addNovelWatchlist.mockRejectedValueOnce(err)
    const { ret } = setupComposable({ initialAdded: false })
    await ret.toggle()
    // 不变量 3：状态翻回 + errorMsg 设置 + busy 复位
    expect(ret.added.value).toBe(false) // 翻回原态（未追更）
    // errorMsg 文案 = zh 字典值（spec #734 T5 已补 useNovelWatchlistToggle.actionFailed 中英文案）
    expect(ret.errorMsg.value).toBe('操作失败，请重试')
    expect(ret.busy.value).toBe(false)
    // 测试硬约束 #3：console.warn 带 [useNovelWatchlistToggle] 模块前缀 + 原始 err
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useNovelWatchlistToggle]'),
      err,
    )
  })

  // ─── 不变量 4：350ms 后 onChange ───
  it('成功后 350ms 才触发 onChange(target)（不变量 4）', async () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { ret } = setupComposable({ initialAdded: false, onChange })
      await ret.toggle()
      // API 立刻成功，onChange 不应立即触发
      expect(onChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(WATCHLIST_ANIMATION_MS)
      expect(onChange).toHaveBeenCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // ─── 不变量 5：errorMsg 清空 ───
  it('再次触发前 errorMsg 清空（不变量 5）：失败一次后成功 → errorMsg 复位空串', async () => {
    silenceWarn()
    addNovelWatchlist.mockRejectedValueOnce(new Error('boom'))
    const { ret } = setupComposable({ initialAdded: false })
    await ret.toggle()
    // 失败一次后 errorMsg = zh 字典值（spec #734 T5 已补 i18n）
    expect(ret.errorMsg.value).toBe('操作失败，请重试')
    addNovelWatchlist.mockResolvedValueOnce(undefined)
    await ret.toggle()
    // 不变量 5：第二次触发前清空 errorMsg；成功后无新错误覆盖
    expect(ret.errorMsg.value).toBe('')
    expect(addNovelWatchlist).toHaveBeenCalledTimes(2)
  })

  // ─── 不变量 6：跨入口状态共享 ───
  it('API 成功后调 setWatchState(seriesId, target)（不变量 6 + 跨入口共享）', async () => {
    const setWatchStateSpy = vi.spyOn(watchlistStore, 'setWatchState')
    const { ret, seriesId } = setupComposable({ seriesId: 7777, initialAdded: false })
    await ret.toggle()
    // spy 校验：setWatchState 被以正确参数调用（不变量 6：跨入口状态共享）
    expect(setWatchStateSpy).toHaveBeenCalledWith(7777, true)
    // observable 兜底：getWatchState 同步返回 true（与 createWatchlistPrompt 同源读取）
    expect(watchlistStore.getWatchState(seriesId)).toBe(true)
  })

  // ─── mutationFn 路由 ───
  it('mutationFn 路由：added=false → deleteNovelWatchlist；added=true → addNovelWatchlist', async () => {
    const { ret } = setupComposable({ initialAdded: true })
    await ret.toggle()
    expect(deleteNovelWatchlist).toHaveBeenCalledWith(toSeriesId(7777))
    expect(addNovelWatchlist).not.toHaveBeenCalled()

    deleteNovelWatchlist.mockReset()
    addNovelWatchlist.mockReset()
    await ret.toggle()
    expect(addNovelWatchlist).toHaveBeenCalledWith(toSeriesId(7777))
    expect(deleteNovelWatchlist).not.toHaveBeenCalled()
  })

  // ─── 初始状态 ───
  it('initialAdded=true 时 added.value 初始为 true', () => {
    const { ret } = setupComposable({ initialAdded: true })
    expect(ret.added.value).toBe(true)
  })

  // ─── 失败不污染跨入口缓存 ───
  it('失败时不调 setWatchState（不污染跨入口共享缓存）', async () => {
    const setWatchStateSpy = vi.spyOn(watchlistStore, 'setWatchState')
    silenceWarn()
    addNovelWatchlist.mockRejectedValueOnce(new Error('boom'))
    const { ret, seriesId } = setupComposable({ seriesId: 7777, initialAdded: false })
    await ret.toggle()
    // 失败路径不污染跨入口缓存——避免正文页 createWatchlistPrompt 误读成功态
    expect(setWatchStateSpy).not.toHaveBeenCalled()
    expect(watchlistStore.getWatchState(seriesId)).toBeUndefined()
  })
})