// ─── 下载执行器接线（lynx 引擎）：模块加载即注册到 downloadStore ───
// 原生 NativeModules.PictelioDownloader；web-core 预览无该模块 → 显式 warn（不注册，任务失败信息可见）。
import { getNativeModules } from '../api/client'
import { setDownloadExecutor } from '../stores/downloadStore'
import { createLynxDownloadExecutor, type LynxDownloaderNative } from './lynxDownloadExecutor'

const mod = getNativeModules()?.PictelioDownloader as LynxDownloaderNative | undefined
if (mod) {
  setDownloadExecutor(createLynxDownloadExecutor(mod))
} else {
  console.warn('[downloadExecutor] 无原生 PictelioDownloader（web-core 预览不支持下载队列执行）')
}
