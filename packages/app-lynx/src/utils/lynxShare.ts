// ─── 系统分享（lynx 引擎：NativeModules 桥，spec docs/specs/download-manager.md §4.1）───
// 纯注入工厂（node 可测）；生产接线在 utils/downloadSharer.ts。
import { unquoteNativeString } from './tokenStorage'

export interface LynxShareNative {
  share(urisJson: string, mime: string, cb: (ok: string, err: string) => void): void
}

export function createLynxSharer(
  native: LynxShareNative,
): (uris: readonly string[]) => Promise<void> {
  return (uris) => {
    if (uris.length === 0) {
      return Promise.reject(new Error('没有可分享的文件'))
    }
    return new Promise((resolve, reject) => {
      native.share(JSON.stringify([...uris]), '', (_ok, err) => {
        const message = unquoteNativeString(err)
        if (message) {
          console.warn('[lynxShare] 分享失败:', message)
          reject(new Error(message))
          return
        }
        resolve()
      })
    })
  }
}
