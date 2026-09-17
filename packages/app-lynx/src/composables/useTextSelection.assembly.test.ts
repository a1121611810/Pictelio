// useTextSelection 装配层单测（code-review C8 缺口）：适配器装配 + 段落源变化收敛 + scope 释放。
//
// 手法：只 mock **引擎适配器**（唯一需要真机的能力），其余全走真实实现——真实深模块、
// 真实 Pinia store（modalStack / searchSheetStore）、真实 i18n。这样断言的正是装配行为本身：
// ① 选中事件 → 视图可见（适配器接上了）；② 段落源变化（切章/重载）→ 自动收起；
// ③ scope 释放 → 卸载后不再响应（onScopeDispose 生效）。
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const measureRange = vi.fn(async () => ({
  ok: true as const,
  rectVw: { left: 10, top: 20, width: 5, height: 3 },
}))

vi.mock('../utils/lynxSelectionEngine', () => ({
  createLynxSelectionEngine: () => ({
    measureRange: (...args: unknown[]) => measureRange(...(args as [])),
    clearRange: () => Promise.resolve(true),
  }),
}))

import { useTextSelection } from './useTextSelection'

const selectFirst = (api: { onSelectionChange: (e: never) => void }): void => {
  api.onSelectionChange({ target: { id: 'p-0' }, detail: { start: 0, end: 2 } } as never)
}

describe('useTextSelection 装配', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    measureRange.mockClear()
  })

  it('选中 → 可见（适配器已接）；段落源变化 → 收起；scope 释放 → 不再响应', async () => {
    const paragraphs = ref<readonly string[]>(['第一段文字', '第二段文字'])
    const scope = effectScope()
    const api = scope.run(() => useTextSelection({ paragraphs }))
    expect(api).toBeDefined()
    if (!api) return

    expect(api.rootId).toBe('novel-selection-root')
    expect(api.paragraphId(1)).toBe('p-1')

    selectFirst(api)
    await vi.waitFor(() => {
      expect(api.view.visible).toBe(true)
    })
    expect(measureRange).toHaveBeenCalledWith('p-0', { start: 0, end: 2 })

    // 切章 / 重载：段落源换新值 → 旧索引失效，必须自动收起
    paragraphs.value = ['换了一章的内容']
    await vi.waitFor(() => {
      expect(api.view.visible).toBe(false)
    })

    // scope 释放（页面卸载）：dispose 后事件不再产生可见视图
    selectFirst(api)
    await vi.waitFor(() => {
      expect(api.view.visible).toBe(true)
    })
    scope.stop()
    measureRange.mockClear()
    selectFirst(api)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(measureRange).not.toHaveBeenCalled() // dispose 后事件被丢弃（与视图无关的判据）
    expect(api.view.visible).toBe(false)
  })

  it('滚动与 tap 转发在隐藏态是空操作（不抛、不产生视图）', async () => {
    const paragraphs = ref<readonly string[]>(['第一段文字'])
    const scope = effectScope()
    const api = scope.run(() => useTextSelection({ paragraphs }))
    if (!api) return
    expect(() => {
      api.onScroll()
      api.onTapAway()
      api.notifyLongPress()
      api.copy()
      api.search()
    }).not.toThrow()
    expect(api.view.visible).toBe(false)
    scope.stop()
  })
})
