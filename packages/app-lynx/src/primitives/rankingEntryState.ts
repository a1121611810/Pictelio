/**
 * 排行榜入口大卡状态纯函数（spec docs/specs/ranking.md §5.1/§5.2；#519）。
 * 抽为纯函数以获得行为级可测性（.vue 在 node 测试环境不可渲染）。
 */

/** 入口可见性：收起或加载失败 → 隐藏；否则显示（无数据时渲染骨架） */
export function isEntryVisible(input: {
  dismissed: boolean
  hasError: boolean
  itemCount: number
}): boolean {
  return !input.dismissed && !input.hasError
}

/** refreshEpoch 变化（下拉刷新 / 返回重进）→ 应复位收起态（首次不重置） */
export function shouldResetDismissed(prev: number | undefined, next: number | undefined): boolean {
  return prev !== undefined && prev !== next
}
