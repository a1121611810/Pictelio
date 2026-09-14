// ─── useBookmarkPanel 单测（T5 / issue #534，spec docs/specs/bookmark-tags.md D5/D6/D8）───
// 期望值出处（Oracle 溯源，禁止从被测实现反推）：
// - 预填语义 = spec D6 + docs/research/bookmark-tags-similar-clients.md §7.3（真实端点形状：
//   bookmark_detail.tags = 作品标签 + is_registered 标记「用户收藏标签库已有该标签」）——
//   下方 snake_case 响应字面量即该端点的真实字段名，非与本实现自洽的 mock 字段；
// - 上限 10 / 空格提交 token / 去重 = spec D5/D11 + glossary「标签上限」「空格分隔序列化」；
// - 保存载荷 = spec D1/D2（restrict + 完整标签集经 saveWith 覆盖式保存）+ ADR-0160 D2；
// - 保存成效判定 = 宿主 saveWith 的 Promise<boolean> 返回值（FIX-2：显式成败通道；errorMsg
//   仅用于文案渲染，不再作为成败推断的字符串哨兵——失败用例刻意不提供任何错误文案）；
// - 失败路径（detail 禁存 / 标签库降级 / 保存回滚）= spec D6 + US12 + 测试硬约束 #1/#3；
// - 竞态（可见性切换重拉分库、晚到响应丢弃）= spec D6「切换后标签库候选按分库重拉」+ 硬约束 3。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import type { PixivBookmarkDetailResponse, PixivUserBookmarkTagsResponse, RestrictType } from '../api/types'
import { BOOKMARK_TAG_LIMIT } from '../utils/bookmarkTags'
import {
  BOOKMARK_PANEL_FEEDBACK_MS,
  UNAUTHENTICATED_MARKER,
  useBookmarkPanel,
  type UseBookmarkPanelReturn,
} from './useBookmarkPanel'

// 端点 mock（仅 mock 网络边界；reducer / 竞态 / 状态机全部走真实实现）
const loadBookmarkDetail = vi.fn()
const loadUserBookmarkTags = vi.fn()
vi.mock('../api/illust', () => ({
  loadBookmarkDetail: (...args: unknown[]) => loadBookmarkDetail(...args),
  loadUserBookmarkTags: (...args: unknown[]) => loadUserBookmarkTags(...args),
}))

/** 真实端点响应形状（研究 §7.3/§7.4 字段名逐字；已收藏示例） */
function detailResponse(overrides: Partial<{ is_bookmarked: boolean; restrict: string; tags: { name: string; is_registered?: boolean }[] }> = {}): PixivBookmarkDetailResponse {
  return {
    bookmark_detail: {
      is_bookmarked: true,
      restrict: 'public',
      tags: [
        { name: 'オリジナル', is_registered: true },
        { name: '風景', is_registered: true },
        { name: 'R-18', is_registered: false },
      ],
      ...overrides,
    },
  } as PixivBookmarkDetailResponse
}

function universeResponse(names: string[]): PixivUserBookmarkTagsResponse {
  return {
    bookmark_tags: names.map((name, i) => ({ name, count: names.length - i })),
    next_url: null,
  }
}

interface Harness {
  panel: UseBookmarkPanelReturn
  saveWith: ReturnType<typeof vi.fn>
  saving: ReturnType<typeof ref<boolean>>
  onSaved: ReturnType<typeof vi.fn>
  scope: EffectScope
}

function mount(overrides: Partial<{
  illustId: number
  userId: number | null
  /** 宿主 saveWith 行为（FIX-2：成败经返回值显式表达，不再读 errorMsg 字符串哨兵） */
  saveBehavior: () => Promise<boolean> | boolean
}> = {}): Harness {
  const scope = effectScope()
  const saving = ref(false)
  const onSaved = vi.fn()
  const saveWith = vi.fn(async (..._args: [RestrictType, string[]]) => {
    if (overrides.saveBehavior) return await overrides.saveBehavior()
    return true
  })
  let panel!: UseBookmarkPanelReturn
  scope.run(() => {
    panel = useBookmarkPanel({
      getIllustId: () => overrides.illustId ?? 12345,
      getUserId: () => (overrides.userId === undefined ? 999 : overrides.userId),
      saveWith: (...args: [RestrictType, string[]]) => saveWith(...args),
      getSaving: () => saving.value,
      onSaved,
    })
  })
  return { panel, saveWith, saving, onSaved, scope }
}

