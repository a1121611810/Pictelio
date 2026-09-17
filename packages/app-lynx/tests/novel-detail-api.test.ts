// ─── 小说详情端点契约测试（spec #585 / 票 #586：介绍页数据链路的 IO 边界） ───
// Oracle（期望值独立来源）：
//   - 端点路径/参数逐字对齐 Pixiv-Shaft：GET v2/novel/detail?novel_id=（ceui/loxia/API.kt）
//   - 响应字段清单逐字取自 src/api/types.ts PixivNovel / PixivNovelDetailResponse（真实类型，非自洽 mock）
// IO 边界硬约束：成功与失败两条路径都必须覆盖。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiClient } from '../src/api/client'
import { loadNovelDetail, addNovelBookmark, deleteNovelBookmark } from '../src/api/novel'
import type { PixivNovel } from '../src/api/types'

// PixivNovel 字段逐字清单（types.ts）：id/title/user/image_urls/tags/page_count/text_length/
// series?/is_bookmarked/total_bookmarks/total_view?/x_restrict/novel_ai_type?/create_date/caption?/total_comments?
const NOVEL: PixivNovel = {
  id: 23876543,
  title: '夜の向こう側',
  user: {
    id: 998877,
    name: '作者名',
    account: 'author_acc',
    profile_image_urls: { medium: 'https://i.pximg.net/user-profile/img/2024/01/01/00/00/00/998877_medium.jpg' },
  },
  image_urls: {
    square_medium: 'https://i.pximg.net/c/360x360_70/novel-cover-master/img/2024/05/01/00/00/00/ci23876543_square1200.jpg',
    medium: 'https://i.pximg.net/c/176x176_80/novel-cover-master/img/2024/05/01/00/00/00/ci23876543_master1200.jpg',
    large: 'https://i.pximg.net/novel-cover-master/img/2024/05/01/00/00/00/ci23876543_master1200.jpg',
  },
  tags: [
    { name: 'オリジナル' },
    { name: 'ファンタジー', translated_name: '奇幻' },
  ],
  page_count: 1,
  text_length: 4820,
  series: { id: 1145480, title: '夜の向こう側 シリーズ' },
  is_bookmarked: false,
  total_bookmarks: 135,
  total_view: 4021,
  x_restrict: 0,
  novel_ai_type: 0,
  create_date: '2024-05-01T00:00:00+09:00',
  caption: 'あらすじ：夜の向こう側の物語。',
  total_comments: 12,
}

describe('loadNovelDetail 契约（/v2/novel/detail）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('成功路径：GET /v2/novel/detail 带 novel_id 字符串参数，透传响应', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ novel: NOVEL })
    const res = await loadNovelDetail(23876543)
    expect(spy).toHaveBeenCalledWith('/v2/novel/detail', { novel_id: '23876543' })
    expect(res.novel.id).toBe(23876543)
    expect(res.novel.caption).toBe('あらすじ：夜の向こう側の物語。')
    expect(res.novel.series?.id).toBe(1145480)
  })

  it('失败路径：apiClient.get 拒绝时错误向上传播（由页面 presentError 映射，不静默吞）', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network down'))
    await expect(loadNovelDetail(23876543)).rejects.toThrow('network down')
  })
})

// ─── 小说收藏契约（票 #587；oracle = webview api/novel.ts addBookmark/deleteBookmark 逐字对齐） ───
describe('小说收藏契约（/v2/novel/bookmark/add · /v1/novel/bookmark/delete）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('addNovelBookmark：POST /v2/novel/bookmark/add 带 novel_id + restrict（缺省 public）', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined as never)
    await addNovelBookmark(23876543)
    expect(spy).toHaveBeenCalledWith('/v2/novel/bookmark/add', {
      novel_id: '23876543',
      restrict: 'public',
    })
    await addNovelBookmark(23876543, 'private')
    expect(spy).toHaveBeenLastCalledWith('/v2/novel/bookmark/add', {
      novel_id: '23876543',
      restrict: 'private',
    })
  })

  it('deleteNovelBookmark：POST /v1/novel/bookmark/delete 带 novel_id', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined as never)
    await deleteNovelBookmark(23876543)
    expect(spy).toHaveBeenCalledWith('/v1/novel/bookmark/delete', { novel_id: '23876543' })
  })

  it('失败路径：add/delete 拒绝时错误向上传播（收藏按钮静息回滚，不静默吞）', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('bookmark failed'))
    await expect(addNovelBookmark(23876543)).rejects.toThrow('bookmark failed')
    await expect(deleteNovelBookmark(23876543)).rejects.toThrow('bookmark failed')
  })
})
