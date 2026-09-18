// ─── 系统栏安全区 signals（spec docs/specs/lynx-systembars.md §4.2，D2）───
// 原生 insets 管线的 JS 侧：订阅 pictelioInsets 事件 + 订阅后拉取初值。
// 消费方：App.vue Root padding-top/bottom + 底部弹层 padding-bottom。
import { ref } from 'vue'

/** 当前状态栏安全高度（px；原生模式下含状态栏与刘海的并集） */
export const safeTop = ref(0)
/** 当前导航栏安全高度（px；全屏模式隐藏系统栏后为 0） */
export const safeBottom = ref(0)

let initialized = false

/**
 * 初始化系统栏安全区（App.vue onMounted 调用，幂等）。
 *
 * 通道（spec D2 修订）：**订阅后拉**——先 addListener 订阅 pictelioInsets 事件，
 * 再经 NativeModules.PictelioApp.getSafeAreaInsets 拉取当前值。拉取是初值来源：
 * insets 首次分发发生在视图 attach 期，早于 JS 订阅（benchNav 四次广播同族竞态），
 * 纯推模式首帧必丢；事件只负责后续变化（全屏开关 hide/show、旋转）。
 *
 * web-core 预览 / dev：无 native → 恒 0（= 历史非 e2e 形态的布局等价），一次性
 * warn 可见（禁静默降级，router.ts registerSystemBackHandler 先例）。
 */
export function initSafeArea(): void {
  if (initialized) return
  initialized = true

  const lynxGlobal =
    typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
  if (!emitter || typeof emitter.addListener !== 'function') {
    console.warn('[safeArea] GlobalEventEmitter 不可用，安全区恒 0（web-core 预览属预期）')
    return
  }
  emitter.addListener('pictelioInsets', (...args: unknown[]) => {
    // 原生侧 JavaOnlyArray.of(top, bottom) → 参数展开（router.ts:384 illust-detail 同款）
    const top = Number(args[0])
    const bottom = Number(args[1])
    if (Number.isFinite(top)) safeTop.value = top
    if (Number.isFinite(bottom)) safeBottom.value = bottom
  })

  // 订阅后立即拉取初值（spec D2 修订核心：防首帧事件丢失）
  const nm =
    (typeof NativeModules !== 'undefined' ? NativeModules : undefined) ??
    (globalThis as { NativeModules?: { PictelioApp?: PictelioAppNative } }).NativeModules
  const appModule = nm?.PictelioApp
  if (!appModule || typeof appModule.getSafeAreaInsets !== 'function') {
    console.warn('[safeArea] NativeModules.PictelioApp 不可用，安全区恒 0（web-core 预览属预期）')
    return
  }
  appModule.getSafeAreaInsets((top: number, bottom: number) => {
    safeTop.value = Number.isFinite(top) ? top : 0
    safeBottom.value = Number.isFinite(bottom) ? bottom : 0
  })
}

/** 原生 PictelioApp 模块本文件所需子集（完整声明见 rspeedy-env.d.ts） */
interface PictelioAppNative {
  getSafeAreaInsets(callback: (top: number, bottom: number) => void): void
}
