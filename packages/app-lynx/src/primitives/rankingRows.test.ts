// 排行榜静音行派生（ADR-0187 D4 / #732 / ADR-0158 保序精神）纯函数单测。
// 期望值 oracle = spec docs/specs/tag-mute.md 边界 5：「先赋名次（预过滤下标+1）后过滤，
// 移除留洞」——被静音移除条目的后续名次不前移，跨页名次不漂移。
import { describe, expect, it } from 'vitest'
import { assignRanksThenDropMuted } from './rankingRows'

interface Row {
  id: number
  tags?: { name: string }[]
}

describe('assignRanksThenDropMuted（排行榜名次保序）', () => {
  const isMuted = (item: Row) => (item.tags ?? []).some((t) => t.name === 'muted-tag')

  it('先赋名次后过滤：被移除条目留名次空洞，后续名次不前移', () => {
    const items: Row[] = [
      { id: 1 },
      { id: 2, tags: [{ name: 'muted-tag' }] }, // 第 2 名被移除
      { id: 3 },
      { id: 4, tags: [{ name: 'muted-tag' }] }, // 第 4 名被移除
      { id: 5 },
    ]
    expect(assignRanksThenDropMuted(items, isMuted)).toEqual([
      { item: { id: 1 }, rank: 1 },
      { item: { id: 3 }, rank: 3 },
      { item: { id: 5 }, rank: 5 },
    ])
  })

  it('首位/末位移除同样留洞；无命中时名次 = 下标 + 1 连续', () => {
    const items: Row[] = [
      { id: 1, tags: [{ name: 'muted-tag' }] },
      { id: 2 },
      { id: 3 },
      { id: 4, tags: [{ name: 'muted-tag' }] },
    ]
    expect(assignRanksThenDropMuted(items, isMuted)).toEqual([
      { item: { id: 2 }, rank: 2 },
      { item: { id: 3 }, rank: 3 },
    ])
    expect(assignRanksThenDropMuted([{ id: 9 }, { id: 10 }], isMuted)).toEqual([
      { item: { id: 9 }, rank: 1 },
      { item: { id: 10 }, rank: 2 },
    ])
  })

  it('全部被移除 → 空数组（页面三态空判定输入）', () => {
    const items: Row[] = [
      { id: 1, tags: [{ name: 'muted-tag' }] },
      { id: 2, tags: [{ name: 'muted-tag' }] },
    ]
    expect(assignRanksThenDropMuted(items, isMuted)).toEqual([])
  })

  it('空流 → 空数组（幂等无害）', () => {
    expect(assignRanksThenDropMuted([], isMuted)).toEqual([])
  })
})
