// buildImageTasks 单测（oracle = spec docs/specs/download-manager.md §3.1 + 既有
// image-save-download §3 D3 文件名契约；复用 originalPageUrls/extForUrl 字面语义）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildImageTasks } from './galleryDownload'
import type { PixivIllust } from '../api/types'

function illust(over?: Partial<PixivIllust>): PixivIllust {
  return {
    id: 123,
    title: '作品A',
    type: 'illust',
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

afterEach(() => vi.restoreAllMocks())

describe('buildImageTasks（spec §3.1）', () => {
  it('单页：原图 URL + Pictelio_<id>.<ext> 文件名，一条任务', () => {
    const i = illust({ meta_single_page: { original_image_url: 'https://i.pximg.net/o.jpg' } })
    const tasks = buildImageTasks(i, [0])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'img_123_p0',
      illustId: 123,
      kind: 'image',
      page: 0,
      sourceUrl: 'https://i.pximg.net/o.jpg',
      targetFormat: 'jpg',
      fileName: 'Pictelio_123.jpg',
    })
  })

  it('多页：按选中页序生成，文件名带 _pN，格式取 URL 扩展名', () => {
    const i = illust({
      page_count: 2,
      meta_pages: [
        { image_urls: { square_medium: 's', medium: 'm0', large: 'l0', original: 'o0.png' } },
        { image_urls: { square_medium: 's', medium: 'm1', large: 'l1', original: 'o1.png' } },
      ],
    })
    const tasks = buildImageTasks(i, [1, 0])
    expect(tasks.map((t) => t.id)).toEqual(['img_123_p1', 'img_123_p0'])
    expect(tasks.map((t) => t.fileName)).toEqual(['Pictelio_123_p1.png', 'Pictelio_123_p0.png'])
    expect(tasks[0]!.sourceUrl).toBe('o1.png')
    expect(tasks.every((t) => t.targetFormat === 'png')).toBe(true)
  })

  it('缺失原图 URL 的页跳过并 warn（无静默降级）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const i = illust({ page_count: 1, meta_single_page: { original_image_url: 'o0.jpg' } })
    const tasks = buildImageTasks(i, [0, 5])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe('img_123_p0')
    expect(warn).toHaveBeenCalled()
  })

  it('thumbnailUrl 取 medium 兜底', () => {
    const i = illust({ meta_single_page: { original_image_url: 'o.jpg' } })
    expect(buildImageTasks(i, [0])[0]!.thumbnailUrl).toBe('https://i.pximg.net/medium.jpg')
  })
})
