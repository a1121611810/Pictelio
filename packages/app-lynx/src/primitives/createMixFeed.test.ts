// createMixFeed 单测（混合分页 feed 深模块）。
// 全部为接口级测试，fake 源：手写可控 fetchPage（预设 items/nextUrl 序列，可注入延迟/失败）。
// vi.useFakeTimers 控制双防抖 / 超时时序；异步链用 flush() 推进微任务。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PixivIllust, PixivNovel } from '../api/types'
import { createMixFeed, type MixFeedItem, type MixFeedSource } from './createMixFeed'

/** fake 源一页返回形状 */
type Page = { items: MixFeedItem[]; nextUrl: string | null }

afterEach(() => {
  vi.useRealTimers()
})

// ─── fake 数据构造 ───

function mkUser(id: number) {
  return { id, name: 'user', account: 'user', profile_image_urls: {} }
}

function mkIllust(key: string, id: number): MixFeedItem {
  return {
    kind: 'illust',
    key,
    id,
    data: {
      id,
      title: `illust-${key}`,
      type: 'illust',
      user: mkUser(id),
      image_urls: { square_medium: '', medium: '', large: '' },
      width: 1,
      height: 1,
      page_count: 1,
      is_bookmarked: false,
      total_bookmarks: 0,
      tags: [],
      x_restrict: 0,
      create_date: '',
      meta_pages: [],
      meta_single_page: {},
    } as PixivIllust,
  }
}

function mkNovel(key: string, id: number): MixFeedItem {
  return {
    kind: 'novel',
    key,
    id,
    data: {
      id,
      title: `novel-${key}`,
      user: mkUser(id),
      image_urls: { square_medium: '', medium: '', large: '' },
      tags: [],
      page_count: 1,
      text_length: 100,
      is_bookmarked: false,
      total_bookmarks: 0,
      x_restrict: 0,
      create_date: '',
    } as PixivNovel,
  }
}

/** 推进微任务队列，让 fetchPage → withTimeout → Promise.all 的整条异步链跑完 */
async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

/** 常用 fake 源构造：sources 参数可直接塞进 createMixFeed */
function source(name: string, fetchPage: MixFeedSource['fetchPage']): MixFeedSource {
  return { name, fetchPage }
}

// ─── 测试 ───

