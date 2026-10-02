// ─── 系统栏安全区 signals（spec docs/specs/lynx-systembars.md §4.2，D2）───
// 原生 insets 管线的 JS 侧：订阅 pictelioInsets 事件 + 订阅后拉取初值。
// 消费方：App.vue Root padding-top/bottom + 底部弹层 padding-bottom。
import { ref } from 'vue'

// ─── ⚠️ 单位边界：本模块是**物理像素 → 逻辑像素的唯一换算点** ───
//
// 原生 `WindowInsetsCompat.getInsets()` 返回的是**物理像素**，而 Lynx 的 `px` 是
// **逻辑像素**（= Android dp / iOS pt / 1/96 inch，见 docs/adr/glossary-lynx-units.md「核心术语」）——
// 两者差一个 `SystemInfo.pixelRatio`（= density）。ADR-0168 落地时这两侧直接对接，
// 漏掉了这道换算，于是**每一处安全区补偿都被放大 density 倍**。
//
// 真机实证（emulator-5554 / 1080×2160 / density 480 ⇒ scale 3.0）：
//   - 平台真值：`dumpsys` 状态栏 inset = 72 **物理** px；
//   - `SubTabBar` 的 `border-b-[1px]` 在真机上渲染成**整整 3 个物理像素行**
//     ⇒ 独立证明 Lynx `1px` = 3 物理 px（px 是逻辑像素）；
//   - 首页 surface 区实测 400px，减去 PageTopBar 的 17.067vw(184.3px) 后
//     ⇒ paddingTop = **216** 物理 px = 72 × 3，与「物理值被当逻辑值消费」完全吻合。
//
// 后果：状态栏只有 72px，header 上方却凭空多出 144px 空白；6 个底部弹层的
// safeBottom spacer 同理各多 144px 死白；且**随设备而变**（mdpi density=1.0
// 的设备恰好正确、density=3.0 的设备错 3 倍 ⇒ 同一 APK 跨设备表现不一致）。
// web-core 预览无 native ⇒ safeTop/safeBottom 恒 0 ⇒ 该路径不触发，故只在真机暴露。
//
// ⇒ 约定：**本模块对外一律暴露逻辑像素**；下游（App.vue Root + 6 个底部弹层）
//   直接 `safeTop + 'px'` 使用，**不得**在下游再乘除比率。
let ratioWarned = false

/**
 * 物理像素 → 逻辑像素换算比率（= density）。
 * web-core 预览无 `SystemInfo` ⇒ 回退 1；该路径下安全区恒 0，本就用不到比率。
 */
function densityRatio(): number {
  const ratio = typeof SystemInfo === 'undefined' ? undefined : SystemInfo.pixelRatio
  if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0) return ratio
  // 禁静默降级（测试硬约束 #3）：拿不到比率 = 单位不明，必须让 debug 可见
  // （只 warn 一次：insets 在旋转/全屏切换时会重复回调）
  if (!ratioWarned) {
    ratioWarned = true
    console.warn('[safeArea] SystemInfo.pixelRatio 不可用，insets 按 1:1 当逻辑像素处理（补偿可能偏大）')
  }
  return 1
}

/** 原生物理像素 → Lynx 逻辑像素（非有限值归 0，不污染现值） */
function toLogical(physical: number): number {
  return Number.isFinite(physical) ? physical / densityRatio() : 0
}

/** 当前状态栏安全高度（**逻辑** px；原生模式下含状态栏与刘海的并集） */
export const safeTop = ref(0)
/** 当前导航栏安全高度（**逻辑** px；全屏模式隐藏系统栏后为 0） */
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
    // 非法载荷不污染现值，但 debug 可见（非静默；正常链路不应出现）
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      console.debug('[safeArea] pictelioInsets 非法载荷，忽略:', args[0], args[1])
      return
    }
    // ⚠️ 原生给的是物理像素 ⇒ 必须过 toLogical，否则按 density 倍放大（见文件头单位边界）
    safeTop.value = toLogical(top)
    safeBottom.value = toLogical(bottom)
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
    // ⚠️ 同上：原生给物理像素，经 toLogical 转逻辑像素（见文件头单位边界）
    safeTop.value = toLogical(top)
    safeBottom.value = toLogical(bottom)
  })
}

/** 原生 PictelioApp 模块本文件所需子集（完整声明见 rspeedy-env.d.ts） */
interface PictelioAppNative {
  getSafeAreaInsets(callback: (top: number, bottom: number) => void): void
}
