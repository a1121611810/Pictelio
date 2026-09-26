// buildImageTasks 单测（oracle = spec docs/specs/download-manager.md §3.1 + 既有
// image-save-download §3 D3 文件名契约；复用 originalPageUrls/extForUrl 字面语义）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildImageTasks } from './galleryDownload'
import { toIllustId, toUserId } from '../api/id'
import type { PixivIllust } from '../api/types'

function illust(over?: Partial<PixivIllust>): PixivIllust {
  return {
    id: toIllustId(123),
    title: '作品A',
    type: 'illust',
    user: { id: toUserId(1), name: 'u', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
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

  // ── 命名模板端到端（ADR-0192 D7 / spec D5：settings 模板经 naming.template 注入同一纯函数）───
  it('自定义模板端到端：fileName 展开净化后的作者/标题；缺省 template 与默认逐字节一致', () => {
    const i = illust({
      title: '作品 A',
      user: { id: toUserId(1), name: '画/师', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
      meta_single_page: { original_image_url: 'https://i.pximg.net/o.jpg' },
    })
    expect(buildImageTasks(i, [0], { template: '{author}_{title}_{id}' })[0]!.fileName).toBe(
      '画_师_作品 A_123.jpg',
    )
    // 缺省 template → buildSaveFileName 硬编码默认路径，字节不变
    expect(buildImageTasks(i, [0])[0]!.fileName).toBe('Pictelio_123.jpg')
    expect(buildImageTasks(i, [0], { template: undefined })[0]!.fileName).toBe('Pictelio_123.jpg')
  })

  it('自定义模板多页且不含 {p}：自动追加 _p<选中页号>（与默认后缀同形）；单选一页与默认路径同取无后缀形态', () => {
    const i = illust({
      page_count: 2,
      meta_pages: [
        { image_urls: { square_medium: 's', medium: 'm0', large: 'l0', original: 'o0.png' } },
        { image_urls: { square_medium: 's', medium: 'm1', large: 'l1', original: 'o1.png' } },
      ],
    })
    expect(buildImageTasks(i, [1, 0], { template: '{id}' }).map((t) => t.fileName)).toEqual([
      '123_p1.png',
      '123_p0.png',
    ])
    // 单选一页（total=1）：与缺省 buildSaveFileName 路径逐字节同形态（无 _pN 后缀）
    expect(buildImageTasks(i, [1], { template: '{id}' }).map((t) => t.fileName)).toEqual(['123.png'])
  })
})

// ── dir 作者目录段（ADR-0192 D5/D7 / spec docs/specs/lynx-download-naming.md T11/T12）───
describe('buildImageTasks dir 字段（开关矩阵）', () => {
  it('缺省（未传 naming）→ dir = ""（现行为字节不变）', () => {
    const i = illust({ meta_single_page: { original_image_url: 'o.jpg' } })
    expect(buildImageTasks(i, [0])[0]!.dir).toBe('')
  })

  it('开关关 → dir = ""（字节不变）；开关开 → dir = 净化作者段', () => {
    const i = illust({ meta_single_page: { original_image_url: 'o.jpg' } })
    expect(buildImageTasks(i, [0], { authorDir: false })[0]!.dir).toBe('')
    expect(buildImageTasks(i, [0], { authorDir: true })[0]!.dir).toBe('u')
  })

  it('作者名含分隔符/空白 → 经 buildAuthorDirSegment 净化（同一命名纯函数）', () => {
    const i = illust({
      user: { id: toUserId(1), name: ' a/b\\c ', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
      meta_single_page: { original_image_url: 'o.jpg' },
    })
    const tasks = buildImageTasks(i, [0], { authorDir: true })
    expect(tasks.map((t) => t.dir)).toEqual(['a_b_c'])
  })

  it('开关开 + 作者名缺失 → dir = "" + warn（禁静默退化）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const i = illust({ user: undefined, meta_single_page: { original_image_url: 'o.jpg' } } as Partial<PixivIllust>)
    expect(buildImageTasks(i, [0], { authorDir: true })[0]!.dir).toBe('')
    expect(warn).toHaveBeenCalled()
  })
})
