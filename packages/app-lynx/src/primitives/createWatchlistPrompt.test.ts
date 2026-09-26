// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US4 接口契约 + §2 决策记录
// - 预取：创建时 getSeries() 非空 → loadWatchState；generation-gate（dispose 后慢响应作废）；
//   失败 → watchAdded=null + warn（保守不弹）
// - requestBack：命中 shouldPromptWatchlist（oracle 见 watchlistPrompt.test.ts）→ 拦截开弹窗
// - confirm：busy 锁；成功 setWatchState+关弹窗；失败 dialogError+warn
// - decline/cancel：都 dismiss + 关弹窗；继续返回与否由页面层决定（primitive 不导航）
// - ADR-0189 D5：deps.getWatchState（reactive cache）→ watchAdded 派生来源；
//   外部 setWatchState 写入 cache 后 watchAdded 立即反映（同页 / 跨页同步）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reactive } from "vue"
import {
  createWatchlistPrompt,
  type WatchlistPromptDeps,
} from "./createWatchlistPrompt"
import {
  WATCHLIST_PROMPT_MIN_DWELL_MS,
  WATCHLIST_PROMPT_SCROLL_THRESHOLD,
} from "./watchlistPrompt"
import * as watchlistStore from "../stores/watchlistStore"

interface FakeDeps extends WatchlistPromptDeps {
  series: { id: number; title: string } | null
  dismissed: Set<number>
  /** 镜像真实 watchlistStore：reactive Record，setWatchState 写入触发 Vue 响应式 */
  watchStates: Record<number, boolean>
  addedCalls: number[]
}

/** 假 deps：全内存实现 + 调用记录；loadWatchState/addWatchlist 可由用例覆盖 */
function makeDeps(overrides?: {
  series?: { id: number; title: string } | null
  loadWatchState?: (seriesId: number) => Promise<boolean>
  addWatchlist?: (seriesId: number) => Promise<void>
  now?: () => number
}): FakeDeps {
  const dismissed = new Set<number>()
  // reactive Record —— 与 watchlistStore 行为一致（set/get 触发响应式通知），
  // 让 computed watchAdded 在 setWatchState 写入后能正确重算
  const watchStates = reactive<Record<number, boolean>>({})
  const addedCalls: number[] = []
  const series = overrides?.series === undefined ? { id: 42, title: "测试系列" } : overrides.series
  return {
    series,
    dismissed,
    watchStates,
    addedCalls,
    getSeries: () => series,
    loadWatchState: overrides?.loadWatchState ?? (() => Promise.resolve(false)),
    addWatchlist:
      overrides?.addWatchlist ??
      ((id: number) => {
        addedCalls.push(id)
        return Promise.resolve()
      }),
    isDismissed: (id) => dismissed.has(id),
    markDismissed: (id) => {
      dismissed.add(id)
    },
    setWatchState: (id, added) => {
      watchStates[id] = added
    },
    getWatchState: (id) => watchStates[id],
    now: overrides?.now,
  }
}

/** 可控时钟：step 推进 dwellMs */
function makeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let t = startMs
  return { now: () => t, advance: (ms) => (t += ms) }
}

