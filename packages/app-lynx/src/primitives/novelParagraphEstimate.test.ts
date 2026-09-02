import { describe, expect, it } from 'vitest'
import {
  NOVEL_ESTIMATE,
  novelAverageParagraphHeightPx,
  novelParagraphHeightPx,
} from './novelParagraphEstimate'

// oracle：NOVEL_ESTIMATE 模型公式（行数×行高+间距）+ 结构不变量（单调/空段占位）；
// 聚合测试独立重算（中位口径按实现重算——聚合逻辑属独立重算）；高度值按模型公式手算。
// 注：常量为精调项（ADR-0134 §实施注意），换算依据见 NOVEL_ESTIMATE 注释。

describe('novelParagraphHeightPx', () => {
  it('空段返回最小占位高度（1 行 + 间距）', () => {
    expect(novelParagraphHeightPx('')).toBe(NOVEL_ESTIMATE.lineHeightPx + NOVEL_ESTIMATE.paragraphGapPx)
  })

  it('满行与超行边界：<=charsPerLine 字 = 1 行', () => {
    const one = novelParagraphHeightPx('a'.repeat(NOVEL_ESTIMATE.charsPerLine))
    const two = novelParagraphHeightPx('a'.repeat(NOVEL_ESTIMATE.charsPerLine + 1))
    expect(two - one).toBe(NOVEL_ESTIMATE.lineHeightPx)
  })

  it('高度随字数单调不减', () => {
    const h1 = novelParagraphHeightPx('短')
    const h2 = novelParagraphHeightPx('这是一个中等长度的段落，用于验证单调性是否成立。')
    const h3 = novelParagraphHeightPx('超'.repeat(NOVEL_ESTIMATE.charsPerLine * 3))
    expect(h1).toBeLessThanOrEqual(h2)
    expect(h2).toBeLessThanOrEqual(h3)
  })
})

describe('novelAverageParagraphHeightPx', () => {
  it('空列表回退单段最小占位', () => {
    expect(novelAverageParagraphHeightPx([])).toBe(novelParagraphHeightPx(''))
  })

  it('偶数长度取中两位平均', () => {
    const texts = ['短', '中长文本'.repeat(3), '很长的'.repeat(NOVEL_ESTIMATE.charsPerLine * 2), '又一个长段'.repeat(10)]
    const h = texts.map((t) => novelParagraphHeightPx(t)).sort((a, b) => a - b)
    expect(novelAverageParagraphHeightPx(texts)).toBe(Math.round((h[1] + h[2]) / 2))
  })

  it('奇数长度取中位', () => {
    const texts = ['第一段', '第二段第二段第二段'.repeat(3), '第三段第三段第三段第三段第三段'.repeat(5)]
    const h = texts.map((t) => novelParagraphHeightPx(t)).sort((a, b) => a - b)
    expect(novelAverageParagraphHeightPx(texts)).toBe(h[Math.floor(h.length / 2)])
  })
})
