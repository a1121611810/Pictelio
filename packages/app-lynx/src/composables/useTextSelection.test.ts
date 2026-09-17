// 搜索端口装配单测（spec docs/specs/app-lynx-novel-text-selection.md §ID 7）。
// oracle：searchSheetStore 源码语义——openSearch 幂等（已开则早退、关键词被吞，`searchSheetStore.ts:24`），
// closeSearch 会清 prefill；故端口必须先关再开（否则「搜索选中词」在弹层已开时静默丢词）。
import { describe, expect, it } from 'vitest'
import { createSelectionSearchPort, paragraphNodeId, paragraphTextFromId } from './useTextSelection'

function fakeStore(open = false) {
  const calls: string[] = []
  return {
    store: {
      isOpen: open,
      closeSearch: () => calls.push('close'),
      openSearch: (keyword: string) => calls.push('open:' + keyword),
    },
    calls,
  }
}

describe('createSelectionSearchPort', () => {
  it('弹层未开 → 直接打开并携带关键词（不多余关一次）', () => {
    const { store, calls } = fakeStore(false)
    createSelectionSearchPort(store).openWithKeyword('猫耳少女')
    expect(calls).toEqual(['open:猫耳少女'])
  })

  it('弹层已开 → 先关再开，关键词不丢（幂等吞词的收编点）', () => {
    const { store, calls } = fakeStore(true)
    createSelectionSearchPort(store).openWithKeyword('猫耳少女')
    expect(calls).toEqual(['close', 'open:猫耳少女'])
  })
})

describe('段落节点 id ⇄ 文本（索引即身份；review C2 回归锁）', () => {
  const paragraphs = ['第一段', '第二段', '第三段'] as const

  it('往返一致：编码的 id 能查回同一下标的文本', () => {
    paragraphs.forEach((text, index) => {
      expect(paragraphTextFromId(paragraphs, paragraphNodeId(index))).toBe(text)
    })
  })

  it('越界 / 非法 id / 非 p- 前缀 → null（调用方按缺失处理并 warn）', () => {
    expect(paragraphTextFromId(paragraphs, 'p-99')).toBeNull()
    expect(paragraphTextFromId(paragraphs, 'p-1x')).toBeNull()
    expect(paragraphTextFromId(paragraphs, 'meta')).toBeNull()
    expect(paragraphTextFromId(paragraphs, '')).toBeNull()
  })
})
