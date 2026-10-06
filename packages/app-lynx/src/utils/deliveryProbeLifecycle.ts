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
import { ref } from "vue"
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
  // 显式可观测：静默期计时起点在冷启动与每次回前台都会重启。
  // 这条日志是「竞态是否被修复」的唯一运行时证据——门禁只能验源码形态，
  // 验不了「挂载那一刻到底有没有记上时刻」。
  console.log('[deliveryProbe] 进入前台，静默期计时重启')
}

function onBackground(): void {
  // 用户已离开 ⇒ 本轮不再打扰。丢弃时刻而非暂停计时：
  // 下次进入前台会重新记时刻，半截计时没有意义。
  foregroundedAt.value = null
  console.log('[deliveryProbe] 离开前台，停止静默期计时')
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

  // ⚠️ **冷启动首帧补投**（本仓已有同款竞态的先例与解法）：
  //   Android 顺序是 onCreate(建 lynxView + 异步加载 bundle) → onResume → … → JS 挂载。
  //   `onResume` 发的前台事件**必然早于本行订阅** ⇒ 纯推模式下冷启动那次事件必丢，
  //   计时起点将保持 null，静默期永不启动，且**全程无告警**。
  //   本仓此前正是因此**废弃过**同款事件总线方案，改成「订阅后拉取初值」——
  //   见 LynxActivity 中 `applyDevIntentHooks` 的说明（force R18 改写 SharedPreferences，
  //   注释写明「取代 sendGlobalEvent + JS listener，bundle 渲染竞态不再丢事件」）。
  //   此处采用同源的**兜底**语义：**订阅时若尚未收到过后台事件，即判定当前在前台**。
  //   正确性：JS 能跑起来本身就说明 App 未被系统冻结在后台；而「已在前台却没收到事件」
  //   只可能发生在挂载竞态窗口内 ⇒ 补记时刻是对的。
  //   若挂载后立刻被切后台，会紧接着收到 onBackground 把时刻清掉 ⇒ 不会误判。
  foregroundedAt.value = nowMs()
  // 独立成一条日志：它与上面事件回调那条**必须可区分**——否则真机上看到
  // 「进入前台」日志时，分不清是补投生效（冷启动，事件已丢）还是事件侥幸收到。
  // 没有这条日志，竞态修复就只能靠推理，不能靠设备证据。
  console.log('[deliveryProbe] 订阅即补投前台时刻（冷启动首帧已丢事件，走此兜底）')

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
}
