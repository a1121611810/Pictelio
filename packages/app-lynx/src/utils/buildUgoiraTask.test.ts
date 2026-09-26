// buildUgoiraTask 单测（oracle = spec docs/specs/download-manager.md §3.1/§5）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildUgoiraTask } from './galleryDownload'
import { toIllustId, toUserId } from '../api/id'
import type { PixivIllust } from '../api/types'

function illust(over?: Partial<PixivIllust>): PixivIllust {
  return {
    id: toIllustId(123),
    title: '动图A',
    type: 'ugoira',
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

const ZIP = 'https://i.pximg.net/img-zip-ugoira/img/2020/01/01/00/00/00/123_ugoira1920x1080.zip'

afterEach(() => vi.restoreAllMocks())

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

  // ── 命名模板端到端（ADR-0192 D7 / spec D5：ugoira 链同样消费 naming.template）───
  it('自定义模板端到端：基段展开模板，扩展名恒取目标格式（非 ZIP URL 推断）；缺省字节不变', () => {
    const i = illust({
      title: '动图 A',
      user: { id: toUserId(1), name: '画/师', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
    })
    expect(buildUgoiraTask(i, ZIP, 'gif', [], { template: '{author}_{title}_{id}' }).fileName).toBe(
      '画_师_动图 A_123.gif',
    )
    // ZIP URL 无白名单扩展名 → 若误走 URL 推断会得 .jpg；此处必须仍为目标格式
    expect(buildUgoiraTask(i, ZIP, 'webm', [], { template: '{id}' }).fileName).toBe('123.webm')
    // 缺省 template → 既有字面路径，字节不变
    expect(buildUgoiraTask(illust(), ZIP, 'mp4').fileName).toBe('Pictelio_123.mp4')
  })
})

// ── dir 作者目录段（ADR-0192 D5/D7：ugoira 导出基座 = Downloads/Pictelio + 作者段）───
describe('buildUgoiraTask dir 字段', () => {
  it('缺省 / 开关关 → dir = ""（现行为字节不变）', () => {
    expect(buildUgoiraTask(illust(), ZIP, 'gif').dir).toBe('')
    expect(buildUgoiraTask(illust(), ZIP, 'gif', [], { authorDir: false }).dir).toBe('')
  })

  it('开关开 → dir = 净化作者段（任务创建即快照）', () => {
    const i = illust({
      user: { id: toUserId(1), name: ' 画/师 ', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
    })
    expect(buildUgoiraTask(i, ZIP, 'mp4', [], { authorDir: true }).dir).toBe('画_师')
  })

  it('开关开 + 作者名缺失 → dir = "" + warn（禁静默退化）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const i = illust({ user: undefined } as Partial<PixivIllust>)
    expect(buildUgoiraTask(i, ZIP, 'zip', [], { authorDir: true }).dir).toBe('')
    expect(warn).toHaveBeenCalled()
  })
})
