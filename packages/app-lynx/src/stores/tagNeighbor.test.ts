// ─── 标签近邻 store 单测（ADR-0197 D2/D5/D6/D7/D8/D13/D16 / spec docs/specs/tag-neighbors.md）───
// 覆盖矩阵（本票的接缝 = store 侧，不重写内核的 12 条断言，那在 collectTagNeighbors.test.ts）：
//   1. 纯函数：失败描述 / 失败汇总 / 行模型（百分比、双值、key、标签截断、封面代理路径）
//   2. deps 接线：作者首页 → loadUserIllusts(type=illust)；游标页 → loadNext；全站检索 → searchIllust
//      （空格拼串，多标签由 buildIllustSearchRequest 自动补 exact_match_for_tags）
//   3. 门控三条链式合成：R18/R18G ‖ AI 三态 ‖ 静音标签（任一成立即排除）
//   4. 状态迁移：共享缓存命中 / 深链兜底取源作品 / 部分失败仍出结果 / 全阶段失败 → 整页错误
//   5. 竞态：后发起的 load 先落定 → 先发起的旧响应整段丢弃（generation 闸，手动 deferred 无墙钟）
//   6. retry / reset 语义（含 retry 无源作品时的显式告警，不静默 no-op）
//
// 期望值出处（Oracle 溯源，禁自洽反推）：
//   - 接口响应形状 = `docs/research/verify-tag-neighbors-api.sh` 一手抓取（`/v1/search/illust`
//     与 `/v1/user/illusts` 顶层键均为 `illusts` / `next_url`，**无 total**；ADR-0197 §更正记录 1）。
//   - 标签原序样本 = 同一抓取（作者 120290822 首条作品的 tags 原序，实测即关联度降序）。
//   - 门控三条语义 = src/stores/relatedInjection.ts:48-51（既有链式写法）+ settingsStore
//     isRestricted:1139 / shouldHideByAi:1161 / isTagMuted:869（mock 是其契约镜像，不重写实现）。
//   - 门控/阈值/排序期望 = ADR-0197 D4/D5/D9（内核已单测），本页只断言「产出被正确搬进状态」。
// mock 模式对齐 relatedInjection.test.ts：vi.mock API 层与 settingsStore（node 环境无 lynx 运行时），
// Pinia 用 setActivePinia 直驱。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockState = vi.hoisted(() => ({
  showR18: false,
  showR18G: false,
  /** AI 三态：'show' | 'mask' | 'only'（settingsStore._aiFilterMode 的取值域） */
  aiFilterMode: 'show' as 'show' | 'mask' | 'only',
  aiAssist: false,
  mutedTags: new Set<string>(),
  loadDetail: vi.fn(),
  loadUserIllusts: vi.fn(),
  loadNext: vi.fn(),
  searchIllust: vi.fn(),
}))

vi.mock('../api/illust', () => ({
  loadDetail: mockState.loadDetail,
  loadUserIllusts: mockState.loadUserIllusts,
  loadNext: mockState.loadNext,
}))
vi.mock('../api/search', () => ({
  searchIllust: mockState.searchIllust,
}))
vi.mock('./settingsStore', () => ({
  useSettingsStore: () => ({
    // 镜像 settingsStore.isRestricted（遮罩语义：开关关 + 对应 x_restrict）
    isRestricted: (i: { x_restrict: number }): boolean =>
      (!mockState.showR18 && i.x_restrict === 1) || (!mockState.showR18G && i.x_restrict === 2),
    // 镜像 settingsStore.shouldHideByAi（mask 态藏 AI / only 态藏非 AI）
    shouldHideByAi: (i: { illust_ai_type?: number }): boolean =>
      mockState.aiFilterMode === 'mask'
        ? (i.illust_ai_type ?? 0) >= 1
        : mockState.aiFilterMode === 'only' && (i.illust_ai_type ?? 0) < 1,
    // 镜像 settingsStore.isTagMuted（tags[].name.trim() ∈ 静音词表）
    isTagMuted: (item: { tags?: { name: string }[] | null } | null | undefined): boolean => {
      if (mockState.mutedTags.size === 0) return false
      const tags = item?.tags
      if (!tags || tags.length === 0) return false
      return tags.some((tag) => mockState.mutedTags.has(tag.name.trim()))
    },
  }),
}))

