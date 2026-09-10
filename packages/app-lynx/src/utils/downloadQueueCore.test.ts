// downloadQueueCore 单测（oracle = spec docs/specs/download-manager.md §3.2/§4.2/§4.4）。
// 与 app 包 tests/unit/utils/downloadQueueCore.test.ts 同源同规格（双端差分对齐）。
import { describe, it, expect } from 'vitest'
import {
  canPause,
  canStart,
  canStop,
  complete,
  countByStatus,
  enqueue,
  fail,
  findTask,
  MAX_CONCURRENT,
  pause,
  QUEUE_SCHEMA_VERSION,
  removeTasks,
  reportProgress,
  restore,
  schedule,
  selectDeleteFileUris,
  serialize,
  start,
  stop,
  UGOIRA_FORMATS,
  type DownloadTask,
  type DownloadTaskDraft,
} from './downloadQueueCore'

function task(over: Partial<DownloadTask> & { id: string }): DownloadTask {
  return {
    illustId: 1,
    title: 't',
    thumbnailUrl: 'https://i.pximg.net/t.jpg',
    kind: 'image',
    sourceUrl: 'https://i.pximg.net/o.jpg',
    targetFormat: 'jpg',
    fileName: 'Pictelio_1_p0.jpg',
    status: 'queued',
    progress: 0,
    runId: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function draft(id: string, over?: Partial<DownloadTaskDraft>): DownloadTaskDraft {
  return {
    id,
    illustId: 1,
    title: 't',
    thumbnailUrl: 'https://i.pximg.net/t.jpg',
    kind: 'image',
    page: 0,
    sourceUrl: 'https://i.pximg.net/o.jpg',
    targetFormat: 'jpg',
    fileName: 'Pictelio_1_p0.jpg',
    ...over,
  }
}

function captureWarn(): { warn: (m: string, e?: unknown) => void; msgs: string[] } {
  const msgs: string[] = []
  return { msgs, warn: (m) => msgs.push(m) }
}

describe('契约常量', () => {
  it('并发上限固定为 1，schema 版本为 1，ugoira 六格式齐全', () => {
    expect(MAX_CONCURRENT).toBe(1)
    expect(QUEUE_SCHEMA_VERSION).toBe(1)
    expect([...UGOIRA_FORMATS]).toEqual(['gif', 'mp4', 'webp', 'apng', 'zip', 'tar'])
  })
})

describe('enqueue（spec §3.1）', () => {
  it('新条目状态 queued / 进度 0 / 运行代 0，时间取注入 now', () => {
    const s = enqueue({ tasks: [] }, [draft('a'), draft('b')], 1000)
    expect(s.tasks).toHaveLength(2)
    for (const t of s.tasks) {
      expect(t.status).toBe('queued')
      expect(t.progress).toBe(0)
      expect(t.runId).toBe(0)
      expect(t.createdAt).toBe(1000)
      expect(t.updatedAt).toBe(1000)
    }
  })

  it('按 id 去重（幂等），重复入队不产生重复条目', () => {
    const s1 = enqueue({ tasks: [] }, [draft('a')], 1)
    const s2 = enqueue(s1, [draft('a'), draft('b')], 2)
    expect(s2.tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('ugoira 草稿无 page 字段', () => {
    const s = enqueue(
      { tasks: [] },
      [draft('u', { kind: 'ugoira', page: undefined, targetFormat: 'gif' })],
      1,
    )
    expect(s.tasks[0]?.page).toBeUndefined()
    expect(s.tasks[0]?.targetFormat).toBe('gif')
  })
})

describe('状态迁移合法性（spec §3.2）', () => {
  const statuses: Array<DownloadTask['status']> = [
    'queued',
    'downloading',
    'paused',
    'stopped',
    'completed',
    'failed',
  ]

  it('canStart：queued/paused/stopped/failed 可开始；downloading/completed 不可', () => {
    const expected: Record<string, boolean> = {
      queued: true,
      downloading: false,
      paused: true,
      stopped: true,
      completed: false,
      failed: true,
    }
    for (const st of statuses) expect(canStart(task({ id: 'x', status: st }))).toBe(expected[st])
  })

  it('canPause：仅 downloading', () => {
    for (const st of statuses) {
      expect(canPause(task({ id: 'x', status: st }))).toBe(st === 'downloading')
    }
  })

  it('canStop：queued/downloading/paused；completed/failed/stopped 不可', () => {
    const expected: Record<string, boolean> = {
      queued: true,
      downloading: true,
      paused: true,
      stopped: false,
      completed: false,
      failed: false,
    }
    for (const st of statuses) expect(canStop(task({ id: 'x', status: st }))).toBe(expected[st])
  })
})

describe('start / pause / stop（spec §3.2）', () => {
  it('start 把 paused/stopped/failed 复位为 queued 并清除 error', () => {
    const s = {
      tasks: [
        task({ id: 'a', status: 'paused', progress: 40 }),
        task({ id: 'b', status: 'failed', error: 'boom' }),
        task({ id: 'c', status: 'completed', outputUri: 'file://c' }),
      ],
    }
    const out = start(s, ['a', 'b', 'c'], 9)
    expect(findTask(out, 'a')?.status).toBe('queued')
    expect(findTask(out, 'b')?.status).toBe('queued')
    expect(findTask(out, 'b')?.error).toBeUndefined()
    expect(findTask(out, 'c')?.status).toBe('completed')
  })

  it('pause 仅作用 downloading，保留进度', () => {
    const s = { tasks: [task({ id: 'a', status: 'downloading', progress: 42 })] }
    const out = pause(s, ['a'], 9)
    expect(findTask(out, 'a')?.status).toBe('paused')
    expect(findTask(out, 'a')?.progress).toBe(42)
  })

  it('pause 对非 downloading 为 no-op', () => {
    const s = { tasks: [task({ id: 'a', status: 'queued' })] }
    expect(pause(s, ['a'], 9)).toEqual(s)
  })

  it('stop 丢弃部分产物：进度归零、清 bytes/outputUri/error', () => {
    const s = {
      tasks: [
        task({
          id: 'a',
          status: 'paused',
          progress: 55,
          bytesDone: 5,
          bytesTotal: 10,
          outputUri: 'file://x',
          error: 'e',
        }),
      ],
    }
    const out = stop(s, ['a'], 9)
    const t = findTask(out, 'a')!
    expect(t.status).toBe('stopped')
    expect(t.progress).toBe(0)
    expect(t.bytesDone).toBeUndefined()
    expect(t.bytesTotal).toBeUndefined()
    expect(t.outputUri).toBeUndefined()
    expect(t.error).toBeUndefined()
  })
})

describe('schedule（spec §4.2 并发上限 + createdAt 升序）', () => {
  it('额度内启动最早的 queued，其余保持 queued', () => {
    const s = {
      tasks: [task({ id: 'late', createdAt: 30 }), task({ id: 'early', createdAt: 10 })],
    }
    const { state, started } = schedule(s, 1, 100)
    expect(started).toEqual([{ id: 'early', runId: 1 }])
    expect(findTask(state, 'early')?.status).toBe('downloading')
    expect(findTask(state, 'late')?.status).toBe('queued')
  })

  it('已有 downloading 时不再启动（额度满）', () => {
    const s = {
      tasks: [
        task({ id: 'running', status: 'downloading', runId: 1 }),
        task({ id: 'wait', createdAt: 2 }),
      ],
    }
    const { state, started } = schedule(s, 1, 100)
    expect(started).toEqual([])
    expect(state).toBe(s)
  })

  it('完成后释放额度，下一次调度启动下一个，并递增 runId', () => {
    let s = {
      tasks: [task({ id: 'a', createdAt: 1 }), task({ id: 'b', createdAt: 2 })],
    }
    const first = schedule(s, 1, 100)
    s = complete(first.state, 'a', first.started[0]!.runId, 'content://a', 101)
    const second = schedule(s, 1, 102)
    expect(second.started).toEqual([{ id: 'b', runId: 1 }])
  })

  it('limit>1 时按顺序启动多条', () => {
    const s = {
      tasks: [
        task({ id: 'a', createdAt: 1 }),
        task({ id: 'b', createdAt: 2 }),
        task({ id: 'c', createdAt: 3 }),
      ],
    }
    const { started } = schedule(s, 2, 100)
    expect(started.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('进度 / 完成 / 失败（spec §4.2 竞态防护）', () => {
  it('reportProgress 夹取 0–100 并写入字节', () => {
    const s = { tasks: [task({ id: 'a', status: 'downloading', runId: 1 })] }
    const hi = reportProgress(s, 'a', 1, 150, { done: 3, total: 6 }, 9)
    expect(findTask(hi, 'a')?.progress).toBe(100)
    const lo = reportProgress(s, 'a', 1, -5, undefined, 9)
    expect(findTask(lo, 'a')?.progress).toBe(0)
    expect(findTask(hi, 'a')?.bytesDone).toBe(3)
    expect(findTask(hi, 'a')?.bytesTotal).toBe(6)
  })

  it('过期 runId 或非 downloading 的进度被丢弃', () => {
    const s = { tasks: [task({ id: 'a', status: 'downloading', runId: 2, progress: 10 })] }
    expect(reportProgress(s, 'a', 1, 90, undefined, 9)).toBe(s)
    const paused = pause(s, ['a'], 9)
    expect(reportProgress(paused, 'a', 2, 90, undefined, 9)).toEqual(paused)
  })

  it('complete 写入 outputUri 与 100%，仅 runId 匹配', () => {
    const s = { tasks: [task({ id: 'a', status: 'downloading', runId: 1 })] }
    const ok = complete(s, 'a', 1, 'content://a', 9)
    expect(findTask(ok, 'a')?.status).toBe('completed')
    expect(findTask(ok, 'a')?.progress).toBe(100)
    expect(findTask(ok, 'a')?.outputUri).toBe('content://a')
    expect(complete(s, 'a', 2, 'content://a', 9)).toBe(s)
  })

  it('fail 写入 error，仅 runId 匹配', () => {
    const s = { tasks: [task({ id: 'a', status: 'downloading', runId: 1 })] }
    const out = fail(s, 'a', 1, 'HTTP 404', 9)
    expect(findTask(out, 'a')?.status).toBe('failed')
    expect(findTask(out, 'a')?.error).toBe('HTTP 404')
    expect(fail(s, 'a', 9, 'x', 9)).toBe(s)
  })
})

describe('删除（spec §3.3 两模式）', () => {
  const s = {
    tasks: [
      task({ id: 'done', status: 'completed', outputUri: 'content://done' }),
      task({ id: 'run', status: 'downloading', outputUri: 'content://run' }),
      task({ id: 'q', status: 'queued' }),
    ],
  }

  it('mode=files 只取 completed 的 outputUri', () => {
    expect(selectDeleteFileUris(s, ['done', 'run', 'q'], 'files')).toEqual(['content://done'])
  })

  it('mode=records 不删任何文件', () => {
    expect(selectDeleteFileUris(s, ['done', 'run', 'q'], 'records')).toEqual([])
  })

  it('removeTasks 移除指定 id', () => {
    const out = removeTasks(s, ['done', 'q'])
    expect(out.tasks.map((t) => t.id)).toEqual(['run'])
  })

  it('countByStatus / findTask 选择器', () => {
    expect(countByStatus(s, 'completed')).toBe(1)
    expect(countByStatus(s, 'downloading')).toBe(1)
    expect(findTask(s, 'nope')).toBeUndefined()
  })
})

describe('持久化 serialize / restore（spec §4.4）', () => {
  it('往返保持字段', () => {
    const s = {
      tasks: [
        task({
          id: 'a',
          status: 'completed',
          progress: 100,
          outputUri: 'content://a',
          runId: 3,
          createdAt: 5,
        }),
      ],
    }
    const restored = restore(serialize(s))
    expect(restored.tasks).toEqual(s.tasks)
  })

  it('null / 空串按空队列', () => {
    expect(restore(null)).toEqual({ tasks: [] })
    expect(restore('')).toEqual({ tasks: [] })
  })

  it('损坏 JSON → 空队列 + warn', () => {
    const c = captureWarn()
    expect(restore('{not json', c.warn)).toEqual({ tasks: [] })
    expect(c.msgs.some((m) => m.includes('解析失败'))).toBe(true)
  })

  it('schema 版本不匹配 → 空队列 + warn', () => {
    const c = captureWarn()
    expect(restore(JSON.stringify({ version: 99, tasks: [] }), c.warn)).toEqual({ tasks: [] })
    expect(c.msgs.some((m) => m.includes('schema'))).toBe(true)
  })

  it('downloading 恢复为 paused + warn（进程重启中断）', () => {
    const raw = serialize({
      tasks: [task({ id: 'a', status: 'downloading', progress: 30, runId: 2 })],
    })
    const c = captureWarn()
    const restored = restore(raw, c.warn)
    expect(restored.tasks[0]?.status).toBe('paused')
    expect(restored.tasks[0]?.progress).toBe(30)
    expect(c.msgs.some((m) => m.includes('中断'))).toBe(true)
  })

  it('损坏条目被丢弃并 warn，合法条目保留', () => {
    const raw = JSON.stringify({
      version: 1,
      tasks: [task({ id: 'ok' }), { id: 'bad' }, null, 42],
    })
    const c = captureWarn()
    const restored = restore(raw, c.warn)
    expect(restored.tasks.map((t) => t.id)).toEqual(['ok'])
    expect(c.msgs.some((m) => m.includes('丢弃 3 条'))).toBe(true)
  })
})
