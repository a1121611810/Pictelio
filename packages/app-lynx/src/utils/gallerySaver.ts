// ─── 保存到相册桥（app-lynx，spec docs/specs/image-save-download.md §3 D3）───
// 原生：NativeModules.PictelioGallery（PictelioGalleryModule.java → GallerySaver.java 深模块）。
// web-core（无 NativeModules）：显式失败（拒绝 + warn），不做伪保存（无静默降级）。
// 探测模式对齐 utils/tokenStorage.ts 的 nativeModule()。
import { unquoteNativeString } from './tokenStorage'

/** 原生保存 Module（回调契约见 PictelioGalleryModule.java：cb(uri, "") / cb("", errMsg)，无 null） */
interface NativeGalleryModule {
  saveImage(url: string, fileName: string, callback: (uri: string, err: string) => void): void
}

/** 探测原生 Module（web-core 无 NativeModules → null，调用方走显式失败） */
function nativeModule(): NativeGalleryModule | null {
  // 同时检查裸 NativeModules（lynx runtime 全局对象，真机实测不在 globalThis 上）
  const nm =
    (typeof NativeModules !== 'undefined' ? NativeModules : undefined) ??
    (globalThis as { NativeModules?: { PictelioGallery?: NativeGalleryModule } }).NativeModules
  return nm?.PictelioGallery ?? null
}

/** 保存入口是否可用（ugoira 等宿主可据此隐藏入口；面板内兜底走 saveImageToGallery 拒绝路径） */
export function gallerySaveAvailable(): boolean {
  return nativeModule() !== null
}

/**
 * 保存单张图到系统相册，resolve(content:// 或 file:// uri)。
 * Lynx Callback.invoke(String) 会把字符串参数 JSON 序列化（首尾带引号，
 * 见 tokenStorage.unquoteNativeString 注释）——uri/errMsg 统一去引号后消费。
 */
export function saveImageToGallery(url: string, fileName: string): Promise<string> {
  const mod = nativeModule()
  if (!mod) {
    console.warn('[gallerySaver] 无原生 PictelioGallery 模块（web-core 预览环境不支持保存）')
    return Promise.reject(new Error('当前环境不支持保存到相册'))
  }
  return new Promise((resolve, reject) => {
    mod.saveImage(url, fileName, (uri, err) => {
      const message = unquoteNativeString(err)
      if (message) {
        console.warn('[gallerySaver] 保存失败:', message)
        reject(new Error(message))
        return
      }
      resolve(unquoteNativeString(uri) ?? uri)
    })
  })
}
