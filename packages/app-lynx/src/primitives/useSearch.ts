// ─── 搜索状态机（app-lynx 全局搜索，issue #292 / spec app-lynx-global-search D2） ───
// 响应式形态：与 useComments（issue #162）同款 —— 内部全部用 ref（唯一数据源，
// controller 是唯一写者）；state 通过 computed 聚合各 ref 生成符合 SearchState 接口
// （字段普通值类型）的只读快照，getter 无 setter（测试/模板读 state.results 即数组本身）。
//
// 状态语义（对齐 webview searchStore + useComments）：
// - 首载失败 → status='error'（中文文案，toApiError 归一）；
// - 分页失败 → status 保持 'ready'、已加载结果保留、error 置值 + paginationError=true
//   （UI 显示「保留结果 + 底部内联重试」，next_url 不推进故重试可再次 loadMore）。
//
// 竞态防护（last-write-wins）：
// - 每次搜索触发（debounce 到期 / setScope / setSort / refresh）先 abort 上一在途并轮换
//   新 AbortController（一个 in-flight 序列守卫）；在途 loadMore 随轮换一并作废；
// - 每个请求 settle 后校验 disposed || signal.aborted（捕获的是发起时信号）：
//   中止的旧请求（含 AbortError 与「transport 不因 abort reject 而延迟 resolve」的场景）
//   一律静默丢弃 —— 不写状态、不回填。
//
// debounce：search() 内层 300ms（spec D2 定案：控制器内实现，fake timers 可测）；
//   keyword.trim() 为空 → 立即清空回 idle（不 debounce）；isSearching 标记 debounce 窗口
//   （UI 顶部轻量指示），触发后由 status='loading' 承接。
//
// scope=all 混排：两类请求 **并行** 发起（同一 signal），settle 后按 create_date 降序
//   混排为单一时间线（同日 illustrator 优先，语义逐字复刻 webview utils/searchMerger.ts，
//   见下方 mergeSearchResults）；一类失败一类成功 = 部分降级（console.warn 可见，
//   失败侧清空，结果 = 成功类）—— 双类失败 = status='error'。
//   scope=illust/novel：保留服务端顺序（date_asc / popular_desc 不被混排器重排；
//   与 webview 无条件 merge 的偏离为有意为之：popular_desc 被重排成时间序是 webview 旧病）。
//
// 关注点分离：不写搜索历史（提交点由 SearchSheet 组件负责）；不做记忆化缓存（spec D2）。
import { computed, ref } from "vue"
import { deriveSearchTarget, searchTransport } from "../api/search"
import type { SearchTransport } from "../api/search"
import type { PixivIllust, PixivNovel, SearchScope, SearchSort } from "../api/types"
import { toApiError } from "../utils/errors"

export type SearchStatus = "idle" | "loading" | "ready" | "error"

/** 结果行类型：type/entity/date 与 webview api/types.ts SearchResultItem 逐字对齐 */
export type SearchResultItem =
  | { type: "illust"; entity: PixivIllust; date: string }
  | { type: "novel"; entity: PixivNovel; date: string }

export interface SearchState {
  status: SearchStatus
  /** 当前 scope 下的结果（all = 时间线混排；单 scope = 服务端顺序） */
  results: SearchResultItem[]
  /** 列表类错误（中文）；分页失败时 status 保持 ready、error 置值（结果保留） */
  error: string | null
  /** next_url 镜像：任一游标非空即 true */
  hasMore: boolean
  scope: SearchScope
  sort: SearchSort
  /** debounce 窗口内为 true（用户输入中、等待 300ms 触发）；触发后由 status='loading' 承接 */
  isSearching: boolean
  /** true = 当前 error 来自分页（loadMore）而非首载（UI 显示保留结果 + 内联重试） */
  paginationError: boolean
}

