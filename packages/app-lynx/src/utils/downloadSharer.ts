// ─── 系统分享接线（lynx 引擎）：模块加载即注册到 downloadStore ───
import { getNativeModules } from '../api/client'
import { setDownloadSharer } from '../stores/downloadStore'
import { createLynxSharer, type LynxShareNative } from './lynxShare'

const mod = getNativeModules()?.PictelioShare as LynxShareNative | undefined
if (mod) {
  setDownloadSharer(createLynxSharer(mod))
} else {
  console.warn('[downloadSharer] 无原生 PictelioShare（web-core 预览不支持系统分享）')
}
