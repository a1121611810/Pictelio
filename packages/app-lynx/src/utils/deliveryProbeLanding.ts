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
import { useDeliveryProbeStore, type ClickProvenance } from "../stores/deliveryProbeStore"

/** 宿主广播的落点事件名（冷启动：随 onLoadSuccess 多窗重发，与 benchNav 深链同款竞态对抗） */
export const EVENT_NOTIFICATION_TARGET = "pictelioNotificationTarget"
/**
 * 热启动落点事件名。**单次**广播即可（JS 早已挂载），无渲染竞态。
 *
 * ⚠️ 为什么用两个事件名而不是「一个事件名 + 载荷带来源」：lynx 4.0.1 的
 *   `JavaOnlyArray.of` 载荷只实证过**单个** Long（见 benchNav illust-detail 先例），
 *   双参签名未经取证。与其赌签名，不如沿用**事件名编码**这一既有手法
 *   ——benchNav 的整张路由表都是这么做的。
 */
export const EVENT_NOTIFICATION_TARGET_WARM = "pictelioNotificationTargetWarm"

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
 * @param provenance 由**哪个事件**送达决定（冷 / 热），不是载荷里的数字 ——
 *   载荷只承载 clickId，来源靠事件名区分（理由见上方事件名注释）。
 * @returns 是否真的记了一笔（重复广播返回 false）
 */
export async function handleNotificationTarget(
  state: ClickDedupeState,
  clickId: number,
  provenance: ClickProvenance,
): Promise<boolean> {
  if (!acceptClick(state, clickId)) return false
  await useDeliveryProbeStore().recordClicked(provenance)
  console.log(`[deliveryProbe] 记 1 个点击样本（${provenance}，clickId=${clickId}）`)
  return true
}
