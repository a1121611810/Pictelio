import { ref } from 'vue'
import { presentError } from '../utils/errorPresentation'
import type { WatchlistNovelListResponse, WatchlistSeries } from '../api/types'

/**
 * 追更列表 feed 深模块（issue #225 / spec §US7）。
 *
 * createMixFeed 的 MixFeedItem 类型只接受 illust/novel（PixivIllust/PixivNovel），
 * WatchlistSeries 是另一种条目形状（系列而非作品），故单列本模块承载：
 * 分页合并（系列 id 去重）/ 竞态代 / 错误槽分流（error=首屏、pageError=分页）/
 * 翻页在飞锁。纯逻辑可 node 单测，页面只做 ref 快照桥接（对齐 NovelList 用法）。
 */

/** 翻页合并：保持既有顺序，按系列 id 去重（oracle：next_url offset 分页语义，服务端不保证跨页零重复） */
export function mergeWatchlistPage(
  prev: WatchlistSeries[],
  page: WatchlistNovelListResponse,
): WatchlistSeries[] {
  const seen = new Set(prev.map((s) => s.id))
  const merged = [...prev]
  for (const s of page.series) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    merged.push(s)
  }
  return merged
}

export interface WatchlistFeedDeps {
  fetchFirst: (signal?: AbortSignal) => Promise<WatchlistNovelListResponse>
  fetchNext: (url: string, signal?: AbortSignal) => Promise<WatchlistNovelListResponse>
  /** 模块内部自动触发的加载（防抖重试补发，T1）完成后通知页面重新快照（P1） */
  onUpdate?: () => void
}

export interface WatchlistFeed {
  items: () => WatchlistSeries[]
  loading: () => boolean
  loadingMore: () => boolean
  /** 首屏/刷新失败错误文案；无错误 null */
  error: () => string | null
  /** 分页失败错误文案（保留已加载内容，nextUrl 保留供滚动重试）；无错误 null */
  pageError: () => string | null
  nextUrl: () => string | null
  /** 本地移除条目（取消追更成功后调用，防下次分页 sync 后已删条目复活，review P1-2） */
  removeItem: (seriesId: number) => void
  refresh: () => Promise<void>
  fetchMore: () => Promise<void>
  /** 释放实例（页面卸载时调用）：作废挂起补触发与在途响应（spec §4 T1） */
  dispose: () => void
}

export function createWatchlistFeed(deps: WatchlistFeedDeps): WatchlistFeed {
  const { onUpdate } = deps
  const items = ref<WatchlistSeries[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  const pageError = ref<string | null>(null)
  const nextUrl = ref<string | null>(null)
  /** 竞态代：refresh 重建递增，在飞的旧响应落地即作废 */
  let generation = 0

  // [T1] 在飞锁吞事件的一次性补触发（同 createMixFeed 修复，spec: app-lynx-feed-pagination-and-watchlist-prompt-fix）：
  // 原生 scrolltolower 低频单发，落在在飞窗口被吞且无重试 = 永久卡死。
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  /** 被在飞锁吞掉且还有下一页时挂一次性重试；最多挂起一个 */
  function scheduleRetry(): void {
    if (retryTimer !== null) return
    if (!nextUrl.value) return // 耗尽不排
    retryTimer = setTimeout(() => {
      retryTimer = null
      void fetchMore().finally(() => onUpdate?.()) // 补发完成后页面重新快照（P1）
    }, 800)
  }

  async function refresh(): Promise<void> {
    // 在飞锁优先（review P1-1）：首屏在飞时的重复 refresh 直接吞掉、共享在飞结果；
    // 不得先递增代——在飞响应相对页面状态不是陈旧的，作废它会落地假空态。
    // 注：clearRetry 放在锁后（仅真实 refresh 才清）——被吞的 refresh 不是真 refresh，
    // 挂起的补发继续保留，在飞完成后自动恢复用户的「加载更多」意图（spec §4 T1）。
    if (loading.value) return
    clearRetry() // 重建会话：挂起的补触发随旧会话作废
    const gen = ++generation
    loading.value = true
    error.value = null
    pageError.value = null
    try {
      const page = await deps.fetchFirst()
      if (gen !== generation) return
      items.value = mergeWatchlistPage([], page)
      nextUrl.value = page.next_url
    } catch (err) {
      if (gen !== generation) return
      console.warn('[watchlistFeed] 首屏加载失败', err)
      error.value = presentError(err, '加载失败')
    } finally {
      // refresh 同时只允许一个在飞（上方在飞锁），无条件复位即可；
      // 不能用 gen === generation 守——被后到调用作废时也必须复位，否则 loading 永久卡死
      loading.value = false
    }
  }

  async function fetchMore(): Promise<void> {
    const url = nextUrl.value
    if (!url) return
    if (loading.value || loadingMore.value) {
      scheduleRetry() // [T1] 单发事件被在飞锁吞掉 → 窗口后自动补一次
      return
    }
    clearRetry() // 本次真实执行：取消挂起的补触发
    const gen = generation
    loadingMore.value = true
    pageError.value = null
    try {
      const page = await deps.fetchNext(url)
      if (gen !== generation) return
      items.value = mergeWatchlistPage(items.value, page)
      nextUrl.value = page.next_url
    } catch (err) {
      if (gen !== generation) return
      console.warn('[watchlistFeed] 分页加载失败', err)
      pageError.value = presentError(err, '加载更多失败')
    } finally {
      loadingMore.value = false
    }
  }

  function removeItem(seriesId: number): void {
    items.value = items.value.filter((s) => s.id !== seriesId)
  }

  /** 释放：清挂起补触发 + 代递增作废在途响应（页面卸载调用，防孤儿请求） */
  function dispose(): void {
    clearRetry()
    generation++
  }

  return {
    items: () => items.value,
    loading: () => loading.value,
    loadingMore: () => loadingMore.value,
    error: () => error.value,
    pageError: () => pageError.value,
    nextUrl: () => nextUrl.value,
    removeItem,
    refresh,
    fetchMore,
    dispose,
  }
}