describe('createMixFeed', () => {
  it('首载并行：两个源都被调用，loading 从 true 流转到 false', async () => {
    let resolveA!: (v: Page) => void
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(
      (_s?: AbortSignal) => new Promise<Page>((res) => (resolveA = res)),
    )
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkNovel('b1', 1)], nextUrl: null }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      throttleMs: 0,
      cooldownMs: 0,
    })
    // createMixFeed 构造即同步发起首载（Promise.all 并行）：两个 fetchPage 都已被调用
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).toHaveBeenCalledTimes(1)
    expect(feed.loading()).toBe(true)

    resolveA({ items: [mkIllust('a1', 10)], nextUrl: null })
    await flush()
    expect(feed.loading()).toBe(false)
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1'])
  })

  it('交替合并：默认 ratio 4:1（每 4 条 illust 插 1 条 novel）', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('a1', 1), mkIllust('a2', 2), mkIllust('a3', 3), mkIllust('a4', 4), mkIllust('a5', 5)],
      nextUrl: null,
    }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkNovel('b1', 10), mkNovel('b2', 11)],
      nextUrl: null,
    }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'a2', 'a3', 'a4', 'b1', 'a5', 'b2'])
    expect(feed.items().map((i) => i.kind)).toEqual([
      'illust', 'illust', 'illust', 'illust', 'novel', 'illust', 'novel',
    ])
  })

  it('分批渲染上限 pageSize + fetchMore 优先消费内部队列（不触发网络）', async () => {
    const aItems = Array.from({ length: 30 }, (_, i) => mkIllust(`a${i + 1}`, i + 1))
    const bItems = Array.from({ length: 10 }, (_, i) => mkNovel(`b${i + 1}`, 100 + i))
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: aItems, nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: bItems, nextUrl: null }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 10,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // 首载只暴露前 pageSize=10 条，其余进内部队列
    expect(feed.items()).toHaveLength(10)

    // fetchMore 优先同步消费内部队列：追加 10 条，无网络请求
    await feed.fetchMore()
    await flush()
    expect(feed.items()).toHaveLength(20)
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).toHaveBeenCalledTimes(1)

    await feed.fetchMore()
    await flush()
    expect(feed.items()).toHaveLength(30)
    expect(fetchA).toHaveBeenCalledTimes(1)
  })

  it('loading / loadingMore 状态流转', async () => {
    let resolveA2!: (v: Page) => void
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkIllust('a1', 1)], nextUrl: 'A2' }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    expect(feed.loading()).toBe(true)
    expect(feed.loadingMore()).toBe(false)
    await flush()
    expect(feed.loading()).toBe(false)

    // 翻页（deferred）：fetchMore 同步进入 loadingMore，直到响应返回
    fetchA.mockImplementationOnce(
      () => new Promise<Page>((res) => (resolveA2 = res)),
    )
    void feed.fetchMore()
    await flush()
    expect(feed.loadingMore()).toBe(true)

    resolveA2({ items: [mkIllust('a2', 2)], nextUrl: null })
    await flush()
    expect(feed.loadingMore()).toBe(false)
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'a2'])
  })

  it('按 key 去重：跨源重复 key 丢弃（先出现的保留）', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('shared', 1), mkIllust('a2', 2)],
      nextUrl: null,
    }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkNovel('shared', 10), mkNovel('b2', 11)],
      nextUrl: null,
    }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // 'shared' 由 illust 源先入队，novel 源的重复 key 被丢弃
    expect(feed.items().map((i) => i.key)).toEqual(['shared', 'a2', 'b2'])
    expect(feed.items().filter((i) => i.key === 'shared')).toHaveLength(1)
  })

  it('一源耗尽：降级纯另一源翻页；全部耗尽后 fetchMore no-op', async () => {
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkIllust('a1', 1)], nextUrl: null })) // A 首载即耗尽
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      return { items: [mkNovel(`b${page}`, page)], nextUrl: page < 2 ? `B${page}` : null }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.nextUrl()).toBe('B1')

    // 只翻 B（A 已耗尽）
    await feed.fetchMore()
    await flush()
    expect(fetchB).toHaveBeenCalledTimes(2)
    expect(fetchA).toHaveBeenCalledTimes(1)

    // B 也耗尽 → nextUrl null，fetchMore no-op（不再触发任何源）
    await feed.fetchMore()
    await flush()
    expect(feed.nextUrl()).toBeNull()
    expect(fetchB).toHaveBeenCalledTimes(2)
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1', 'b2'])
  })

  it('翻页优先级：缺哪种类型先补哪种（novel 占比不足优先翻 novel 源）', async () => {
    const aItems = Array.from({ length: 20 }, (_, i) => mkIllust(`a${i + 1}`, i + 1))
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: aItems, nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkNovel('b1', 1)], nextUrl: 'B2' }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 21,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // 渲染窗口 21 条：20 illust + 1 novel → novel 占比明显低于 ratio 目标（1/5）
    expect(feed.items()).toHaveLength(21)

    await feed.fetchMore()
    await flush()
    expect(fetchB).toHaveBeenCalledTimes(2) // 缺 novel → 优先翻 B
    expect(fetchA).toHaveBeenCalledTimes(1)
  })

  it('refresh 竞态：在途旧 fetchMore 响应被丢弃，最终 items 是 refresh 后的', async () => {
    let resolveA2!: (v: Page) => void
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('a1', 1), mkIllust('a2', 2), mkIllust('a3', 3), mkIllust('a4', 4)],
      nextUrl: 'A2',
    }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkNovel('b1', 10)], nextUrl: 'B2' }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'a2', 'a3', 'a4', 'b1'])

    // fetchMore 翻页（deferred，pending 空时候选 A/B 比例均衡取首个 = A）
    fetchA.mockImplementationOnce(() => new Promise<Page>((res) => (resolveA2 = res)))
    void feed.fetchMore()
    await flush()
    expect(feed.loadingMore()).toBe(true)

    // refresh：立即返回全新数据，generation++
    fetchA.mockImplementationOnce(async () => ({ items: [mkIllust('a1r', 101)], nextUrl: null }))
    fetchB.mockImplementationOnce(async () => ({ items: [mkNovel('b1r', 110)], nextUrl: null }))
    await feed.refresh()
    await flush()
    expect(feed.items().map((i) => i.key)).toEqual(['a1r', 'b1r'])

    // 旧 fetchMore 响应迟到：generation 已变 → 丢弃，不影响 refresh 后的数据
    resolveA2({ items: [mkIllust('stale', 999)], nextUrl: null })
    await flush()
    expect(feed.items().map((i) => i.key)).toEqual(['a1r', 'b1r'])
    expect(feed.loadingMore()).toBe(false)
  })

  it('throttle：节流窗口内第二次 fetchMore 被跳过，窗口结束自动补发（T1 重试）', async () => {
    vi.useFakeTimers()
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      return { items: [mkIllust(`a${page}`, page)], nextUrl: `p${page}` }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 800,
      cooldownMs: 0,
    })
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(1)

    // 第一次 fetchMore：翻页（触发网络）
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2)

    // 节流窗口内（时钟未推进）：第二次被跳过，不立即触发网络
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2)

    // 窗口结束：挂起的补触发自动执行（无需再次 fetchMore）
    await vi.advanceTimersByTimeAsync(800)
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(3)
  })

  it('cooldown：首载完成后的冷却窗口内 fetchMore 被跳过，窗口结束自动补发（T1 重试）', async () => {
    vi.useFakeTimers()
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      return { items: [mkIllust(`a${page}`, page)], nextUrl: `p${page}` }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 3000,
    })
    await flush()
    expect(feed.items()).toHaveLength(1)

    // 冷却窗口内：fetchMore 被跳过（不立即触发网络）
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(1)

    // 窗口结束：自动补发一次（无需再次 fetchMore）
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2)
  })

  it('T1 重试：冷却吞事件且有待渲染内容 → 窗口结束自动补触发一次，补发后调用 onUpdate（P1 页面快照契约）', async () => {
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('a1', 1), mkIllust('a2', 2), mkIllust('a3', 3)],
      nextUrl: 'p1',
    }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 2,
      cooldownMs: 3000,
      throttleMs: 0,
      onUpdate,
    })
    await flush()
    expect(feed.items()).toHaveLength(2) // pageSize 分批：rendered=2, pending=1

    // 冷却窗口内吞掉 → items 不变、不触发 onUpdate（页面直接调用路径由页面自己 sync）
    await feed.fetchMore()
    await flush()
    expect(feed.items()).toHaveLength(2)
    expect(onUpdate).not.toHaveBeenCalled()

    // 窗口结束自动补触发 → 消费 pending（同步路径，无网络请求）→ 通知页面重新快照
    await vi.advanceTimersByTimeAsync(3001)
    await flush()
    expect(feed.items()).toHaveLength(3)
    expect(fetchA).toHaveBeenCalledTimes(1) // 仅首载
    expect(onUpdate).toHaveBeenCalledTimes(1) // P1：重试路径页面无感知，必须回调
  })

  it('T1 重试：吞事件时全耗尽 → 不注册定时器', async () => {
    vi.useFakeTimers()
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('a1', 1)],
      nextUrl: null,
    }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 2,
      cooldownMs: 3000,
      throttleMs: 0,
    })
    await flush()
    expect(feed.items()).toHaveLength(1)

    await feed.fetchMore() // 耗尽 no-op
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('T1 重试：连续吞事件不叠加重试（最多一个挂起定时器）', async () => {
    vi.useFakeTimers()
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('a1', 1), mkIllust('a2', 2), mkIllust('a3', 3)],
      nextUrl: 'p1',
    }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 2,
      cooldownMs: 3000,
      throttleMs: 0,
    })
    await flush()

    await feed.fetchMore()
    await feed.fetchMore()
    await feed.fetchMore()
    await flush()
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(3001)
    await flush()
    expect(feed.items()).toHaveLength(3)
  })

  it('T1 重试：一次性不自我续期（消费后无幽灵级联/无额外网络请求）', async () => {
    vi.useFakeTimers()
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: [mkIllust('a1', 1), mkIllust('a2', 2), mkIllust('a3', 3), mkIllust('a4', 4), mkIllust('a5', 5)],
      nextUrl: 'p1',
    }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 2,
      cooldownMs: 3000,
      throttleMs: 0,
    })
    await flush()
    expect(feed.items()).toHaveLength(2) // pending=3

    await feed.fetchMore() // 吞 → 挂起 t=3000
    await flush()

    await vi.advanceTimersByTimeAsync(3001)
    await flush()
    expect(feed.items()).toHaveLength(4) // 消费 2 条
    expect(fetchA).toHaveBeenCalledTimes(1) // 仅首载

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    await flush()
    expect(feed.items()).toHaveLength(4)
    expect(fetchA).toHaveBeenCalledTimes(1)
  })

  it('T1 重试：refresh 清除挂起的补触发，不幽灵翻页（spec §4 T1）', async () => {
    vi.useFakeTimers()
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      return { items: [mkIllust(`a${page}`, page)], nextUrl: `p${page}` }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 1,
      throttleMs: 0,
      cooldownMs: 3000,
    })
    await flush()
    expect(feed.items()).toHaveLength(1)
    expect(fetchA).toHaveBeenCalledTimes(1)

    // 冷却窗口内吞掉 → 挂起补触发（t=3000）
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    // refresh 重建会话 → 挂起补触发被清除
    await feed.refresh()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2) // 首载 + refresh
    expect(vi.getTimerCount()).toBe(0)

    // 原窗口时间已过：无幽灵翻页
    await vi.advanceTimersByTimeAsync(5000)
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2)
  })

  it('T1 重试：dispose 清除挂起的补触发并作废在途响应（spec §4 T1）', async () => {
    vi.useFakeTimers()
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      return { items: [mkIllust(`a${page}`, page)], nextUrl: `p${page}` }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 1,
      throttleMs: 0,
      cooldownMs: 3000,
    })
    await flush()

    // 冷却窗口内吞掉 → 挂起补触发（t=3000）
    await feed.fetchMore()
    await flush()
    expect(vi.getTimerCount()).toBe(1)

    // dispose：挂起补触发被清、无残留定时器
    feed.dispose()
    expect(vi.getTimerCount()).toBe(0)

    // 推进超过原窗口：无幽灵翻页
    await vi.advanceTimersByTimeAsync(5000)
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(1) // 仅首载
  })

  it('首载全部失败：error 置为首个错误，items 空', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      throw new Error('A-fail')
    })
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => {
      throw new Error('B-fail')
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.error()).toBe('A-fail') // 首个（源顺序第一个）失败的错误
    expect(feed.items()).toEqual([])
    expect(feed.loading()).toBe(false)
    expect(feed.nextUrl()).toBeNull()
  })

  it('首载部分失败：成功源正常合并，失败源标记耗尽（不阻塞另一源）', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkIllust('a1', 1)], nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => {
      throw new Error('B-fail')
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // 成功源的数据可用，无错误展示（有内容不置 error）
    expect(feed.items().map((i) => i.key)).toEqual(['a1'])
    expect(feed.error()).toBeNull()
    expect(feed.nextUrl()).toBe('A2')

    // 失败源 B 已标记耗尽：后续 fetchMore 只翻 A
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2)
    expect(fetchB).toHaveBeenCalledTimes(1)
  })

  it('翻页失败：置分页错误文案（加载更多失败）且不崩溃，原数据保留', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkIllust('a1', 1)], nextUrl: 'A2' }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()

    fetchA.mockImplementationOnce(async () => {
      throw new Error('page-fail')
    })
    await expect(feed.fetchMore()).resolves.toBeUndefined() // 不 reject
    // 槽位分离（ADR-0104）：分页失败置 pageError，首屏 error 槽不受影响
    expect(feed.error()).toBeNull()
    expect(feed.pageError()).toBe('page-fail') // presentError(err, '加载更多失败')
    expect(feed.items().map((i) => i.key)).toEqual(['a1']) // 原数据保留
    expect(feed.nextUrl()).toBe('A2') // 保留 nextUrl 供重试
  })

  it('pageError 生命周期：翻页失败置位、重试成功清空（首屏 error 槽全程不受影响）', async () => {
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      if (page === 1) return { items: [mkIllust('a1', 1)], nextUrl: 'A2' }
      if (page === 2) throw new Error('page-fail')
      return { items: [mkIllust(`a${page}`, page)], nextUrl: null }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.error()).toBeNull()

    await feed.fetchMore() // 翻页失败
    await flush()
    expect(feed.pageError()).toBe('page-fail')
    expect(feed.error()).toBeNull()

    await feed.fetchMore() // 滚动重试成功 → 清 pageError
    await flush()
    expect(feed.pageError()).toBeNull()
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'a3'])
  })

  it('refresh 清两槽：首屏错误与分页残留错误都被清空', async () => {
    let page = 0
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => {
      page++
      if (page === 1) return { items: [mkIllust('a1', 1)], nextUrl: 'A2' }
      if (page === 2) throw new Error('page-fail')
      return { items: [mkIllust('a1', 1)], nextUrl: null }
    })

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    await feed.fetchMore() // 翻页失败 → pageError 置位
    await flush()
    expect(feed.pageError()).toBe('page-fail')

    await feed.refresh() // refresh 成功 → 两槽清
    await flush()
    expect(feed.error()).toBeNull()
    expect(feed.pageError()).toBeNull()
    expect(feed.items()).toHaveLength(1)
  })

  it('autoStart=false：构造不触发首载，refresh 才触发', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkIllust('a1', 1)], nextUrl: null }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      autoStart: false,
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    expect(fetchA).not.toHaveBeenCalled()
    expect(feed.loading()).toBe(false)

    await feed.refresh()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(feed.items()).toHaveLength(1)
  })

  it('翻页传 nextUrl：fetchMore 调用 fetchPage(signal, 该源当前 next_url)（offset 分页语义）', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [mkIllust('a1', 1)], nextUrl: 'A2' }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()

    await feed.fetchMore()
    await flush()
    // 翻页：fetchPage(signal, 'A2')——携带该源当前 next_url（offset 分页语义）
    // T6 改造（ADR-0141 R2 修订）：createMixFeed 内部 AbortController 透传 signal 到 sources
    // 让 sources 可把 signal 传给 apiClient.get → OkHttp 真取消（R1-1 真机结论 117ms）
    expect(fetchA).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), 'A2')
  })

  it('畸形响应（items 非数组）→ 首载视为失败，error 置位不崩溃', async () => {
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({
      items: 'not-an-array' as never,
      nextUrl: null,
    }))

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.error()).toBe('数据格式异常')
    expect(feed.items()).toEqual([])
    expect(feed.loading()).toBe(false)
  })

  it('fetchPage 15s 超时兜底（issue #128）：挂起请求超时后 error 置位', async () => {
    vi.useFakeTimers()
    // 永不 settle 的 fetchPage
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(() => new Promise<Page>(() => {}))

    const feed = createMixFeed({
      sources: [source('illust', fetchA)],
      throttleMs: 0,
      cooldownMs: 0,
    })
    await vi.advanceTimersByTimeAsync(15000)
    expect(feed.error()).not.toBeNull()
    expect(feed.error()).toContain('超时')
    expect(feed.loading()).toBe(false)
  })
})

