// lynx 侧 resolveIllustTypeBadges × 共享 truth-table 差分测试（Ticket #215 / ADR-0113）。
// fixture 与 app 侧逐字节一致（illustTypeBadgeCasesConsistency.test.ts 守护），
// 期望值来源 = spec 决策 1 判定语义（独立 oracle）。两端同一 fixture → 输出语义等价即差分成立。
import { describe, expect, it } from 'vitest'
import { resolveIllustTypeBadges } from '../../src/components/illustTypeBadges'
import { ILLUST_TYPE_BADGE_CASES } from './sharedIllustTypeBadgeCases'

describe('resolveIllustTypeBadges × 共享 truth table（7 例差分 fixture）', () => {
  it.each(ILLUST_TYPE_BADGE_CASES)(
    'type=$type, page_count=$page_count → $expectedBadges',
    ({ type, page_count, expectedBadges }) => {
      expect(resolveIllustTypeBadges({ type, page_count })).toEqual(expectedBadges)
    },
  )
})