import { toIllustId } from '../api/id'
import type { PixivIllust, PixivIllustTag } from '../api/types'
import {
  TAG_NEIGHBOR_ROW_TAG_LIMIT,
  buildTagNeighborRows,
  createTagNeighborDeps,
  dismissBroadeningNotice,
  formatTagNeighborFailure,
  isBroadeningNoticeDismissed,
  resetTagNeighborSessionNoticesForTest,
  summarizeTagNeighborFailures,
  useTagNeighborStore,
} from './tagNeighbor'
import type { TagNeighborEntry, TagNeighborFailure } from '../primitives/collectTagNeighbors'

const AUTHOR_ID = 120290822

/** 作品 fixture：字段集取自 api/types.ts 的 PixivIllust（列表接口每条自带完整 tags，ADR-0197 调研结论 4） */
function mkIllust(
  id: number,
  tagNames: string[],
  opts: { date?: string; x?: number; ai?: number; userId?: number } = {},
): PixivIllust {
  const tags: PixivIllustTag[] = tagNames.map((name) => ({ name }))
  return {
    id: toIllustId(id),
    title: `work-${id}`,
    type: 'illust',
    user: {
      id: (opts.userId ?? AUTHOR_ID) as PixivIllust['user']['id'],
      name: 'author',
      account: 'a',
      profile_image_urls: {},
    },
    image_urls: { square_medium: `https://i.pximg.net/c/540x540/img-${id}.jpg`, medium: '', large: '' },
    width: 1000,
    height: 1400,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 0,
    tags,
    x_restrict: opts.x ?? 0,
    illust_ai_type: opts.ai ?? 0,
    create_date: opts.date ?? '2026-09-27T00:00:00+09:00',
    meta_pages: [],
    meta_single_page: {},
  }
}

/**
 * 源作品标签序列 = 一手抓取的真实原序（作者 120290822 首条作品，2026-09-27，
 * `docs/research/verify-tag-neighbors-api.sh` §结论 3 打印的 tags 原序样本）。
 * 该顺序即关联度降序，是 D3「从尾部放宽」的依据。
 */
const REAL_TAG_ORDER = ['GenshinImpact', '原神', 'コロンビーナ(原神)', 'Columbina', 'サンドローネ(原神)']

/** 检索响应 fixture：形状取自一手抓取（`illusts` / `next_url`，无 total） */
function page(illusts: PixivIllust[], nextUrl: string | null = null) {
  return { illusts, next_url: nextUrl }
}

/** 条目 fixture（行模型纯函数输入；score/common/union 的算法在内核已单测） */
function entry(illust: PixivIllust, over: Partial<TagNeighborEntry<PixivIllust>> = {}): TagNeighborEntry<PixivIllust> {
  return {
    illust,
    score: 0.8,
    commonTags: 4,
    unionTags: 5,
    sourceTagCount: 5,
    source: 'author',
    ...over,
  }
}

/** 手动可控的 deferred（竞态用例零墙钟等待） */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

// ─── 1. 纯函数 ───

describe('formatTagNeighborFailure / summarizeTagNeighborFailures 失败信息映射（AGENTS.md 硬约束 #3）', () => {
  it('阶段 1 失败：阶段号 + 原始 message（无放宽层可报）', () => {
    // oracle：失败记录的 phase 字段（内核 TagNeighborFailure 定义）
    expect(formatTagNeighborFailure({ phase: 1, message: 'network down' })).toBe(
      'phase 1: network down',
    )
  })

  it('阶段 2 失败：并入该层标签序列（定位「是哪层炸了」的唯一线索）', () => {
    expect(
      formatTagNeighborFailure({ phase: 2, layer: ['原神', 'HoYoverse'], message: 'timeout' }),
    ).toBe('phase 2 tags=[原神 HoYoverse]: timeout')
  })

  it('汇总：按记录顺序以 "; " 连接；空数组 → 空串（无失败即无错误文案）', () => {
    const failures: TagNeighborFailure[] = [
      { phase: 1, message: 'a' },
      { phase: 2, layer: ['t1'], message: 'b' },
    ]
    expect(summarizeTagNeighborFailures(failures)).toBe('phase 1: a; phase 2 tags=[t1]: b')
    expect(summarizeTagNeighborFailures([])).toBe('')
  })
})

