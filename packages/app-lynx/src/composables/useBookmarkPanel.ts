// ─── 收藏面板状态机 composable（T5 / issue #534，spec docs/specs/bookmark-tags.md D5/D6/D8）───
//
// 面板的全部数据与交互状态收敛在此（组件 BookmarkPanel.vue 只做渲染与事件转接），
// 与 webview 面板同语义（packages/app/src/components/BookmarkPanel.tsx）：
// - 预填（D6）：打开时 loadBookmarkDetail 取服务端真值 → 已选标签（detail.tags 中
//   is_registered 的项，见 docs/research/bookmark-tags-similar-clients.md §7.3：detail.tags
//   = 作品标签 + is_registered 标记「用户收藏标签库已有该标签」）+ 可见性；
// - 标签库（D4/D6）：loadUserBookmarkTags 按可见性分库拉候选，切换可见性即重拉；
// - 选择 reducer（D5）：toggle/上限/去重/新建提交全部走 utils/bookmarkTags 纯函数；
// - 保存（D2/D9）：经宿主 saveWith（useBookmarkMutation 的覆盖式保存变体）——面板**不**
//   直连 addBookmark，保留乐观状态机与六条不变量；成败按宿主 saveWith 的显式返回值判定
//   （FIX-2），失败回滚预填态（errorMsg 仅由组件渲染文案，不作成败推断依据）。
//
// 竞态防护（用户故事 13 家族 / 硬约束 3）：detail 与标签库各自持 generation + AbortController，
// 关闭（dispose）/作品变化/可见性切换都会中止旧请求，晚到响应按代数丢弃。
//
// 错误路径（禁止静默降级，测试硬约束 #3）：
// - 预填失败 → detailStatus='error' + 面板内提示 + 保存禁用（无真值不覆盖，D6）；
// - 标签库失败 → universeStatus='error' + 候选区降级提示，保存不受阻（D6）；
//   未登录（无 userId）同样显式降级（不发 user_id=0 的垃圾请求）；
// - 保存失败（宿主 saveWith 返回 false）→ 回滚预填态 + 面板保持打开（US12）——成败判定
//   不读 errorMsg 文案（FIX-2 显式成败通道）。
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { loadBookmarkDetail, loadUserBookmarkTags } from '../api/illust'
import type { PixivBookmarkDetail, RestrictType } from '../api/types'
import { apiErrorMessage, t } from '../i18n'
import { toApiError } from '../utils/errors'
import { commitBookmarkTagToken, toggleBookmarkTag } from '../utils/bookmarkTags'

/** 标签库条目（GET /v1/user/bookmark-tags/illust 的 bookmark_tags[] 元素形状：name + 使用计数） */
export interface BookmarkTagUniverseItem {
  name: string
  count: number
}

/** 输入/选择反馈类别（文案由组件经 i18n 渲染） */
export type BookmarkPanelFeedback = 'limit' | 'empty' | 'duplicate'

/** 数据源加载态：loading / ready / error（idle = 尚未发起） */
export type BookmarkPanelLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 反馈文案保留时长（与 webview 面板同为瞬态 2.5s） */
export const BOOKMARK_PANEL_FEEDBACK_MS = 2500

/** 未登录（无 userId）时的标签库降级标记（与 webview 面板同字面量，双端差分可对齐） */
export const UNAUTHENTICATED_MARKER = 'unauthenticated'

export interface UseBookmarkPanelOptions {
  /** 目标插画 id（getter：作品变化时重载并中止旧请求） */
  getIllustId: () => number
  /** 当前登录用户 id（标签库作用域；null = 未登录 → 标签库降级） */
  getUserId: () => number | null
  /** 宿主收藏状态机的保存变体（T4 saveWith）——面板保存的唯一通道；
   * 返回 true=成功 / false=失败静息回滚（或 busy no-op）——成败判定的唯一依据（FIX-2） */
  saveWith: (restrict: RestrictType, tags: string[]) => Promise<boolean>
  /** 宿主 mutation 的 busy 读取器（保存中禁存） */
  getSaving: () => boolean
  /** 保存成功回调（宿主更新页面收藏态并关面板） */
  onSaved?: (restrict: RestrictType) => void
}

