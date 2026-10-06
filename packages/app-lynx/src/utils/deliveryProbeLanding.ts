// ─── 送达通道 · 触达探测的**通知落点**（spec notification-delivery-probe / #940）───
//
// 【解决什么】#939 发的通知**完全没有点击意图**（真机 dumpsys 实证 contentIntent=null），
//   被点即消失 ⇒ ADR-0220 §6-3 的「点了像没点」在正式收口前一直暴露。
//   本模块是 JS 侧那一半：收到原生广播的落点意图 → 去重 → 记点击 → （由 router 导航）。
//
// 【为什么必须去重】冷启动那条路径要**广播 4 次**（1.5/3/4.5/6s）对抗 bundle 渲染竞态
//   ——这是既有 benchNav 深链验证过的手法。但 `navigate(..., { replace: true })` 幂等，
//   **计数不幂等**：不去重则一次点击被记 4 次，点击率直接虚高 4 倍。
//   去重键用原生在**点击瞬间**生成的 clickId：4 次广播携带同一个 id，天然可判重。
//
// 【为什么冷/热要分开记】探测只在「用户已进入前台 + 静默期」后投递（ADR-0220 §3.1），
//   所以热启动时用户本就在 App 里 —— 这一记点击**不构成**「被通知叫回来」。
//   现在分开记，等报告期有数据了再决定要不要把它算进分子（ADR-0220 D10）。
import { useDeliveryProbeStore } from "../stores/deliveryProbeStore"
import { idbGet } from "./idbKV"

/** 宿主广播的落点事件名（冷启动：随 onLoadSuccess 多窗重发，与 benchNav 深链同款竞态对抗） */
export const EVENT_NOTIFICATION_TARGET = "pictelioNotificationTarget"
/** 已见 clickId 的滑动窗口大小：够覆盖 4 次广播，又不会让 Set 无限长 */
const SEEN_LIMIT = 32

export interface ClickDedupeState {
  seen: Set<number>
}

/**
 * 判定一次到达是否应当计数，并登记该 clickId。
 *
 * @returns true = 首次到达（应当计数）；false = 4 次广播里的重复到达
 */
export function acceptClick(state: ClickDedupeState, clickId: number): boolean {
  if (state.seen.has(clickId)) return false
  state.seen.add(clickId)
  // 滑动窗口：只保留最近的若干个，避免长时间运行后 Set 无限增长
  if (state.seen.size > SEEN_LIMIT) {
    const oldest = state.seen.values().next().value
    if (oldest !== undefined) state.seen.delete(oldest)
  }
  return true
}

/**
 * 处理一次落点到达：去重 → 记点击。
 *
 * ⚠️ 不做冷/热拆分（#940 实施期结论）：「点击时用户是否在 App 里」在进程内**不可判定**——
 *   处理点击这个动作本身就是状态跃迁，四种候选信号全被它污染。详见 store 的 recordClicked。
 *
 * @returns 是否真的记了一笔（重复广播返回 false）
 */
export async function handleNotificationTarget(
  state: ClickDedupeState,
  clickId: number,
): Promise<boolean> {
  if (!acceptClick(state, clickId)) return false
  await useDeliveryProbeStore().recordClicked()
  console.log(`[deliveryProbe] 记 1 个点击样本（clickId=${clickId}）`)
  return true
}

/**
 * 待认领的点击：宿主在落点分派时把 clickId 落盘，JS 挂载时主动拉取。
 *
 * ⚠️ 为什么需要这条**拉取**通道（e2e #942 实测）：四窗广播**可能全部落在 JS 订阅之前**
 * ——落点分派成功、点击却一次都没被记。多加广播窗口只是把概率压低，不是根治；
 * 本仓 safeArea / darkMode 早已为此立过同款先例（「首帧事件早于 JS 订阅而丢失 ⇒
 * 订阅后拉取初值」）。⇒ 事件负责「已经在跑的时候」，拉取负责「错过了也不丢」。
 */
export const PENDING_CLICK_KEY = "delivery_probe_pending_click"

/** 拉取并处理宿主落盘的那一次点击；无待认领点击时静默返回。 */
export async function pullPendingClick(state: ClickDedupeState): Promise<boolean> {
  let raw: string | null = null
  try {
    raw = await idbGet(PENDING_CLICK_KEY)
  } catch (e) {
    console.warn("[deliveryProbe] 待认领点击读取失败（跳过）", e)
    return false
  }
  if (!raw) return false
  const clickId = Number(raw)
  if (!Number.isFinite(clickId) || clickId <= 0) {
    console.warn(`[deliveryProbe] 待认领点击 id 畸形：${raw}（跳过）`)
    return false
  }
  return handleNotificationTarget(state, clickId)
}
