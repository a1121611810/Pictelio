// ─── 追更（watchlist）状态单一 seam（app-lynx，spec §US6） ───
// 追更相关知识只住在这里：详情页预取 / 弹窗 confirm / 列表页取消写入，
// 详情页系列行标记与触发判定读取。
// - dismissed 会话记忆（决策 D2）：内存 Set，不持久化，重启即清
// - watch 状态缓存：reactive Record（ADR-0189 D5「跨入口 reactive cache」），
//   跨页面 / 跨 controller 共享同一响应式引用，写入即时通知所有读取者；
//   介绍页 inline toggle 后系列行 chip 由 createWatchlistPrompt 内部 computed 派生同步翻转。

import { reactive } from "vue"

/** 本会话已「暂不」的系列 id 集合（D2 会话级，不持久化） */
const dismissedSeriesIds = new Set<number>()

/** 系列追更状态缓存：reactive Record —— 跨 controller 共享响应式读写 */
interface WatchlistState {
  watchStateBySeries: Record<number, boolean>
}
const state = reactive<WatchlistState>({ watchStateBySeries: {} })

/** 记录本会话对该系列已选择「暂不」（弹窗不再询问） */
export function markDismissed(seriesId: number): void {
  dismissedSeriesIds.add(seriesId)
}

/** 本会话是否已对该系列选择过「暂不」 */
export function isDismissed(seriesId: number): boolean {
  return dismissedSeriesIds.has(seriesId)
}

/** 写入系列追更状态（详情页预取 / 弹窗追更成功 / 列表页取消 / inline toggle） */
export function setWatchState(seriesId: number, added: boolean): void {
  state.watchStateBySeries[seriesId] = added
}

/** 读取系列追更状态；undefined = 未知（未预取或预取失败，触发判定按保守不弹处理） */
export function getWatchState(seriesId: number): boolean | undefined {
  return state.watchStateBySeries[seriesId]
}

/** 测试专用：清空全部状态（模块级单例，避免用例间串扰） */
export function resetWatchlistStoreForTest(): void {
  dismissedSeriesIds.clear()
  for (const k of Object.keys(state.watchStateBySeries)) {
    delete state.watchStateBySeries[Number(k)]
  }
}