/** 让在飞 promise 链结算（load 内 await 若干层） */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('useBookmarkPanel 预填链路（spec D6）', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    loadBookmarkDetail.mockReset()
    loadUserBookmarkTags.mockReset()
  })

  it('打开：并行拉预填 + 标签库；已选 = detail.tags 中 is_registered 的项，可见性取 restrict', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse({ restrict: 'private' }))
    loadUserBookmarkTags.mockResolvedValue(universeResponse(['風景', '人物']))
    const h = mount()
    expect(h.panel.detailStatus.value).toBe('loading')
    await h.panel.load()
    expect(h.panel.detailStatus.value).toBe('ready')
    expect(h.panel.selected.value).toEqual(['オリジナル', '風景'])
    expect(h.panel.restrict.value).toBe('private')
    expect(h.panel.prefillBookmarked.value).toBe(true)
    // 可见性 private → 标签库按私密库拉取（分库）
    expect(loadUserBookmarkTags).toHaveBeenCalledWith(999, 'private', undefined, expect.anything())
    expect(h.panel.universeTags.value.map((tag) => tag.name)).toEqual(['風景', '人物'])
    expect(h.panel.universeStatus.value).toBe('ready')
    h.scope.stop()
  })

  it('未收藏（bookmark_detail 为 null）→ 空预填 + 公开，保存按钮语义为「收藏」', async () => {
    loadBookmarkDetail.mockResolvedValue({ bookmark_detail: null })
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    expect(h.panel.selected.value).toEqual([])
    expect(h.panel.restrict.value).toBe('public')
    expect(h.panel.prefillBookmarked.value).toBe(false)
    h.scope.stop()
  })

  it('预填失败 → detailStatus=error + console.warn + 保存禁用（无真值不覆盖，D6）', async () => {
    loadBookmarkDetail.mockRejectedValue(new Error('boom'))
    loadUserBookmarkTags.mockResolvedValue(universeResponse(['a']))
    const h = mount()
    await h.panel.load()
    expect(h.panel.detailStatus.value).toBe('error')
    expect(h.panel.detailError.value).toBe('boom')
    expect(h.panel.canSave.value).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[useBookmarkPanel]'),
      expect.any(Error),
    )
    // 面板仍可用（候选不受阻）
    expect(h.panel.universeStatus.value).toBe('ready')
    h.scope.stop()
  })

  it('响应缺 bookmark_detail 字段（契约破坏）→ 按预填失败处理：告警 + 禁存（不用空预填覆盖）', async () => {
    // 契约（T3 types + 研究 §7.3）：bookmark_detail 恒为 null 或对象；字段整体缺失 = 契约破坏
    loadBookmarkDetail.mockResolvedValue({} as PixivBookmarkDetailResponse)
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    expect(h.panel.detailStatus.value).toBe('error')
    expect(h.panel.canSave.value).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('缺 bookmark_detail 字段（契约破坏）'),
    )
    h.scope.stop()
  })

  it('标签库响应缺 bookmark_tags 字段（契约破坏）→ 告警 + 按空候选处理，保存不受阻', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse())
    loadUserBookmarkTags.mockResolvedValue({} as PixivUserBookmarkTagsResponse)
    const h = mount()
    await h.panel.load()
    expect(h.panel.universeTags.value).toEqual([])
    expect(h.panel.universeStatus.value).toBe('ready')
    expect(h.panel.canSave.value).toBe(true)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('缺 bookmark_tags 字段（契约破坏）'),
    )
    h.scope.stop()
  })

  it('detail 非空但缺 is_bookmarked（契约破坏）→ 告警 + 按未收藏处理（标签集仍按预填保留）', async () => {
    loadBookmarkDetail.mockResolvedValue({ bookmark_detail: { tags: [{ name: '風景', is_registered: true }] } } as PixivBookmarkDetailResponse)
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    expect(h.panel.detailStatus.value).toBe('ready')
    expect(h.panel.prefillBookmarked.value).toBe(false)
    expect(h.panel.selected.value).toEqual(['風景'])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('is_bookmarked 缺失（契约破坏）'),
    )
    h.scope.stop()
  })

  it('预填取私有可见性时重拉私密库（restrict 变化触发重拉，公开库响应被代数丢弃）', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse({ restrict: 'private' }))
    loadUserBookmarkTags.mockImplementation(async (_uid: number, restrict: string) =>
      universeResponse(restrict === 'private' ? ['私密标签'] : ['公开标签']),
    )
    const h = mount()
    await h.panel.load()
    // 首次按默认公开库起拉 → 预填改私密 → 重拉私密库（分库语义）
    expect(loadUserBookmarkTags).toHaveBeenCalledTimes(2)
    expect(loadUserBookmarkTags.mock.calls[1]?.[1]).toBe('private')
    expect(h.panel.universeTags.value.map((tag) => tag.name)).toEqual(['私密标签'])
    h.scope.stop()
  })

  it('标签库失败 → 降级提示（universeStatus=error）+ 保存仍可用（D6）', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse())
    loadUserBookmarkTags.mockRejectedValue(new Error('universe down'))
    const h = mount()
    await h.panel.load()
    expect(h.panel.universeStatus.value).toBe('error')
    expect(h.panel.universeError.value).toBe('universe down')
    expect(h.panel.universeTags.value).toEqual([])
    expect(h.panel.canSave.value).toBe(true)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[useBookmarkPanel] 标签库加载失败'),
      expect.any(Error),
    )
    h.scope.stop()
  })

  it('未登录（无 userId）→ 标签库显式降级且不发请求（禁止 user_id=0 垃圾请求）', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse())
    const h = mount({ userId: null })
    await h.panel.load()
    expect(loadUserBookmarkTags).not.toHaveBeenCalled()
    expect(h.panel.universeStatus.value).toBe('error')
    expect(h.panel.universeError.value).toBe(UNAUTHENTICATED_MARKER)
    h.scope.stop()
  })

  it('dispose 中止在途请求（关闭面板不留悬挂响应写状态）', async () => {
    let signal: AbortSignal | undefined
    loadBookmarkDetail.mockImplementation(async (_id: number, s?: AbortSignal) => {
      signal = s
      return detailResponse()
    })
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    const pending = h.panel.load()
    h.panel.dispose()
    expect(signal?.aborted).toBe(true)
    await pending
    expect(h.panel.detailStatus.value).toBe('loading') // 晚到响应被丢弃
    h.scope.stop()
  })
})

