// ─── 追更询问编排 primitive（spec §US4） ───
// 深模块：预取 + generation-gate 竞态防护 + 触发判定接线 + 弹窗状态机全部内收，
// 页面（NovelDetail）只喂滚动事件、把 requestBack 接进返回守卫、按状态渲染弹窗。
// deps 注入（对齐 createBookmarkToggle 风格），node 可单测——测试用假 deps，
// 不碰真实 API 模块。
//
// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US4 接口契约 + §2 决策记录
// - D1：滚动 ≥70% 或到达底部，且停留 ≥10s（判定细节在 ./watchlistPrompt.ts）
// - D2：decline/cancel 记入本会话「暂不」，不再询问
// - 预取失败 → watchAdded = null + console.warn（保守不弹，禁静默降级）
// - decline 与 cancel 语义差：都 dismiss + 关弹窗；**是否继续原返回动作由页面层区分**
//   （decline 继续返回 / cancel 留在详情页），primitive 只暴露两个不同方法名。
import { ref } from "vue"
import { shouldPromptWatchlist } from "./watchlistPrompt"
import { t0log } from "../debug/t0Diag" // [T0-DIAG]

export interface WatchlistPromptDeps {
  /** 页面提供当前小说的系列信息；null = 非系列小说（守卫恒放行，零开销） */
  getSeries: () => { id: number; title: string } | null
  /** 加载系列追更状态（T1 loadNovelSeries 的适配，返回 watchlist_added） */
  loadWatchState: (seriesId: number) => Promise<boolean>
  /** 本会话是否已「暂不」该系列（watchlistStore.isDismissed） */
  isDismissed: (seriesId: number) => boolean
  /** 记录「暂不」（watchlistStore.markDismissed） */
  markDismissed: (seriesId: number) => void
  /** 写入追更状态缓存（watchlistStore.setWatchState） */
  setWatchState: (seriesId: number, added: boolean) => void
  /** 追更请求（T1 addNovelWatchlist 的适配；deps 注入保持单测不碰真实 API） */
  addWatchlist: (seriesId: number) => Promise<void>
  /** 测试注入时钟，默认 Date.now */
  now?: () => number
}

export interface WatchlistPromptController {
  /** 页面转发滚动事件：progress 0~1；reachedBottom 到达底部 */
  notifyScroll(progress: number, reachedBottom: boolean): void
  /** 返回守卫回调：命中触发条件 → 打开弹窗并返回 true（拦截）；否则 false 放行 */
  requestBack(): boolean
  /** 弹窗显隐 */
  readonly dialogOpen: boolean
  /** 追更请求在飞（防连点，弹窗据此禁用按钮） */
  readonly dialogBusy: boolean
  /** 追更失败错误信息（弹窗内错误条 + 可重试） */
  readonly dialogError: string
  /** 当前系列追更状态：true/false 已知；null = 未知（预取失败/未回/非系列） */
  readonly watchAdded: boolean | null
  /** 「追更」：成功 → setWatchState + 关弹窗；失败 → dialogError + warn（不静默） */
  confirm(): Promise<void>
  /** 「暂不」：dismiss + 关弹窗（页面层继续原返回动作） */
  decline(): void
  /** 返回键关弹窗：dismiss + 关弹窗（页面层留在详情页） */
  cancel(): void
  /** 卸载/章节切换：代递增作废在飞预取 + 状态复位 */
  dispose(): void
}

export function createWatchlistPrompt(
  deps: WatchlistPromptDeps,
): WatchlistPromptController {
  const now = deps.now ?? Date.now
  const createdAt = now()

  const dialogOpen = ref(false)
  const dialogBusy = ref(false)
  const dialogError = ref("")
  const watchAdded = ref<boolean | null>(null)

  let generation = 0
  let scrollProgress = 0
  let reachedBottom = false

  // 预取追更状态（创建时一次）：generation-gate 防 dispose/章节切换后慢响应污染
  const seriesAtCreate = deps.getSeries()
  if (seriesAtCreate) {
    const seriesId = seriesAtCreate.id
    const gen = generation
    void deps
      .loadWatchState(seriesId)
      .then((added) => {
        if (gen !== generation) return
        t0log("[watchlist]", `prefetch sid=${seriesId} added=${added}`) // [T0-DIAG]
        // review P2-2：confirm 已先行置 true 时，陈旧预取落地不得覆盖
        if (watchAdded.value === true) return
        watchAdded.value = added
        deps.setWatchState(seriesId, added)
      })
      .catch((err) => {
        if (gen !== generation) return
        // 预取失败 → watchAdded 保持 null（shouldPromptWatchlist 保守不弹）
        console.warn("[watchlist] 追更状态预取失败，本次不弹询问", err)
        t0log("[watchlist]", `prefetch FAIL sid=${seriesId} ${String(err).slice(0, 60)}`) // [T0-DIAG]
      })
  }

  function notifyScroll(progress: number, bottom: boolean): void {
    scrollProgress = progress
    reachedBottom = bottom
  }

  function requestBack(): boolean {
    if (dialogOpen.value) return true // 弹窗已打开：返回键归 modalStack 关弹窗，页面不再 pop
    const series = deps.getSeries()
    const input = {
      hasSeries: series !== null,
      watchlistAdded: watchAdded.value,
      dismissedThisSession: series !== null && deps.isDismissed(series.id),
      scrollProgress,
      reachedBottom,
      dwellMs: now() - createdAt,
    }
    const hit = shouldPromptWatchlist(input)
    // [T0-DIAG] 判定输入与结论打点（复现不弹问题用，修复后移除）
    t0log("[watchlist]", `reqBack s=${input.hasSeries} wa=${input.watchlistAdded} d=${input.dismissedThisSession} p=${input.scrollProgress.toFixed(2)} b=${input.reachedBottom} dwell=${Math.round(input.dwellMs / 1000)}s → hit=${hit}`,)
    if (!hit) return false
    dialogError.value = ""
    dialogOpen.value = true
    return true
  }

  async function confirm(): Promise<void> {
    if (dialogBusy.value) return
    const series = deps.getSeries()
    if (!series) {
      dialogOpen.value = false
      return
    }
    dialogBusy.value = true
    dialogError.value = ""
    const gen = generation
    try {
      await deps.addWatchlist(series.id)
      if (gen !== generation) return
      deps.setWatchState(series.id, true)
      watchAdded.value = true
      dialogOpen.value = false
    } catch (err) {
      if (gen !== generation) return
      console.warn("[watchlist] 追更失败", err)
      dialogError.value = "追更失败，请重试"
    } finally {
      if (gen === generation) dialogBusy.value = false
    }
  }

  function decline(): void {
    const series = deps.getSeries()
    if (series) deps.markDismissed(series.id)
    dialogOpen.value = false
  }

  function cancel(): void {
    decline()
  }

  function dispose(): void {
    generation++
    dialogOpen.value = false
    dialogBusy.value = false
    dialogError.value = ""
  }

  return {
    notifyScroll,
    requestBack,
    get dialogOpen() {
      return dialogOpen.value
    },
    get dialogBusy() {
      return dialogBusy.value
    },
    get dialogError() {
      return dialogError.value
    },
    get watchAdded() {
      return watchAdded.value
    },
    confirm,
    decline,
    cancel,
    dispose,
  }
}
