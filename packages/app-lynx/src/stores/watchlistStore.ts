// ─── 追更（watchlist）状态单一 seam（app-lynx，spec §US6） ───
// 追更相关知识只住在这里：详情页预取 / 弹窗 confirm / 列表页取消写入，
// 详情页系列行标记与触发判定读取。
// - dismissed 会话记忆（决策 D2）：内存 Set，不持久化，重启即清
// - watch 状态缓存：seriesId → watchlist_added（预取失败/未预取 = undefined）

/** 本会话已「暂不」的系列 id 集合（D2 会话级，不持久化） */
const dismissedSeriesIds = new Set<number>()

/** 系列追更状态缓存：seriesId → watchlist_added（undefined = 未知） */
const watchStateBySeries = new Map<number, boolean>()

/** 记录本会话对该系列已选择「暂不」（弹窗不再询问） */
export function markDismissed(seriesId: number): void {
  dismissedSeriesIds.add(seriesId)
}

/** 本会话是否已对该系列选择过「暂不」 */
export function isDismissed(seriesId: number): boolean {
  return dismissedSeriesIds.has(seriesId)
}

/** 写入系列追更状态（详情页预取 / 弹窗追更成功 / 列表页取消） */
export function setWatchState(seriesId: number, added: boolean): void {
  watchStateBySeries.set(seriesId, added)
}

/** 读取系列追更状态；undefined = 未知（未预取或预取失败，触发判定按保守不弹处理） */
export function getWatchState(seriesId: number): boolean | undefined {
  return watchStateBySeries.get(seriesId)
}

/** 测试专用：清空全部状态（模块级单例，避免用例间串扰） */
export function resetWatchlistStoreForTest(): void {
  dismissedSeriesIds.clear()
  watchStateBySeries.clear()
}