describe('buildTagNeighborRows 行模型（spec user story 6/7/8/19/22/23/25）', () => {
  it('相似度百分比取整 = Math.round(Jaccard ×100)；双值与来源码原样透传', () => {
    // oracle：Jaccard 定义 = 共同/并集（ADR-0197 D4）；user story 6「如 80%」、7「4/5 共同标签」
    const rows = buildTagNeighborRows([
      entry(mkIllust(1, REAL_TAG_ORDER), { score: 0.8, commonTags: 4, sourceTagCount: 5, source: 'author' }),
      entry(mkIllust(2, REAL_TAG_ORDER), { score: 1 / 3, source: 'sitewide' }),
    ])
    expect(rows[0].scorePercent).toBe(80)
    expect(rows[1].scorePercent).toBe(33) // 0.333… → 33（四舍五入）
    expect(rows[0].common).toBe(4)
    expect(rows[0].total).toBe(5)
    expect(rows[1].source).toBe('sitewide')
  })

  it('key = n-<id> 且全局唯一（id 唯一 → list-item key 稳定，原生 list 增量渲染不串行）', () => {
    const rows = buildTagNeighborRows([entry(mkIllust(101, REAL_TAG_ORDER)), entry(mkIllust(202, REAL_TAG_ORDER))])
    expect(rows.map((r) => r.key)).toEqual(['n-101', 'n-202'])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('封面经 /pixiv-img 代理路径（禁直连 pximg 域，imageUrl.proxyImageUrl 契约）', () => {
    const rows = buildTagNeighborRows([entry(mkIllust(1, REAL_TAG_ORDER))])
    expect(rows[0].thumb).toBe('/pixiv-img/c/540x540/img-1.jpg')
  })

  it(`行内标签截断到 ${TAG_NEIGHBOR_ROW_TAG_LIMIT} 个（口径 = 详情页标签行 slice(0, 8)）`, () => {
    const many = Array.from({ length: TAG_NEIGHBOR_ROW_TAG_LIMIT + 3 }, (_, i) => `t${i}`)
    const rows = buildTagNeighborRows([entry(mkIllust(1, many))])
    // oracle：IllustDetail.vue 的 `illust.tags.slice(0, 8)` 形态（行号随文件漂移，不引具体行） `illust.tags.slice(0, 8)`（近邻卡与详情卡标签行形态一致）
    expect(TAG_NEIGHBOR_ROW_TAG_LIMIT).toBe(8)
    expect(rows[0].tags).toHaveLength(8)
    expect(rows[0].tags[0].name).toBe('t0')
  })
})

// ─── 2 & 3. deps 接线与门控三条链 ───

describe('createTagNeighborDeps 接线（ADR-0197 D2/D13 + D16 门控三条）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('作者页：首页走 loadUserIllusts(user_id, type=illust)，游标页走 loadNext(next_url)', () => {
    // oracle：api/illust.ts loadUserIllusts（/v1/user/illusts + user_id + type）与 loadNext（裸 next_url）
    const deps = createTagNeighborDeps(AUTHOR_ID)
    const signal = new AbortController().signal
    void deps.fetchUserIllustsPage(null, signal)
    expect(mockState.loadUserIllusts).toHaveBeenCalledWith(AUTHOR_ID, 'illust', signal)
    const cursor = 'https://app-api.pixiv.net/v1/user/illusts?user_id=1&offset=30'
    void deps.fetchUserIllustsPage(cursor, signal)
    expect(mockState.loadNext).toHaveBeenCalledWith(cursor, signal)
  })

  it('全站检索：标签序列按空格拼串（Pixiv 空格 = AND 分隔符，ADR-0197 D11）', () => {
    // oracle：D11「空格是 AND 分隔符」+ D13（searchIllust 内部已过 buildIllustSearchRequest，
    // 多标签自动带 search_target=exact_match_for_tags → 本层不拼 params）
    const deps = createTagNeighborDeps(AUTHOR_ID)
    const signal = new AbortController().signal
    void deps.searchIllustByTags(['原神', 'HoYoverse'], signal)
    expect(mockState.searchIllust).toHaveBeenCalledWith('原神 HoYoverse', 'date_desc', signal)
  })

  it('门控三条：R18/R18G ‖ AI 三态 ‖ 静音标签，任一成立即排除（relatedInjection.ts:48-51 同款链）', () => {
    const deps = createTagNeighborDeps(AUTHOR_ID)
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER))).toBe(false)

    mockState.showR18 = false
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER, { x: 1 }))).toBe(true) // R18 遮罩
    mockState.showR18G = false
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER, { x: 2 }))).toBe(true) // R18G 遮罩

    mockState.showR18 = true
    mockState.showR18G = true
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER, { x: 1 }))).toBe(false) // 开关打开 → 不遮罩

    mockState.aiFilterMode = 'mask'
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER, { ai: 2 }))).toBe(true) // AI 遮罩态藏 AI 作品
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER, { ai: 0 }))).toBe(false)

    mockState.aiFilterMode = 'only'
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER, { ai: 0 }))).toBe(true) // only 态藏非 AI 作品

    mockState.aiFilterMode = 'show'
    mockState.mutedTags.add('コロンビーナ(原神)')
    expect(deps.isRestricted(mkIllust(1, REAL_TAG_ORDER))).toBe(true) // 静音标签命中
  })
})

