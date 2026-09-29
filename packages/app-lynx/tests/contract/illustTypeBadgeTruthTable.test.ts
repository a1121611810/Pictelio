// Lynx 单端行为基准：resolveIllustTypeBadges × 类型角标真值表（Ticket #215 / ADR-0113）。
// 形态说明（ADR-0203 决策 5）：WebView 客户端删除后差分对侧消失，本文件只断言 Lynx 侧。
// fixture 为 Lynx 唯一事实源；期望值来源 = spec docs/specs/work-type-badges.md 决策 1 +
// ADR-0113 决策 2（独立 oracle），禁止从实现反推。
import { describe, expect, it } from 'vitest'
import { resolveIllustTypeBadges } from '../../src/components/illustTypeBadges'
import { ILLUST_TYPE_BADGE_CASES } from './sharedIllustTypeBadgeCases'

describe('Lynx 单端行为基准：resolveIllustTypeBadges × 类型角标真值表（7 例）', () => {
  it.each(ILLUST_TYPE_BADGE_CASES)(
    'type=$type, page_count=$page_count → $expectedBadges',
    ({ type, page_count, expectedBadges }) => {
      expect(resolveIllustTypeBadges({ type, page_count })).toEqual(expectedBadges)
    },
  )
})
