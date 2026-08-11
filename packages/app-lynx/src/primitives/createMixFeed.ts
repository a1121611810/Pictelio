// 混合分页 feed 深模块：把两路远程分页源（如插画推荐 + 小说推荐）按比例交替合并成单一渲染流，
// 向调用方隐藏全部协调复杂度（交替合并 / 分批渲染 / 双防抖 / 翻页优先级 / 去重 / 竞态 / 超时）。
// 纯 TS 无 DOM 依赖（node 环境可测），写法风格对齐同目录 createLiquidElastic.ts。
//
// 与 Recommended / NovelList 页面对齐的既有决策：
// - 分批渲染窗口 pageSize=20（ADR-0060：web-core list 不回收 item，一次性全渲染 = 图片加载风暴）
// - fetchMore 双重防抖 throttleMs=800 + cooldownMs=3000（[lynx:fix] 防 web-core scrolltolower 高频）
// - 单页请求 15s 超时兜底（issue #128，withTimeout 包裹）

import type { PixivIllust, PixivNovel } from '../api/types'
import { withTimeout } from '../utils/withTimeout'
import { presentError } from '../utils/errorPresentation'

/** 单页请求超时兜底（issue #128）：请求挂起 15s 即 reject，走错误分支避免 loading 无限期显示 */
const TIMEOUT_MS = 15000

/** 混合 feed 的单条数据（kind 区分插画 / 小说，key 全局唯一用于去重） */
export type MixFeedItem =
  | { kind: 'illust'; key: string; id: number; data: PixivIllust }
  | { kind: 'novel'; key: string; id: number; data: PixivNovel }

/** 一路远程分页源：fetchPage 返回一页数据 + 下一页 URL（null = 耗尽） */
export interface MixFeedSource {
  name: string
  fetchPage: (signal?: AbortSignal) => Promise<{ items: MixFeedItem[]; nextUrl: string | null }>
}

export interface MixFeedOptions {
  sources: MixFeedSource[]
  /** 交替比例，默认 [4, 1]：每 4 条 illust 插 1 条 novel */
  ratio?: number[]
  /** 每批渲染窗口大小，默认 20（web-core 图片风暴规避，ADR-0060） */
  pageSize?: number
  /** fetchMore 节流 ms，默认 800（[lynx:fix] 防 web-core list 高频 scrolltolower） */
  throttleMs?: number
  /** 加载完成冷却 ms，默认 3000（[lynx:fix] 同上） */
  cooldownMs?: number
}

export interface MixFeed {
  items: () => MixFeedItem[]
  loading: () => boolean
  loadingMore: () => boolean
  /** 已格式化错误文案（presentError(err, '加载失败'/'加载更多失败') 产出）；无错误 null */
  error: () => string | null
  nextUrl: () => string | null
  fetchMore: () => Promise<void>
  refresh: () => Promise<void>
}

/** 每个源的运行态 */
interface SourceState {
  /** 该源下一页 URL；null = 已耗尽（首载失败或服务端返回 null） */
  nextUrl: string | null
  /** 最近一次成功返回推断的条目类型（用于翻页优先级「缺哪种先补哪种」） */
  kind: MixFeedItem['kind'] | null
}

