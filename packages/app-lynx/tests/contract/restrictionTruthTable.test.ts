// Lynx 单端行为基准：isRestricted 12 例参数化测试，以真值表 fixture 为 oracle。
// 形态说明（ADR-0203 决策 5）：WebView 客户端删除后差分对侧消失，本文件只断言 Lynx 侧。
// fixture 为 Lynx 唯一事实源；期望值来源 = x_restrict 契约语义（0=全年龄 / 1=R-18 /
// 2=R-18G），独立 oracle。
// isRestricted 直接可测（settingsStore.test.ts 模式）：setShowR18/setShowR18G 注入开关态。
// Pinia 化（ADR-0139/T5）：从具名 import 改为 useSettingsStore()（setActivePinia 隔离）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../../src/stores/settingsStore'
import { RESTRICTION_TRUTH_TABLE } from './sharedRestrictionTruthTable'

// node 环境无 indexedDB，顶层 mock idbKV（既有 settingsStore.test.ts 同款）
vi.mock('../../src/utils/idbKV', () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
}))

let store: ReturnType<typeof useSettingsStore>

beforeEach(() => {
  setActivePinia(createPinia())
  store = useSettingsStore()
})

describe('Lynx 单端行为基准：settingsStore.isRestricted × 限制真值表（12 例）', () => {
  it.each(RESTRICTION_TRUTH_TABLE)(
    'x_restrict=$x_restrict, showR18=$showR18, showR18G=$showR18G → restricted=$expectedRestricted',
    ({ x_restrict, showR18: s18, showR18G: s18g, expectedRestricted }) => {
      store.setShowR18(s18)
      store.setShowR18G(s18g)
      expect(store.isRestricted({ x_restrict })).toBe(expectedRestricted)
    },
  )
})
