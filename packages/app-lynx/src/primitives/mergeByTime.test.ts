// mergeByTime 时间交叉合并纯函数单测（T1，ticket: app-lynx-feed-pagination-buttons T1/T2）
// oracle = app 端 createTQFeedStore.ts L151-169：
//   sortByDate = [...items].sort((a,b) => b.create_date.localeCompare(a.create_date))（降序、稳定）
//   mergeAndSort = 稳定合并，a.create_date >= b.create_date 取 a（同分 = sources 顺序靠前者优先）
// 测试硬约束 3：create_date 缺失沉底 + console.warn（非静默降级）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeByTime } from './mergeByTime'

interface Item {
  id: number
  date?: string
}

function mk(id: number, date?: string): Item {
  return date === undefined ? { id } : { id, date }
}

const getDate = (i: Item) => i.date

describe('mergeByTime 时间交叉合并（oracle: app mergeAndSort）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('两路按 create_date 降序交叉合并', () => {
    const a = [mk(1, '2026-08-10'), mk(2, '2026-08-05')]
    const b = [mk(3, '2026-08-08'), mk(4, '2026-08-01')]
    expect(mergeByTime([a, b], getDate).map((i) => i.id)).toEqual([1, 3, 2, 4])
  })

  it('同分 tie-break = sources 顺序靠前者优先（app mergeAndSort 取 a）', () => {
    const a = [mk(1, '2026-08-10')]
    const b = [mk(2, '2026-08-10')]
    expect(mergeByTime([a, b], getDate).map((i) => i.id)).toEqual([1, 2])
    // 反序：sources 顺序变则优先权翻转
    expect(mergeByTime([b, a], getDate).map((i) => i.id)).toEqual([2, 1])
  })

  it('create_date 缺失沉底 + console.warn（非静默降级）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = [mk(1, '2026-08-10'), mk(2)] // 2 缺失日期
    const b = [mk(3, '2026-08-08')]
    expect(mergeByTime([a, b], getDate).map((i) => i.id)).toEqual([1, 3, 2])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('单路退化为降序稳定排序（同分保持服务端顺序）', () => {
    const a = [mk(1, '2026-08-01'), mk(2, '2026-08-10'), mk(3, '2026-08-05'), mk(4, '2026-08-01')]
    expect(mergeByTime([a], getDate).map((i) => i.id)).toEqual([2, 3, 1, 4])
  })

  it('空路 / 全空输入安全', () => {
    expect(mergeByTime([[], [mk(1, '2026-08-01')]], getDate).map((i) => i.id)).toEqual([1])
    expect(mergeByTime([], getDate)).toEqual([])
    expect(mergeByTime([[], []], getDate)).toEqual([])
  })
})
