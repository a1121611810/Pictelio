// ─── 小说系列追更 API 契约测试（issue #220 / spec app-lynx-novel-series-watchlist §3） ───
// Oracle（期望值独立来源）：端点路径/参数逐字对齐 Pixiv-Shaft
//   - ceui/lisa/http/AppApi.kt:  POST v1/watchlist/novel/add|delete（@Field("series_id")）
//   - ceui/loxia/API.kt:         GET  v1/watchlist/novel（无 query）、GET v2/novel/series
//   - ceui/loxia/Models.kt:      WatchlistSeries / NovelSeriesDetail 字段名与 isMasked 判定
// mock 响应字段清单逐字取自上述源码，非手写自洽（测试硬约束第 2 条）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiClient } from '../src/api/client'
import {
  loadNovelSeries,
  addNovelWatchlist,
  deleteNovelWatchlist,
  loadWatchlistNovels,
  loadWatchlistNovelsNext,
} from '../src/api/novel'
import { isWatchlistSeriesMasked } from '../src/api/types'
import type { WatchlistSeries } from '../src/api/types'

// Shaft Models.kt WatchlistSeries 字段逐字清单：id / title / url / mask_text /
// published_content_count / latest_content_id / latest_content_date / user
const WATCHLIST_ITEM: WatchlistSeries = {
  id: 1145480,
  title: '異世界転生日記',
  url: 'https://i.pximg.net/c/360x360_80/novel-cover-master/img/2024/05/01/00/00/00/ci1234567_master1200.jpg',
  mask_text: null,
  published_content_count: 12,
  latest_content_id: 23876543,
  latest_content_date: '2026-08-10T12:34:56+09:00',
  user: {
    id: 998877,
    name: '作者名',
    account: 'author_acc',
    profile_image_urls: { medium: 'https://i.pximg.net/user-profile/img/2024/01/01/00/00/00/998877_medium.jpg' },
  },
}

// Shaft Models.kt isMasked 判定条件逐字复现：title="" + url=null + mask_text!=null + user.id=0
const MASKED_ITEM: WatchlistSeries = {
  id: 2220001,
  title: '',
  url: null,
  mask_text: 'このシリーズは閲覧できません。',
  published_content_count: 0,
  latest_content_id: 0,
  latest_content_date: '',
  user: { id: 0, name: '', account: '', profile_image_urls: {} },
}

describe('追更 API 契约（issue #220）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── GET /v2/novel/series ──
  it('loadNovelSeries 调 /v2/novel/series 带 series_id（signal 透传）', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      novel_series_detail: {
        id: 1145480,
        title: '異世界転生日記',
        content_count: 12,
        is_concluded: false,
        watchlist_added: true,
      },
    })
    const signal = new AbortController().signal
    const res = await loadNovelSeries(1145480, signal)
    expect(spy).toHaveBeenCalledWith('/v2/novel/series', { series_id: '1145480' }, signal)
    expect(res.novel_series_detail.watchlist_added).toBe(true)
    expect(res.novel_series_detail.is_concluded).toBe(false)
  })

  it('loadNovelSeries 失败透传 reject（IO 边界失败路径）', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('404'))
    await expect(loadNovelSeries(1)).rejects.toThrow('404')
  })

  // ── POST /v1/watchlist/novel/add|delete ──
  it('addNovelWatchlist POST /v1/watchlist/novel/add 带 form series_id', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined)
    await addNovelWatchlist(1145480)
    expect(spy).toHaveBeenCalledWith('/v1/watchlist/novel/add', { series_id: '1145480' })
  })

  it('addNovelWatchlist 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('rate limited'))
    await expect(addNovelWatchlist(1)).rejects.toThrow('rate limited')
  })

  it('deleteNovelWatchlist POST /v1/watchlist/novel/delete 带 form series_id', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined)
    await deleteNovelWatchlist(1145480)
    expect(spy).toHaveBeenCalledWith('/v1/watchlist/novel/delete', { series_id: '1145480' })
  })

  it('deleteNovelWatchlist 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('server 500'))
    await expect(deleteNovelWatchlist(1)).rejects.toThrow('server 500')
  })

  // ── GET /v1/watchlist/novel ──
  it('loadWatchlistNovels 调 /v1/watchlist/novel 且无 query（对齐 Shaft getWatchlistNovel）', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      series: [WATCHLIST_ITEM, MASKED_ITEM],
      next_url: null,
    })
    const res = await loadWatchlistNovels()
    expect(spy).toHaveBeenCalledWith('/v1/watchlist/novel', undefined, undefined)
    expect(res.series).toHaveLength(2)
    expect(res.series[0].latest_content_id).toBe(23876543)
  })

  it('loadWatchlistNovels 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network down'))
    await expect(loadWatchlistNovels()).rejects.toThrow('network down')
  })

  it('loadWatchlistNovelsNext 透传 next_url 完整 URL（保留 query）', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ series: [], next_url: null })
    await loadWatchlistNovelsNext('/pixiv-api/v1/watchlist/novel?max_series_id=1145480')
    expect(spy).toHaveBeenCalledWith(
      '/pixiv-api/v1/watchlist/novel?max_series_id=1145480',
      undefined,
      undefined,
    )
  })

  it('loadWatchlistNovelsNext 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('403'))
    await expect(loadWatchlistNovelsNext('/x')).rejects.toThrow('403')
  })
})

describe('isWatchlistSeriesMasked（对齐 Shaft Models.kt isMasked）', () => {
  it('正常条目 → false', () => {
    expect(isWatchlistSeriesMasked(WATCHLIST_ITEM)).toBe(false)
  })

  it('mask 占位条目（title 空 + url null + mask_text 非空 + user.id=0）→ true', () => {
    expect(isWatchlistSeriesMasked(MASKED_ITEM)).toBe(true)
  })

  it('部分缺失不算 mask：仅 mask_text 非空但标题正常 → false', () => {
    expect(
      isWatchlistSeriesMasked({ ...WATCHLIST_ITEM, mask_text: 'テスト' }),
    ).toBe(false)
  })

  it('部分缺失不算 mask：标题空但 user.id 非 0 → false', () => {
    expect(
      isWatchlistSeriesMasked({
        ...MASKED_ITEM,
        user: { id: 42, name: '', account: '', profile_image_urls: {} },
      }),
    ).toBe(false)
  })
})
