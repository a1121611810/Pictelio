// 标签自适应折叠纯函数（ADR-0149 / spec docs/specs/app-lynx-adaptive-list-tags.md）。
// 语义参照 webview packages/app/src/components/home/adaptiveTagFit.ts，但**有意分叉**（非差分等价）：
// webview 贪心条件 used + gap + w + plusWidth <= width 少算了「最后一个完整 chip 与 +N 之间的 gap」，
// 会多放一个导致溢出 gap 像素；此处补上。
//
// 布局语义（ADR-0149 决策 1）：
// 1. 全部 chip 装得下 → 全显示、无 +N；
// 2. 装不下 → 右侧固定预留 +N 宽度，左侧自 0 起贪心放完整 chip；
// 3. 放完完整 chip 后剩余宽度 >= minPartialWidth → 再放一个「截断 chip」（宽度 = 剩余宽度）；
// 4. 其余折叠为 +N。
export interface AdaptiveTagFit {
  /** 完整展示的 chip 数 */
  visible: number
  /** 折叠进 +N 的数量（已扣除截断 chip） */
  remaining: number
  /** 截断 chip 的可用宽度（px）；null = 不显示截断 chip */
  partialWidth: number | null
}

/** 截断 chip 的最小可读宽度（低于此值不显示截断 chip，直接 +N） */
export const MIN_PARTIAL_WIDTH = 16

/**
 * 计算单行标签的可见数量。
 * @param chipWidths 每个标签 chip 的实测宽度（px），顺序与标签一致
 * @param plusWidth +N 徽标的实测宽度（px，按最大可能 N 保守测量）
 * @param containerWidth 容器可用宽度（px）
 * @param gap chip 间距（px，实测相邻 chip 左边界差得出）
 * @param minPartialWidth 截断 chip 的最小可读宽度
 */
export function computeAdaptiveTagFit(
  chipWidths: number[],
  plusWidth: number,
  containerWidth: number,
  gap: number,
  minPartialWidth: number = MIN_PARTIAL_WIDTH,
): AdaptiveTagFit {
  const total = chipWidths.length
  if (!(containerWidth > 0) || total === 0) return { visible: 0, remaining: total, partialWidth: null }

  const allWidth = chipWidths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0)
  if (allWidth <= containerWidth) return { visible: total, remaining: 0, partialWidth: null }

  let visible = 0
  let used = 0
  for (const w of chipWidths) {
    const g = visible > 0 ? gap : 0
    // 末尾还要留一个 gap（与 +N 之间）——webview 版漏算此处
    if (used + g + w + gap + plusWidth <= containerWidth) {
      used += w + g
      visible++
    } else {
      break
    }
  }

  const remaining = total - visible
  const availForPartial =
    containerWidth - used - (visible > 0 ? gap : 0) - (remaining > 0 ? gap + plusWidth : 0)
  if (remaining > 0 && availForPartial >= minPartialWidth) {
    return { visible, remaining: remaining - 1, partialWidth: availForPartial }
  }
  return { visible, remaining, partialWidth: null }
}