export interface UseBookmarkPanelReturn {
  readonly restrict: Ref<RestrictType>
  readonly selected: Ref<string[]>
  readonly input: Ref<string>
  readonly feedback: Ref<BookmarkPanelFeedback | null>
  readonly universeTags: Ref<BookmarkTagUniverseItem[]>
  readonly detailStatus: Ref<BookmarkPanelLoadStatus>
  /** 预填失败原因（渲染进 bookmarkPanel.detailFailed 的 {{detail}}） */
  readonly detailError: Ref<string>
  readonly universeStatus: Ref<BookmarkPanelLoadStatus>
  /** 标签库失败原因 / UNAUTHENTICATED_MARKER（仅调试与测试消费，UI 只显示降级提示） */
  readonly universeError: Ref<string>
  /** 预填的已收藏态（保存按钮「收藏 / 保存修改」文案依据） */
  readonly prefillBookmarked: Ref<boolean>
  /** 可保存：预填真值就绪且宿主未在保存中（D6 无真值不覆盖） */
  readonly canSave: ComputedRef<boolean>
  /** 打开时调用（宿主 v-if 挂载 → onMounted）：并行发起预填 + 标签库 */
  load(): Promise<void>
  toggleTag(name: string): void
  commitInput(): void
  save(): Promise<void>
  /** 关闭/卸载：中止全部在途请求 + 清计时器，此后所有异步回调不再写状态 */
  dispose(): void
}