describe("createWatchlistPrompt · 预取", () => {
  it("创建时 getSeries() 非空 → loadWatchState 并写 watchAdded + setWatchState", async () => {
    const deps = makeDeps({ loadWatchState: () => Promise.resolve(true) })
    const p = createWatchlistPrompt(deps)
    await vi.waitFor(() => expect(p.watchAdded).toBe(true))
    expect(deps.watchStates[42]).toBe(true)
    p.dispose()
  })

  it("非系列小说 → 不发起预取，watchAdded 恒为 null", async () => {
    const loadWatchState = vi.fn(() => Promise.resolve(false))
    const deps = makeDeps({ series: null, loadWatchState })
    const p = createWatchlistPrompt(deps)
    await Promise.resolve()
    expect(loadWatchState).not.toHaveBeenCalled()
    expect(p.watchAdded).toBeNull()
    p.dispose()
  })

  it("预取失败 → watchAdded 保持 null + console.warn（保守不弹，禁静默降级）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const deps = makeDeps({ loadWatchState: () => Promise.reject(new Error("network")) })
    const p = createWatchlistPrompt(deps)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(warn.mock.calls[0]?.[0]).toContain("[watchlist]")
    expect(p.watchAdded).toBeNull()
    warn.mockRestore()
    p.dispose()
  })

  it("generation-gate：dispose 后慢响应不写入 watchAdded / watchStates", async () => {
    let resolveLoad!: (v: boolean) => void
    const deps = makeDeps({
      loadWatchState: () => new Promise<boolean>((r) => (resolveLoad = r)),
    })
    const p = createWatchlistPrompt(deps)
    p.dispose()
    resolveLoad(true)
    await Promise.resolve()
    expect(p.watchAdded).toBeNull()
    expect(Object.keys(deps.watchStates).length).toBe(0)
  })
})

describe("createWatchlistPrompt · requestBack 判定接线", () => {
  /** 全条件命中场景：未追更 + 未暂不 + 进度达标 + 停留达标 */
  function setupReady(overrides?: Parameters<typeof makeDeps>[0]) {
    const clock = makeClock()
    const deps = makeDeps({ ...overrides, now: clock.now })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    p.notifyScroll(WATCHLIST_PROMPT_SCROLL_THRESHOLD, false)
    return { deps, p, clock }
  }

  it("全条件命中 → 拦截并打开弹窗", async () => {
    const { p } = setupReady()
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    expect(p.requestBack()).toBe(true)
    expect(p.dialogOpen).toBe(true)
    p.dispose()
  })

  it("已追更（预取 true）→ 放行", async () => {
    const { p } = setupReady({ loadWatchState: () => Promise.resolve(true) })
    await vi.waitFor(() => expect(p.watchAdded).toBe(true))
    expect(p.requestBack()).toBe(false)
    expect(p.dialogOpen).toBe(false)
    p.dispose()
  })

  it("预取失败（状态未知）→ 保守放行", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { p } = setupReady({ loadWatchState: () => Promise.reject(new Error("x")) })
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(p.requestBack()).toBe(false)
    vi.mocked(console.warn).mockRestore()
    p.dispose()
  })

  it("本会话已「暂不」→ 放行", async () => {
    const { deps, p } = setupReady()
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    deps.dismissed.add(42)
    expect(p.requestBack()).toBe(false)
    p.dispose()
  })

  it("停留不足 → 放行", async () => {
    const clock = makeClock()
    const deps = makeDeps({ now: clock.now })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS - 1)
    p.notifyScroll(1, true)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    expect(p.requestBack()).toBe(false)
    p.dispose()
  })

  it("进度不足且未到底 → 放行；到达底部 → 拦截（reachedBottom 短路）", async () => {
    const { p } = setupReady()
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(0.1, false)
    expect(p.requestBack()).toBe(false)
    p.notifyScroll(0.1, true)
    expect(p.requestBack()).toBe(true)
    p.dispose()
  })

  it("非系列小说 → 恒放行", () => {
    const deps = makeDeps({ series: null })
    const p = createWatchlistPrompt(deps)
    p.notifyScroll(1, true)
    expect(p.requestBack()).toBe(false)
    p.dispose()
  })

  it("弹窗已打开时再 requestBack → 仍拦截（返回键归 modalStack，不重复开弹窗）", async () => {
    const { p } = setupReady()
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    expect(p.requestBack()).toBe(true)
    expect(p.requestBack()).toBe(true)
    expect(p.dialogOpen).toBe(true)
    p.dispose()
  })
})

