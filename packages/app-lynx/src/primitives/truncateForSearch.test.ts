// 搜索关键词截断单测（spec docs/specs/app-lynx-novel-text-selection.md §ID 7）。
// oracle：spec「取首个非空行 + 上限 30 字」；code point 截断（不劈开代理对）。
import { describe, expect, it } from 'vitest'
import { SEARCH_KEYWORD_MAX_CHARS, truncateForSearch } from './truncateForSearch'

describe('truncateForSearch', () => {
  it('单行 → 原样（去首尾空白）', () => {
    expect(truncateForSearch('  猫耳少女  ')).toBe('猫耳少女')
  })

  it('多行选区 → 只取首个非空行', () => {
    expect(truncateForSearch('\n\n第二行才是正文\n第三行')).toBe('第二行才是正文')
  })

  it('超长 → 截到 30 字（字面量交叉核对常量）', () => {
    expect(SEARCH_KEYWORD_MAX_CHARS).toBe(30)
    const long = '字'.repeat(50)
    expect(truncateForSearch(long)).toBe('字'.repeat(30))
    expect(truncateForSearch('字'.repeat(30))).toBe('字'.repeat(30))
  })

  it('按 code point 截断：不劈开代理对（emoji 不被切成半个）', () => {
    const text = '🌸'.repeat(40)
    const out = truncateForSearch(text)
    expect(Array.from(out)).toHaveLength(30)
    expect(out).toBe('🌸'.repeat(30))
    expect(out.includes('\uFFFD')).toBe(false)
  })

  it('空 / 纯空白 → 空串（调用方据此 warn 且不开弹层）', () => {
    expect(truncateForSearch('')).toBe('')
    expect(truncateForSearch('   \n  ')).toBe('')
  })
})
