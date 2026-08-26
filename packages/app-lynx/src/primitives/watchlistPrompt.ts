// ─── 追更询问触发判定（纯逻辑 seam，spec §US2） ───
// 零 Vue 依赖，node 可单测。oracle = docs/specs/app-lynx-novel-series-watchlist.md
// §2 决策记录 D1–D3：滚动 ≥70% 或到达底部、停留 ≥10s、状态已知且未追更、
// 本会话未「暂不」、已完结系列也弹（is_concluded 不参与判定）。

/** 触发判定所需的最短停留时长（ms，决策 D1 防秒进秒退误触） */
export const WATCHLIST_PROMPT_MIN_DWELL_MS = 10_000

/** 触发判定所需的最小滚动进度（0~1，决策 D1） */
export const WATCHLIST_PROMPT_SCROLL_THRESHOLD = 0.7

export interface WatchlistPromptInput {
  /** 小说是否属于系列（novel.series 存在） */
  hasSeries: boolean
  /** 系列追更状态；null = 状态未知（预取失败/未回）→ 保守不弹 */
  watchlistAdded: boolean | null
  /** 本会话是否已「暂不」该系列（决策 D2） */
  dismissedThisSession: boolean
  /** 阅读进度 0~1 */
  scrollProgress: number
  /** 是否已滚动到底（到达底部与进度阈值是「或」关系） */
  reachedBottom: boolean
  /** 页面停留时长（ms） */
  dwellMs: number
}

/**
 * 是否应在返回时弹出「是否追更该系列」询问。
 * 全条件命中才弹；watchlistAdded 为 null（未知）时保守不弹——
 * 预取失败的 console.warn 由调用方（createWatchlistPrompt）负责。
 */
export function shouldPromptWatchlist(input: WatchlistPromptInput): boolean {
  if (!input.hasSeries) return false
  if (input.watchlistAdded !== false) return false
  if (input.dismissedThisSession) return false
  if (input.dwellMs < WATCHLIST_PROMPT_MIN_DWELL_MS) return false
  return input.scrollProgress >= WATCHLIST_PROMPT_SCROLL_THRESHOLD || input.reachedBottom
}

/**
 * 阅读进度计算（spec §US4）：scrollTop / (scrollHeight - viewportHeight)，clamp 到 0~1。
 * Lynx scroll-view 的 scroll 事件 payload 只有 scrollTop/scrollHeight（ADR-0109），
 * 无 viewport 高度：viewportHeight 不可知（传 0）时退化为 scrollTop/scrollHeight 近似值
 * ——阈值触发会偏晚，但「到达底部」始终由 scrolltolower 兑底，不会漏弹。
 * 不可滚动（scrollHeight <= viewportHeight）时进度恒 0（仅靠到达底部触发）。
 */
export function computeReadProgress(
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  if (scrollHeight <= 0) return 0
  const scrollable = scrollHeight - Math.max(0, viewportHeight)
  const raw = scrollable > 0 ? scrollTop / scrollable : 0
  if (!Number.isFinite(raw)) return 0
  return Math.min(1, Math.max(0, raw))
}