describe("createWatchlistPrompt · confirm", () => {
  function makeConfirmDeps(overrides?: Parameters<typeof makeDeps>[0]) {
    const clock = makeClock()
    const deps = makeDeps({ ...overrides, now: clock.now })
    return { deps, clock }
  }

  it("成功 → addWatchlist 调用 + setWatchState(true) + 关弹窗", async () => {
    const { deps, clock } = makeConfirmDeps()
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(1, true)
    expect(p.requestBack()).toBe(true)
    await p.confirm()
    expect(deps.addedCalls).toEqual([42])
    expect(deps.watchStates[42]).toBe(true)
    expect(p.watchAdded).toBe(true)
    expect(p.dialogOpen).toBe(false)
    p.dispose()
  })

  it("失败 → dialogError + console.warn，弹窗保持打开可重试", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { deps, clock } = makeConfirmDeps({
      addWatchlist: () => Promise.reject(new Error("500")),
    })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(1, true)
    expect(p.requestBack()).toBe(true)
    await p.confirm()
    // oracle = spec §US4 行为契约（dialogError 非空 + 弹窗保持可重试）；文案字面值非 spec 契约，不锁定
    expect(p.dialogError).toBeTruthy()
    expect(p.dialogOpen).toBe(true)
    expect(warn.mock.calls[0]?.[0]).toContain("[watchlist]")
    // 追更失败不得翻转状态：watchStates 仅保留预取写入的 false
    expect(deps.watchStates[42]).toBe(false)
    expect(p.watchAdded).toBe(false)
    warn.mockRestore()
    p.dispose()
  })

  it("busy 锁：请求在飞时重复 confirm 被忽略（防连点）", async () => {
    let resolveAdd!: () => void
    const addWatchlist = vi.fn(
      () => new Promise<void>((r) => (resolveAdd = r)),
    )
    const { deps, clock } = makeConfirmDeps({ addWatchlist })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(1, true)
    p.requestBack()
    const first = p.confirm()
    expect(p.dialogBusy).toBe(true)
    await p.confirm() // 应立即返回，不产生第二次调用
    expect(addWatchlist).toHaveBeenCalledTimes(1)
    resolveAdd()
    await first
    expect(p.dialogBusy).toBe(false)
    p.dispose()
  })

  it("confirm 后 dispose：在飞响应落地不写入状态", async () => {
    let resolveAdd!: () => void
    const { deps, clock } = makeConfirmDeps({
      addWatchlist: () => new Promise<void>((r) => (resolveAdd = r)),
    })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(1, true)
    p.requestBack()
    const pending = p.confirm()
    p.dispose()
    resolveAdd()
    await pending
    // 在飞 confirm 落地被 generation-gate 拦截：状态保持预取时的 false，弹窗不复开
    expect(deps.watchStates[42]).toBe(false)
    expect(p.watchAdded).toBe(false)
    expect(p.dialogOpen).toBe(false)
  })
})

describe("createWatchlistPrompt · decline / cancel", () => {
  async function openedPrompt() {
    const clock = makeClock()
    const deps = makeDeps({ now: clock.now })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(1, true)
    expect(p.requestBack()).toBe(true)
    return { deps, p }
  }

  it("decline：dismiss + 关弹窗，再返回不再询问（D2）", async () => {
    const { deps, p } = await openedPrompt()
    p.decline()
    expect(p.dialogOpen).toBe(false)
    expect(deps.dismissed.has(42)).toBe(true)
    expect(p.requestBack()).toBe(false)
    p.dispose()
  })

  it("cancel：同样 dismiss + 关弹窗（语义差在页面层：decline 继续返回 / cancel 留页）", async () => {
    const { deps, p } = await openedPrompt()
    p.cancel()
    expect(p.dialogOpen).toBe(false)
    expect(deps.dismissed.has(42)).toBe(true)
    p.dispose()
  })
})

describe("createWatchlistPrompt · dispose", () => {
  it("dispose 复位弹窗状态", async () => {
    const clock = makeClock()
    const deps = makeDeps({ now: clock.now })
    const p = createWatchlistPrompt(deps)
    clock.advance(WATCHLIST_PROMPT_MIN_DWELL_MS)
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    p.notifyScroll(1, true)
    p.requestBack()
    expect(p.dialogOpen).toBe(true)
    p.dispose()
    expect(p.dialogOpen).toBe(false)
    expect(p.dialogBusy).toBe(false)
    expect(p.dialogError).toBe("")
  })
})

