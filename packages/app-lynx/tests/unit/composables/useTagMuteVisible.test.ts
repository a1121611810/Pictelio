// useTagMuteVisible 组装接缝单测（ADR-0187 D4 / #732）。
// 该 composable 是 IllustList / NovelList / Bookmarks / Following / UserHome 五个页面
// 七个列表组装点的共享过滤缝（useAiOnlyVisible 链式后置）；Recommended/SearchSheet 同谓词内联。
// 期望值 oracle = spec docs/specs/tag-mute.md 边界 1（空 tags/undefined 放行）+ ADR-0187 D2
// （trim 后精确相等）+ 边界 4（已渲染列表不回溯移除 → isTagMuted 快照契约，ADR-0162 结构规避）。
// 真实 settingsStore（真实谓词）+ 登录态 mock。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTagMuteVisible } from '../../../src/composables/useTagMuteVisible'
import { useSettingsStore } from '../../../src/stores/settingsStore'

vi.mock('../../../src/utils/idbKV', () => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(async () => {}),
  idbRemove: vi.fn(async () => {}),
}))

const mockUser = ref<{ id: number } | null>({ id: 42 })
vi.mock('../../../src/stores/authStore', () => ({
  useAuthStore: () => ({
    get currentUser() {
      return mockUser.value
    },
  }),
}))

interface Item {
  id: number
  tags?: { name: string }[] | null
}

describe('useTagMuteVisible（列表组装点静音过滤缝）', () => {
  let settings: ReturnType<typeof useSettingsStore>

  beforeEach(() => {
    mockUser.value = { id: 42 }
    setActivePinia(createPinia())
    settings = useSettingsStore()
  })

  it('命中条目移除、未命中/空 tags/undefined 放行；默认元素自身取标签', () => {
    settings.muteTag('R-18G')
    const items = ref<Item[]>([
      { id: 1, tags: [{ name: '風景' }] },
      { id: 2, tags: [{ name: '  R-18G  ' }] }, // trim 命中
      { id: 3, tags: [] },
      { id: 4 }, // undefined tags
    ])
    expect(useTagMuteVisible(items).value.map((i) => i.id)).toEqual([1, 3, 4])
  })

  it('toItem 提取器：包装条目（MixFeedItem.data 形态）取内层作品', () => {
    settings.muteTag('グロ')
    const items = ref([{ key: 'a', data: { id: 1, tags: [{ name: 'グロ' }] } as Item }])
    expect(
      useTagMuteVisible(items, (it) => it.data).value,
    ).toEqual([])
  })

  it('快照契约：集合变化不收缩已组装可见集；列表数据替换（重新组装）后按新集合过滤', () => {
    const items = ref<Item[]>([
      { id: 1, tags: [{ name: '風景' }] },
      { id: 2, tags: [{ name: 'R-18G' }] },
    ])
    // 模拟 useAiOnlyVisible 的返回（ComputedRef）作为输入
    const aiVisible = computed(() => items.value.filter((i) => i.id !== 99))
    const visible = useTagMuteVisible(aiVisible)
    expect(visible.value.map((i) => i.id)).toEqual([1, 2])
    // 长按静音：集合变化但列表数据未重新组装 → 已组装可见集不变
    // （spec docs/specs/tag-mute.md 边界 4「已渲染列表不回溯移除」；ADR-0162 原生 <list>
    // 中途移除 list-item = 留空位风险 → isTagMuted 只读非响应式快照，computed 不因集合重算）
    settings.muteTag('R-18G')
    expect(visible.value.map((i) => i.id)).toEqual([1, 2])
    // 模拟刷新/分页重新组装（替换列表数据引用）→ 按新集合过滤
    items.value = [
      { id: 1, tags: [{ name: '風景' }] },
      { id: 2, tags: [{ name: 'R-18G' }] },
      { id: 3, tags: [{ name: 'グロ' }] },
    ]
    expect(visible.value.map((i) => i.id)).toEqual([1, 3])
  })
})
