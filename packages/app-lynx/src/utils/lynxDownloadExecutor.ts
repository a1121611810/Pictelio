// ─── 下载执行器（lynx 引擎：NativeModules 拉模式桥，spec docs/specs/download-manager.md §4.3）───
// 纯注入工厂（schedule/clear 可注入，node 可测）；生产接线在 utils/downloadExecutor.ts。
// 进度拉模式：Lynx Callback 一次性（对齐 UgoiraStreamEngine）——定时 pollProgress 取 "done/total"。
import { unquoteNativeString } from './tokenStorage'
import type { DownloadExecutor, DownloadExecutorCallbacks } from './downloadManager'

/** 原生 PictelioDownloader 模块契约（Android PictelioDownloaderModule） */
export interface LynxDownloaderNative {
  start(
    id: string,
    sourceUrl: string,
    fileName: string,
    kind: string,
    targetFormat: string,
    framesJson: string,
    payloadJson: string,
    cb: (uri: string, err: string) => void,
  ): void
  pollProgress(id: string, cb: (payload: string, err: string) => void): void
  cancel(id: string, cb: (hit: string, err: string) => void): void
  deleteFile(uri: string, cb: (ok: string, err: string) => void): void
}

export const DOWNLOAD_POLL_INTERVAL_MS = 300

export function createLynxDownloadExecutor(
  native: LynxDownloaderNative,
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setInterval> = setInterval,
  clear: (handle: ReturnType<typeof setInterval>) => void = clearInterval,
): DownloadExecutor {
  const active = new Map<string, DownloadExecutorCallbacks>()
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  const lastPct = new Map<string, number>()

  function stopPolling(id: string): void {
    const handle = timers.get(id)
    if (handle !== undefined) {
      clear(handle)
      timers.delete(id)
    }
    lastPct.delete(id)
  }

  return {
    start(task, _runId, cb) {
      active.set(task.id, cb)
      lastPct.set(task.id, -1)
      timers.set(
        task.id,
        schedule(() => {
          native.pollProgress(task.id, (payload) => {
            const [doneStr, totalStr] = (unquoteNativeString(payload) ?? '').split('/')
            const done = Number(doneStr)
            const total = Number(totalStr)
            if (!Number.isFinite(done) || done < 0) return
            const pct = total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0
            if (lastPct.get(task.id) === pct) return
            lastPct.set(task.id, pct)
            active.get(task.id)?.onProgress(pct, { done, total })
          })
        }, DOWNLOAD_POLL_INTERVAL_MS),
      )

      const framesJson = task.frames ? JSON.stringify(task.frames) : ''
      const payloadJson = task.payloadJson ?? ''
      native.start(task.id, task.sourceUrl, task.fileName, task.kind, task.targetFormat, framesJson, payloadJson, (uri, err) => {
        stopPolling(task.id)
        if (active.get(task.id) !== cb) return
        active.delete(task.id)
        const message = unquoteNativeString(err)
        if (message) {
          console.warn('[lynxDownloadExecutor] 下载失败:', message)
          cb.onFail(message)
          return
        }
        cb.onComplete(unquoteNativeString(uri) ?? uri)
      })
    },
    // 原生暂无「挂起保留部分进度」能力：pause 等同 cancel，续传重新下载（spec §2 申报范围）
    pause(id) {
      active.delete(id)
      stopPolling(id)
      native.cancel(id, () => {})
    },
    cancel(id) {
      active.delete(id)
      stopPolling(id)
      native.cancel(id, () => {})
    },
    deleteFile(uri) {
      return new Promise((resolve, reject) => {
        native.deleteFile(uri, (_ok, err) => {
          const message = unquoteNativeString(err)
          if (message) {
            console.warn('[lynxDownloadExecutor] deleteFile 失败:', message)
            reject(new Error(message))
            return
          }
          resolve()
        })
      })
    },
  }
}
