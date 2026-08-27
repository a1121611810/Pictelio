// 页式缓存分页深模块（ADR-0114 / spec: app-lynx-feed-pagination-buttons §3.1.1）。
// 推荐页按钮分页（替换式翻书）的数据层：列表永远只显示当前页，切页 = 页缓存切换 /
// 拉取新页后整页替换（渲染层 epoch 重建由页面负责）。
//
// 语义要点（spec §3.1.1）：
// - 缓存窗口不变式：cachedPages 是含 currentIndex 的连续窗口，prev/next 只走 ±1
// - 切页事务：next 拉所有非耗尽源，全部成功才提交；任一路失败不提交（保留当前页与游标，可重试）
// - 防重入：任一请求在飞时 next/prev 为 no-op；refresh 例外（打断型，generation 作废在途）
// - 缓存上限淘汰：超 maxCachedPages 淘汰距 currentIndex 较远一端（等距淘汰 lo 端），永不淘汰当前页
// - 页内去重（按 key），跨页不去重（缓存一致性）
// - 空 items + 非空 nextUrl = 该源失败（防空页死循环）
// 纯 TS 无 DOM 依赖（node 可测）；onUpdate 契约保留（按钮模式无自动加载路径，当前不触发）。
import type { MixFeedItem } from './createMixFeed'
import { withTimeout } from '../utils/withTimeout'
import { presentError } from '../utils/errorPresentation'
import { mergeByTime } from './mergeByTime'

/** 单路分页源：fetchPage(signal, nextUrl)——nextUrl 为 undefined/空 = 第一页，否则该路当前游标 */
export interface PagedFeedSource {
  name: string
  fetchPage: (
    signal?: AbortSignal,
    nextUrl?: string | null,
  ) => Promise<{ items: MixFeedItem[]; nextUrl: string | null }>
}

export interface PagedFeedOptions {
  sources: PagedFeedSource[]
  /** 单页请求超时 ms，默认 15000（对齐 createMixFeed） */
  timeoutMs?: number
  /** 页缓存上限（上一页可回溯的最大页数），默认 5 */
  maxCachedPages?: number
  /** 合并模式：默认 time-merge（按 create_date 交叉合并）；ratio 为预留接口，当前实现恒走 time-merge */
  merge?: 'time-merge' | 'ratio'
  /** 页面级每页条数（文档性：页内全量展示，无截断消费路径） */
  pageSize?: number
  /** 模块内部自动触发的加载完成后通知页面重新快照（与 createMixFeed 同签名；
   *  按钮模式无自动加载路径，当前永不触发，保留供未来预取/自动刷新复用） */
  onUpdate?: () => void
}

/** 缓存的单页：合并后条目 + 各路游标（与 sources 对齐） */
interface CachedPage {
  items: MixFeedItem[]
  nextUrls: (string | null)[]
}

export interface PagedFeed {
  /** 当前页合并排序后的条目（替换式渲染，页面 sync 快照） */
  items: () => MixFeedItem[]
  /** 当前页请求在飞（切页 loading 指示） */
  loading: () => boolean
  /** 当前操作失败文案（presentError 产出）；首载失败 items 空 = 整页错误，否则页内错误条 */
  error: () => string | null
  /** 当前页号（0 起） */
  pageIndex: () => number
  /** 是否可上一页（currentIndex > 0 且该页在缓存窗口内） */
  hasPrev: () => boolean
  /** 是否可下一页（缓存窗口内有下一页，或当前页任一路游标非空） */
  hasNext: () => boolean
  /** 下一页：缓存命中直接切换，否则拉所有非耗尽源，全部成功才提交 */
  next: () => Promise<void>
  /** 上一页：纯缓存切换（Pixiv 无 prev_url），缓存 miss 时 warn + no-op */
  prev: () => Promise<void>
  /** 刷新：回第 1 页重拉（清缓存）；失败保留当前页与缓存，error 置文案可重试 */
  refresh: () => Promise<void>
  /** 释放实例（页面卸载时调用）：generation 作废在途 + abort 会话 signal */
  dispose: () => void
}