// ─── time-merge 模式（merge:'time-merge'，ADR-0115 推荐页） ───
// oracle = app 端 createTQFeedStore 的 sortByDate + mergeAndSort（按 create_date 降序跨源交叉合并）。
describe('createMixFeed time-merge', () => {
  it('首载：merge=time-merge 按 create_date 降序跨源排序', async () => {
    const a1 = mkIllust('a1', 1); a1.data.create_date = '2024-01-03T00:00:00+00:00'
    const a2 = mkIllust('a2', 2); a2.data.create_date = '2024-01-01T00:00:00+00:00'
    const b1 = mkNovel('b1', 10); b1.data.create_date = '2024-01-02T00:00:00+00:00'
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [a1, a2], nextUrl: null }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [b1], nextUrl: null }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // 跨源按 create_date 降序：a1(01-03) > b1(01-02) > a2(01-01)
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1', 'a2'])
  })

  it('fetchMore time-merge：并行拉所有非耗尽源 next 页，mergeByTime 追加（携带各源 nextUrl）', async () => {
    const a1 = mkIllust('a1', 1); a1.data.create_date = '2024-01-05T00:00:00+00:00'
    const b1 = mkNovel('b1', 10); b1.data.create_date = '2024-01-04T00:00:00+00:00'
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [a1], nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [b1], nextUrl: 'B2' }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1'])

    const a2 = mkIllust('a2', 2); a2.data.create_date = '2024-01-02T00:00:00+00:00'
    const b2 = mkNovel('b2', 11); b2.data.create_date = '2024-01-03T00:00:00+00:00'
    fetchA.mockImplementationOnce(async () => ({ items: [a2], nextUrl: null }))
    fetchB.mockImplementationOnce(async () => ({ items: [b2], nextUrl: null }))
    await feed.fetchMore()
    await flush()
    // 追加按时间合并（老条目在后）：a1,b1,b2,a2
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1', 'b2', 'a2'])
    expect(feed.nextUrl()).toBeNull()
    // 两源都携带了各自的 next_url + AbortController signal（T6 改造）
    expect(fetchA).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), 'A2')
    expect(fetchB).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), 'B2')
  })

  it('fetchMore time-merge 部分失败：成功源并入、失败源跳过、不置全局 pageError', async () => {
    const a1 = mkIllust('a1', 1); a1.data.create_date = '2024-01-05T00:00:00+00:00'
    const b1 = mkNovel('b1', 10); b1.data.create_date = '2024-01-04T00:00:00+00:00'
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [a1], nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [b1], nextUrl: 'B2' }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()

    const a2 = mkIllust('a2', 2); a2.data.create_date = '2024-01-02T00:00:00+00:00'
    fetchA.mockImplementationOnce(async () => ({ items: [a2], nextUrl: null }))
    fetchB.mockImplementationOnce(async () => {
      throw new Error('B-fail')
    })
    await feed.fetchMore()
    await flush()
    // 逐源独立（app createTQFeedStore oracle）：成功源 a2 并入、失败源跳过，不置全局 pageError
    expect(feed.pageError()).toBeNull()
    expect(feed.error()).toBeNull()
    // 成功源并入后流仍全局降序（01-05 a1 > 01-04 b1 > 01-02 a2）
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1', 'a2'])
    // 失败源 B 的 nextUrl 保留（下轮 fetchMore 可重试），成功源 A 已耗尽（nextUrl=null）
    expect(feed.nextUrl()).toBe('B2')
  })

  it('fetchMore time-merge 全部失败：不追加、置 pageError、原数据保留', async () => {
    const a1 = mkIllust('a1', 1); a1.data.create_date = '2024-01-05T00:00:00+00:00'
    const b1 = mkNovel('b1', 10); b1.data.create_date = '2024-01-04T00:00:00+00:00'
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [a1], nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [b1], nextUrl: 'B2' }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()

    fetchA.mockImplementationOnce(async () => {
      throw new Error('A-fail')
    })
    fetchB.mockImplementationOnce(async () => {
      throw new Error('B-fail')
    })
    await feed.fetchMore()
    await flush()
    expect(feed.pageError()).toBe('A-fail') // presentError(首个失败,'加载更多失败')；两源均失败
    expect(feed.error()).toBeNull()
    // 全部失败：不追加，保留已加载内容
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1'])
  })

  it('time-merge：create_date 缺失沉底 + console.warn（非静默降级）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a1 = mkIllust('a1', 1); a1.data.create_date = '2024-01-02T00:00:00+00:00'
    const aNoDate = mkIllust('a2', 2); aNoDate.data.create_date = ''
    const b1 = mkNovel('b1', 10); b1.data.create_date = '2024-01-01T00:00:00+00:00'
    const feed = createMixFeed({
      sources: [
        source('illust', vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [aNoDate, a1], nextUrl: null }))),
        source('novel', vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [b1], nextUrl: null }))),
      ],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // aNoDate 无日期 → 沉底（排在最后），其余按时间
    expect(feed.items().map((i) => i.key)).toEqual(['a1', 'b1', 'a2'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('time-merge 去重：同 key 跨源仅保留一条（先出现者）', async () => {
    const dupA = mkIllust('dup', 1); dupA.data.create_date = '2024-01-05T00:00:00+00:00'
    const a3 = mkIllust('a3', 3); a3.data.create_date = '2024-01-01T00:00:00+00:00'
    const dupNovel = mkNovel('dup', 10); dupNovel.data.create_date = '2024-01-03T00:00:00+00:00'
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [dupA, a3], nextUrl: null }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [dupNovel], nextUrl: null }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    // merged 按时间：dupA(01-05)、dupNovel(01-03)、a3(01-01)；dedupe 按 key：'dup' 保留先出现者
    expect(feed.items().map((i) => i.key)).toEqual(['dup', 'a3'])
    expect(feed.items().filter((i) => i.key === 'dup')).toHaveLength(1)
  })

  it('fetchMore time-merge 跨源时间错位：新批更“新”的条目插入正确位置（全局降序，app 端 items() 语义）', async () => {
    const a1 = mkIllust('a1', 1); a1.data.create_date = '2024-01-01T00:00:00+00:00'
    const b1 = mkNovel('b1', 10); b1.data.create_date = '2024-01-02T00:00:00+00:00'
    const fetchA = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [a1], nextUrl: 'A2' }))
    const fetchB = vi.fn<MixFeedSource['fetchPage']>(async () => ({ items: [b1], nextUrl: 'B2' }))
    const feed = createMixFeed({
      sources: [source('illust', fetchA), source('novel', fetchB)],
      merge: 'time-merge',
      pageSize: 100,
      throttleMs: 0,
      cooldownMs: 0,
    })
    await flush()
    expect(feed.items().map((i) => i.key)).toEqual(['b1', 'a1']) // b1(01-02) > a1(01-01)

    // 后续翻页：A2 拉到比已渲染的 b1(01-02) 更新（01-03）的条目、B2 耗尽
    const a2 = mkIllust('a2', 2); a2.data.create_date = '2024-01-03T00:00:00+00:00'
    fetchA.mockImplementationOnce(async () => ({ items: [a2], nextUrl: null }))
    fetchB.mockImplementationOnce(async () => ({ items: [], nextUrl: null }))
    await feed.fetchMore()
    await flush()
    // 全局降序：a2(01-03) 应插到 b1(01-02) 之前，而非 append 末尾（append-only 会得到 ['b1','a1','a2'] 错序）
    expect(feed.items().map((i) => i.key)).toEqual(['a2', 'b1', 'a1'])
    expect(feed.nextUrl()).toBeNull()
  })
})
