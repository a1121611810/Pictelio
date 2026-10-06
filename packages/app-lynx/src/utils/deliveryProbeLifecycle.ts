// ─── 送达通道 · 触达探测的**生命周期接线**（spec notification-delivery-probe / ADR-0220 决策 2）───
//
// 【为什么必须有这一层】宿主在 onResume / onPause 发两个全局事件，但 Lynx 侧**没有窗口
// focus 事件**（`api/queryClient` 已因此关闭 `refetchOnWindowFocus`）⇒「用户没在主动看」
// 只能用「进入前台的时刻 + 计时」近似。本文件是那个时刻的落点：
// 收到进入前台 → 记下时刻；收到离开前台 → 丢弃时刻。
//
// ⚠️ **静默期是近似值**（ADR-0220 §3.1 登记的已知取舍，不是实现疏忽）：
//   「用户其实在看但引擎没发 onPause」这类情形会让计时偏乐观，判据里已按「先判静默期」
//   兜住（宁可少发不可乱发）。
import { onUnmounted, ref } from "vue"
import {
  EVENT_APP_BACKGROUND,
  EVENT_APP_FOREGROUND,
  useDeliveryProbeStore,
} from "../stores/deliveryProbeStore"

/** 进入前台的时刻（ms）；离开前台即置 null */
const foregroundedAt = ref<number | null>(null)
/** 是否已成功订阅（不订阅则探测链整条不可用，必须对外可见，禁静默降级） */
const subscribed = ref(false)

let registered = false

/** 具名回调：removeListener 需回传同一函数引用，故不能用内联箭头 */
function onForeground(): void {
  foregroundedAt.value = nowMs()
}

function onBackground(): void {
  // 用户已离开 ⇒ 本轮不再打扰。丢弃时刻而非暂停计时：
  // 下次进入前台会重新记时刻，半截计时没有意义。
  foregroundedAt.value = null
}

function nowMs(): number {
  return Date.now()
}

/**
 * 订阅生命周期事件。幂等：重复调用 no-op。
 *
 * @returns 是否成功订阅
 */
export function initDeliveryProbeLifecycle(): boolean {
  if (registered) return subscribed.value
  registered = true

  const lynxGlobal =
    typeof lynx !== "undefined" ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.("GlobalEventEmitter")
  if (!emitter || typeof emitter.addListener !== "function") {
    // web-core 预览 / 异常版本漂移：探测链不可用，显式告警（不静默假装在工作）
    console.warn("[deliveryProbe] GlobalEventEmitter 不可用，静默期计时无法启动")
    return false
  }

  emitter.addListener(EVENT_APP_FOREGROUND, onForeground)
  emitter.addListener(EVENT_APP_BACKGROUND, onBackground)

  subscribed.value = true
  void useDeliveryProbeStore().load()
  return true
}

/** 自进入前台起已过的毫秒数；未在前台时返回 null */
export function quietElapsedMs(): number | null {
  const at = foregroundedAt.value
  if (at === null) return null
  return nowMs() - at
}

export function isLifecycleSubscribed(): boolean {
  return subscribed.value
}

/** 组件卸载时清订阅（App 是常驻根，一般不触发；保留以免测试泄漏） */
export function disposeDeliveryProbeLifecycle(): void {
  const lynxGlobal =
    typeof lynx !== "undefined" ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.("GlobalEventEmitter")
  if (emitter && typeof emitter.removeListener === "function") {
    // 需回传与 addListener 同一个函数引用，故用具名函数而非内联箭头
    emitter.removeListener(EVENT_APP_FOREGROUND, onForeground)
    emitter.removeListener(EVENT_APP_BACKGROUND, onBackground)
  }
  foregroundedAt.value = null
  registered = false
  subscribed.value = false
  onUnmounted(() => {
    /* no-op：App 常驻；保留钩子以满足 vue 的生命周期类型要求 */
  })
}
