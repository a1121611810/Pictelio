// 时钟字形单一事实源守卫（ADR-0112）：VS15（U+FE0E）缺失即回退彩色 emoji presentation，
// Lynx 原生渲染不受 CSS 变色控制——字形常量被改动时此处先行报警。
import { describe, expect, it } from 'vitest'
import { LATER_ICON } from './watchLaterGlyph'

describe('watchLaterGlyph（ADR-0112）', () => {
  it('LATER_ICON = ⏱ + VS15（U+FE0E 强制 text presentation）', () => {
    expect(LATER_ICON).toBe('\u23F1\uFE0E')
    expect(LATER_ICON.codePointAt(0)).toBe(0x23f1)
    expect(LATER_ICON.codePointAt(1)).toBe(0xfe0e)
    expect(LATER_ICON).toHaveLength(2)
  })
})
