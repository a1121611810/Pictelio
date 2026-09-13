// 榜单单源分页 feed（spec docs/specs/ranking.md §6.3）：复用 createMixFeed（sources 只放一路），
// 每 (mode, date) 重建实例——与 IllustList.switchMode 同款「dispose + 重建」语义，配合 createMixFeed
// 内部的竞态代 + abort 池作废旧响应。
//
// 名次 = 渲染流下标 + 1：单源不打乱顺序，页序 × 页内序即名次顺序（**不引入任何按 create_date 重排的
// 合并路径**，否则名次被毁）。受限条目由页面保留并盖遮罩，名次不变（spec §5.6 本端口径）。
import { createMixFeed, type MixFeed, type MixFeedItem } from "./createMixFeed"
import { loadRanking, loadRankingNext } from "../api/ranking"
import type { RankingQuery } from "@pictelio/ranking-core"
import type { PixivIllust, PixivIllustListResponse } from "../api/types"

function mapIllusts(r: PixivIllustListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: "illust" as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}

export interface RankingFeed {
  query: () => RankingQuery
  /** 切换维度/日期（#518）：释放旧实例（作废在途响应）后以新参数重建（沿用构造时的 onUpdate） */
  setQuery: (query: RankingQuery) => void
  items: () => PixivIllust[]
  loading: () => boolean
  loadingMore: () => boolean
  settled: () => boolean
  error: () => string | null
  pageError: () => string | null
  nextUrl: () => string | null
  fetchMore: () => Promise<void>
  refresh: () => Promise<void>
  dispose: () => void
}

function makeFeed(query: RankingQuery, onUpdate?: () => void): MixFeed {
  return createMixFeed({
    // 构造不首载，由页面 refresh() 显式触发（避免「构造首载 + refresh」双请求）
    autoStart: false,
    onUpdate,
    sources: [
      {
        name: "ranking",
        fetchPage: (signal, nextUrl) =>
          nextUrl
            ? loadRankingNext(nextUrl, signal).then(mapIllusts)
            : loadRanking(query, signal).then(mapIllusts),
      },
    ],
  })
}

export function createRankingFeed(initial: RankingQuery, onUpdate?: () => void): RankingFeed {
  let query = initial
  let feed = makeFeed(query, onUpdate)

  return {
    query: () => query,
    setQuery: (next) => {
      feed.dispose()
      query = next
      // 沿用构造时的 onUpdate：否则切换后 createMixFeed 的防抖补发不再触发页面重新快照
      feed = makeFeed(next, onUpdate)
    },
    items: () => feed.items().map((i) => i.data as PixivIllust),
    loading: () => feed.loading(),
    loadingMore: () => feed.loadingMore(),
    settled: () => feed.settled(),
    error: () => feed.error(),
    pageError: () => feed.pageError(),
    nextUrl: () => feed.nextUrl(),
    fetchMore: () => feed.fetchMore(),
    refresh: () => feed.refresh(),
    dispose: () => feed.dispose(),
  }
}
