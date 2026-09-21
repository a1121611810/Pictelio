// ─── 小说推荐端点契约测试（票 #708 / spec docs/specs/app-lynx-recommended-novel-bookmark.md）───
// Oracle（期望值独立来源）：
//   - 端点路径/参数 = 既有实现（src/api/novel.ts loadRecommendedNovels）+ Pixiv-Shaft 同款端点
//     + webview 差分实现（packages/app/src/api/novel.ts）三处一致；
//   - 透传/失败传播 = 不变量（客户端不得改写响应、错误必须上抛而非静默吞；测试硬约束 #1 失败路径）。
//
// ⚠️ 已挂账（issue #708）：本 feature 唯一的外部依赖 = 推荐小说响应**真的携带**
//   is_bookmarked / total_bookmarks / text_length（推荐轮播小说滑页的 ♥ 初始态、计数与「N 字」全取自它们）。
//   目前该依赖只有 `src/api/types.ts` 的**类型声明**背书（声明 ≠ 证据），而 spec 要求用**真实响应**落 fixture
//   钉死。因 refresh_token 被设备端轮换（Pixiv 刷新令牌单次轮换语义），逐字节真实抓取暂不可得 ——
//   故本文件**不假装**已钉死该依赖：下方样例仅用于验证端点契约与透传，登录恢复后按 issue #708 把
//   RESPONSE 替换为抓取到的真实响应 JSON，并补回「字段存在性」断言。
//   （此前版本曾以 typeof 循环断言自写样例的字段，属自洽 mock 的同义反复，已在本轮 code-review 中移除。）
//
// IO 边界硬约束：成功与失败两条路径都必须覆盖。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiClient } from '../src/api/client'
import { loadRecommendedNovels } from '../src/api/novel'
import type { PixivNovel, PixivNovelListResponse } from '../src/api/types'

/** 样例条目 A：字段清单逐字取自 types.ts 的 PixivNovel（真实响应字段形态，非页面自造字段） */
const NOVEL_A: PixivNovel = {
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

/** 样例条目 B：已收藏 + R-18 + 非系列（清单同为 PixivNovel，值域参照真实作品形态） */
const NOVEL_B: PixivNovel = {
  ...NOVEL_A,
  id: 24489901,
  title: '舟渡',
  tags: [{ name: 'R-18' }, { name: '中国語注意' }],
  text_length: 5011,
  series: undefined,
  is_bookmarked: true,
  total_bookmarks: 540,
  x_restrict: 1,
  create_date: '2026-09-18T12:00:00+09:00',
}

const RESPONSE: PixivNovelListResponse = {
  novels: [NOVEL_A, NOVEL_B],
  next_url: 'https://app-api.pixiv.net/v1/novel/recommended?filter=for_ios&offset=30',
}

describe('loadRecommendedNovels 契约（/v1/novel/recommended）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('端点/参数契约：GET /v1/novel/recommended 带 filter=for_ios，响应原样透传', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(RESPONSE)
    const res = await loadRecommendedNovels()
    expect(spy).toHaveBeenCalledWith('/v1/novel/recommended', { filter: 'for_ios' }, undefined)
    // 透传语义：客户端不改写字段（页面直接消费响应对象）
    expect(res).toBe(RESPONSE)
  })

  it('失败路径：apiClient.get 拒绝时错误向上传播（页面走 presentError，不静默吞）', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network down'))
    await expect(loadRecommendedNovels()).rejects.toThrow('network down')
  })
})
