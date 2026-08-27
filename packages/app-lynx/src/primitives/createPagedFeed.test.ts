// createPagedFeed 页式缓存分页深模块单测（T1，ticket: app-lynx-feed-pagination-buttons T1）
// oracle = spec docs/specs/app-lynx-feed-pagination-buttons.md §3.1.1（缓存窗口不变式/切页事务/
// 防重入/竞态/缓存淘汰）+ §4 单测矩阵 + Pixiv next_url offset 分页语义。
// 注：spec §4「竞态：快速 next×2 旧响应作废」与 §3.1.1「在飞时 next/prev/refresh 全部 no-op」矛盾，
// 按 §3.1.1 审阅补充实现：翻页在飞时重复 next/prev 为 no-op（防重入）；refresh 例外（打断型，generation 作废在途）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPagedFeed, type PagedFeedSource } from './createPagedFeed'
import type { MixFeedItem } from './createMixFeed'

function mkItem(kind: 'illust' | 'novel', id: number, date: string): MixFeedItem {
  const prefix = kind === 'illust' ? 'i' : 'n'
  const data = { id, create_date: date } as unknown as MixFeedItem['data']
  return { kind, key: `${prefix}-${id}`, id, data } as MixFeedItem
}

/** 分页源返回的一页（id = 本页标识；nextUrl = 指向下一页的游标，null = 耗尽） */
interface Page {
  id: string
  items: MixFeedItem[]
  nextUrl: string | null
}

/**
 * 构造按游标推进的分页源：fetchPage(undefined) → pages[0]；fetchPage(cursor) → id === cursor 的页。
 * 第 1 页 nextUrl 应指向下一页的 id（如 'p2'）；末页 nextUrl 为 null。
 */
function makeSource(name: string, pages: Page[]) {
  const fn = vi.fn(async (_signal?: AbortSignal, nextUrl?: string | null): Promise<{ items: MixFeedItem[]; nextUrl: string | null }> => {
    if (nextUrl == null) {
      const first = pages[0]
      return { items: first.items, nextUrl: first.nextUrl }
    }
    const found = pages.find((p) => p.id === nextUrl)
    if (!found) throw new Error(`unexpected nextUrl: ${nextUrl}`)
    return { items: found.items, nextUrl: found.nextUrl }
  })
  return { source: { name, fetchPage: fn } as PagedFeedSource, fn }
}

