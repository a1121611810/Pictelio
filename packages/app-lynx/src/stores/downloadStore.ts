// ─── 下载队列响应式 store（Pinia 薄壳，spec docs/specs/download-manager.md §4）───
// 深模块在 utils/downloadManager.ts（框架无关、node 可测）；本文件只做三件事：
// 提供 prefs/idbKV seam、注册原生执行器 seam（T3 接入）、把状态镜像进 Pinia ref。
// 原生：NativeModules.PictelioPrefs（共享 SharedPreferences，与 webview 同键）；
// web-core dev：IndexedDB KV。探测形态对齐 stores/settingsStore.ts。
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getNativeModules, isNativeMode } from '../api/client'
import { idbGet, idbSet } from '../utils/idbKV'
import { unquoteNativeString } from '../utils/tokenStorage'
import {
  createDownloadManager,
  type DownloadExecutor,
  type DownloadKV,
} from '../utils/downloadManager'
import type { DeleteMode, DownloadTaskDraft, QueueState } from '../utils/downloadQueueCore'

interface NativePrefs {
  prefsGet(key: string, callback: (value: string, err: string | null) => void): void
  prefsSet(key: string, value: string, callback: (err: string | null) => void): void
}

function nativeKv(): DownloadKV {
  const mod = getNativeModules()?.PictelioPrefs as NativePrefs | undefined
  return {
    get(key) {
      return new Promise((resolve) => {
        if (!mod) {
          console.warn('[downloadStore] 原生 PictelioPrefs 不可用（按缺失处理）')
          resolve(null)
          return
        }
        mod.prefsGet(key, (value, err) => {
          if (err) {
            console.warn('[downloadStore] 原生读取失败', err)
            resolve(null)
            return
          }
          resolve(value === '' ? null : unquoteNativeString(value))
        })
      })
    },
    set(key, value) {
      return new Promise((resolve, reject) => {
        if (!mod) {
          console.warn('[downloadStore] 原生 PictelioPrefs 不可用（写失败）')
          reject(new Error('native prefs unavailable'))
          return
        }
        mod.prefsSet(key, value, (err) => {
          if (err) {
            console.warn('[downloadStore] 原生写入失败', err)
            reject(new Error(err))
          } else {
            resolve()
          }
        })
      })
    },
  }
}

function devKv(): DownloadKV {
  return { get: (key) => idbGet(key), set: (key, value) => idbSet(key, value) }
}

function kv(): DownloadKV {
  return isNativeMode() ? nativeKv() : devKv()
}

let executor: DownloadExecutor | null = null

/** 注册原生执行器（T3 在原生环境接入；未接入前任务显式失败）。 */
export function setDownloadExecutor(next: DownloadExecutor): void {
  executor = next
}

const delegatingExecutor: DownloadExecutor = {
  start(task, runId, cb) {
    if (!executor) {
      console.warn('[downloadStore] 下载执行器未接入，任务失败')
      cb.onFail('下载执行器未接入')
      return
    }
    executor.start(task, runId, cb)
  },
  pause(id) {
    executor?.pause(id)
  },
  cancel(id) {
    executor?.cancel(id)
  },
  deleteFile(uri) {
    if (!executor) {
      console.warn('[downloadStore] 下载执行器未接入，删除文件失败')
      return Promise.reject(new Error('下载执行器未接入'))
    }
    return executor.deleteFile(uri)
  },
}

let sharer: ((uris: readonly string[]) => Promise<void>) | null = null

/** 注册系统分享器（T6 在原生环境接入；未接入前显式失败）。 */
export function setDownloadSharer(next: (uris: readonly string[]) => Promise<void>): void {
  sharer = next
}

const manager = createDownloadManager({ kv: kv(), executor: delegatingExecutor })
// 启动即恢复一次持久队列（hydrate 幂等；页面重挂载不再覆盖内存态）
void manager.hydrate()

export const useDownloadStore = defineStore('downloads', () => {
  const state = ref<QueueState>(manager.getState())
  manager.subscribe((s) => {
    state.value = s
  })

  /** 从持久层恢复（downloading→paused），不自动开始。 */
  function hydrate(): Promise<void> {
    return manager.hydrate()
  }
  function enqueue(drafts: readonly DownloadTaskDraft[]): void {
    manager.enqueue(drafts)
  }
  function start(ids: readonly string[]): void {
    manager.start(ids)
  }
  function pause(ids: readonly string[]): void {
    manager.pause(ids)
  }
  function stop(ids: readonly string[]): void {
    manager.stop(ids)
  }
  function deleteTasks(ids: readonly string[], mode: DeleteMode): Promise<void> {
    return manager.deleteTasks(ids, mode)
  }
  function flush(): Promise<void> {
    return manager.flush()
  }
  /** 系统分享已下载文件（spec §7.2：仅 completed 且有 outputUri）。 */
  async function share(ids: readonly string[]): Promise<void> {
    const uris = manager
      .getState()
      .tasks.filter((t) => ids.includes(t.id) && t.status === 'completed' && t.outputUri)
      .map((t) => t.outputUri as string)
    if (uris.length === 0) {
      throw new Error('没有可分享的已下载文件')
    }
    if (!sharer) {
      console.warn('[downloadStore] 分享器未接入（T6）')
      throw new Error('分享功能未接入')
    }
    await sharer(uris)
  }

  return { state, hydrate, enqueue, start, pause, stop, deleteTasks, flush, share }
})
