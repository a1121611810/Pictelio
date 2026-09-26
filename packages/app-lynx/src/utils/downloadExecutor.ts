// ─── 下载执行器接线（lynx 引擎）：模块加载即注册到 downloadStore ───
// 原生 NativeModules.PictelioDownloader 惰性解析：首个任务使用时再取（模拟器实证——
// 原生模块注入晚于 bundle 求值，求值期一次性判定会永久判空，下载队列整会话失效）；
// web-core 预览无该模块 → 首用时一次性 warn（不静默，任务失败信息可见）。
import { getNativeModules } from '../api/client'
import { t } from '../i18n'
import { setDownloadExecutor } from '../stores/downloadStore'
import type { DownloadExecutor } from './downloadManager'
import { createLynxDownloadExecutor, type LynxDownloaderNative } from './lynxDownloadExecutor'

/** 测试与接线共用：惰性解析原生模块的执行器（解析与缺席告警均为本实例一次性）。 */
export function createLazyLynxDownloadExecutor(): DownloadExecutor {
  let inner: DownloadExecutor | null = null
  let warned = false

  function resolveExecutor(): DownloadExecutor | null {
    if (inner) return inner
    const mod = getNativeModules()?.PictelioDownloader as LynxDownloaderNative | undefined
    if (mod) {
      inner = createLynxDownloadExecutor(mod)
      return inner
    }
    if (!warned) {
      warned = true
      console.warn('[downloadExecutor] 无原生 PictelioDownloader（web-core 预览不支持下载队列执行）')
    }
    return null
  }

  return {
    start(task, runId, cb) {
      const exec = resolveExecutor()
      if (!exec) {
        cb.onFail(t('downloadStore.executorNotReady'))
        return
      }
      exec.start(task, runId, cb)
    },
    pause(id) {
      resolveExecutor()?.pause(id)
    },
    cancel(id) {
      resolveExecutor()?.cancel(id)
    },
    deleteFile(uri) {
      const exec = resolveExecutor()
      if (!exec) return Promise.reject(new Error(t('downloadStore.executorNotReady')))
      return exec.deleteFile(uri)
    },
  }
}

setDownloadExecutor(createLazyLynxDownloadExecutor())
