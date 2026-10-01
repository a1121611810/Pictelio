import { describe, expect, it } from 'vitest'
import { LATER_ICON } from './watchLaterGlyph'
import { ICON_CODEPOINTS } from './iconMap'

describe('LATER_ICON（稍后看图标名单一事实源）', () => {
  // oracle：ADR-0083「稍后看」动作为闹钟语义 → Material Symbols `schedule`。
  // 码点本身由 tests/iconMap.test.ts 对官方 codepoints 文件双向核对，
  // 本文件只钉「这个名字被登记了」+「不是裸字形」。
  it('是已登记的 IconName（schedule），不是裸字形串', () => {
    expect(LATER_ICON).toBe('schedule')
    expect(ICON_CODEPOINTS).toHaveProperty('schedule')
  })

  it('不再是转义序列 / 裸字形（防回退到旧实现）', () => {
    // 旧实现是 '\u23F1\uFE0E'（⏱ + VS15），是个 2 码点的转义串。这里反证三件事：
    // 不是反斜杠转义写法、不是单字符字形、且确实是 iconMap 登记过的名字。
    expect(LATER_ICON).not.toMatch(/^\\u/i)
    expect(LATER_ICON).not.toMatch(/^[\u2000-\uFFFF]$/) // 非 BMP / 非符号区单字符
    expect(Object.keys(ICON_CODEPOINTS)).toContain(LATER_ICON)
  })
})
