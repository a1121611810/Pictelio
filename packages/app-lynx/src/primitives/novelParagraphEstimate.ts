/**
 * 正文段落高度估算（ADR-0134 / spec #314 T1）：为 `<list single>` 的
 * `estimated-main-axis-size-px` 提供「接近真实」的段落高度近似，减少滚动条修正抖动。
 *
 * 模型：每段高度 ≈ 行数 × 行高 + 段间距。行数 = ceil(字数 / 每行字数)，
 * 每行字数按「段宽 / 字符平均宽」估算；本库正文样式为 text-body-large + leading-44rpx，
 * 语义参数集中在此，避免散落魔法数（估算仅影响滚动条/布局预热，不影响正确性）。
 */

export const NOVEL_ESTIMATE = {
  /** 行高 px（@375 基准换算：leading-[44rpx]，1rpx=0.5px → 22px；随屏宽由 vw 体系缩放，估算取 375 基准） */
  lineHeightPx: 22,
  /** 每行最大字数（正文近似：CJK 为主、宽松取整） */
  charsPerLine: 22,
  /** 段间距 px（@375 基准：mb-4 = spacing 4 档 = 16px） */
  paragraphGapPx: 16,
} as const

/**
 * 估算单个段落的渲染高度（px）。空段/空输入返回最小高度（行高 + 间距），
 * 保证「零字」文字（空段）在列表中有占位，不产生 0 高条目。
 */
export function novelParagraphHeightPx(text: string): number {
  const chars = text.length
  const lines = Math.max(1, Math.ceil(chars / NOVEL_ESTIMATE.charsPerLine))
  return lines * NOVEL_ESTIMATE.lineHeightPx + NOVEL_ESTIMATE.paragraphGapPx
}

/**
 * 估算正文列表的平均段落高度（px）：列表级 estimated 取「中位段」口径
 * （对长文常见「少数超长段 + 多数短段」形态比均值更稳）。
 * 空列表回退到单段估算（防御）。
 */
export function novelAverageParagraphHeightPx(texts: readonly string[]): number {
  if (texts.length === 0) return novelParagraphHeightPx("")
  const heights = texts.map((t) => novelParagraphHeightPx(t)).sort((a, b) => a - b)
  const mid = Math.floor(heights.length / 2)
  return heights.length % 2 === 0 ? Math.round((heights[mid - 1] + heights[mid]) / 2) : heights[mid]
}
