// lynxDownloadExecutor 单测（spec docs/specs/download-manager.md §4.3）：
// 拉模式进度 / 完成失败映射 / 取消清理 / 删除委托（schedule/clear 注入，nan 时钟可控）。
import { describe, it, expect, vi } from 'vitest'
import { createLynxDownloadExecutor, type LynxDownloaderNative } from './lynxDownloadExecutor'
import type { DownloadExecutorCallbacks } from './downloadManager'
import type { DownloadTask } from './downloadQueueCore'

function task(id: string): DownloadTask {
  return {
    id,
    illustId: 1,
    title: 't',
    thumbnailUrl: '',
    kind: 'image',
    sourceUrl: 'https://i.pximg.net/o.jpg',
    targetFormat: 'jpg',
    fileName: id + '.jpg',
    status: 'downloading',
    progress: 0,
    runId: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function callbacks() {
  const onProgress = vi.fn()
  const onComplete = vi.fn()
  const onFail = vi.fn()
  const cb: DownloadExecutorCallbacks = { onProgress, onComplete, onFail }
  return { cb, onProgress, onComplete, onFail }
}

function harness() {
  const startCbs = new Map<string, (uri: string, err: string) => void>()
  const pollCbs = new Map<string, (payload: string, err: string) => void>()
  const cancelled: string[] = []
  const deleted: string[] = []
  const native: LynxDownloaderNative = {
    start: vi.fn(
      (
        id: string,
        _s: string,
        _f: string,
        _k: string,
        _t: string,
        _fj: string,
        cb: (uri: string, err: string) => void,
      ) => {
        startCbs.set(id, cb)
      },
    ),
    pollProgress: vi.fn((id: string, cb: (payload: string, err: string) => void) => {
      pollCbs.set(id, cb)
    }),
    cancel: vi.fn((id: string, cb: (hit: string, err: string) => void) => {
      cancelled.push(id)
      cb('1', '')
    }),
    deleteFile: vi.fn((uri: string, cb: (ok: string, err: string) => void) => {
      deleted.push(uri)
      cb('1', '')
    }),
  }
  const scheduled: Array<() => void> = []
  const cleared: Array<ReturnType<typeof setInterval>> = []
  const exec = createLynxDownloadExecutor(
    native,
    (fn) => {
      scheduled.push(fn)
      return scheduled.length as unknown as ReturnType<typeof setInterval>
    },
    (h) => {
      cleared.push(h)
    },
  )
  return { native, exec, startCbs, pollCbs, scheduled, cleared, cancelled, deleted }
}

describe('createLynxDownloadExecutor（spec §4.3）', () => {
  it('拉模式进度：换算百分比并按 pct 去重', () => {
    const h = harness()
    const a = callbacks()
    h.exec.start(task('a'), 1, a.cb)
    expect(h.scheduled).toHaveLength(1)
    h.scheduled[0]!()
    h.pollCbs.get('a')!('1000/4000', '')
    expect(a.onProgress).toHaveBeenCalledWith(25, { done: 1000, total: 4000 })
    h.pollCbs.get('a')!('1000/4000', '') // 同 pct → 不重复上报
    expect(a.onProgress).toHaveBeenCalledTimes(1)
  })

  it('start 完成 → onComplete 并停止轮询', () => {
    const h = harness()
    const a = callbacks()
    h.exec.start(task('a'), 1, a.cb)
    h.startCbs.get('a')!('file://a', '')
    expect(a.onComplete).toHaveBeenCalledWith('file://a')
    expect(h.cleared).toHaveLength(1)
  })

  it('start 失败（err 非空）→ onFail', () => {
    const h = harness()
    const a = callbacks()
    h.exec.start(task('a'), 1, a.cb)
    h.startCbs.get('a')!('', 'HTTP 404')
    expect(a.onFail).toHaveBeenCalledWith('HTTP 404')
  })

  it('cancel 清理轮询并委托原生', () => {
    const h = harness()
    const a = callbacks()
    h.exec.start(task('a'), 1, a.cb)
    h.exec.cancel('a')
    expect(h.cleared).toHaveLength(1)
    expect(h.cancelled).toContain('a')
    expect(a.onComplete).not.toHaveBeenCalled()
  })

  it('deleteFile 委托原生', async () => {
    const h = harness()
    await h.exec.deleteFile('content://a')
    expect(h.deleted).toEqual(['content://a'])
  })
})
