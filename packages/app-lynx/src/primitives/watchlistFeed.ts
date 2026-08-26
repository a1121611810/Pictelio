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
  refresh: () => Promise<void>
  fetchMore: () => Promise<void>
}

export function createWatchlistFeed(deps: WatchlistFeedDeps): WatchlistFeed {
  const items = ref<WatchlistSeries[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  const pageError = ref<string | null>(null)
  const nextUrl = ref<string | null>(null)
  /** 竞态代：refresh 重建递增，在飞的旧响应落地即作废 */
  let generation = 0

  async function refresh(): Promise<void> {
    // 竞态代必须先递增再防重入：后到的 refresh 即使被在飞锁吞掉，
    // 也要作废在飞的旧响应（防陈旧首屏落地）
    const gen = ++generation
    if (loading.value) return
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
    if (!url || loading.value || loadingMore.value) return
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

  return {
    items: () => items.value,
    loading: () => loading.value,
    loadingMore: () => loadingMore.value,
    error: () => error.value,
    pageError: () => pageError.value,
    nextUrl: () => nextUrl.value,
    refresh,
    fetchMore,
  }
}
