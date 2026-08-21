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

  it('throttle：节流窗口内第二次 fetchMore 被跳过（不触发网络）', async () => {
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

    // 节流窗口内（时钟未推进）：第二次被跳过
    await feed.fetchMore()
    expect(fetchA).toHaveBeenCalledTimes(2)

    // 推进 800ms 后恢复
    await vi.advanceTimersByTimeAsync(800)
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(3)
  })

  it('cooldown：首载完成后的冷却窗口内 fetchMore 被跳过', async () => {
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

    // 冷却窗口内：fetchMore 被跳过（首载完成后 3s 内）
    await feed.fetchMore()
    expect(fetchA).toHaveBeenCalledTimes(1)

    // 推进 3000ms 后恢复
    await vi.advanceTimersByTimeAsync(3000)
    await feed.fetchMore()
    await flush()
    expect(fetchA).toHaveBeenCalledTimes(2)
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
    // 翻页：fetchPage(undefined, 'A2')——携带该源当前 next_url（offset 分页语义）
    expect(fetchA).toHaveBeenNthCalledWith(2, undefined, 'A2')
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
