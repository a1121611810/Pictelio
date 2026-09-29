// Lynx 单端行为基准：标签静音真值表（ADR-0187 D2/D4 / #732），以 fixture 为 oracle
// 参数化断言 settingsStore.isTagMuted（真实实现）。
// 形态说明（ADR-0203 决策 5）：WebView 客户端删除后差分对侧消失，ADR-0187 D6「双端各自
// 实现 + 差分真值表互为镜像」已无成立对象，本文件只断言 Lynx 侧。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../../src/stores/settingsStore'
import { TAG_MUTE_TRUTH_TABLE } from './sharedTagMuteTruthTable'

// node 环境无 indexedDB，顶层 mock idbKV（settingsStore.test.ts 同款）
vi.mock('../../src/utils/idbKV', () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
  idbRemove: vi.fn(async () => {}),
}))

// 登录态注入（settingsStore.test.ts 同款）：muteTag 走账号级语义（未登录 no-op），
// 谓词铺集合必须经真实公开 API，故 mock useAuthStore 提供固定 uid。
const mockUser = ref<{ id: number } | null>({ id: 42 })
vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))

let store: ReturnType<typeof useSettingsStore>

beforeEach(() => {
  mockUser.value = { id: 42 }
  setActivePinia(createPinia())
  store = useSettingsStore()
})

describe('Lynx 单端行为基准：settingsStore.isTagMuted × 标签静音真值表（9 例，ADR-0187）', () => {
  it.each(TAG_MUTE_TRUTH_TABLE)(
    'muted=$muted, tags=$tags → muted=$expectedMuted',
    ({ muted: tableMuted, tags, expectedMuted }) => {
      // 集合经公开 API muteTag 逐个注入（trim/幂等语义由 settingsStore.test.ts 另测）
      for (const name of tableMuted) store.muteTag(name)
      expect(store.isTagMuted({ tags })).toBe(expectedMuted)
    },
  )
})
