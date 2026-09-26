// ─── 保存到相册桥（app-lynx，spec docs/specs/image-save-download.md §3 D3）───
// 原生：NativeModules.PictelioGallery（PictelioGalleryModule.java → GallerySaver.java 深模块）。
// web-core（无 NativeModules）：显式失败（拒绝 + warn），不做伪保存（无静默降级）。
// 探测模式对齐 utils/tokenStorage.ts 的 nativeModule()。
import { unquoteNativeString } from './tokenStorage'

/** 原生保存 Module（回调契约见 PictelioGalleryModule.java：cb(uri, "") / cb("", errMsg)，无 null） */
interface NativeGalleryModule {
  saveImage(url: string, fileName: string, callback: (uri: string, err: string) => void): void
  /** 子目录变体（ADR-0192 D4）：dir = JS 侧展开好的目录段（作者名段，非模板）。
   *  可选标记——旧原生包无此方法，调用方以 dir === "" 走三参 saveImage 保持兼容 */
  saveImageTo?(
    url: string,
    fileName: string,
    dir: string,
    callback: (uri: string, err: string) => void,
  ): void
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
 * dir 为可选子目录段（ADR-0192 D4，作者目录开关产生的净化作者段；由 JS 单一事实源
 * utils/galleryDownload.buildAuthorDirSegment 生成）：空串/缺省 = 走既有三参 saveImage
 * （现行为字节不变，兼容旧原生包）；非空 → saveImageTo 透传至 GallerySaver.save 追加到
 * 基座常量 Pictures/Pictelio 之后。原生缺 saveImageTo 方法（版本漂移）→ 显式失败（禁静默
 * 降级为平铺保存）。
 *
 * Lynx Callback.invoke(String) 会把字符串参数 JSON 序列化（首尾带引号，
 * 见 tokenStorage.unquoteNativeString 注释）——uri/errMsg 统一去引号后消费。
 */
export function saveImageToGallery(url: string, fileName: string, dir = ""): Promise<string> {
  const mod = nativeModule()
  if (!mod) {
    console.warn('[gallerySaver] 无原生 PictelioGallery 模块（web-core 预览环境不支持保存）')
    return Promise.reject(new Error('当前环境不支持保存到相册'))
  }
  return new Promise((resolve, reject) => {
    const onDone = (uri: string, err: string) => {
      const message = unquoteNativeString(err)
      if (message) {
        console.warn('[gallerySaver] 保存失败:', message)
        reject(new Error(message))
        return
      }
      resolve(unquoteNativeString(uri) ?? uri)
    }
    if (dir === "") {
      mod.saveImage(url, fileName, onDone)
      return
    }
    if (typeof mod.saveImageTo !== 'function') {
      console.warn('[gallerySaver] 原生 PictelioGallery.saveImageTo 不可用（版本漂移），保存失败')
      reject(new Error('当前原生版本不支持子目录保存'))
      return
    }
    mod.saveImageTo(url, fileName, dir, onDone)
  })
}
