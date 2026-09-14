// buildUgoiraTask 单测（oracle = spec docs/specs/download-manager.md §3.1/§5）。
import { describe, it, expect } from 'vitest'
import { buildUgoiraTask } from './galleryDownload'
import type { PixivIllust } from '../api/types'

function illust(over?: Partial<PixivIllust>): PixivIllust {
  return {
    id: 123,
    title: '动图A',
    type: 'ugoira',
    user: { id: 1, name: 'u', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
    image_urls: {
      square_medium: 's',
      medium: 'https://i.pximg.net/medium.jpg',
      large: 'https://i.pximg.net/large.jpg',
    },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 0,
    tags: [],
    x_restrict: 0,
    create_date: '2020-01-01',
    meta_pages: [],
    meta_single_page: {},
    ...over,
  }
}

const ZIP = 'https://i.pximg.net/img-zip-ugoira/img/2020/01/01/00/00/00/123_ugoira1920x1080.zip'

describe('buildUgoiraTask（spec §3.1/§5）', () => {
  it('官方 ZIP URL + 全局格式 → ugoira 任务（无 page 字段）', () => {
    const t = buildUgoiraTask(illust(), ZIP, 'gif')
    expect(t).toMatchObject({
      id: 'ugoira_123_gif',
      illustId: 123,
      kind: 'ugoira',
      sourceUrl: ZIP,
      targetFormat: 'gif',
      fileName: 'Pictelio_123.gif',
      thumbnailUrl: 'https://i.pximg.net/medium.jpg',
    })
    expect(t.page).toBeUndefined()
  })

  it('不同格式 → 不同 id 与文件名（任务创建即快照）', () => {
    expect(buildUgoiraTask(illust(), ZIP, 'zip').id).toBe('ugoira_123_zip')
    expect(buildUgoiraTask(illust(), ZIP, 'tar').fileName).toBe('Pictelio_123.tar')
    expect(buildUgoiraTask(illust(), ZIP, 'mp4').targetFormat).toBe('mp4')
  })
})