describe('useBookmarkPanel 选择交互（spec D5/D11）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    loadBookmarkDetail.mockReset()
    loadUserBookmarkTags.mockReset()
  })

  async function ready(): Promise<Harness> {
    loadBookmarkDetail.mockResolvedValue({ bookmark_detail: null })
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    return h
  }

  it('勾选/取消：二次 toggle 回到原状（幂等），无反馈', async () => {
    const h = await ready()
    h.panel.toggleTag('風景')
    expect(h.panel.selected.value).toEqual(['風景'])
    expect(h.panel.feedback.value).toBeNull()
    h.panel.toggleTag('風景')
    expect(h.panel.selected.value).toEqual([])
    h.scope.stop()
  })

  it('上限 10：第 11 个被拒收 + feedback=limit（已选集不变），反馈 2.5s 后自动清除', async () => {
    const h = await ready()
    for (let i = 0; i < BOOKMARK_TAG_LIMIT; i++) h.panel.toggleTag(`tag${i}`)
    expect(h.panel.selected.value).toHaveLength(10)
    h.panel.toggleTag('tag10')
    expect(h.panel.selected.value).toHaveLength(10)
    expect(h.panel.selected.value).not.toContain('tag10')
    expect(h.panel.feedback.value).toBe('limit')
    vi.advanceTimersByTime(BOOKMARK_PANEL_FEEDBACK_MS)
    expect(h.panel.feedback.value).toBeNull()
    h.scope.stop()
  })

  it('新建提交：空格 token trim 后入集并清空输入（D11：空格即提交，含内部空格原样入集）', async () => {
    const h = await ready()
    h.panel.input.value = '  新しい タグ '
    h.panel.commitInput()
    expect(h.panel.selected.value).toEqual(['新しい タグ'])
    expect(h.panel.input.value).toBe('')
    h.scope.stop()
  })

  it('新建提交失败：空串 → feedback=empty；重复 → feedback=duplicate（均不改已选/不清空输入）', async () => {
    const h = await ready()
    h.panel.toggleTag('風景')
    h.panel.input.value = '   '
    h.panel.commitInput()
    expect(h.panel.feedback.value).toBe('empty')
    expect(h.panel.input.value).toBe('   ')
    h.panel.input.value = '風景'
    h.panel.commitInput()
    expect(h.panel.feedback.value).toBe('duplicate')
    expect(h.panel.selected.value).toEqual(['風景'])
    h.panel.input.value = ''
    h.scope.stop()
  })
})

