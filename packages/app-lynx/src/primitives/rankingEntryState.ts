/**
 * 排行榜入口大卡状态纯函数（spec docs/specs/ranking.md §5.1/§5.2；#519）。
 * 抽为纯函数以获得行为级可测性（.vue 在 node 测试环境不可渲染）。
 */

/**
 * 入口可见性：收起 / 加载失败 / 已成功落定但空 → 隐藏；否则显示（加载中渲染骨架）。
 * settled-empty 必须隐藏——否则 createMixFeed 成功空返回会让骨架永久停留（spec §5.4 禁静默降级）。
 */
export function isEntryVisible(input: {
  dismissed: boolean
  hasError: boolean
  settled: boolean
  itemCount: number
}): boolean {
  if (input.dismissed || input.hasError) return false
  if (input.settled && input.itemCount === 0) return false
  return true
}

/** refreshEpoch 变化（下拉刷新 / 返回重进）→ 应复位收起态（首次不重置） */
export function shouldResetDismissed(prev: number | undefined, next: number | undefined): boolean {
  return prev !== undefined && prev !== next
}
