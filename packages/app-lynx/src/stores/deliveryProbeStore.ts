// ─── 送达通道 · 触达探测的计数存储与判定链（spec notification-delivery-probe / ADR-0220）───
//
// 【这是什么】一次**测量**的记录面，不是通知功能本身。ADR-0220 决策 1：
//   交付物是「拿到一个可判定『用户想不想要这个回执』的数据点」，不是「通知能用」。
//   按功能验收会滑向「能用」，而「能用」证明不了「想要」。
//
// 【只存本地】ADR-0220 决策 13：**不上传任何行为数据**。落盘走既有偏好存储 seam
//   （原生 PictelioPrefs / dev IndexedDB，与 stores/notificationStore 同款 adapter 形态），
//   **不新建存储模块**。
//   ⚠️ 键名不带 uid：这是**设备行为**（「这台设备上的用户发过几次」），不是账号数据。
//
// 【为何是一个 JSON 值而非三个键】重置要「只清计数、保开始时间」。三个独立键做这件事
//   需要读-改-写三步且非原子；单值 JSON 一次写入即完成，且能保证三者永远同版本。
//
// 【静默期是近似值】Lynx 侧**没有窗口 focus 事件**（api/queryClient 已因此关闭
//   refetchOnWindowFocus），故「用户没在主动看」只能用生命周期事件 + 计时近似。
//   这是 ADR-0220 §3.1 登记的已知取舍，不是实现疏忽。
import { defineStore } from "pinia"
import { ref } from "vue"
import { getNativeModules } from "../api/client"
import { unquoteNativeString } from "../utils/tokenStorage"
import { idbGet, idbSet } from "../utils/idbKV"

// ─── 跨端契约符号（宿主侧逐字一致，由 deliveryProbeContract.test.ts 钉住）───

/** 宿主在进入前台时发射的全局事件名 */
export const EVENT_APP_FOREGROUND = "pictelioAppForeground"
/** 宿主在离开前台时发射的全局事件名 */
export const EVENT_APP_BACKGROUND = "pictelioAppBackground"

/** 计数存储键（与宿主 SharedPreferences 同一键；跨端一致性由契约门禁断言） */
export const DELIVERY_PROBE_KEY = "delivery_probe_v1"

// ─── 计数形状 ───

export interface DeliveryProbeCounts {
  /** 发出样本数：一次轮询 = 1（汇总形态，不论该批有几条更新） */
  sent: number
  /** 点击样本数（ADR-0220 D12 的分子）。 */
  clicked: number
  /** 本轮探测开始时间（ms）。**跨轮保留**，故重置不清它 */
  startedAt: number | null
}

export function emptyCounts(): DeliveryProbeCounts {
  return { sent: 0, clicked: 0, startedAt: null }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/**
 * 解析持久化值。
 *
 * ⚠️ 缺失 / 畸形一律按**首轮未探测**处理并显式告警（禁静默降级）：
 * 读失败若静默当成「0 次发出」，探测报告会把「没数据」误读成「没人点」——
 * 那正是本探测要回答的问题被自己抹掉。
 */
export function parseCounts(raw: string | null): DeliveryProbeCounts {
  if (raw === null || raw === "") return emptyCounts()
  try {
    const v = JSON.parse(raw) as Partial<DeliveryProbeCounts>
    return {
      sent: num(v.sent),
      clicked: num(v.clicked),
      startedAt:
        typeof v.startedAt === "number" && Number.isFinite(v.startedAt) ? v.startedAt : null,
    }
  } catch (e) {
    console.warn("[deliveryProbe] 计数解析失败（按首轮未探测处理）", e)
    return emptyCounts()
  }
}

// ─── prefs seam（形态对齐 stores/notificationStore）───

interface NativePrefs {
  prefsGet(key: string, callback: (value: string, err: string | null) => void): void
  prefsSet(key: string, value: string, callback: (err: string | null) => void): void
}

function nativeKv() {
  const mod = getNativeModules()?.PictelioPrefs as NativePrefs | undefined
  return {
    get(key: string): Promise<string | null> {
      return new Promise((resolve) => {
        if (!mod) {
          console.warn("[deliveryProbe] 原生 PictelioPrefs 不可用（按缺失处理）")
          resolve(null)
          return
        }
        mod.prefsGet(key, (value, err) => {
          if (err) {
            console.warn("[deliveryProbe] 原生读取失败（按缺失处理）", err)
            resolve(null)
            return
          }
          // lynx Callback 字符串带 JSON 引号（tokenStorage 同款坑）
          resolve(value === "" ? null : unquoteNativeString(value))
        })
      })
    },
    set(key: string, value: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!mod) {
          console.warn("[deliveryProbe] 原生 PictelioPrefs 不可用（写失败）")
          reject(new Error("native prefs unavailable"))
          return
        }
        mod.prefsSet(key, value, (err) => {
          if (err) {
            console.warn("[deliveryProbe] 原生写入失败", err)
            reject(new Error(err))
          } else {
            resolve()
          }
        })
      })
    },
  }
}

