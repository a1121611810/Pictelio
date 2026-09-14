// downloadManager 单测（oracle = spec docs/specs/download-manager.md §3.2/§4.2/§4.4/§3.3）。
// 与 app 包 tests/unit/utils/downloadManager.test.ts 同源同规格（双端差分对齐）。
import { describe, it, expect } from 'vitest'
import {
  createDownloadManager,
  DOWNLOAD_QUEUE_KEY,
  type DownloadExecutor,
  type DownloadExecutorCallbacks,
} from './downloadManager'
import { findTask, serialize, type DownloadTaskDraft } from './downloadQueueCore'

interface StartedRecord {
  id: string
  runId: number
  cb: DownloadExecutorCallbacks
}

function fakeExecutor() {
  const started: StartedRecord[] = []
  const paused: string[] = []
  const cancelled: string[] = []
  const deleted: string[] = []
  const executor: DownloadExecutor = {
    start(task, runId, cb) {
      started.push({ id: task.id, runId, cb })
    },
    pause(id) {
      paused.push(id)
    },
    cancel(id) {
      cancelled.push(id)
    },
    deleteFile(uri) {
      deleted.push(uri)
      return Promise.resolve()
    },
  }
  return { executor, started, paused, cancelled, deleted }
}

function fakeKV() {
  const map = new Map<string, string>()
  let failGet = false
  let failSet = false
  return {
    map,
    setFailGet(v: boolean) {
      failGet = v
    },
    setFailSet(v: boolean) {
      failSet = v
    },
    kv: {
      async get(key: string) {
        if (failGet) throw new Error('read boom')
        return map.get(key) ?? null
      },
      async set(key: string, value: string) {
        if (failSet) throw new Error('write boom')
        map.set(key, value)
      },
    },
  }
}

function draft(id: string, over?: Partial<DownloadTaskDraft>): DownloadTaskDraft {
  return {
    id,
    illustId: Number(id.replace(/\D/g, '')) || 1,
    title: 't',
    thumbnailUrl: 'https://i.pximg.net/t.jpg',
    kind: 'image',
    page: 0,
    sourceUrl: 'https://i.pximg.net/o.jpg',
    targetFormat: 'jpg',
    fileName: 'Pictelio_' + id + '.jpg',
    ...over,
  }
}

function make(over?: { debounceMs?: number }) {
  const ex = fakeExecutor()
  const kv = fakeKV()
  const warns: string[] = []
  const mgr = createDownloadManager({
    kv: kv.kv,
    executor: ex.executor,
    debounceMs: over?.debounceMs ?? 300,
    now: () => 1000,
    warn: (m) => warns.push(m),
  })
  return { mgr, ex, kv, warns }
}

describe('enqueue 即时调度（spec §4.2）', () => {
  it('入队即在额度内启动（下载中 + 执行器收到 runId=1）', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    expect(findTask(mgr.getState(), '1')?.status).toBe('downloading')
    expect(ex.started).toEqual([{ id: '1', runId: 1, cb: expect.anything() }])
  })

  it('并发上限 1：多余任务排队', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1'), draft('2'), draft('3')])
    expect(ex.started.map((s) => s.id)).toEqual(['1'])
    expect(findTask(mgr.getState(), '1')?.status).toBe('downloading')
    expect(findTask(mgr.getState(), '2')?.status).toBe('queued')
    expect(findTask(mgr.getState(), '3')?.status).toBe('queued')
  })

  it('完成释放额度，下一个自动启动', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1'), draft('2')])
    ex.started[0]!.cb.onComplete('content://1')
    expect(findTask(mgr.getState(), '1')?.status).toBe('completed')
    expect(findTask(mgr.getState(), '1')?.outputUri).toBe('content://1')
    expect(ex.started.map((s) => s.id)).toEqual(['1', '2'])
  })
})

describe('start / pause / stop（spec §3.2）', () => {
  it('start 重试暂停任务：重新入队并启动，runId 递增', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    mgr.pause(['1'])
    mgr.start(['1'])
    expect(findTask(mgr.getState(), '1')?.status).toBe('downloading')
    expect(findTask(mgr.getState(), '1')?.runId).toBe(2)
    expect(ex.started.map((s) => [s.id, s.runId])).toEqual([
      ['1', 1],
      ['1', 2],
    ])
  })

  it('pause 调用执行器挂起并释放额度（下一个顶上）', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1'), draft('2')])
    mgr.pause(['1'])
    expect(ex.paused).toEqual(['1'])
    expect(findTask(mgr.getState(), '1')?.status).toBe('paused')
    expect(ex.started.map((s) => s.id)).toEqual(['1', '2'])
  })

  it('pause 非下载中任务为 no-op（不触碰执行器）', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1'), draft('2')])
    mgr.pause(['2'])
    expect(ex.paused).toEqual([])
    expect(findTask(mgr.getState(), '2')?.status).toBe('queued')
  })

  it('stop 调用执行器取消、进度归零、下一个顶上', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1'), draft('2')])
    ex.started[0]!.cb.onProgress(40)
    mgr.stop(['1'])
    expect(ex.cancelled).toEqual(['1'])
    expect(findTask(mgr.getState(), '1')?.status).toBe('stopped')
    expect(findTask(mgr.getState(), '1')?.progress).toBe(0)
    expect(ex.started.map((s) => s.id)).toEqual(['1', '2'])
  })

  it('已完成任务不可 start', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    ex.started[0]!.cb.onComplete('content://1')
    mgr.start(['1'])
    expect(findTask(mgr.getState(), '1')?.status).toBe('completed')
    expect(ex.started).toHaveLength(1)
  })
})

