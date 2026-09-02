/**
 * 滚动指示条几何计算（spec #319 / ticket #320 T1）。
 *
 * oracle = 官方 GalleryScrollbar 公式（Huxpro/vue-lynx
 * examples/gallery/src/GalleryScrollbar/NiceScrollbar.vue）：
 *   scrollbarHeight = listHeight * (listHeight / scrollHeight)
 *   scrollbarTop    = listHeight * (scrollTop / scrollHeight)
 *
 * 差异点（相对官方公式，测试必须覆盖）：
 * D1. height 下限 max(24, ...) —— 内容极长时缩略条不消失
 * D2. top 钳制到 [0, max(0, listHeight - height)] —— 滚动到底/过度滚动不越出轨道
 * D3. scrollHeight 非法（<=0 / NaN / 缺失）→ null —— 无有效信号保持隐藏
 * D4. listHeight 缺失（undefined / NaN）→ 回退 DEFAULT_LIST_HEIGHT（保守常量）
 *
 * 零依赖纯函数（node 可测），所有数值经 Number() 归一化（NaN 视同该字段缺失）。
 */

/** 真机捕获的滚动负载形状（scrollTop / scrollHeight / listHeight 三字段，均为 px） */
export interface ScrollPayload {
  scrollTop: number
  scrollHeight: number
  listHeight: number
}

/** 滚动指示条几何（px） */
export interface ScrollIndicatorGeometry {
  top: number
  height: number
}

/** 保守的可视列表高度常量（原型值）：listHeight 缺失时的回退值 */
export const DEFAULT_LIST_HEIGHT = 580

/** 缩略条最小高度（D1 下限，防内容极长时消失） */
const MIN_THUMB_HEIGHT = 24

export function calcScrollIndicator(detail: {
  scrollTop?: number
  scrollHeight?: number
  listHeight?: number
}): ScrollIndicatorGeometry | null {
  // Number() 归一化：NaN 视同缺失（各字段缺失语义：scrollHeight→null、scrollTop→0、listHeight→回退 580）
  let scrollHeight = Number(detail.scrollHeight)
  if (Number.isNaN(scrollHeight)) scrollHeight = 0
  // D3：scrollHeight 缺失/非法 → 无有效信号，保持隐藏
  if (scrollHeight <= 0) return null

  let scrollTop = Number(detail.scrollTop)
  if (Number.isNaN(scrollTop)) scrollTop = 0

  let listHeight = Number(detail.listHeight)
  if (Number.isNaN(listHeight)) listHeight = DEFAULT_LIST_HEIGHT

  // 官方公式 + D1：高度下限 24px
  const height = Math.max(MIN_THUMB_HEIGHT, listHeight * (listHeight / scrollHeight))
  const rawTop = listHeight * (scrollTop / scrollHeight)
  // D2：顶部钳制在 [0, max(0, listHeight - height)]，滚动到底不越出轨道
  const top = Math.min(Math.max(rawTop, 0), Math.max(0, listHeight - height))

  return { top, height }
}
