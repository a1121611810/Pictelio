// lynx 侧 isRestricted 12 例参数化测试：以共享 truth-table fixture 为 oracle。
// fixture 与 app 侧逐字节一致（restrictionTruthTableConsistency.test.ts 守护），
// 期望值来源 = x_restrict 契约语义（0=全年龄 / 1=R-18 / 2=R-18G），独立 oracle。
// isRestricted 直接可测（settingsStore.test.ts 模式）：setShowR18/setShowR18G 注入开关态。
import { describe, expect, it, vi } from 'vitest'
import { isRestricted, setShowR18, setShowR18G } from '../../src/stores/settingsStore'
import { RESTRICTION_TRUTH_TABLE } from './sharedRestrictionTruthTable'

// node 环境无 indexedDB，顶层 mock idbKV（既有 settingsStore.test.ts 同款）
vi.mock('../../src/utils/idbKV', () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
}))

describe('settingsStore.isRestricted × 共享 truth table（12 例差分 fixture）', () => {
  it.each(RESTRICTION_TRUTH_TABLE)(
    'x_restrict=$x_restrict, showR18=$showR18, showR18G=$showR18G → restricted=$expectedRestricted',
    ({ x_restrict, showR18: s18, showR18G: s18g, expectedRestricted }) => {
      setShowR18(s18)
      setShowR18G(s18g)
      expect(isRestricted({ x_restrict })).toBe(expectedRestricted)
    },
  )
})
