// downloadsViewModel 单测（oracle = spec docs/specs/download-manager.md §3.2/§3.3/§7）。
// 与 app 包 tests/unit/utils/downloadsViewModel.test.ts 同源同规格（双端差分对齐）。
import { describe, it, expect } from 'vitest'
import {
  allSelected,
  availabilityFor,
  availabilityForAll,
  groupByIllust,
  hasDeletableFiles,
  progressText,
  selectAll,
  shareableUris,
  statusLabel,
  summarize,
  toggleId,
} from './downloadsViewModel'
import type { DownloadStatus, DownloadTask } from './downloadQueueCore'

function task(over: Partial<DownloadTask> & { id: string }): DownloadTask {
  return {
    illustId: 1,
    title: '作品',
    thumbnailUrl: 'https://i.pximg.net/t.jpg',
    kind: 'image',
    sourceUrl: 'https://i.pximg.net/o.jpg',
    targetFormat: 'jpg',
    fileName: 'Pictelio_1.jpg',
    status: 'queued',
    progress: 0,
    runId: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('groupByIllust（spec §7 按作品分组）', () => {
  it('同作品聚合，保持首次出现顺序', () => {
    const tasks = [
      task({ id: 'a0', illustId: 10, title: 'A' }),
      task({ id: 'b0', illustId: 20, title: 'B' }),
      task({ id: 'a1', illustId: 10, title: 'A' }),
    ]
    const groups = groupByIllust(tasks)
    expect(groups.map((g) => g.illustId)).toEqual([10, 20])
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(['a0', 'a1'])
    expect(groups[0]!.title).toBe('A')
  })

  it('空输入 → 空分组', () => {
    expect(groupByIllust([])).toEqual([])
  })
})

describe('动作可用性（spec §3.2/§3.3）', () => {
  const tasks = [
    task({ id: 'q', status: 'queued' }),
    task({ id: 'd', status: 'downloading' }),
    task({ id: 'p', status: 'paused' }),
    task({ id: 'c', status: 'completed', outputUri: 'content://c' }),
    task({ id: 'f', status: 'failed' }),
  ]

  it('按选中集合派生 start/pause/stop/delete/share', () => {
    expect(availabilityFor(tasks, ['q', 'd'])).toEqual({
      start: true,
      pause: true,
      stop: true,
      delete: true,
      share: false,
    })
    expect(availabilityFor(tasks, ['c'])).toEqual({
      start: false,
      pause: false,
      stop: false,
      delete: true,
      share: true,
    })
    expect(availabilityFor(tasks, ['f'])).toEqual({
      start: true,
      pause: false,
      stop: false,
      delete: true,
      share: false,
    })
  })

  it('无选中 → 全部 false', () => {
    expect(availabilityFor(tasks, [])).toEqual({
      start: false,
      pause: false,
      stop: false,
      delete: false,
      share: false,
    })
  })

  it('全部：含可开始与可停止项', () => {
    const a = availabilityForAll(tasks)
    expect(a.start).toBe(true)
    expect(a.pause).toBe(true)
    expect(a.stop).toBe(true)
    expect(a.delete).toBe(true)
    expect(a.share).toBe(true)
  })

  it('hasDeletableFiles 仅当所选含 completed+outputUri', () => {
    expect(hasDeletableFiles(tasks, ['c'])).toBe(true)
    expect(hasDeletableFiles(tasks, ['q', 'd'])).toBe(false)
    expect(hasDeletableFiles(tasks, [])).toBe(false)
  })
})

describe('状态文案（spec §7）', () => {
  it('statusLabel 六态全覆盖', () => {
    const cases: Array<[DownloadStatus, string]> = [
      ['queued', '排队中'],
      ['downloading', '下载中'],
      ['paused', '已暂停'],
      ['stopped', '已停止'],
      ['completed', '已完成'],
      ['failed', '失败'],
    ]
    for (const [st, label] of cases) expect(statusLabel(st)).toBe(label)
  })

  it('progressText：下载中显示百分比；失败带错误；其余显示状态', () => {
    expect(progressText(task({ id: 'x', status: 'downloading', progress: 42 }))).toBe('42%')
    expect(progressText(task({ id: 'x', status: 'failed', error: 'HTTP 404' }))).toBe('失败：HTTP 404')
    expect(progressText(task({ id: 'x', status: 'failed' }))).toBe('失败')
    expect(progressText(task({ id: 'x', status: 'paused' }))).toBe('已暂停')
    expect(progressText(task({ id: 'x', status: 'completed' }))).toBe('已完成')
  })
})

describe('选择与分享（spec §7）', () => {
  const tasks = [
    task({ id: 'a', status: 'completed', outputUri: 'content://a' }),
    task({ id: 'b', status: 'downloading' }),
    task({ id: 'c', status: 'completed' }), // 无 uri
  ]

  it('summarize 统计数量/完成/进行中', () => {
    expect(summarize(tasks, ['a', 'b', 'c'])).toEqual({ count: 3, completed: 2, active: 1 })
    expect(summarize(tasks, [])).toEqual({ count: 0, completed: 0, active: 0 })
  })

  it('shareableUris 仅取 completed + outputUri', () => {
    expect(shareableUris(tasks, ['a', 'b', 'c'])).toEqual(['content://a'])
  })

  it('toggleId 增删不改原集合', () => {
    const s = new Set(['a'])
    const added = toggleId(s, 'b')
    const removed = toggleId(s, 'a')
    expect([...added]).toEqual(['a', 'b'])
    expect([...removed]).toEqual([])
    expect([...s]).toEqual(['a'])
  })

  it('selectAll / allSelected', () => {
    const all = selectAll(tasks)
    expect(allSelected(tasks, all)).toBe(true)
    expect(allSelected(tasks, new Set(['a']))).toBe(false)
    expect(allSelected([], new Set())).toBe(false)
  })
})