export function createPagedFeed(opts: PagedFeedOptions): PagedFeed {
  const { sources, timeoutMs = 15000 } = opts
  const rawMax = opts.maxCachedPages ?? 5
  // 防御（review minor-7）：maxCachedPages 非法值（<1）会破坏窗口不变式（currentIndex 越界），归一为默认 5
  const maxCachedPages = rawMax >= 1 ? rawMax : 5
  if (rawMax < 1) {
    console.warn(`[pagedfeed] maxCachedPages 非法值 ${rawMax}（应 ≥1），已归一为默认 5`)
  }

  /** 连续缓存窗口（含 currentIndex；refresh 重建，next push，淘汰 shift/pop） */
  let cachedPages: CachedPage[] = []
  /** 当前页在缓存窗口中的位置 */
  let currentIndex = 0
  /** 竞态代：refresh/dispose 递增，在途旧响应据此作废 */
  let generation = 0
  /** 在飞请求计数（next/prev 防重入用；refresh 可打断，故不能是布尔） */
  let inflight = 0
  /** 当前操作失败文案（presentError 产出）；null = 无错 */
  let errorText: string | null = null
  /** 当前会话 AbortController（dispose/换代时 abort 在途，防孤儿请求） */
  let sessionAbort: AbortController | null = null

  /** 页内合并：时间交叉 + 按 key 去重（跨页不去重，缓存一致性） */
  function mergeItems(pages: MixFeedItem[][]): MixFeedItem[] {
    const merged = mergeByTime(pages, (it) => it.data.create_date)
    const seen = new Set<string>()
    const out: MixFeedItem[] = []
    for (const it of merged) {
      if (seen.has(it.key)) continue
      seen.add(it.key)
      out.push(it)
    }
    return out
  }

  /** 校验单路结果：空 items + 非空 nextUrl = 异常形态（视为失败，防空页死循环）；其余正常 */
  function isSourceValid(r: { items: MixFeedItem[]; nextUrl: string | null }): boolean {
    return !(r.items.length === 0 && r.nextUrl !== null)
  }

  /** 缓存上限淘汰：超限淘汰距 currentIndex 较远一端（等距淘汰 lo 端），永不淘汰当前页 */
  function evict(): void {
    while (cachedPages.length > maxCachedPages) {
      const distLo = currentIndex
      const distHi = cachedPages.length - 1 - currentIndex
      if (distLo >= distHi) {
        cachedPages.shift()
        currentIndex--
      } else {
        cachedPages.pop()
      }
    }
  }

  /** 页缓存 miss（窗口不变式破坏，理论不可达）或未首载时的安全 no-op */
  function pageAt(idx: number): CachedPage | null {
    return idx >= 0 && idx < cachedPages.length ? cachedPages[idx] : null
  }

  async function next(): Promise<void> {
    if (inflight > 0) return // 防重入：任一请求在飞
    if (cachedPages.length === 0) return // 未首载
    // 缓存命中（翻回后再翻前，往返一致）：直接切换，不请求
    const cachedTarget = pageAt(currentIndex + 1)
    if (cachedTarget) {
      currentIndex += 1
      errorText = null
      return
    }
    const current = pageAt(currentIndex)
    if (!current) return
    const nextUrls = current.nextUrls
    if (nextUrls.every((u) => u == null)) return // 全部耗尽

    inflight++
    const gen = generation
    const controller = new AbortController()
    sessionAbort = controller
    try {
      const results = await Promise.all(
        nextUrls.map((u, i) => {
          if (u == null) {
            // 该源耗尽：跳过请求，视为成功空页（游标保持 null）
            return Promise.resolve({ ok: true as const, items: [] as MixFeedItem[], nextUrl: null as string | null })
          }
          return withTimeout(sources[i].fetchPage(controller.signal, u), timeoutMs).then(
            (r) => ({ ok: true as const, items: r.items, nextUrl: r.nextUrl }),
            (err: unknown) => ({ ok: false as const, err }),
          )
        }),
      )
      if (gen !== generation) return // 竞态：refresh/dispose 已作废本会话

      const failed = results.find((r) => !r.ok || (r.ok && !isSourceValid(r)))
      if (failed) {
        const err = !failed.ok ? failed.err : new Error('空页异常（items 为空但 nextUrl 非空）')
        console.warn('[pagedfeed] 翻页失败，不提交（当前页与游标保留）', err)
        errorText = presentError(err, '加载更多失败')
        return
      }
      const okResults = results as { ok: true; items: MixFeedItem[]; nextUrl: string | null }[]
      cachedPages.push({ items: mergeItems(okResults.map((r) => r.items)), nextUrls: okResults.map((r) => r.nextUrl) })
      currentIndex += 1
      errorText = null
      evict()
    } finally {
      inflight--
    }
  }

  async function prev(): Promise<void> {
    if (inflight > 0) return // 防重入
    const target = pageAt(currentIndex - 1)
    if (!target) {
      // 未首载 / 已在第 1 页 / 缓存 miss（淘汰后回退越界）
      if (currentIndex > 0) {
        console.warn('[pagedfeed] prev 缓存 miss（窗口不变式破坏，理论不可达）')
      }
      return
    }
    currentIndex -= 1
    errorText = null
  }

  async function refresh(): Promise<void> {
    // refresh 是打断型操作：generation++ 作废在途翻页/prev，abort 旧会话
    const gen = ++generation
    sessionAbort?.abort()
    sessionAbort = null
    inflight++
    errorText = null
    try {
      const controller = new AbortController()
      sessionAbort = controller
      const results = await Promise.all(
        sources.map((s, i) =>
          withTimeout(s.fetchPage(controller.signal, undefined), timeoutMs).then(
            (r) => ({ ok: true as const, items: r.items, nextUrl: r.nextUrl }),
            (err: unknown) => ({ ok: false as const, err }),
          ),
        ),
      )
      if (gen !== generation) return
      const failed = results.find((r) => !r.ok || (r.ok && !isSourceValid(r)))
      if (failed) {
        const err = !failed.ok ? failed.err : new Error('空页异常（items 为空但 nextUrl 非空）')
        console.warn('[pagedfeed] 刷新失败，保留当前页与缓存', err)
        errorText = presentError(err, '加载失败')
        return // 旧缓存/currentIndex 保留
      }
      const okResults = results as { ok: true; items: MixFeedItem[]; nextUrl: string | null }[]
      cachedPages = [{ items: mergeItems(okResults.map((r) => r.items)), nextUrls: okResults.map((r) => r.nextUrl) }]
      currentIndex = 0
    } finally {
      inflight--
    }
  }

  function dispose(): void {
    generation++
    sessionAbort?.abort()
    sessionAbort = null
    // 不置 inflight=0：在飞请求的 finally 会自然归零；置 0 会使在飞响应落地后 inflight 变 -1（review P2-1）
    errorText = null
  }

  return {
    items: () => {
      const page = pageAt(currentIndex)
      return page ? page.items : []
    },
    loading: () => inflight > 0,
    error: () => errorText,
    pageIndex: () => currentIndex,
    hasPrev: () => currentIndex > 0 && pageAt(currentIndex - 1) !== null,
    hasNext: () => {
      if (cachedPages.length === 0) return false
      const current = pageAt(currentIndex)
      if (!current) return false
      return currentIndex < cachedPages.length - 1 || current.nextUrls.some((u) => u != null)
    },
    next,
    prev,
    refresh,
    dispose,
  }
}