export function useBookmarkPanel(options: UseBookmarkPanelOptions): UseBookmarkPanelReturn {
  const restrict = ref<RestrictType>('public')
  const selected = ref<string[]>([])
  const input = ref('')
  const feedback = ref<BookmarkPanelFeedback | null>(null)
  const universeTags = ref<BookmarkTagUniverseItem[]>([])
  const detailStatus = ref<BookmarkPanelLoadStatus>('loading')
  const detailError = ref('')
  const universeStatus = ref<BookmarkPanelLoadStatus>('idle')
  const universeError = ref('')
  const prefillBookmarked = ref(false)

  // ── 预填快照（保存失败回滚的还原点，spec D6 / US12）──
  let prefillSelected: string[] = []
  let prefillRestrict: RestrictType = 'public'

  let disposed = false
  let detailGen = 0
  let universeGen = 0
  let detailAc: AbortController | null = null
  let universeAc: AbortController | null = null
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null
  /** 复位期间抑制「可见性 → 重拉标签库」监听（避免复位动作额外发一次请求） */
  let suppressUniverseWatch = false

  const canSave = computed(() => detailStatus.value === 'ready' && !options.getSaving())

  /** 错误 → 展示文案（messageKey 优先，fallback 兜底；禁止空串） */
  function errorText(e: unknown, fallback: string): string {
    return apiErrorMessage(toApiError(e, fallback)) || fallback
  }

  function setFeedback(next: BookmarkPanelFeedback | null): void {
    feedback.value = next
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
    }
    if (next !== null) {
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null
        feedback.value = null
      }, BOOKMARK_PANEL_FEEDBACK_MS)
    }
  }

  function applyPrefill(detail: PixivBookmarkDetail | null): void {
    // detail 非空但缺 is_bookmarked = 契约破坏（禁止静默降级：显式告警，按未收藏处理）
    if (detail !== null && detail.is_bookmarked === undefined) {
      console.warn('[useBookmarkPanel] bookmark_detail.is_bookmarked 缺失（契约破坏），按未收藏处理')
    }
    const marked = (detail?.tags ?? [])
      .filter((tag) => tag.is_registered)
      .map((tag) => tag.name)
    const nextRestrict: RestrictType = detail?.restrict === 'private' ? 'private' : 'public'
    prefillSelected = [...marked]
    prefillRestrict = nextRestrict
    prefillBookmarked.value = detail?.is_bookmarked === true
    selected.value = [...marked]
    restrict.value = nextRestrict
  }

  async function loadUniverse(): Promise<void> {
    universeGen++
    universeAc?.abort()
    universeAc = null
    universeTags.value = []
    universeError.value = ''
    if (disposed) return
    const userId = options.getUserId()
    if (!userId) {
      // 未登录：显式降级（不发 user_id=0 的垃圾请求），标签库只影响候选、不阻塞保存
      console.warn('[useBookmarkPanel] 标签库跳过：未登录（无 userId）')
      universeError.value = UNAUTHENTICATED_MARKER
      universeStatus.value = 'error'
      return
    }
    const controller = new AbortController()
    universeAc = controller
    const myGen = universeGen
    const restrictAtLoad = restrict.value
    universeStatus.value = 'loading'
    try {
      const res = await loadUserBookmarkTags(userId, restrictAtLoad, undefined, controller.signal)
      if (disposed || myGen !== universeGen || controller.signal.aborted) return
      if (res.bookmark_tags === undefined) {
        // 字段契约恒在（PixivUserBookmarkTagsResponse.bookmark_tags）——缺失即契约破坏，显式告警
        console.warn('[useBookmarkPanel] 标签库响应缺 bookmark_tags 字段（契约破坏），按空候选处理')
      }
      universeTags.value = res.bookmark_tags ?? []
      universeStatus.value = 'ready'
    } catch (e) {
      if (disposed || myGen !== universeGen || controller.signal.aborted) return
      console.warn('[useBookmarkPanel] 标签库加载失败', e)
      universeTags.value = []
      universeError.value = errorText(e, t('error.fallback.loadFailed'))
      universeStatus.value = 'error'
    }
  }

  // 可见性切换 → 标签库按分库重拉（spec D6/D7）。sync 刷使重拉时机确定（测试可断言）。
  watch(
    restrict,
    () => {
      if (suppressUniverseWatch) return
      void loadUniverse()
    },
    { flush: 'sync' },
  )

  // 作品变化（同一面板实例被复用）→ 整体重载 + 中止旧请求
  watch(
    () => options.getIllustId(),
    (id, prev) => {
      if (id !== prev) void load()
    },
  )

  function resetState(): void {
    suppressUniverseWatch = true
    restrict.value = 'public'
    suppressUniverseWatch = false
    selected.value = []
    input.value = ''
    prefillSelected = []
    prefillRestrict = 'public'
    prefillBookmarked.value = false
    detailStatus.value = 'loading'
    detailError.value = ''
    universeTags.value = []
    universeError.value = ''
    universeStatus.value = 'idle'
    setFeedback(null)
  }

  async function load(): Promise<void> {
    if (disposed) return
    detailGen++
    universeGen++
    detailAc?.abort()
    detailAc = null
    universeAc?.abort()
    universeAc = null
    resetState()
    const controller = new AbortController()
    detailAc = controller
    const myGen = detailGen
    // 标签库与预填并行（D6）：先按当前可见性起拉；预填若为 private，restrict 变化经
    // 上方 watch 重拉私密库（与 webview 的 restrict 依赖效应同语义）
    void loadUniverse()
    try {
      const res = await loadBookmarkDetail(options.getIllustId(), controller.signal)
      if (disposed || myGen !== detailGen || controller.signal.aborted) return
      // `bookmark_detail` 字段整体缺失 = 契约破坏（契约恒返回 null 或对象）：按预填失败处理
      // （禁存）——无法区分「未收藏」与「服务端未返回」，不得用空预填覆盖既有收藏（D6）
      if (res?.bookmark_detail === undefined) {
        console.warn('[useBookmarkPanel] 收藏详情响应缺 bookmark_detail 字段（契约破坏），保存已禁用')
        detailError.value = t('error.fallback.loadFailed')
        detailStatus.value = 'error'
        return
      }
      applyPrefill(res.bookmark_detail)
      detailStatus.value = 'ready'
    } catch (e) {
      if (disposed || myGen !== detailGen || controller.signal.aborted) return
      console.warn('[useBookmarkPanel] 收藏详情加载失败', e)
      detailError.value = errorText(e, t('error.fallback.loadFailed'))
      detailStatus.value = 'error'
    }
  }

  function toggleTag(name: string): void {
    const res = toggleBookmarkTag(selected.value, name)
    selected.value = res.selected
    // 超限拒收 → 明确反馈（D5/US9）；正常勾选/取消清除上一条反馈
    setFeedback(res.rejected === 'limit' ? 'limit' : null)
  }

  function commitInput(): void {
    const res = commitBookmarkTagToken(selected.value, input.value)
    if (res.error) {
      setFeedback(res.error)
      return
    }
    selected.value = res.selected
    input.value = ''
    setFeedback(null)
  }

  async function save(): Promise<void> {
    if (!canSave.value) return
    const restrictAtSave = restrict.value
    const tagsAtSave = [...selected.value]
    // 成败由宿主 saveWith 的显式返回值判定（FIX-2：saveWith 失败静息回滚 → false）；
    // errorMsg 只用于组件渲染文案，不再作为成败的字符串哨兵
    const ok = await options.saveWith(restrictAtSave, tagsAtSave)
    if (disposed) return
    if (!ok) {
      // 回滚到预填态（US12：不丢上下文），错误文案由面板 footer 呈现宿主 errorMsg
      selected.value = [...prefillSelected]
      restrict.value = prefillRestrict
      setFeedback(null)
      return
    }
    options.onSaved?.(restrictAtSave)
  }

  function dispose(): void {
    disposed = true
    detailGen++
    universeGen++
    detailAc?.abort()
    detailAc = null
    universeAc?.abort()
    universeAc = null
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
    }
  }

  return {
    restrict,
    selected,
    input,
    feedback,
    universeTags,
    detailStatus,
    detailError,
    universeStatus,
    universeError,
    prefillBookmarked,
    canSave,
    load,
    toggleTag,
    commitInput,
    save,
    dispose,
  }
}
