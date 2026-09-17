// ─── 剪贴板桥（app-lynx；spec docs/specs/app-lynx-novel-text-selection.md §ID 6）───
//
// 存在理由：Lynx JS 运行时**没有 navigator**、引擎也没有内置剪贴板 JS API（wayfinder #560
// 研究：liblynx.so 内 clipboard 零命中），自绘选中菜单的「复制」必须走自建原生通道。
//
// 原生契约（PictelioClipboardModule.java）：cb("1", "") / cb("", errMsg)，**无 null**。
// web-core 预览：无 NativeModules → 显式失败（warn + reject），**绝不假成功**（#568 教训）。
// 探测模式对齐 utils/gallerySaver.ts（调用期探测，不吃模块加载顺序）。
import { unquoteNativeString } from './tokenStorage'

export interface ClipboardNative {
  setText(text: string, callback: (ok: string, err: string) => void): void
}

/** 纯注入工厂（node 可测）：成功 resolve；原生报错 reject（失败态由调用方呈现） */
export function createLynxClipboard(native: ClipboardNative): (text: string) => Promise<void> {
  return (text) =>
    new Promise((resolve, reject) => {
      native.setText(text, (ok, err) => {
        const message = unquoteNativeString(err)
        // 成功判据 = ok 标记（"1"）；只看 err 会把 ('', '') 这类契约破坏当成功（禁假成功 #568）
        const failure = message !== null && message.length > 0 ? message : null
        if (ok !== '1' || failure !== null) {
          if (failure !== null) {
            console.warn('[lynxClipboard] 复制失败:', failure)
            reject(new Error(failure))
            return
          }
          console.warn('[lynxClipboard] 复制失败：原生未返回成功标记')
          reject(new Error('clipboard write failed without message'))
          return
        }
        resolve()
      })
    })
}

/** 探测原生模块（web-core 无 NativeModules；裸全局与 globalThis 双通道，同 gallerySaver） */
function nativeModule(): ClipboardNative | null {
  const nm =
    (typeof NativeModules !== 'undefined' ? NativeModules : undefined) ??
    (globalThis as { NativeModules?: { PictelioClipboard?: ClipboardNative } }).NativeModules
  return nm?.PictelioClipboard ?? null
}

/** 生产装配（调用期探测）：缺模块 → 与原生同形的失败回调（warn + reject，不静默降级） */
export function nativeClipboard(): ClipboardNative {
  const mod = nativeModule()
  if (mod) {
    return mod
  }
  return {
    setText(_text: string, callback: (ok: string, err: string) => void): void {
      console.warn('[lynxClipboard] 无原生 PictelioClipboard 模块（web-core 预览不支持复制）')
      callback('', 'clipboard unavailable in this environment')
    },
  }
}

/** 写系统剪贴板（唯一出口）：失败即 reject，由调用方呈现「复制失败」 */
export function writeClipboardText(text: string): Promise<void> {
  return createLynxClipboard(nativeClipboard())(text)
}
