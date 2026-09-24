// ─── 小说导航缝隙行为单测（spec #711 缝隙 1 / ADR-0183 / 票 #713）───
// 只测外部行为：给定开关状态 → 导航到哪个路由。导航函数打桩（'../src/router'）、
// store 打桩注入两态（'../src/stores/settingsStore'，vi.hoisted 容器用例间翻转）。
// oracle：ADR-0183 D2——开 = `/novel/:id/intro`，关 = `/novel/:id`。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openNovel } from '../src/utils/novelNavigation'
import { navigate } from '../src/router'

// 两态可控：vi.mock factory 求值早于模块体，经 vi.hoisted 容器在用例间翻转
const state = vi.hoisted(() => ({ novelIntroFirst: true }))

vi.mock('../src/router', () => ({
  navigate: vi.fn(),
}))

vi.mock('../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({ novelIntroFirst: state.novelIntroFirst }),
}))

const navigateMock = vi.mocked(navigate)

describe('openNovel 导航缝隙双态（ADR-0183）', () => {
  beforeEach(() => {
    navigateMock.mockClear()
  })

  it('开关开（默认态）：navigate 到介绍页 /novel/5/intro（number id）', () => {
    state.novelIntroFirst = true
    openNovel(5)
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith('/novel/5/intro')
  })

  it('开关关：navigate 直达正文 /novel/5（number id）', () => {
    state.novelIntroFirst = false
    openNovel(5)
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith('/novel/5')
  })

  it('开关开：string id 同样进介绍页 /novel/5/intro', () => {
    state.novelIntroFirst = true
    openNovel('5')
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith('/novel/5/intro')
  })

  it('开关关：string id 同样直达正文 /novel/5', () => {
    state.novelIntroFirst = false
    openNovel('5')
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith('/novel/5')
  })
})