export interface SearchController {
  readonly state: SearchState
  /** 输入变化即调用（@input 语义）：300ms debounce；空词立即清空回 idle */
  search(word: string): void
  /** 切 scope：关键词非空时对当前词立即重搜（不 debounce，对齐 webview handleScopeChange） */
  setScope(scope: SearchScope): void
  /** 切排序：同上 */
  setSort(sort: SearchSort): void
  /** 分页加载更多：all → 双游标并行；单 scope → 单游标 */
  loadMore(): Promise<void>
  /** 错误态重试（其余状态 no-op） */
  refresh(): Promise<void>
  /** 清空回 idle（含取消待发 debounce 与中止在途请求） */
  reset(): void
  /** 释放：abort 全部在途；此后所有方法安全 no-op */
  dispose(): void
}

/** 输入防抖窗口（spec D2：300ms 即输即搜） */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * 插画 + 小说按 create_date 降序混排为单一时间线（纯函数，仅 scope=all 使用）。
 * 语义复刻 webview `packages/app/src/utils/searchMerger.ts`（spec D2 要求）：
 * - ISO 日期字符串 localeCompare 降序；
 * - 同一 create_date 毫秒内 illust 优先（novel 居后）；
 * - 同类型返回 0（保持服务端相对顺序，依赖 V8 稳定排序，弱序反称性成立）。
 */
export function mergeSearchResults(
  illusts: PixivIllust[],
  novels: PixivNovel[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [
    ...illusts.map((i) => ({ type: "illust" as const, entity: i, date: i.create_date })),
    ...novels.map((n) => ({ type: "novel" as const, entity: n, date: n.create_date })),
  ]
  items.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date)
    if (dateCmp !== 0) return dateCmp
    // 同日 → illust 优先（同类型返回 0，保证 sort 一致弱序反称性）
    return a.type === b.type ? 0 : a.type === "illust" ? -1 : 1
  })
  return items
}

