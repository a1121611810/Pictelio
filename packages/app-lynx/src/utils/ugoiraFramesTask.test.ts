// ugoira 帧时序随任务传递/持久化（oracle = spec docs/specs/download-manager.md §3.1/§4.4/§6）。
import { describe, it, expect } from 'vitest'
import { buildUgoiraTask } from './galleryDownload'
import { enqueue, findTask, restore, serialize } from './downloadQueueCore'
import type { PixivIllust } from '../api/types'

function illust(): PixivIllust {
  return {
    id: 123,
    title: '动图A',
    type: 'ugoira',
    user: { id: 1, name: 'u', account: 'u', profile_image_urls: { medium: '' } } as PixivIllust['user'],
    image_urls: { square_medium: 's', medium: 'm', large: 'l' },
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
  }
}

const FRAMES = [
  { file: 'frame_0.png', delay: 60 },
  { file: 'frame_1.png', delay: 120 },
]

describe('ugoira 帧时序（spec §3.1/§4.4）', () => {
  it('buildUgoiraTask 携带 frames；无帧则省略字段', () => {
    expect(buildUgoiraTask(illust(), 'z.zip', 'apng', FRAMES).frames).toEqual(FRAMES)
    expect(buildUgoiraTask(illust(), 'z.zip', 'zip').frames).toBeUndefined()
  })

  it('入队 + 序列化/恢复保留 frames', () => {
    const state = enqueue({ tasks: [] }, [buildUgoiraTask(illust(), 'z.zip', 'apng', FRAMES)], 1)
    const restored = restore(serialize(state))
    expect(findTask(restored, 'ugoira_123_apng')?.frames).toEqual(FRAMES)
  })

  it('损坏 frames 条目被丢弃、合法项保留（无静默）', () => {
    const raw = JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'x',
          illustId: 1,
          title: 't',
          thumbnailUrl: '',
          kind: 'ugoira',
          sourceUrl: 'z',
          targetFormat: 'apng',
          fileName: 'x.apng',
          status: 'queued',
          progress: 0,
          runId: 0,
          createdAt: 1,
          updatedAt: 1,
          frames: [{ file: 'a.png', delay: 1 }, { file: 2 }, null],
        },
      ],
    })
    expect(findTask(restore(raw), 'x')?.frames).toEqual([{ file: 'a.png', delay: 1 }])
  })
})