describe('进度 / 完成 / 失败（spec §4.2）', () => {
  it('onProgress 更新进度；stop 后的过期回调被丢弃', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    ex.started[0]!.cb.onProgress(40, { done: 4, total: 10 })
    expect(findTask(mgr.getState(), '1')?.progress).toBe(40)
    expect(findTask(mgr.getState(), '1')?.bytesTotal).toBe(10)
    mgr.stop(['1'])
    ex.started[0]!.cb.onProgress(90)
    ex.started[0]!.cb.onComplete('content://late')
    expect(findTask(mgr.getState(), '1')?.status).toBe('stopped')
    expect(findTask(mgr.getState(), '1')?.progress).toBe(0)
  })

  it('onFail 写入错误并继续下一个', () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1'), draft('2')])
    ex.started[0]!.cb.onFail('HTTP 404')
    expect(findTask(mgr.getState(), '1')?.status).toBe('failed')
    expect(findTask(mgr.getState(), '1')?.error).toBe('HTTP 404')
    expect(ex.started.map((s) => s.id)).toEqual(['1', '2'])
  })
})

describe('删除两模式（spec §3.3）', () => {
  it('mode=files 先删已完成文件再移除记录', async () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    ex.started[0]!.cb.onComplete('content://1')
    await mgr.deleteTasks(['1'], 'files')
    expect(ex.deleted).toEqual(['content://1'])
    expect(findTask(mgr.getState(), '1')).toBeUndefined()
  })

  it('mode=records 不动文件只移除记录', async () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    ex.started[0]!.cb.onComplete('content://1')
    await mgr.deleteTasks(['1'], 'records')
    expect(ex.deleted).toEqual([])
    expect(findTask(mgr.getState(), '1')).toBeUndefined()
  })

  it('删除下载中任务先取消再移除', async () => {
    const { mgr, ex } = make()
    mgr.enqueue([draft('1')])
    await mgr.deleteTasks(['1'], 'records')
    expect(ex.cancelled).toEqual(['1'])
    expect(findTask(mgr.getState(), '1')).toBeUndefined()
  })
})

describe('持久化 hydrate / flush（spec §4.4）', () => {
  it('flush 落盘；新实例 hydrate 还原（downloading→paused，不自动开始）', async () => {
    const first = make({ debounceMs: 1_000_000 })
    first.mgr.enqueue([draft('1')])
    await first.mgr.flush()
    expect(first.kv.map.has(DOWNLOAD_QUEUE_KEY)).toBe(true)

    const second = make({ debounceMs: 1_000_000 })
    second.kv.map.set(DOWNLOAD_QUEUE_KEY, first.kv.map.get(DOWNLOAD_QUEUE_KEY)!)
    await second.mgr.hydrate()
    expect(findTask(second.mgr.getState(), '1')?.status).toBe('paused')
    expect(second.ex.started).toEqual([]); // 不自动开始
    expect(second.warns.some((m) => m.includes('中断'))).toBe(true)
  })

  it('hydrate 幂等：二次调用不用持久快照覆盖内存态（防重挂载把在途任务降级 paused）', async () => {
    const { mgr, kv } = make({ debounceMs: 1_000_000 })
    kv.map.set(DOWNLOAD_QUEUE_KEY, serialize({ tasks: [] }))
    await mgr.hydrate()
    mgr.enqueue([draft('1')])
    expect(findTask(mgr.getState(), '1')?.status).toBe('downloading')
    await mgr.hydrate()
    expect(findTask(mgr.getState(), '1')?.status).toBe('downloading')
  })

  it('KV 读取失败 → 空队列 + warn', async () => {
    const { mgr, kv, warns } = make()
    kv.setFailGet(true)
    await mgr.hydrate()
    expect(mgr.getState()).toEqual({ tasks: [] })
    expect(warns.some((m) => m.includes('读取失败'))).toBe(true)
  })

  it('KV 写入失败 → warn（不抛，队列仍可用）', async () => {
    const { mgr, kv, warns } = make({ debounceMs: 0 })
    kv.setFailSet(true)
    mgr.enqueue([draft('1')])
    await mgr.flush()
    expect(warns.some((m) => m.includes('持久化失败'))).toBe(true)
    expect(findTask(mgr.getState(), '1')?.status).toBe('downloading')
  })

  it('损坏持久化数据 → 空队列 + warn', async () => {
    const { mgr, kv, warns } = make()
    kv.map.set(DOWNLOAD_QUEUE_KEY, '{broken')
    await mgr.hydrate()
    expect(mgr.getState()).toEqual({ tasks: [] })
    expect(warns.some((m) => m.includes('解析失败'))).toBe(true)
  })
})

describe('订阅', () => {
  it('subscribe 收到状态变更；unsubscribe 后不再收到', () => {
    const { mgr } = make()
    const seen: number[] = []
    const off = mgr.subscribe((s) => seen.push(s.tasks.length))
    mgr.enqueue([draft('1')])
    // 入队 + 即时调度是两次状态迁移（各 emit 一次），任务数恒为 1
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((n) => n === 1)).toBe(true)
    const after = seen.length
    off()
    mgr.enqueue([draft('2')])
    expect(seen.length).toBe(after)
  })

  it('空操作不触发订阅（结构共享）', () => {
    const { mgr } = make()
    mgr.enqueue([draft('1'), draft('2')])
    const before = mgr.getState()
    const seen: number[] = []
    mgr.subscribe(() => seen.push(1))
    mgr.pause(['2']); // 非下载中，no-op
    expect(mgr.getState()).toBe(before)
    expect(seen).toEqual([])
  })
})