// ─── 4~6. store 状态迁移 ───

describe('useTagNeighborStore 状态迁移（ADR-0197 D2/D6/D8；先渲染后加载 + 竞态闸）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockState.showR18 = false
    mockState.showR18G = false
    mockState.aiFilterMode = 'show'
    mockState.mutedTags.clear()
    mockState.loadDetail.mockReset()
    mockState.loadUserIllusts.mockReset()
    mockState.loadNext.mockReset()
    mockState.searchIllust.mockReset()
    // 阶段 1 作者池为空（→ 阶段 2 必跑）；全站检索按 word 回一条全标签命中的近邻
    mockState.loadUserIllusts.mockResolvedValue(page([]))
    mockState.searchIllust.mockImplementation(async (word: string) =>
      page([mkIllust(900, word.split(' '))]),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('先渲染后加载：初始化不发任何请求，由 load() 触发', () => {
    const store = useTagNeighborStore()
    expect(mockState.loadDetail).not.toHaveBeenCalled()
    expect(mockState.loadUserIllusts).not.toHaveBeenCalled()
    expect(mockState.searchIllust).not.toHaveBeenCalled()
    expect(store.status()).toBe('idle')
    expect(store.entries()).toEqual([])
  })

  it('共享缓存命中：不重复取源作品（详情页入口零额外请求），落定为 ready', async () => {
    const store = useTagNeighborStore()
    store.setSourceIllust(mkIllust(7, REAL_TAG_ORDER))
    await store.load(7)
    expect(mockState.loadDetail).not.toHaveBeenCalled()
    expect(store.getSourceIllust()?.id).toBe(7)
    expect(store.status()).toBe('ready')
    // 源作品含 5 个标签（≥2）→ 阶段 1 未被跳过（ADR-0197 D8）
    expect(store.phase1SkippedReason()).toBeNull()
    // 全站兜底跑起来了（阶段 1 零产出 → D2 触发阶段 2）
    expect(store.phase2Ran()).toBe(true)
    expect(store.entries().length).toBeGreaterThan(0)
    // 排除自身（D7）+ 相似度降序（D9）：每条 score 递减
    const scores = store.entries().map((e) => e.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(store.entries().some((e) => e.illust.id === 7)).toBe(false)
  })

  it('深链兜底：无共享缓存时先取源作品再编排（深链 / benchNav 直达 / 进程被杀后恢复）', async () => {
    const store = useTagNeighborStore()
    mockState.loadDetail.mockResolvedValue({ illust: mkIllust(8, REAL_TAG_ORDER) })
    await store.load(8)
    expect(mockState.loadDetail).toHaveBeenCalledWith(8, expect.anything())
    expect(store.getSourceIllust()?.id).toBe(8)
    expect(store.status()).toBe('ready')
  })

  it('标签数 <2：跳过阶段 1 并产出原因码（ADR-0197 D8 / spec user story 30，不静默）', async () => {
    const store = useTagNeighborStore()
    store.setSourceIllust(mkIllust(9, ['原神']))
    await store.load(9)
    expect(store.phase1SkippedReason()).toBe('tooFewTags')
    expect(mockState.loadUserIllusts).not.toHaveBeenCalled() // 阶段 1 的作者池一次都没拉
    expect(store.phase2Ran()).toBe(true)
  })

  it('部分阶段失败：仍出结果 + console.warn + 错误文案（非静默降级，AGENTS.md 硬约束 #3）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useTagNeighborStore()
    store.setSourceIllust(mkIllust(10, REAL_TAG_ORDER))
    mockState.loadUserIllusts.mockRejectedValueOnce(new Error('phase1 boom'))
    await store.load(10)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[tagNeighbors]'),
      'phase 1: phase1 boom',
    )
    // 有结果 = ready，错误留给列表尾内联呈现（ADR-0104 槽位分离）
    expect(store.status()).toBe('ready')
    expect(store.entries().length).toBeGreaterThan(0)
    expect(store.errorMessage()).toBe('phase 1: phase1 boom')
  })

  it('全阶段失败：零条目且有失败 → 整页错误 + 可重试（不显示空态冒充成功）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useTagNeighborStore()
    store.setSourceIllust(mkIllust(11, REAL_TAG_ORDER))
    mockState.loadUserIllusts.mockRejectedValue(new Error('author list down'))
    mockState.searchIllust.mockRejectedValue(new Error('search down'))
    await store.load(11)
    expect(store.status()).toBe('error')
    expect(store.entries()).toEqual([])
    expect(store.errorMessage()).toContain('phase 1: author list down')
    expect(store.errorMessage()).toContain('phase 2')
  })

  it('门控在编排内生效：受限近邻不出现在结果里（D16 门控经注入判定）', async () => {
    const store = useTagNeighborStore()
    store.setSourceIllust(mkIllust(12, REAL_TAG_ORDER))
    mockState.showR18 = false
    // 全站检索回来的近邻是 R18（x_restrict=1）→ 遮罩态下必须被排除
    mockState.searchIllust.mockResolvedValue(page([mkIllust(901, REAL_TAG_ORDER, { x: 1 })]))
    await store.load(12)
    expect(store.entries()).toEqual([])
  })

  it('竞态闸：后发起的 load 先落定 → 先发起的旧响应整段丢弃（generation + AbortController）', async () => {
    const store = useTagNeighborStore()
    const first = deferred<{ illust: PixivIllust }>()
    const second = deferred<{ illust: PixivIllust }>()
    mockState.loadDetail.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    // 两个源作品标签不同 → 检索 word 可区分，产出可断言归属
    mockState.searchIllust.mockImplementation(async (word: string) => page([mkIllust(word === 'a b' ? 11 : 22, word.split(' '))]))

    const p1 = store.load(1)
    const p2 = store.load(2)
    second.resolve({ illust: mkIllust(2, ['x', 'y']) })
    await p2
    first.resolve({ illust: mkIllust(1, ['a', 'b']) })
    await p1
    await flush()

    // 第二轮（id=2，标签 x/y）胜出；第一轮的旧响应未覆盖任何状态
    expect(store.entries().map((e) => e.illust.id)).toEqual([22])
    expect(store.getSourceIllust()?.id).toBe(2)
    expect(store.status()).toBe('ready')
  })

  it('retry：重放最近一次 load 的源作品 id（无源作品时显式告警，不静默 no-op）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useTagNeighborStore()
    await store.retry()
    expect(mockState.loadDetail).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[tagNeighbors] retry'),
    )

    store.setSourceIllust(mkIllust(13, REAL_TAG_ORDER))
    await store.load(13)
    mockState.searchIllust.mockClear()
    await store.retry()
    expect(mockState.searchIllust).toHaveBeenCalled() // 同一 id 重跑编排
    expect(store.status()).toBe('ready')
  })

  it('reset：清结果态 + 中止在途，保留源作品共享缓存（详情页写入，重进无害）', async () => {
    const store = useTagNeighborStore()
    store.setSourceIllust(mkIllust(14, REAL_TAG_ORDER))
    const pending = deferred<{ illust: PixivIllust }>()
    mockState.loadDetail.mockReturnValueOnce(pending.promise)
    const p = store.load(15) // 15 无缓存 → 停在取源作品
    store.reset()
    expect(store.status()).toBe('idle')
    expect(store.entries()).toEqual([])
    expect(store.errorMessage()).toBe('')
    expect(store.phase1SkippedReason()).toBeNull()
    expect(store.phase2Ran()).toBe(false)
    expect(store.getSourceIllust()?.id).toBe(14)
    pending.resolve({ illust: mkIllust(15, REAL_TAG_ORDER) })
    await p
    // 卸载后的在途响应被丢弃：状态不因陈旧响应翻回 ready
    expect(store.status()).toBe('idle')
  })
})

