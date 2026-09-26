// isNovelDownloaded 单测（oracle = spec docs/specs/app-lynx-novel-intro-action-row.md §3.3）。
// 任务 mock 字段与 packages/app-lynx/src/utils/downloadQueueCore.ts 的 DownloadTask 完全对齐（测试硬约束 #2）。
import { describe, it, expect } from 'vitest'
import { isNovelDownloaded } from './novelDownloadStatus'
import type { DownloadTask, QueueState } from './downloadQueueCore'

/**
 * 构造最小但字段完备的 DownloadTask（与 downloadQueueCore.test.ts 同源 factory 形态，
 * 仅保留参与判定 + 类型完备的字段；其余可缺省字段遵循 downloadQueueCore `newTask` 默认）。
 */
function makeTask(over: Partial<DownloadTask> & { id: string; kind: DownloadTask['kind'] }): DownloadTask {
  return {
    illustId: 1,
    title: 't',
    thumbnailUrl: 'https://i.pximg.net/c/240x480/novel-cover.jpg',
    sourceUrl: 'https://app-api.pixiv.net/novel/text',
    targetFormat: 'txt',
    fileName: 'Pictelio_novel_1.txt',
    status: 'queued',
    progress: 0,
    runId: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function makeState(tasks: DownloadTask[]): QueueState {
  return { tasks }
}

describe('isNovelDownloaded（spec §3.3 / US4）', () => {
  it('空 queue → false', () => {
    expect(isNovelDownloaded(makeState([]), 123)).toBe(false)
  })

  it('仅有 queued / downloading / failed / paused 任务（非 completed）→ false', () => {
    const state = makeState([
      makeTask({ id: 'q', kind: 'novel', illustId: 123, status: 'queued' }),
      makeTask({ id: 'd', kind: 'novel', illustId: 123, status: 'downloading' }),
      makeTask({ id: 'f', kind: 'novel', illustId: 123, status: 'failed' }),
      makeTask({ id: 'p', kind: 'novel', illustId: 123, status: 'paused' }),
    ])
    expect(isNovelDownloaded(state, 123)).toBe(false)
  })

  it('kind 非 novel（如 illust/ugoira 任务）即使 status=completed → false', () => {
    const state = makeState([
      makeTask({ id: 'i', kind: 'image', illustId: 123, status: 'completed', progress: 100 }),
      makeTask({ id: 'u', kind: 'ugoira', illustId: 123, status: 'completed', progress: 100 }),
    ])
    expect(isNovelDownloaded(state, 123)).toBe(false)
  })

  it('illustId 不匹配 → false', () => {
    const state = makeState([
      makeTask({ id: 'a', kind: 'novel', illustId: 999, status: 'completed', progress: 100 }),
    ])
    expect(isNovelDownloaded(state, 123)).toBe(false)
  })

  it('命中一条 novel + completed → true', () => {
    const state = makeState([
      makeTask({
        id: 'n1',
        kind: 'novel',
        illustId: 123,
        status: 'completed',
        progress: 100,
        outputUri: 'file:///storage/emulated/0/Pictelio/novel_123.txt',
      }),
    ])
    expect(isNovelDownloaded(state, 123)).toBe(true)
  })

  it('多任务含一条 novel + completed + illustId 匹配 → true', () => {
    const state = makeState([
      makeTask({ id: 'i1', kind: 'image', illustId: 7, status: 'completed', progress: 100 }),
      makeTask({ id: 'u1', kind: 'ugoira', illustId: 8, status: 'downloading' }),
      makeTask({
        id: 'n1',
        kind: 'novel',
        illustId: 123,
        status: 'completed',
        progress: 100,
        outputUri: 'file:///storage/emulated/0/Pictelio/novel_123.txt',
      }),
      makeTask({ id: 'q1', kind: 'novel', illustId: 456, status: 'queued' }),
    ])
    expect(isNovelDownloaded(state, 123)).toBe(true)
  })

  it('多任务含 novel + completed 但 illustId 全错 → false', () => {
    const state = makeState([
      makeTask({ id: 'n2', kind: 'novel', illustId: 456, status: 'completed', progress: 100 }),
      makeTask({ id: 'n3', kind: 'novel', illustId: 789, status: 'completed', progress: 100 }),
      makeTask({ id: 'i2', kind: 'image', illustId: 123, status: 'completed', progress: 100 }),
    ])
    expect(isNovelDownloaded(state, 123)).toBe(false)
  })
})