describe('useBookmarkPanel 保存（spec D2/D9 + US12）', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    loadBookmarkDetail.mockReset()
    loadUserBookmarkTags.mockReset()
  })

  it('保存经宿主 saveWith 且载荷 = (可见性, 完整已选集)；成功回调 onSaved(restrict)', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse({ restrict: 'private' }))
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    h.panel.toggleTag('新标签')
    await h.panel.save()
    expect(h.saveWith).toHaveBeenCalledWith('private', ['オリジナル', '風景', '新标签'])
    expect(h.onSaved).toHaveBeenCalledWith('private')
    h.scope.stop()
  })

  it('未收藏作品保存：可见性缺省公开 + 空标签集也算有效保存（US7/US8）', async () => {
    loadBookmarkDetail.mockResolvedValue({ bookmark_detail: null })
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    await h.panel.save()
    expect(h.saveWith).toHaveBeenCalledWith('public', [])
    expect(h.onSaved).toHaveBeenCalledTimes(1)
    h.scope.stop()
  })

  it('保存失败（宿主 saveWith 返回 false）→ 回滚预填态 + 不触发 onSaved + 面板保持打开', async () => {
    loadBookmarkDetail.mockResolvedValue(detailResponse({ restrict: 'public' }))
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    // 宿主失败行为 = useBookmarkMutation.saveWith 的失败静息回滚（不 throw、只返回 false）；
    // 本用例刻意不提供任何错误文案，成败判定只可能来自返回值（FIX-2：禁用 errorMsg 字符串哨兵）
    const h = mount({ saveBehavior: () => false })
    await h.panel.load()
    h.panel.toggleTag('风景')
    h.panel.toggleTag('新しい')
    h.panel.restrict.value = 'private'
    await h.panel.save()
    expect(h.saveWith).toHaveBeenCalledWith('private', ['オリジナル', '風景', '风景', '新しい'])
    expect(h.onSaved).not.toHaveBeenCalled()
    // 回滚到预填快照（spec US12：不丢上下文）
    expect(h.panel.selected.value).toEqual(['オリジナル', '風景'])
    expect(h.panel.restrict.value).toBe('public')
    h.scope.stop()
  })

  it('失败返回 false 时面板不关（onSaved 只由 true 触发）：成功 → 关面板回调、失败 → 保持打开', async () => {
    loadBookmarkDetail.mockResolvedValue({ bookmark_detail: null })
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const fail = mount({ saveBehavior: () => false })
    await fail.panel.load()
    await fail.panel.save()
    expect(fail.onSaved).not.toHaveBeenCalled()
    fail.scope.stop()

    const ok = mount({ saveBehavior: () => true })
    await ok.panel.load()
    await ok.panel.save()
    expect(ok.onSaved).toHaveBeenCalledTimes(1)
    ok.scope.stop()
  })

  it('预填未就绪（detail 失败）→ 保存 no-op（禁存，D6）', async () => {
    loadBookmarkDetail.mockRejectedValue(new Error('boom'))
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    await h.panel.save()
    expect(h.saveWith).not.toHaveBeenCalled()
    h.scope.stop()
  })

  it('宿主 saving=true（在飞）→ canSave=false 且保存 no-op（与 toggle 共用 busy 锁语义）', async () => {
    loadBookmarkDetail.mockResolvedValue({ bookmark_detail: null })
    loadUserBookmarkTags.mockResolvedValue(universeResponse([]))
    const h = mount()
    await h.panel.load()
    h.saving.value = true
    expect(h.panel.canSave.value).toBe(false)
    await h.panel.save()
    expect(h.saveWith).not.toHaveBeenCalled()
    h.scope.stop()
  })
})