export function createMixFeed(opts: MixFeedOptions): MixFeed {
  const { sources, ratio = [4, 1], pageSize = 20, throttleMs = 800, cooldownMs = 3000 } = opts

  // ─── 渲染流状态 ───
  /** 已暴露给渲染层的窗口（items() 返回）；首载只放前 pageSize 条，其余进内部队列 */
  let rendered: MixFeedItem[] = []
  /** 内部队列：已合并但尚未渲染的条目（分批渲染规避图片风暴） */
  let pending: MixFeedItem[] = []
  /** 全局去重表（key → seen）：跨源 / 跨页重复 key 丢弃 */
  let seen = new Set<string>()
  /** 竞态代：refresh 时 ++，在途旧 fetchMore / 首载响应据此被丢弃 */
  let generation = 0
  /** 首载（含 refresh）网络阶段标志 */
  let firstLoadInFlight = false
  /** fetchMore 进行中标志 */
  let loadMoreInFlight = false
  /** 格式化错误文案（presentError 产出） */
  let errorText: string | null = null

  // [lynx:fix] 双重防抖：与 Recommended / NovelList 的 lastLoadMoreAt / lastLoadEndedAt 同语义
  let lastLoadMoreAt = 0
  let lastLoadEndedAt = 0

  /** 各源运行态（索引对齐 sources） */
  let sourceStates: SourceState[] = sources.map(() => ({ nextUrl: null, kind: null }))

  /** 按比例交替合并各源第一页数据：每轮按 ratio 从各源取条，跳过空源，不足一轮时取尽余量 */
  function mergeByRatio(pages: (MixFeedItem[] | undefined)[]): MixFeedItem[] {
    const cursor = pages.map(() => 0)
    const out: MixFeedItem[] = []
    let added = true
    while (added) {
      added = false
      for (let i = 0; i < pages.length; i++) {
        const queue = pages[i]
        if (!queue) continue
        const take = ratio[i] ?? ratio[0] ?? 1
        for (let k = 0; k < take; k++) {
          if (cursor[i] < queue.length) {
            out.push(queue[cursor[i]++])
            added = true
          }
        }
      }
    }
    return out
  }

  /** 顺序去重：key 首次出现保留，之后重复（含跨源重复）一律丢弃 */
  function dedupe(items: MixFeedItem[]): MixFeedItem[] {
    const out: MixFeedItem[] = []
    for (const item of items) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      out.push(item)
    }
    return out
  }

  /** 是否还有任一源可翻页 */
  function hasNext(): boolean {
    return sourceStates.some((s) => s.nextUrl !== null)
  }

  /**
   * 翻页源选择：
   * - 只从还有 nextUrl 的源里选；全耗尽返回 -1
   * - 多候选时「缺哪种类型先补哪种」：按 ratio 目标占比与当前渲染占比的缺口排序（缺口大的优先）
   * - 平手时取源顺序靠前者（ratio 数组顺序即优先级）
   */
  function pickSourceToFetch(): number {
    const candidates: number[] = []
    for (let i = 0; i < sourceStates.length; i++) {
      if (sourceStates[i].nextUrl !== null) candidates.push(i)
    }
    if (candidates.length === 0) return -1
    if (candidates.length === 1) return candidates[0]

    const kindCount: Partial<Record<MixFeedItem['kind'], number>> = {}
    for (const item of rendered) {
      kindCount[item.kind] = (kindCount[item.kind] ?? 0) + 1
    }
    const totalRatio = ratio.reduce((a, b) => a + b, 0) || ratio.length || 1
    const base = Math.max(1, rendered.length)
    let best = candidates[0]
    let bestGap = -Infinity
    for (const i of candidates) {
      const kind = sourceStates[i].kind
      const targetShare = (ratio[i] ?? 1) / totalRatio
      const actualShare = kind === null ? 0 : (kindCount[kind] ?? 0) / base
      const gap = targetShare - actualShare
      if (gap > bestGap + 1e-9) {
        bestGap = gap
        best = i
      }
    }
    return best
  }

  /**
   * 首载 / 刷新：并行（Promise.all）拉所有源第一页。
   * - 全部失败 → error 置为首个错误
   * - 部分失败 → 用成功的源，失败的源标记耗尽（不阻塞另一源）
   * - 成功后按比例交替合并 + 去重，仅暴露前 pageSize 条，其余进内部队列
   */
  async function loadFirstPage(): Promise<void> {
    const g = ++generation
    firstLoadInFlight = true
    errorText = null
    // 新会话开始：丢弃在途 fetchMore 的残留状态，重建渲染流
    loadMoreInFlight = false
    rendered = []
    pending = []
    seen = new Set<string>()
    sourceStates = sources.map(() => ({ nextUrl: null, kind: null }))
    try {
      // 并行发请求；单源失败用占位结果捕获（不整体 reject，避免阻塞其他源）
      const results = await Promise.all(
        sources.map(
          async (
            src,
          ): Promise<{ items: MixFeedItem[]; nextUrl: string | null } | { error: unknown }> => {
            try {
              return await withTimeout(src.fetchPage(), TIMEOUT_MS)
            } catch (err) {
              return { error: err }
            }
          },
        ),
      )
      // 竞态：此响应返回前已发生 refresh（generation 变了）→ 整个结果丢弃
      if (g !== generation) return

      let firstError: unknown = null
      const pages: (MixFeedItem[] | undefined)[] = []
      results.forEach((res, i) => {
        if ('error' in res) {
          if (firstError === null) firstError = res.error
          sourceStates[i].nextUrl = null // 失败源标记耗尽
        } else {
          pages[i] = res.items
          sourceStates[i].nextUrl = res.nextUrl
          sourceStates[i].kind = res.items[0]?.kind ?? null
        }
      })

      if (pages.every((p) => p === undefined)) {
        // 全部失败：error 置为首个错误
        errorText = presentError(firstError, '加载失败')
      } else {
        const merged = dedupe(mergeByRatio(pages))
        rendered = merged.slice(0, pageSize)
        pending = merged.slice(pageSize)
      }
    } finally {
      firstLoadInFlight = false
      if (g === generation) lastLoadEndedAt = Date.now()
    }
  }

  /**
   * fetchMore：双防抖 → 优先同步消费内部队列 → 队列耗尽才按优先级翻页 → 全部耗尽 no-op。
   * 翻页失败不崩溃：置错误文案（'加载更多失败'），保留该源 nextUrl 供后续重试。
   */
  async function fetchMore(): Promise<void> {
    const now = Date.now()
    // [lynx:fix] 双重防抖：冷却（内容追加后 cooldownMs）+ 节流（触发间隔 throttleMs）
    if (now - lastLoadEndedAt < cooldownMs) return
    if (now - lastLoadMoreAt < throttleMs) return
    if (loadMoreInFlight) return
    if (firstLoadInFlight) return
    if (pending.length === 0 && !hasNext()) return // 全部耗尽 → no-op

    lastLoadMoreAt = now
    loadMoreInFlight = true
    const g = generation
    try {
      // 优先同步消费内部队列（追加 pageSize 条，无网络请求）
      if (pending.length > 0) {
        rendered.push(...pending.splice(0, pageSize))
        return
      }
      const srcIdx = pickSourceToFetch()
      if (srcIdx < 0) return
      try {
        const res = await withTimeout(sources[srcIdx].fetchPage(), TIMEOUT_MS)
        if (g !== generation) return // 竞态：refresh 已取代本次翻页，丢弃响应
        sourceStates[srcIdx].nextUrl = res.nextUrl
        sourceStates[srcIdx].kind = res.items[0]?.kind ?? sourceStates[srcIdx].kind
        const fresh = dedupe(res.items)
        rendered.push(...fresh.slice(0, pageSize))
        pending.push(...fresh.slice(pageSize))
        // 翻页成功：清除先前「加载更多失败」的残留错误（否则错误条永久挂顶直到 refresh）
        errorText = null
      } catch (err) {
        // 翻页失败不崩溃：置错误文案，保留 nextUrl 供后续重试
        errorText = presentError(err, '加载更多失败')
      }
    } finally {
      loadMoreInFlight = false
      if (g === generation) lastLoadEndedAt = Date.now()
    }
  }

  /** 刷新：不受节流 / 冷却限制；generation++ 保证在途旧首载 / fetchMore 响应被丢弃 */
  async function refresh(): Promise<void> {
    await loadFirstPage()
  }

  // 构造即触发首载（纯逻辑原语，无 DOM 依赖）
  void loadFirstPage()

  return {
    items: () => rendered,
    loading: () => firstLoadInFlight && rendered.length === 0,
    loadingMore: () => loadMoreInFlight,
    error: () => errorText,
    nextUrl: () => {
      for (const s of sourceStates) {
        if (s.nextUrl !== null) return s.nextUrl
      }
      return null
    },
    fetchMore,
    refresh,
  }
}