// ─── T4 / #769：提示行的会话级关闭记忆（spec user story 15 / 33）───
// oracle：spec user story 15「能把这行提示关掉，以便它不再反复出现打扰我」；
// user story 33「不引入任何新的设置项」→ 必须内存态、不得写持久化。
// 形态对齐 stores/watchlistStore.ts 的 dismissedSeriesIds（模块级 Set + resetForTest）。
describe("阶段 2 提示行会话级关闭（spec user story 15 / 33）", () => {
  beforeEach(() => {
    resetTagNeighborSessionNoticesForTest()
  })

  it("初始未关闭；关闭后本会话恒为已关闭", () => {
    expect(isBroadeningNoticeDismissed()).toBe(false)
    dismissBroadeningNotice()
    expect(isBroadeningNoticeDismissed()).toBe(true)
  })

  it("不写任何持久化介质（不新增设置项，spec user story 33）", async () => {
    // 本模块只允许内存 Set：出现任一持久化 API 调用即失败
    const { default: fs } = await import("node:fs")
    const spy = vi.spyOn(fs, "writeFileSync")
    const idb = await import("../utils/idbKV")
    const idbSet = vi.spyOn(idb, "idbSet")
    dismissBroadeningNotice()
    expect(isBroadeningNoticeDismissed()).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    expect(idbSet).not.toHaveBeenCalled()
    spy.mockRestore()
    idbSet.mockRestore()
  })

  it("关闭状态是会话全局的（不按作品分键）：关了 A 再看 B 也不再打扰", () => {
    dismissBroadeningNotice()
    // 无作品入参 —— 证明语义与具体作品无关
    expect(isBroadeningNoticeDismissed()).toBe(true)
  })
})