describe("createWatchlistPrompt · reactive cache 同步（ADR-0189 D5）", () => {
  // 使用真实 watchlistStore（reactive Record）——验证 setWatchState 写入 → computed 派生翻转
  beforeEach(() => {
    watchlistStore.resetWatchlistStoreForTest()
  })

  afterEach(() => {
    watchlistStore.resetWatchlistStoreForTest()
  })

  /** 真 store 接线：与页面 wiring 完全一致；loadWatchState/addWatchlist 可由用例覆盖 */
  function makeRealDeps(overrides?: {
    series?: { id: number; title: string } | null
    loadWatchState?: (seriesId: number) => Promise<boolean>
    addWatchlist?: (seriesId: number) => Promise<void>
    now?: () => number
  }): WatchlistPromptDeps {
    const series =
      overrides?.series === undefined ? { id: 42, title: "测试系列" } : overrides.series
    return {
      getSeries: () => series,
      loadWatchState: overrides?.loadWatchState ?? (() => Promise.resolve(false)),
      addWatchlist: overrides?.addWatchlist ?? (() => Promise.resolve()),
      isDismissed: watchlistStore.isDismissed,
      markDismissed: watchlistStore.markDismissed,
      setWatchState: watchlistStore.setWatchState,
      getWatchState: watchlistStore.getWatchState,
      now: overrides?.now,
    }
  }

  it("外部调 setWatchState(true) → watchAdded 立即变 true（介绍页 toggle 后 chip 翻转）", async () => {
    const p = createWatchlistPrompt(makeRealDeps())
    // 等预取落地：cache[42] = false, fetchedWatchAdded = false
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    // 模拟介绍页 inline toggle（useNovelWatchlistToggle 调 watchlistStore.setWatchState）
    watchlistStore.setWatchState(42, true)
    // computed 派生翻转（无需手动 watch 兜底）
    expect(p.watchAdded).toBe(true)
    p.dispose()
  })

  it("外部调 setWatchState(false) → watchAdded 立即变 false", async () => {
    // 预取 true（已追更）；外部写入 false 模拟用户取消
    const p = createWatchlistPrompt(makeRealDeps({ loadWatchState: () => Promise.resolve(true) }))
    await vi.waitFor(() => expect(p.watchAdded).toBe(true))
    watchlistStore.setWatchState(42, false)
    expect(p.watchAdded).toBe(false)
    p.dispose()
  })

  it("API fetch false + 外部 setWatchState(true) → watchAdded = true（cache 优先于 fetch）", async () => {
    const p = createWatchlistPrompt(makeRealDeps({ loadWatchState: () => Promise.resolve(false) }))
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    watchlistStore.setWatchState(42, true)
    expect(p.watchAdded).toBe(true)
    p.dispose()
  })

  it("外部 setWatchState(true) 后再 setWatchState(false) → watchAdded = false（最新写入生效）", async () => {
    const p = createWatchlistPrompt(makeRealDeps({ loadWatchState: () => Promise.resolve(true) }))
    await vi.waitFor(() => expect(p.watchAdded).toBe(true))
    watchlistStore.setWatchState(42, false)
    expect(p.watchAdded).toBe(false)
    watchlistStore.setWatchState(42, true)
    expect(p.watchAdded).toBe(true)
    p.dispose()
  })

  it("confirm 成功后外部 read 同步看到 true（跨 controller 共享 cache）", async () => {
    const p = createWatchlistPrompt(makeRealDeps())
    await vi.waitFor(() => expect(p.watchAdded).toBe(false))
    // 不开弹窗：直接走 confirm 路径需要 dialog open。这里通过外部 setWatchState 模拟 confirm 落地的 cache 写入
    watchlistStore.setWatchState(42, true)
    expect(watchlistStore.getWatchState(42)).toBe(true)
    expect(p.watchAdded).toBe(true)
    p.dispose()
  })
})