export function useSearch(config: { transport?: SearchTransport } = {}): SearchController {
  const transport = config.transport ?? searchTransport

  // ── 响应式状态（全部 ref） ──
  const statusRef = ref<SearchStatus>("idle")
  const illustsRef = ref<PixivIllust[]>([])
  const novelsRef = ref<PixivNovel[]>([])
  const errorRef = ref<string | null>(null)
  const nextIllustUrlRef = ref<string | null>(null) // hasMore 镜像来源（双游标）
  const nextNovelUrlRef = ref<string | null>(null)
  const scopeRef = ref<SearchScope>("all")
  const sortRef = ref<SearchSort>("date_desc")
  const isSearchingRef = ref(false)
  const paginationErrorRef = ref(false)

  // ── 内部控制（非响应式） ──
  let ac = new AbortController() // 单一 AbortController，搜索触发时轮换；dispose() abort 全部在途
  let disposed = false
  let loadingMore = false // loadMore 重入门控
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** 最近一次 search() 的 trim 后关键词（setScope/setSort/refresh 重搜依据；reset 清空） */
  let keyword = ""

  /** 请求已作废（组件销毁 or 信号中止）→ 静默丢弃，不写状态不回填 */
  function isStale(signal: AbortSignal): boolean {
    return disposed || signal.aborted
  }

  /** 错误归一为中文文案：优先透传 ApiError.message（client.classifyError 已产中文） */
  function toErrorText(e: unknown, fallback: string): string {
    return toApiError(e, fallback).message
  }

  /** 清空回 idle：取消待发 debounce + 中止在途 + 清结果（reset() 与空词共用） */
  function resetToIdle(): void {
    if (debounceTimer != null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    isSearchingRef.value = false
    ac.abort()
    ac = new AbortController()
    keyword = ""
    statusRef.value = "idle"
    errorRef.value = null
    paginationErrorRef.value = false
    illustsRef.value = []
    novelsRef.value = []
    nextIllustUrlRef.value = null
    nextNovelUrlRef.value = null
  }

  /**
   * 立即搜索指定词（不 debounce）。触发期 abort 上一在途（含 loadMore）+ 轮换 AbortController；
   * loading 期间保留旧结果（spec D5：顶部轻量指示，不闪空白），settle 后整表替换。
   * 游标语义（review P1-1）：settle 后原子落表时，未请求的异类游标随局部空值一并写为
   * null——scope 切换后不残留旧 scope 的 next_url，否则 hasMore 撒谎（「没有更多了」
   * 永不出现）且 loadMore 空转（对齐 webview searchStore 起始清双游标的语义）。
   * 原子写入（review P2-1）：两侧响应先暂存局部变量，Promise.all 结束后一次性落表——
   * 避免「新词插画 + 旧词小说」的混拼窗口（loading 期间展示旧快照）。
   */
  async function executeSearch(word: string): Promise<void> {
    if (disposed) return
    ac.abort()
    ac = new AbortController()
    const signal = ac.signal
    statusRef.value = "loading"
    errorRef.value = null
    paginationErrorRef.value = false

    const scope = scopeRef.value
    const sort = sortRef.value
    const target = deriveSearchTarget(word)
    const failures: unknown[] = []
    // 局部暂存（失败侧保持空——「失败侧清空」语义与既有实现一致）
    const illustData = { items: [] as PixivIllust[], next: null as string | null }
    const novelData = { items: [] as PixivNovel[], next: null as string | null }

    const fetchIllust = async (): Promise<void> => {
      try {
        const res = await transport.searchIllust(word, sort, target, signal)
        if (isStale(signal)) return
        illustData.items = res.illusts
        illustData.next = res.next_url
      } catch (e) {
        if (!isStale(signal)) failures.push(e)
      }
    }

    const fetchNovel = async (): Promise<void> => {
      try {
        const res = await transport.searchNovel(word, sort, target, signal)
        if (isStale(signal)) return
        novelData.items = res.novels
        novelData.next = res.next_url
      } catch (e) {
        if (!isStale(signal)) failures.push(e)
      }
    }

    // scope=all → 并行发起（spec D2：按 create_date 降序混排）；单 scope → 单路
    if (scope === "all") {
      await Promise.all([fetchIllust(), fetchNovel()])
    } else if (scope === "illust") {
      await fetchIllust()
    } else {
      await fetchNovel()
    }

    // 被新搜索替换/dispose → 静默丢弃（AbortError 不回填不置 error，last-write-wins）
    if (isStale(signal)) return

    // 原子写入（review P2-1）：Promise.all 结束后一次性落表
    illustsRef.value = illustData.items
    nextIllustUrlRef.value = illustData.next
    novelsRef.value = novelData.items
    nextNovelUrlRef.value = novelData.next

    if (scope === "all") {
      if (failures.length === 2) {
        statusRef.value = "error"
        errorRef.value = toErrorText(failures[0], "搜索失败，请重试")
        return
      }
      if (failures.length === 1) {
        // 部分降级：单类失败保留成功类结果（warn 可见，测试硬约束 3：禁止静默降级）
        console.warn(
          `[useSearch] scope=all 下插画/小说其中一类搜索失败，结果仅含成功类别：`,
          failures[0],
        )
      }
    } else if (failures.length > 0) {
      statusRef.value = "error"
      errorRef.value = toErrorText(failures[0], "搜索失败，请重试")
      return
    }
    statusRef.value = "ready"
  }

  /** 输入变化即调用：300ms debounce；空词立即清空回 idle（不 debounce） */
  function search(word: string): void {
    if (disposed) return
    const trimmed = word.trim()
    if (trimmed === "") {
      resetToIdle()
      return
    }
    keyword = trimmed
    isSearchingRef.value = true
    if (debounceTimer != null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      isSearchingRef.value = false
      void executeSearch(trimmed)
    }, SEARCH_DEBOUNCE_MS)
  }

  /** 关键词非空 → 取消待发 debounce 并立即重搜当前词（setScope/setSort 共用） */
  function rerunIfKeyword(): void {
    const word = keyword
    if (word === "") return
    if (debounceTimer != null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    isSearchingRef.value = false
    void executeSearch(word)
  }

  /** 切 scope：关键词非空时立即重搜（不 debounce，对齐 webview handleScopeChange）；空词只更新状态 */
  function setScope(scope: SearchScope): void {
    if (disposed) return
    if (scopeRef.value === scope) return
    scopeRef.value = scope
    rerunIfKeyword()
  }

  /** 切排序：同上 */
  function setSort(sort: SearchSort): void {
    if (disposed) return
    if (sortRef.value === sort) return
    sortRef.value = sort
    rerunIfKeyword()
  }

  /** 分页加载更多：ready + hasMore 时才生效；all → 双游标并行，单 scope → 单游标 */
  async function loadMore(): Promise<void> {
    if (disposed) return
    if (statusRef.value !== "ready" || loadingMore) return
    const scope = scopeRef.value
    const hasIllust = scope !== "novel" && nextIllustUrlRef.value != null
    const hasNovel = scope !== "illust" && nextNovelUrlRef.value != null
    if (!hasIllust && !hasNovel) return
    loadingMore = true
    const signal = ac.signal
    // 重试/新分页前清除上次分页错误（成功即复位 banner）
    errorRef.value = null
    paginationErrorRef.value = false
    try {
      const tasks: Promise<void>[] = []
      if (hasIllust) tasks.push(loadIllustNext(signal))
      if (hasNovel) tasks.push(loadNovelNext(signal))
      await Promise.all(tasks)
    } finally {
      loadingMore = false
    }
  }

  /** 插画游标推进：失败不推进 next_url（保留供内联重试），仅置 error + paginationError */
  async function loadIllustNext(signal: AbortSignal): Promise<void> {
    const url = nextIllustUrlRef.value
    if (!url) return
    try {
      const res = await transport.searchIllustNext(url, signal)
      if (isStale(signal)) return
      illustsRef.value = [...illustsRef.value, ...res.illusts]
      nextIllustUrlRef.value = res.next_url
    } catch (e) {
      if (!isStale(signal)) {
        errorRef.value = toErrorText(e, "加载更多失败")
        paginationErrorRef.value = true
      }
    }
  }

  /** 小说游标推进（语义同上） */
  async function loadNovelNext(signal: AbortSignal): Promise<void> {
    const url = nextNovelUrlRef.value
    if (!url) return
    try {
      const res = await transport.searchNovelNext(url, signal)
      if (isStale(signal)) return
      novelsRef.value = [...novelsRef.value, ...res.novels]
      nextNovelUrlRef.value = res.next_url
    } catch (e) {
      if (!isStale(signal)) {
        errorRef.value = toErrorText(e, "加载更多失败")
        paginationErrorRef.value = true
      }
    }
  }

  /** 首载错误态重试：仅 status='error' 生效（loading/ready 均 no-op，加载态门控） */
  async function refresh(): Promise<void> {
    if (disposed) return
    if (statusRef.value !== "error") return
    if (keyword === "") return
    await executeSearch(keyword)
  }

  /** 清空回 idle（含取消待发与中止在途）；历史与 scope/sort 保留（对 UI 无副作用） */
  function reset(): void {
    if (disposed) return
    resetToIdle()
  }

  /** 释放：abort 全部在途 + 取消待发 debounce；此后所有方法安全 no-op */
  function dispose(): void {
    if (disposed) return
    disposed = true
    if (debounceTimer != null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    ac.abort()
  }

  /** 按 scope 组装结果：all = 时间线混排；单 scope = 服务端顺序（不被混排器重排） */
  function buildResults(
    illusts: PixivIllust[],
    novels: PixivNovel[],
    scope: SearchScope,
  ): SearchResultItem[] {
    if (scope === "all") return mergeSearchResults(illusts, novels)
    if (scope === "illust") {
      return illusts.map((i) => ({ type: "illust" as const, entity: i, date: i.create_date }))
    }
    return novels.map((n) => ({ type: "novel" as const, entity: n, date: n.create_date }))
  }

  // state 只读（computed 聚合 + getter，无 setter）；controller 是唯一写者
  const stateComputed = computed<SearchState>(() => ({
    status: statusRef.value,
    results: buildResults(illustsRef.value, novelsRef.value, scopeRef.value),
    error: errorRef.value,
    hasMore: nextIllustUrlRef.value != null || nextNovelUrlRef.value != null,
    scope: scopeRef.value,
    sort: sortRef.value,
    isSearching: isSearchingRef.value,
    paginationError: paginationErrorRef.value,
  }))

  return {
    get state(): SearchState {
      return stateComputed.value
    },
    search,
    setScope,
    setSort,
    loadMore,
    refresh,
    reset,
    dispose,
  }
}