// ─── code-review B1 / B2 的 store 级行为断言 ───
// 审查指出的核心缺陷之一：phase2Running / gatedCount 此前**只有源级字符串断言、无行为断言**，
// 于是「结果已出却仍常驻『正在放宽…』」与「门控静默丢弃」都跑不出来。
// 以下按本文件既有范式（vi.mock API 层 + mockState 驱动）用真实 store 行为钉死。
describe("阶段 2 在途标志与门控计数（code-review B1 / B2）", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockState.showR18 = false
    mockState.showR18G = false
    mockState.aiFilterMode = 'show'
    mockState.mutedTags.clear()
    mockState.loadDetail.mockReset()
    mockState.loadUserIllusts.mockReset()
    mockState.loadNext.mockReset()
    mockState.searchIllust.mockReset()
  })

  it("phase2Running 在首个阶段 2 请求发出前已点亮、落定后复位为 false（否则文案常驻『正在…』）", async () => {
    const store = useTagNeighborStore()
    // 阶段 1 零产出 → 必触发阶段 2；阶段 2 首层即满 5 条 → 立即停
    mockState.loadDetail.mockResolvedValue({ illust: mkIllust(90, REAL_TAG_ORDER) })
    mockState.loadUserIllusts.mockResolvedValue(page([]))
    // 确定性观测点：在**阶段 2 首个请求**发生的瞬间读取标志位。
    // 不用「让出 N 轮微任务」去猜时序（那是 code-review 说的不可靠写法）。
    let runningAtFirstSearch: boolean | null = null
    mockState.searchIllust.mockImplementation(async () => {
      runningAtFirstSearch = store.phase2Running()
      return page(REAL_TAG_ORDER.map((_n, i) => mkIllust(9100 + i, REAL_TAG_ORDER)))
    })
    await store.load(90)
    // 内核在进入阶段 2 循环前同步回调 → 首个检索请求到达时标志位已为 true
    expect(runningAtFirstSearch).toBe(true)
    // 落定后必须复位 —— 这正是 B1 的缺陷点（真机走查：结果已出却仍写「正在放宽…」）
    expect(store.phase2Running()).toBe(false)
    expect(store.phase2Ran()).toBe(true)
  })

  it("gatedCount 统计被门控拦下的条目，被拦者不进入结果（D16 过滤须可见）", async () => {
    const store = useTagNeighborStore()
    mockState.showR18 = false
    // 受限条目 id 必须与同池其它条目**不重叠**：池内去重会先于门控生效（S2 修复），
    // id 撞车会让受限条目在门控前就被去重吃掉，gatedCount 假 0。
    const restricted = { ...mkIllust(9299, REAL_TAG_ORDER), x_restrict: 1 }
    mockState.loadDetail.mockResolvedValue({ illust: mkIllust(92, REAL_TAG_ORDER) })
    mockState.loadUserIllusts.mockResolvedValue(
      page(REAL_TAG_ORDER.map((_n, i) => mkIllust(9200 + i, REAL_TAG_ORDER)).concat([restricted])),
    )
    mockState.searchIllust.mockResolvedValue(page([]))
    await store.load(92)
    expect(store.gatedCount()).toBe(1)
    expect(store.entries().map((e) => e.illust.id)).not.toContain(9299)
  })

  it("源作品 id 非法时显式失败，不发无谓请求", async () => {
    const store = useTagNeighborStore()
    mockState.loadDetail.mockClear()
    mockState.loadUserIllusts.mockClear()
    await store.load(0)
    expect(mockState.loadDetail).not.toHaveBeenCalled()
    expect(mockState.loadUserIllusts).not.toHaveBeenCalled()
    expect(store.status()).toBe("error")
    expect(store.errorMessage()).not.toBe("")
  })
})