function kv() {
  const native = getNativeModules()?.PictelioPrefs
  if (native) return nativeKv()
  return { get: (key: string) => idbGet(key), set: (key: string, value: string) => idbSet(key, value) }
}

// ─── 判定链（ADR-0220 决策 2：静默期是近似的生命周期计时）───

/** 静默期时长（ms）。进入前台后须静默此时长才进入判定——避免用户一进来就被通知轰炸。 */
export const QUIET_PERIOD_MS = 90_000

export type ProbeDecision =
  /** 静默期未过 */
  | "quiet-period-not-elapsed"
  /** 通知权限未授予 ⇒ 降级到外环未读角标（既有能力），不发 */
  | "permission-not-granted"
  /** 没有新未读 ⇒ 无内容可告知 */
  | "no-unread"
  /** 该发 */
  | "should-send"

export interface ProbeInput {
  /** 静默期已过的毫秒数 */
  quietElapsedMs: number
  /** 通知权限是否已授予 */
  permissionGranted: boolean
  /** 当前未读条数 */
  unreadCount: number
}

export function decideProbe(input: ProbeInput): ProbeDecision {
  if (input.quietElapsedMs < QUIET_PERIOD_MS) return "quiet-period-not-elapsed"
  if (!input.permissionGranted) return "permission-not-granted"
  if (input.unreadCount <= 0) return "no-unread"
  return "should-send"
}

// ─── store ───

export const useDeliveryProbeStore = defineStore("deliveryProbe", () => {
  const counts = ref<DeliveryProbeCounts>(emptyCounts())
  let loaded = false

  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
      counts.value = parseCounts(await kv().get(DELIVERY_PROBE_KEY))
    } catch (e) {
      console.warn("[deliveryProbe] 计数读取失败（按首轮未探测处理）", e)
      counts.value = emptyCounts()
    }
  }

  async function persist(): Promise<void> {
    try {
      await kv().set(DELIVERY_PROBE_KEY, JSON.stringify(counts.value))
    } catch (e) {
      // 度量是旁路：写失败不抛、不阻塞用户操作，但必须显式告警
      console.warn("[deliveryProbe] 计数落盘失败（本轮数据可能丢失）", e)
    }
  }

  /** 记一个发出样本（ADR-0220 决策 6：一次轮询 = 一个样本，不论该批有几条） */
  async function recordSent(): Promise<void> {
    if (counts.value.startedAt === null) counts.value.startedAt = Date.now()
    counts.value.sent += 1
    await persist()
  }

  /**
   * 记一个点击样本（#940）。
   *
   * ⚠️ **调用方必须先按 clickId 去重**——冷启动那一跳要广播 4 次对抗渲染竞态，
   *   而计数不是幂等的（幂等的是 `navigate(..., { replace: true })`）。
   *
   * ⚠️ 刻意**不做冷/热拆分**（#940 实施期结论，见 docs/adr/ADR-0220 §6-3）：
   *   「点击时用户是否在 App 里」在进程内**不可判定**——处理点击这个动作本身
   *   就是状态跃迁，四种候选信号全被它污染（回调类型 / 进程内静态 / 持久前台
   *   标记 / 进程寿命）。宁可只留不可靠的总点击数，也不留会被误用的分类字段。
   */
  async function recordClicked(): Promise<void> {
    counts.value.clicked += 1
    await persist()
  }

  /**
   * 重置一轮探测：**只清计数字段，开始时间保留**（ADR-0220 决策 12）。
   * 保留开始时间才能把多轮的时间线连起来；连它一起清就丢掉了「这轮从什么时候开始」。
   */
  async function resetRound(): Promise<void> {
    counts.value = { ...emptyCounts(), startedAt: counts.value.startedAt }
    await persist()
  }

  return { counts, load, recordSent, recordClicked, resetRound }
})