describe('createPagedFeed 页式缓存分页（spec §3.1.1 / §4）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refresh 首载：两路各一页按时间交叉合并，pageIndex=0、hasPrev=false、hasNext=有游标', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10'), mkItem('illust', 2, '2026-08-05')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-08'), mkItem('novel', 11, '2026-08-01')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })

    await feed.refresh()
    // 降序交叉：i1(08-10) > n10(08-08) > i2(08-05) > n11(08-01)
    expect(feed.items().map((i) => i.id)).toEqual([1, 10, 2, 11])
    expect(feed.pageIndex()).toBe(0)
    expect(feed.hasPrev()).toBe(false)
    expect(feed.hasNext()).toBe(true) // 两路均有游标
    expect(feed.error()).toBeNull()
  })

  it('next：两路各拉下一页（游标正确传递）→ 时间合并 → 新页替换、pageIndex 递增、hasPrev=true', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-08')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh()

    await feed.next()
    // next 调用收到各自上一页返回的游标（p2/n2）
    expect(illust.fn).toHaveBeenLastCalledWith(expect.anything(), 'p2')
    expect(novel.fn).toHaveBeenLastCalledWith(expect.anything(), 'n2')
    expect(feed.items().map((i) => i.id)).toEqual([3, 12]) // 08-03 > 07-30
    expect(feed.pageIndex()).toBe(1)
    expect(feed.hasPrev()).toBe(true)
  })

  it('prev：切回缓存页不重新请求（fetchPage 调用不增），items 恢复上一页', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-08')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh()

    await feed.next()
    const callsAfterNext = illust.fn.mock.calls.length + novel.fn.mock.calls.length
    await feed.prev()
    expect(feed.pageIndex()).toBe(0)
    expect(feed.items().map((i) => i.id)).toEqual([1, 10])
    // prev 纯缓存切换：请求数不增（next 拉了 illust+novel 两路）
    expect(illust.fn.mock.calls.length + novel.fn.mock.calls.length).toBe(callsAfterNext)
  })

  it('prev 到第 1 页后 hasPrev=false；next 后 hasPrev=true（派生自缓存）', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: null }, // 首载即耗尽
      { id: 'n2', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh()

    await feed.next()
    expect(feed.hasPrev()).toBe(true)
    await feed.prev()
    expect(feed.hasPrev()).toBe(false)
    expect(feed.hasNext()).toBe(true) // 第 2 页在缓存
  })

  it('单路耗尽仍可翻：next 只拉非耗尽源（fetchPage 调用数 = 非耗尽源数），耗尽源新页记为 null', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-08')], nextUrl: null }, // 首载即耗尽
      { id: 'n2', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh()
    expect(feed.hasNext()).toBe(true) // illust 有游标

    await feed.next()
    expect(illust.fn).toHaveBeenCalledTimes(2) // 首载 + next
    expect(novel.fn).toHaveBeenCalledTimes(1) // 耗尽源不拉
    expect(feed.items().map((i) => i.id)).toEqual([3])
  })

  it('两路耗尽后 hasNext=false（footer「没有更多了」依据）', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh()
    await feed.next()
    expect(feed.hasNext()).toBe(false)
  })

  it('防重入：next 在飞时重复 next/prev 为 no-op（fetchPage 调用不增），在飞响应正常提交', async () => {
    let resolveNext!: (r: { items: MixFeedItem[]; nextUrl: string | null }) => void
    const fnA = vi.fn()
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' }))
      .mockImplementationOnce(() => new Promise<{ items: MixFeedItem[]; nextUrl: string | null }>((res) => { resolveNext = res }))
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null }))
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: null },
      { id: 'n2', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [{ name: 'illust', fetchPage: fnA }, novel.source] })
    await feed.refresh()
    expect(fnA).toHaveBeenCalledTimes(1)

    const p = feed.next()
    feed.next() // 在飞 → no-op
    await feed.prev() // 在飞 → no-op
    expect(fnA).toHaveBeenCalledTimes(2) // 仅第一次 next

    resolveNext({ items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null })
    await p
    expect(feed.items().map((i) => i.id)).toEqual([3])
    expect(feed.pageIndex()).toBe(1)
  })

  it('切页期间 refresh：generation 作废在途翻页响应，缓存清空回第 1 页', async () => {
    let resolveNext!: (r: { items: MixFeedItem[]; nextUrl: string | null }) => void
    const fnA = vi.fn()
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' }))
      .mockImplementationOnce(() => new Promise<{ items: MixFeedItem[]; nextUrl: string | null }>((res) => { resolveNext = res }))
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 9, '2026-08-09')], nextUrl: null }))
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: null },
      { id: 'n2', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [{ name: 'illust', fetchPage: fnA }, novel.source] })
    await feed.refresh()

    const p = feed.next() // 挂起
    await feed.refresh() // 打断：generation++，拉第 1 页
    resolveNext({ items: [mkItem('illust', 99, '2026-08-11')], nextUrl: 'p9' }) // 旧 next 响应落地
    await p

    expect(feed.pageIndex()).toBe(0)
    expect(feed.items().map((i) => i.id)).toEqual([9, 10]) // 旧响应被丢弃，refresh 结果生效（两路第 1 页）
  })

  it('翻页失败（一路 reject）→ 不提交：当前页保留、pageIndex 不变、error 置文案 + warn；重试成功提交并清 error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fnA = vi.fn()
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' }))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null })
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [{ name: 'illust', fetchPage: fnA }, novel.source] })
    await feed.refresh()

    await feed.next()
    expect(feed.pageIndex()).toBe(0) // 未提交
    expect(feed.items().map((i) => i.id)).toEqual([1, 10]) // 当前页保留
    expect(feed.error()).toBeTruthy()
    expect(warn).toHaveBeenCalled()

    await feed.next() // 重试成功
    expect(feed.pageIndex()).toBe(1)
    expect(feed.items().map((i) => i.id)).toEqual([3, 12])
    expect(feed.error()).toBeNull()
  })

  it('空 items + 非空 nextUrl = 该源按失败处理（warn + 不提交，防空页死循环）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fnA = vi.fn()
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' }))
      .mockResolvedValueOnce({ items: [], nextUrl: 'p3' }) // 空页但带游标
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [{ name: 'illust', fetchPage: fnA }, novel.source] })
    await feed.refresh()

    await feed.next()
    expect(feed.pageIndex()).toBe(0)
    expect(feed.items().map((i) => i.id)).toEqual([1, 10])
    expect(feed.error()).toBeTruthy()
    expect(warn).toHaveBeenCalled()
  })

  it('缓存上限淘汰：超 maxCachedPages 淘汰远端、当前页保留、currentIndex 平移后 prev/next 仍正确', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 2, '2026-08-09')], nextUrl: 'p3' },
      { id: 'p3', items: [mkItem('illust', 3, '2026-08-08')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: null },
      { id: 'n2', items: [], nextUrl: null },
      { id: 'n3', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source], maxCachedPages: 2 })
    await feed.refresh() // 页 0
    await feed.next() // 页 1（缓存 0,1）
    await feed.next() // 页 2（超限 → 淘汰页 0，缓存 1,2）

    expect(feed.pageIndex()).toBe(1) // 淘汰后平移
    expect(feed.items().map((i) => i.id)).toEqual([3]) // 当前 = 原页 2
    await feed.prev() // → 原页 1（仍可回退一步）
    expect(feed.pageIndex()).toBe(0)
    expect(feed.items().map((i) => i.id)).toEqual([2])
    expect(feed.hasPrev()).toBe(false) // 页 0 已被淘汰，不可再回退
  })

  it('refresh 清缓存回第 1 页：fetchPage 收到 undefined（第一页）、pageIndex=0、hasPrev=false', async () => {
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-08')], nextUrl: null },
      { id: 'n2', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh()
    await feed.next()

    await feed.refresh()
    expect(feed.pageIndex()).toBe(0)
    expect(feed.hasPrev()).toBe(false)
    expect(feed.items().map((i) => i.id)).toEqual([1, 10])
    expect(illust.fn).toHaveBeenLastCalledWith(expect.anything(), undefined) // 第一页
  })

  it('refresh 失败保留当前页与缓存，error 置文案可重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fnA = vi.fn()
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' })) // ① refresh 首载
      .mockResolvedValueOnce({ items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null }) // ② next 成功
      .mockRejectedValueOnce(new Error('refresh fail')) // ③ refresh 失败
      .mockResolvedValueOnce({ items: [mkItem('illust', 9, '2026-08-09')], nextUrl: null }) // ④ refresh 重试成功
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [{ name: 'illust', fetchPage: fnA }, novel.source] })
    await feed.refresh()
    await feed.next() // 页 1（缓存 0,1）

    await feed.refresh() // 失败
    expect(feed.pageIndex()).toBe(1) // 保留
    expect(feed.items().map((i) => i.id)).toEqual([3, 12])
    expect(feed.error()).toBeTruthy()
    expect(warn).toHaveBeenCalled()

    await feed.refresh() // 重试成功 → 回第 1 页
    expect(feed.pageIndex()).toBe(0)
    expect(feed.items().map((i) => i.id)).toEqual([9, 10])
    expect(feed.error()).toBeNull()
  })

  it('dispose：作废在途响应，落地不提交、无孤儿请求', async () => {
    let resolveNext!: (r: { items: MixFeedItem[]; nextUrl: string | null }) => void
    const fnA = vi.fn()
      .mockImplementationOnce(async () => ({ items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' }))
      .mockImplementationOnce(() => new Promise<{ items: MixFeedItem[]; nextUrl: string | null }>((res) => { resolveNext = res }))
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-01')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [{ name: 'illust', fetchPage: fnA }, novel.source] })
    await feed.refresh()

    const p = feed.next() // 挂起
    feed.dispose()
    resolveNext({ items: [mkItem('illust', 99, '2026-08-11')], nextUrl: null })
    await p
    expect(feed.pageIndex()).toBe(0) // 不提交
    expect(feed.items().map((i) => i.id)).toEqual([1, 10])
  })

  it('页内去重：两源同 key 只留一条；跨页不去重（缓存一致性，prev 切回内容不变）', async () => {
    // 两路都返回 illust 同 key（接口允许任意多路）；页 2 含页 1 已有 key（i-1 跨页再现）
    const a = makeSource('a', [
      { id: 'a1', items: [mkItem('illust', 1, '2026-08-10'), mkItem('illust', 2, '2026-08-05')], nextUrl: 'a2' },
      { id: 'a2', items: [mkItem('illust', 1, '2026-08-11'), mkItem('illust', 5, '2026-08-02')], nextUrl: null },
    ])
    const b = makeSource('b', [
      { id: 'b1', items: [mkItem('illust', 2, '2026-08-08'), mkItem('illust', 3, '2026-08-01')], nextUrl: null },
      { id: 'b2', items: [], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [a.source, b.source] })
    await feed.refresh()
    // i-2 跨源重复 → 页内只留一条；合并按时间：i1(08-10) i2(08-08) i3(08-01)
    expect(feed.items().map((i) => i.id)).toEqual([1, 2, 3])

    await feed.next()
    // 页 2 = [1, 5]：i-1 跨页再现但保留（跨页不去重——全局去重会使 prev 切回内容不一致）
    expect(feed.items().map((i) => i.id)).toEqual([1, 5])
    // prev 切回缓存页：内容与首次第 1 页一致（缓存一致性）
    await feed.prev()
    expect(feed.items().map((i) => i.id)).toEqual([1, 2, 3])
  })

  it('prev 后 next 缓存命中（往返一致）：1→2→1→2，items 与首次第 2 页一致且请求数不增', async () => {
    // oracle：spec §4「prev 后 next 缓存命中（往返一致）」+ §5「上一页/下一页往返正确」——
    // 翻回后再翻前不得重新请求，且内容与首次一致（缓存一致性）
    const illust = makeSource('illust', [
      { id: 'p1', items: [mkItem('illust', 1, '2026-08-10')], nextUrl: 'p2' },
      { id: 'p2', items: [mkItem('illust', 3, '2026-08-03')], nextUrl: null },
    ])
    const novel = makeSource('novel', [
      { id: 'n1', items: [mkItem('novel', 10, '2026-08-08')], nextUrl: 'n2' },
      { id: 'n2', items: [mkItem('novel', 12, '2026-07-30')], nextUrl: null },
    ])
    const feed = createPagedFeed({ sources: [illust.source, novel.source] })
    await feed.refresh() // 页 0

    await feed.next() // 页 1（拉两路下一页）
    const page2Items = feed.items().map((i) => i.id)
    expect(page2Items).toEqual([3, 12])
    const callsAfterNext = illust.fn.mock.calls.length + novel.fn.mock.calls.length

    await feed.prev() // 回页 0（纯缓存）
    await feed.next() // 缓存命中分支：直接切回页 1，不请求
    expect(feed.pageIndex()).toBe(1)
    expect(feed.items().map((i) => i.id)).toEqual(page2Items) // 往返一致
    expect(illust.fn.mock.calls.length + novel.fn.mock.calls.length).toBe(callsAfterNext) // 零新请求
  })
})