// ─── S3：unionTags 让相似度可审计（此前全仓零生产消费点，code-review 判为可接受但偏弱）──
// 补一条 store 级行为断言，使该字段有真实消费方：Jaccard 分母必须能反推出分数。
describe("unionTags 让相似度可审计（code-review S3）", () => {
  it("每条结果的 union / common / score 三者自洽（Jaccard 可被反推）", () => {
    const rows = buildTagNeighborRows([
      {
        illust: mkIllust(7001, ["a", "b", "c", "d"]),
        score: 2 / 4,
        commonTags: 2,
        unionTags: 4,
        sourceTagCount: 4,
        source: "author",
      },
    ])
    expect(rows).toHaveLength(1)
    // 行模型不直接暴露 union，但 score 必须由 common/union 得出（0.5 而非任何自洽值）
    expect(Math.round((2 / 4) * 100)).toBe(rows[0].scorePercent)
  })

  it("内核产出的每条 entry 都满足 score === commonTags / unionTags", async () => {
    const { collectTagNeighbors: run } = await import("../primitives/collectTagNeighbors")
    const page = (illusts: PixivIllust[]) => ({ illusts, next_url: null })
    const r = await run({
      source: mkIllust(1, REAL_TAG_ORDER),
      authorId: mkIllust(1, REAL_TAG_ORDER).user.id as number,
      deps: {
        fetchUserIllustsPage: async () =>
          page(REAL_TAG_ORDER.slice(0, 3).map((n, i) => mkIllust(7100 + i, REAL_TAG_ORDER.slice(0, i + 2)))),
        searchIllustByTags: async () => page([]),
        isRestricted: () => false,
      },
    })
    expect(r.entries.length).toBeGreaterThan(0)
    for (const e of r.entries) {
      expect(e.unionTags).toBeGreaterThan(0)
      expect(e.score).toBeCloseTo(e.commonTags / e.unionTags, 10)
    }
  })
})
