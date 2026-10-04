<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch } from 'vue'
import { useMainThreadRef, runOnBackground } from 'vue-lynx'
import { computeReadProgress } from '../primitives/watchlistPrompt'
import { novelAverageParagraphHeightPx } from '../primitives/novelParagraphEstimate'
import { resolveNovelContentGeometry } from '../primitives/novelContentFitsViewport'
import { subscribeViewportSize } from '../utils/viewportSizeBridge'
import type { ViewportContentSize, ViewportSystemInfo } from '../utils/viewportGeometry'
import { currentParams, goBack, navigate, requestBack, registerBackGuard } from '../router'
import { loadNovelDetail, fetchNovelData, loadNovelSeries, addNovelWatchlist, loadNovelSeriesChapters } from '../api/novel'
import { toNovelId, toSeriesId } from '../api/id'
import type { NovelExportFormat, NovelImagesMap } from '@pictelio/novel-export'
import { buildNovelExportPayload, buildNovelExportTaskDraft } from '@pictelio/novel-export'
import type { PixivNovel } from '../api/types'
import { useContinueReadingStore, toNovelContinueSnapshot, decideNovelCompletion } from '../stores/continueReadingStore'
import { artworkTitle } from '../utils/artworkTitle'
import { presentError } from '../utils/errorPresentation'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import AppIcon from '../components/AppIcon.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import ActionButton from '../components/ActionButton.vue'
import { LATER_ICON } from '../utils/watchLaterGlyph'
import { useWatchLaterStore, toNovelSnapshot } from '../stores/watchLaterStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useDownloadStore } from '../stores/downloadStore'
import { useNovelTranslateStore } from '../stores/novelTranslateStore'
import { isDismissed, markDismissed, setWatchState, getWatchState } from '../stores/watchlistStore'
import {
  createWatchlistPrompt,
  type WatchlistPromptController,
} from '../primitives/createWatchlistPrompt'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import AiOverlay from '../components/AiOverlay.vue'
import TranslateButton from '../components/TranslateButton.vue'
import TranslateModeSwitch from '../components/TranslateModeSwitch.vue'
import { t } from '../i18n'

const settings = useSettingsStore()
const isRestricted = settings.isRestricted
const isAiRestricted = settings.isAiRestricted
import CommentOverlay from '../components/CommentOverlay.vue'
import NovelExportSheet from '../components/NovelExportSheet.vue'
// 底部遮挡让位（ADR-0217 / 票 #922 / 术语文档 glossary-bottom-occlusion-allowance.md）：
// 模板末尾的让位占位。本页是**非 tab 内容页** ⇒ 档位为 search（让位 58.668vw）。
//   **档位/高度/遮挡源/接线约定全部写在 `FabAllowanceSpacer.vue` 头注，本页只负责接线。**
//   本页是票 #922 全量盘点（25 条路由）出的 4 个漏网页之一，补在 #922。
// · 必须由本页写在滚动容器内末尾（原生 list 只认 list-item 子节点）。
// · 不得塞进上方 footer 之类的三态条件渲染容器（ADR-0217 §2.2 / spec C1）。
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import SkeletonNovel from '../components/SkeletonNovel.vue'
import WatchlistPromptDialog from '../components/WatchlistPromptDialog.vue'
import TextSelectionToolbar from '../components/TextSelectionToolbar.vue'
import { useTextSelection } from '../composables/useTextSelection'

// 顶部安全区让位高度（**逻辑 px**；safeArea.ts 已完成物理→逻辑换算，此处不得再乘除 density）。
// 数值来源唯一：utils/topInset.ts 按当前路由 meta 裁决，公共入口 = composables/useTopInsetSpacer。
// 'bleed'（内容铺到状态栏底下）下恒 0 ⇒ 模板里的 spacer 是 0 高，正确行为，不特判。
const topInsetSpacer = useTopInsetSpacer()

const novel = ref<PixivNovel | null>(null)
const text = ref('')
/** 正文内嵌图片映射（[pixivimage:id] → 图片 URL 档位），导出 payload 用 */
const novelImages = ref<NovelImagesMap>({})
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

// ─── 稍后看（WatchLater，ADR-0191 D5）[维度重构 2026-10-03 新增] ───
// ⚠️ 为什么正文页此前**没有**收藏/稍后看、而介绍页（NovelIntro）有：
//   能力被绑在了「介绍页」这个**路由**上，而不是绑在「这本书」这个对象上。
//   用户正在读书正文时想收藏，必须先退回介绍页 —— 这正是本次维度重构要修的「耦合错位 A」。
//   本页接上后，能力绑对象：同一本书从介绍页或正文页进入，都能收藏/稍后看。
const watchLater = useWatchLaterStore()
const laterAdded = computed(() => watchLater.has('novel', novelId.value))

function toggleWatchLater(): void {
  const n = novel.value
  if (!n) return
  watchLater.toggle(toNovelSnapshot(n))
}

// ─── 评论弹层（issue #164）：入口在作者/元信息行附近；弹层挂根 view 内、scroll-view 之后 ───
const showComments = ref(false)

// ─── 小说导出（spec docs/specs/novel-export.md §7.2 / ADR-0154 D7）───
// 入口仅在正文可用时渲染；面板格式为本次临时选择，内容开关取设置页快照（入队即快照）。
const exportOpen = ref(false)
/** 内联状态提示（lynx 无全局 toast）：约 4s 后自动隐藏 */
const exportNotice = ref('')
let exportNoticeTimer: ReturnType<typeof setTimeout> | undefined
const downloads = useDownloadStore()

/** 构造导出载荷并加入下载队列（格式为本次临时选择，不写回设置） */
function enqueueNovelExport(format: NovelExportFormat): void {
  const n = novel.value
  if (!n) return
  const payload = buildNovelExportPayload({
    novel: n,
    text: text.value,
    images: novelImages.value,
    options: settings.novelExportOptions,
  })
  const draft = buildNovelExportTaskDraft({
    payload,
    format,
    title: n.title,
    thumbnailUrl: n.image_urls.medium ?? n.image_urls.large ?? '',
  })
  downloads.enqueue([draft])
  exportOpen.value = false
  exportNotice.value = t('novelDetail.export.queued') // i18n: 赋值时快照（瞬态）
  clearTimeout(exportNoticeTimer)
  exportNoticeTimer = setTimeout(() => {
    exportNotice.value = ''
  }, 4000)
}

// ─── 追更询问（issue #226 / spec §US4 接线半） ───
// 页面保持薄：预取 + 触发判定 + 弹窗状态机全部在 createWatchlistPrompt；
// 本页只做三件事——喂滚动事件、把 requestBack 接进返回守卫、按状态渲染弹窗。
// novel-detail 不在 App.vue KeepAlive include 白名单（详情页按 :id 加载，不缓存）；
// 守卫在 setup 顶层注册（registerBackGuard）+ onUnmounted 注销，prompt 随详情落地创建——
// 对非缓存组件 setup/onUnmounted 与 onMounted 等价，无需 onActivated/onDeactivated。
// shallowRef：模板读 prompt 的 dialogOpen/watchAdded 等 getter，实例本身被替换时也要触发重渲染
//（控制器内部已是响应式，不需要深层代理）
const prompt = shallowRef<WatchlistPromptController | null>(null)

/** 详情加载完成后创建 prompt（此时 novel.series 已知，预取才能发起） */
function setupPrompt(): void {
  prompt.value = createWatchlistPrompt({
    getSeries: () => novel.value?.series ?? null,
    loadWatchState: async (seriesId) =>
      (await loadNovelSeries(toSeriesId(seriesId))).novel_series_detail.watchlist_added,
    isDismissed,
    markDismissed,
    setWatchState,
    // ADR-0189 D5：computed watchAdded 派生来源——弹窗 confirm / 介绍页 inline toggle
    // 写入 cache 后，正文页 dialogOpen 守卫 / 模板引用保持一致
    getWatchState,
    addWatchlist: (seriesId) => addNovelWatchlist(toSeriesId(seriesId)),
  })
}

function teardownPrompt(): void {
  prompt.value?.dispose()
  prompt.value = null
}

// 系统返回桥（ADR-0066 扩展）：guard 在 modalStack 之后、历史栈 pop 之前裁决；
// prompt 未创建（加载期/非系列）时放行，与左上角 requestBack() 共用同一守卫链
const unregisterBackGuard = registerBackGuard(() => prompt.value?.requestBack() ?? false)

// ─── 滚动跟踪（ADR-0134：MT 信号；BT @scroll 不派发） ───
// [prototype→spike] 滚动信号面：官方 list 只有边界事件（scrolltolower/scrolltoupper）；
// 到「底部」由 @scrolltolower 权威触发（reachBottom 供追更询问），上端进度信号见 MT 实验。
const reachedBottom = ref(false)

// 主线程滚动信号（ADR-0134）：<list> 经 :main-thread-bindscroll 接收 scrollTop（BT @scroll 不派发）。
// MT→BT 传递用 runOnBackground 官方桥（BT 读 .value 的跨线程同步不可靠——真机实证）；节流：
// 上次上报后滚动增量 <8% 高度不重复上报（防每帧跨线程消息风暴）。
const mtReportedTop = useMainThreadRef(-1)
const mtHeightWarned = useMainThreadRef(false)
// ⚠️ 已知（2026-09-02 真机复测）：main-thread-bindscroll 事件在本构建未确认派发
//（原型同日同设备曾实证一次；当前构建复测无事件）。桥接保留：派发恢复即生效（≥70% 复活），
// 未派发期间追更询问回落「仅到底」兜底（与用户确认语义 4a 一致，非静默降级——warn 兜底）。
function onNovelScrollMT(e: { detail?: { scrollTop?: number; scrollHeight?: number } }): void {
  'main thread'
  const top = Number(e?.detail?.scrollTop ?? 0)
  const height = Number(e?.detail?.scrollHeight ?? 0)
  if (height <= 0) {
    // 禁止静默降级：MT payload 缺 scrollHeight 时 ≥70% 信号失效（只剩到底兜底）——仅 warn 一次
    if (!mtHeightWarned.current) {
      mtHeightWarned.current = true
      console.warn('[novel-detail] MT scroll payload 缺 scrollHeight，≥70% 信号不可用')
    }
    return
  }
  if (mtReportedTop.current >= 0 && Math.abs(top - mtReportedTop.current) < height * 0.08) return
  mtReportedTop.current = top
  // vue-lynx 的 runOnBackground 约束回调参数为 unknown；调用方传入的是 number，与上方 payload 同用 Number() 收敛
  void runOnBackground((t: unknown, h: unknown) => {
    // 在背景线程执行：live 读 prompt/reachedBottom；进度纯函数复用 computeReadProgress
    //（viewport=0 保守口径，单测已覆盖 watchlistPrompt.test.ts）
    reportNovelProgress(computeReadProgress(Number(t), Number(h), 0))
  })(top, height)
}


function onNovelToBottom(): void {
  reachedBottom.value = true
  // 📌 完成判定挂在这里（ADR-0219 §2.3 触底行 / 票 #928）：`@scrolltolower` 是**唯一**的
  //   触底权威信号。⚠️ 本函数**不得**出现任何写位置的调用——位置记录是「进入即记、零门槛」
  //   （见 loadNovel 内），挂到这里会让「仅触底」也记位置，判定被放宽
  //   （源级守卫 novelIntroEntryGuards / continueReadingWiring 的反例守卫钉住这一点）。
  //   完成判定同时也要在章节坐标后台落地后再跑一次（见 evaluateCompletion）。
  evaluateCompletion(loadGeneration)
  prompt.value?.notifyScroll(1, true)
}

/** MT→BT 桥回调（runOnBackground）：向追更 prompt 喂最新进度（≥70% 双路判定输入） */
function reportNovelProgress(progress: number): void {
  prompt.value?.notifyScroll(progress, reachedBottom.value)
}

// 正文列表虚拟化（ADR-0134）：段落为 list-item，引擎按需挂载；各 item 共用估算高度。
// 超长文本不再一次性渲染（原型实测深滚 jank 22.6%→8.2%、内存 -42%）。
const paragraphs = computed(() => {
  if (!text.value) return []
  return text.value
    .split(/\n+/u)
    .map((p) => p.trim())
    .filter(Boolean)
})

/** 列表 estimated 高度：正文段落中位高度（估算纯函数，见 primitives/novelParagraphEstimate） */
const estimatedHeightPx = computed(() => novelAverageParagraphHeightPx(paragraphs.value))

// ─── 小说翻译集成（spec docs/specs/app-lynx-novel-translation.md §6.2） ───
// 单源 store：UI 状态全部经 useNovelTranslateStore 读写，本页只接线不持本地状态。
// generation-gate 与现有 loadNovel 并存：翻译 chapterId = 当前 novelId（单本小说语义）。
const translateStore = useNovelTranslateStore()

/** 当前 novel 的 R18 等级（闸门输入；spec §9.7） */
const xRestrict = computed<0 | 1 | 2>(() => {
  const r = novel.value?.x_restrict
  return r === 1 || r === 2 ? r : 0
})

/** 是否启用翻译功能：未受限 + 有正文 */
const translationEnabled = computed<boolean>(() => {
  // R-18 闸门（spec §9.7）：受限作品默认不提供翻译入口。
  // 「已开启 R18 显示」= 用户在设置里明确选择了显示这类内容 → 视为对翻译的同一授权，
  // 不再额外二次确认（授权语义与内容显示对齐，避免同一意图问两遍）。
  if (settings.showR18 && settings.showR18G) {
    return paragraphs.value.length > 0
  }
  return paragraphs.value.length > 0 && xRestrict.value === 0
})

/** 是否已配置 LLM endpoint（决定翻译按钮态 = 「配置翻译」，spec §6.2） */
const endpointConfigured = ref<boolean>(false)

/** 首次进入时问一次 endpoint 配置态（失败保持 false → 按钮显示「配置翻译」，可自愈） */
onMounted(() => {
  void translateStore
    .loadEndpointConfig()
    .then((ep) => {
      endpointConfigured.value = ep !== null
    })
    .catch((err: unknown) => {
      console.warn('[NovelDetail] endpoint 配置态读取失败（按未配置处理）', err)
    })
})

/** 跳设置页（spec §6.2「未译 + 无 endpoint → 配置翻译 → 跳 /me」） */
function goConfigureTranslation(): void {
  void navigate('/me')
}

/**
 * 错误码 → i18n 键（ADR-0173 D7；仓库惯例同 apiErrorMessage / presentError）。
 * 直接渲染 err.message 会把原生英文技术串（或中文 Java 文案）漏给用户与 en 词条。
 */

/** 翻译失败/部分失败的内联提示（§6.4 最小形态；此前 store.error 全仓无渲染点） */
const translateErrorText = computed<string>(() => {
  const err = translateStore.error
  if (err === null) return ''
  const status = translateStore.status
  // #640 step 6：授权拦截走的是 `aborted`（不是 failed/partial）—— 此前该状态被排除，
  // 导致 R18 / R18G 未授权时用户点了按钮**没有任何提示**（静默 no-op）。放开 aborted，
  // 但仅对 R18*_BLOCKED 两类码显示（其余 aborted 是用户主动取消，不该报错）。
  if (status === 'aborted') {
    return err.code === 'R18_BLOCKED' || err.code === 'R18G_BLOCKED'
      ? t(err.code === 'R18G_BLOCKED' ? 'novelTranslate.error.r18gBlocked' : 'novelTranslate.error.R18Blocked')
      : ''
  }
  if (status !== 'failed' && status !== 'partial') return ''
  switch (err.code) {
    case 'network':
      return t('novelTranslate.error.network')
    case 'unauthorized':
      return t('novelTranslate.error.unauthorized')
    case 'rate_limit':
      return t('novelTranslate.error.rateLimit')
    case 'server':
      return t('novelTranslate.error.server')
    case 'timeout':
      return t('novelTranslate.error.timeout')
    case 'canceled':
      return t('novelTranslate.error.canceled')
    case 'NOT_CONFIGURED':
      return t('novelTranslate.error.notConfigured')
    case 'R18_BLOCKED':
      return t('novelTranslate.error.R18Blocked')
    case 'PARTIAL_FAILED':
      return t('novelTranslate.error.partialFailed')
    case 'insufficient_balance':
      return t('novelTranslate.error.insufficientBalance')
    case 'model_not_found':
    case 'endpoint_not_responses':
      return t('novelTranslate.error.modelNotFound')
    case 'invalid_request':
      return t('novelTranslate.error.invalidRequest')
    case 'content_filter':
      return t('novelTranslate.error.contentFilter')
    // ADR-0178 D2：输出截断（max_output_tokens）—— 调用点完备性：新码必须有 UI 映射
    case 'incomplete':
      return t('novelTranslate.error.incomplete')
    default:
      return t('novelTranslate.error.unknown')
  }
})

/** 正文渲染源：译文/原文由 store 的 displayParagraphs 单点决定（spec §6.3 整段切换） */
const displayParagraphs = computed<string[]>(() =>
  translateStore.displayParagraphs.length > 0
    ? translateStore.displayParagraphs
    : paragraphs.value,
)

/** ADR-0178 D4 占位符字符串：与 store.refreshDisplay 内 t('novelTranslate.status.placeholder_untranslated') 必须同源 */
const untranslatedPlaceholder = computed<string>(() =>
  t('novelTranslate.status.placeholder_untranslated'),
)

/** 章节切换 / 卸载时复位 store（spec §5：generation-gate 防 stale 覆盖） */
watch(novelId, (id, prev) => {
  if (id && id !== prev) translateStore.reset()
})

// ─── 正文选中与操作菜单（spec docs/specs/app-lynx-novel-text-selection.md）───
// 页面唯一入口：会话（深模块）+ 工具栏视图；引擎事件、测矩、定位、收起、剪贴板、搜索全在模块内。
const selection = useTextSelection({ paragraphs })

/** 工具栏条目动作（组件只报 key，语义在会话内） */
function onSelectionAction(key: 'copy' | 'search'): void {
  if (key === 'copy') {
    selection.copy()
    return
  }
  selection.search()
}

// generation-gate：章节内跳转（watch novelId 触发重载）后旧响应不得覆盖新数据
let loadGeneration = 0

// ─── 续读记录（ADR-0219 §2.2 会话末位置 / 票 #926）───
const continueStore = useContinueReadingStore()

/** 系列章节序号补齐的 warn 去重：一本只吵一次（先例 onNovelScrollMT 的 mtHeightWarned） */
let chapterNoWarned = false

/**
 * 本次加载已解析出的章节坐标（**代闸内有效**，`loadNovel` 每次重载清空）：
 * 完成判定需要的「是否末话」就在这里，**零新增网络请求**（`content_count` 与
 * `novels[]` 已在 `loadNovelSeriesChapters` 的响应里，票 #926 已埋好这条线）。
 * ⚠️ 章节可能在首页返回范围外 ⇒ 保持 null；`decideNovelCompletion` 遇 null 判「不完成」。
 */
let chapterPosition: { chapterNo: number; chapterTotal: number } | null = null
/** 完成判定降级（系列章节坐标不可确定）的 warn 去重：一本只吵一次 */
let completionWarned = false
/** 完成判定降级（视口高拿不到真实测量）的 warn 去重：一本只吵一次 */
let viewportHeightWarned = false

// ─── 视口高（票 #930 前置的唯一输入）────────────────────────────────────
// ⚠️ **不固化在 setup**：原生内容区契约是**一次性查询、无推送通道**（ADR-0131），
//   旋转 / 分屏会改 LynxView 尺寸而 JS 侧收不到推送。故每次完成判定前**重拉一次**
//   （原生 `contentSize` 随布局与 insets 重算，见 LynxActivity 的 addOnLayoutChangeListener），
//   新值落地后再判一次。写成 setup 期的 const ⇒ 旋转后前置条件停在旧值。
const viewportSize = ref<ViewportContentSize | null>(null)

/** Lynx 全局全屏物理尺寸（web-core 预览无此对象 ⇒ 引用处必须 `typeof` 探测，同 GlobalFab） */
declare const SystemInfo: ViewportSystemInfo

/**
 * 重拉原生内容区尺寸；`after` 在新值落地后跑（无契约的 web-core 预览直接跳过——
 * 那条路径下判定用 SystemInfo 口径，调用方已同步判过）。
 */
function refreshViewportSize(after: () => void): void {
  if (typeof NativeModules === 'undefined') return // web-core 无契约可拉
  subscribeViewportSize(() => NativeModules, (size) => {
    if (size) viewportSize.value = size
    after() // 新值落地 ⇒ 再判一次（幂等：markCompleted 对已完成条目是 no-op）
  })
}

/**
 * 完成判定的前置：正文是否**高于**视口（票 #930）。
 *
 * [单位] 几何解算在 `primitives/novelContentFitsViewport` 内完成，正文高（中位段高 × 段数）
 * 与视口高（vw → @375 基准设计 px）统一到**@375 基准设计 px** 后再比；本页不自行折算单位。
 *
 * 📌 **禁静默降级**：视口高拿不到真实测量时取**保守侧 false**（不判完成）并 warn 一次。
 *   为什么这一侧保守：误完成的代价是**软删用户书架里的书**（条目当场离场），
 *   漏完成的代价只是条目多留一会儿（用户读完再触底即自愈）——代价不对称。
 */
function bodyExceedsViewport(): boolean {
  const geometry = resolveNovelContentGeometry({
    contentSize: viewportSize.value,
    systemInfo:
      typeof SystemInfo === 'undefined'
        ? undefined
        : {
            pixelWidth: SystemInfo.pixelWidth,
            pixelHeight: SystemInfo.pixelHeight,
            pixelRatio: SystemInfo.pixelRatio,
          },
    paragraphCount: paragraphs.value.length,
    avgParagraphHeightPx: estimatedHeightPx.value,
  })
  if (!geometry.viewportMeasured) {
    if (!viewportHeightWarned) {
      viewportHeightWarned = true
      console.warn(
        '[novel-detail] 视口高不可得（无内容区尺寸且无 SystemInfo），本话不标记完成（条目保留在继续读列表）',
      )
    }
  }
  return geometry.contentExceedsViewport
}

/**
 * 完成判定落地（ADR-0219 §2.3 / 票 #928 AC #1/#2/#3 + 票 #930 前置）：成立则软删（置 `completedAt`）。
 *
 * 📌 **两个时机都要跑**：章节坐标是**后台**补的，可能晚于触底才落地。
 *   只在触底时判一次 ⇒ 触底早于补齐的用户永远判不出末话；只在补齐时判 ⇒
 *   补齐早于触底的用户同样漏判。故触底时判一次、坐标落地后再判一次（幂等：
 *   `markCompleted` 对已完成的条目是 no-op）。
 *
 * 📌 **第三次判定（票 #930）**：视口尺寸会随旋转 / 分屏变，故每次判定前重拉内容区尺寸，
 *   新值落地后再判一次。少这一次 ⇒ 旋转后前置条件停在旧视口。
 *
 * 📌 降级不静默：坐标不可确定时**不**判完成（宁可留在列表里也不误软删），
 *   并 warn 一次让用户可从日志看出「这本书不会被自动移出列表」。
 */
function evaluateCompletion(gen: number): void {
  if (gen !== loadGeneration) return // 章节已切换 / 组件已卸载 → 旧判定作废（竞态防护 #3）
  applyCompletionDecision(gen)
  refreshViewportSize(() => applyCompletionDecision(gen))
}

/** 单次判定落地（`evaluateCompletion` 的同步半 + 重拉后的复判共用） */
function applyCompletionDecision(gen: number): void {
  if (gen !== loadGeneration) return
  const seriesId = novel.value?.series?.id ?? null
  const decision = decideNovelCompletion({
    reachedBottom: reachedBottom.value,
    contentExceedsViewport: bodyExceedsViewport(),
    seriesId: seriesId == null ? null : Number(seriesId),
    chapterNo: chapterPosition?.chapterNo,
    chapterTotal: chapterPosition?.chapterTotal,
  })
  if (decision) {
    continueStore.markCompleted(Number(novelId.value))
    return
  }
  // 只在「本可判定却判不出」时吵：触底 + 有系列 + 坐标缺失（禁静默降级）
  if (reachedBottom.value && seriesId != null && chapterPosition === null && !completionWarned) {
    completionWarned = true
    console.warn('[novel-detail] 本话在系列中的序号不可确定，不标记完成（条目保留在继续读列表）')
  }
}

/**
 * 记录本话为续读位置（**会话末语义**：位置可往回拨，重读时回重读到的那话）。
 * 无系列（含单本小说）时只有 novelId，不做章节序号推断。
 *
 * 📌 **完成判定在本函数内只挂在「坐标刚落地」这一个异步点**，另一个点在 `onNovelToBottom`。
 *   中间这次是**必需的**：章节响应是后台补的，可能晚于用户触底才落地——只在触底时判一次，
 *   触底早于补齐的用户永远判不出末话。
 *   ⚠️ 本函数**开头不判**：此刻 `reachedBottom` 刚被 `loadNovel` 复位为 false、正文 `<list>`
 *   尚未渲染，判定必然为 false ⇒ 写在那里只是两行恒不生效的死代码。
 */
function recordContinueReading(target: PixivNovel, gen: number): void {
  continueStore.record(toNovelContinueSnapshot(target))
  // 📌 先捕获到 const：下面的 .then 闭包里 TS 收不回 `target.series` 的窄化
  //   （target 是可变形参，闭包内被视为可能已被改写）
  const seriesId = target.series?.id
  // 单本小说（无系列）：没有坐标要补。完成判定**不依赖坐标**——`chapterPosition` 保持 null，
  // 触底时即判「单本读到底」（ADR-0219 §2.3 情形 ①，票 #928 AC #1）。
  if (seriesId == null) return
  // 📌 后台补章节序号：让行内能显示「第N话」。**不 await**——正文渲染优先（硬约束 #1）。
  //   补不到不降级功能本身（位置已记），只是标签缺失；此时不静默，warn 一次。
  void loadNovelSeriesChapters(toSeriesId(seriesId))
    .then((res) => {
      if (gen !== loadGeneration) return // 章节已切换 → 旧响应作废
      const idx = res.novels.findIndex((n) => Number(n.id) === Number(target.id))
      // ⚠️ 章节不在服务端首页返回范围内（如第 30 话 / 共 50 话）⇒ 序号不可确定。
      //   **不得静默 return**（测试硬约束 #3）：用户会看到行内凭空少了「第N话」而无从得知。
      //   warn 一次后按「不显示坐标」降级（decideContinueLabel 返回 null），功能本身不受影响。
      //   📌 `chapterPosition` 保持 null ⇒ 完成判定据此判「不完成」（宁可留在列表里也不误软删）。
      if (idx < 0) {
        if (!chapterNoWarned) {
          chapterNoWarned = true
          console.warn(
            '[novel-detail] 本话不在系列首页返回范围内，行内不显示「第N话」（召回不受影响）',
          )
        }
        return
      }
      chapterPosition = {
        chapterNo: idx + 1,
        chapterTotal: res.novel_series_detail.content_count,
      }
      continueStore.record(
        toNovelContinueSnapshot(target, Date.now(), {
          id: Number(seriesId),
          chapterNo: chapterPosition.chapterNo,
          chapterTotal: chapterPosition.chapterTotal,
        }),
      )
      // 坐标刚落地 ⇒ 补判一次完成（触底可能早于本次响应，票 #928 闭环 AC #5）
      evaluateCompletion(gen)
    })
    .catch((err: unknown) => {
      if (gen !== loadGeneration) return
      if (chapterNoWarned) return
      chapterNoWarned = true
      console.warn('[novel-detail] 章节序号补齐失败（行内不显示「第N话」，召回不受影响）', err)
    })
}

async function loadNovel(): Promise<void> {
  const gen = ++loadGeneration
  loading.value = true
  errorMsg.value = ''
  novel.value = null
  text.value = ''
  novelImages.value = {}
  reachedBottom.value = false
  chapterNoWarned = false
  // 📌 完成判定的本次加载态必须清空（与 reachedBottom 同批）：坐标与 warn 去重都是
  //   **代闸内**的，章节内跳转后若残留上一次的坐标，新话会拿旧序号判末话。
  chapterPosition = null
  completionWarned = false
  teardownPrompt()
  try {
    // 先取详情判定受限态：受限小说不再拉正文（遮罩是内容不可达而非仅视觉遮挡）
    const detailRes = await loadNovelDetail(toNovelId(novelId.value))
    if (gen !== loadGeneration) return
    novel.value = detailRes.novel
    // 续读记录（ADR-0219 §2.3 / 票 #926）：**进入正文即记录，零门槛**——
    // 不依赖停留时长或滚动百分比（段内滚动信号在当前构建不可得，见上方 onNovelScrollMT 注释）。
    // 先用详情已有的数据落一条（不阻塞渲染，守「先渲染后加载」硬约束），
    // 章节序号随后在后台补齐——补不到也不影响召回，只是行内不显示「第N话」。
    recordContinueReading(detailRes.novel, gen)
    // prompt 在详情落地后创建：getSeries 此时已知，系列预取才能发起；
    // 停留计时（dwellMs）从详情就绪起算，语义上更贴近「实质阅读时长」
    setupPrompt()
    // AI 遮罩态同样不拉正文（与 R18 一致：遮罩是内容不可达而非仅视觉遮挡，ADR-0155）
    if (!isRestricted(detailRes.novel) && !isAiRestricted(detailRes.novel)) {
      const data = await fetchNovelData(toNovelId(novelId.value))
      if (gen !== loadGeneration) return
      // 保留原 fetchNovelText 的空正文语义：提取失败 → 走 catch 展示错误
      if (!data.text) throw new Error(t('novelDetail.bodyExtractFailed')) // i18n: 构造时快照（瞬态）
      text.value = data.text
      novelImages.value = data.images
    }
  } catch (err) {
    if (gen !== loadGeneration) return
    errorMsg.value = presentError(err, t('error.fallback.loadFailed'))
    // 📌 作品失效标记（票 #926 AC #9）：点开失败 = 该作品很可能已被删除/下架。
    //   在此标记（而不是列表批量探活）——批量探活会让每行都发一次请求，
    //   且受限行本就不该发请求。列表据此显式标注「已不可用」并保留移除入口。
    continueStore.markUnavailable(Number(novelId.value))
  } finally {
    if (gen === loadGeneration) loading.value = false
  }
}

onMounted(() => {
  void loadNovel()
  // 首拉视口尺寸（票 #930）：完成判定的前置要用。之后每次判定前仍会重拉
  //（旋转 / 分屏不在此处覆盖——原生契约无推送通道，见 refreshViewportSize 头注）。
  refreshViewportSize(() => {})
})

onUnmounted(() => {
  unregisterBackGuard()
  teardownPrompt()
  clearTimeout(exportNoticeTimer)
  loadGeneration++ // 卸载后任何在飞响应落地即作废
  translateStore.abort() // 取消 in-flight 翻译 + 清章节级状态
  translateStore.reset()
})

// 章节内跳转（spec §6-2）：路由参数变化 = 同一组件实例复用，
// dispose 旧 prompt（代递增废掉在飞预取）+ 全量重载（含新实例重建）
watch(novelId, (id, prev) => {
  if (!id || id === prev) return
  void loadNovel()
})

// ─── 弹窗事件语义差（spec §US5）：decline/confirm 继续原返回动作，cancel 留在详情页 ───
function onWatchlistDecline(): void {
  prompt.value?.decline()
  goBack()
}

async function onWatchlistConfirm(): Promise<void> {
  const p = prompt.value
  if (!p) return
  await p.confirm()
  // 成功 → 弹窗已关 → 继续返回；失败 → 弹窗保留（错误条 + 可重试），留在详情页。
  // prompt === p 守：在飞期间章节跳转重建实例后，旧 confirm 落地不得驱动返回
  if (prompt.value === p && !p.dialogOpen) goBack()
}

function onWatchlistCancel(): void {
  prompt.value?.cancel()
}
</script>

<template>
  <view
    :id="selection.rootId"
    class="w-full h-full flex flex-col relative bg-surface"
    @tap="selection.onTapAway"
    @longpress="selection.notifyLongPress"
  >
    <!-- 顶部安全区让位（#900 T1 / ADR-0194 跳过清单页）：本页顶栏**自补偿**让位，高度取
         utils/topInset.ts 的 barSpacerHeight（self 模式 = 状态栏安全区；bleed = 0）。
         为什么是零内容 spacer 而不是给下面那行加 paddingTop：Lynx 的 border-box UA 默认会让
         padding 吃掉内容高度（顶栏矮一截），web-core 预览却不复刻该默认 ⇒ 两端观感分叉
         （App.vue 转场包裹层 pb-18 已登记过这个坑）。底部弹层家族（SearchSheet 等 6 个）用同款写法。
         spacer 保持透明：状态栏染色仍由根容器 surface 背景承担。
         为什么本页保留手写顶栏（不迁 PageTopBar）：见下方 [T1 不迁移] 注释。 -->
    <view :style="{ height: topInsetSpacer + 'px' }" />
    <!-- 左上角返回改走 requestBack：与系统返回共用同一守卫链（spec §US3）；
         [T1 不迁移] 返回守卫源级锁（unit.test.ts 断言本页含 @tap="requestBack"）——
         PageTopBar 化需语义改测试，与「既有页面测试零语义修改」硬门禁冲突，保留手写头 -->
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <!-- 返回箭头：T12/ADR-0208 收口——`‹`（U+2039）已登记为 iconMap 的 arrow_back
           （决策 3：凡在映射表内的一律算图标位），改走 <AppIcon>。
           尺寸/size 由 AppIcon 自带 leading-none + 默认 6.4vw 承担（ADR-0206 决策 3 装饰性例外）。
           另注：本页 requestBack 源级锁被 unit.test.ts 断言，a11y 注册表绑定形态不动 -->
      <view class="py-1 pr-2" @tap="requestBack"><AppIcon name="arrow_back" class="text-surface-on" /></view>
      <text class="flex-1 text-title-large font-regular text-surface-on">{{ t('novelDetail.title') }}</text>
    </view>

    <!-- 加载期骨架（issue #91）：header 照常渲染，正文区骨架占位 -->
    <SkeletonNovel v-if="loading" />
    <view v-else-if="errorMsg" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-medium text-error p-4">{{ errorMsg }}</text>
    </view>
    <!-- 正文列表虚拟化（ADR-0134）：官方指南「超三屏用 list」；红线 = Vue :key 与 Lynx
         :item-key 双份一致 + 稳定 id；estimated 按段落估算滚动条。 -->
    <list
      v-else-if="novel && !isRestricted(novel) && !isAiRestricted(novel)"
      class="w-full flex-1 min-h-0"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      :main-thread-bindscroll="onNovelScrollMT"
      :scroll-event-throttle="0"
      @scroll="selection.onScroll"
      @scrolltolower="onNovelToBottom"
    >
      <list-item :key="'meta'" :item-key="'meta'" :estimated-main-axis-size-px="estimatedHeightPx" class="w-full">
        <!-- 头部精简（spec #585 / 票 #589）：标题 + 作者小字；字数/收藏/系列信息由介绍页（NovelIntro）承载。
             系列判定数据（novel.series）仍经详情端点加载——追更询问（prompt getSeries）依赖它，不随行移除而移除。 -->
        <view class="py-5 px-4 bg-surface-container-lowest mb-3">
        <!-- T07 档位清理：原为 700 字重。作品标题是内容文本，title-large 官方 regular(400)、
             emphasized 500；此前它比同页「屏标题」（PageTopBar 屏标题 title-large + 500，:398）
             还重，层级是倒的 → 500。受限小说分支（下方）同一判定。 -->
        <text class="text-title-large font-regular text-surface-on">{{ artworkTitle(novel?.title) }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
        <!-- 评论入口（issue #164）：T12/ADR-0208 💬 → Material Symbols `chat_bubble`（缺省 6.4vw = 原
             text-[6.4vw]，尺寸不变）。⚠️ 本入口改造前**就没有** accessibility-label（存量如此），
             本票只换字形不加标注——读屏语义由相邻的评论数文本承担；补 label 属独立可达性债。 -->
        <view
          v-if="novel?.total_comments !== undefined"
          class="mt-2 flex flex-row items-center"
          @tap="showComments = true"
        >
          <AppIcon name="chat_bubble" />
          <text class="text-label-medium text-outline ml-1">{{ novel?.total_comments }}</text>
        </view>
        <!-- 导出入口（spec §7.2）：仅正文可用时渲染；label 内联，不进 ME_A11Y_LABELS -->
        <view
          v-if="text.length > 0"
          class="mt-2 flex flex-row items-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelDetail.export.a11y')"
          @tap="exportOpen = true"
        >
          <!-- T12/ADR-0208：⬆ → Material Symbols `upload`（缺省 6.4vw = 原 text-[6.4vw]，尺寸不变） -->
          <AppIcon name="upload" />
          <text class="text-label-medium text-outline ml-1">{{ t('novelDetail.export.action') }}</text>
        </view>
        <!-- 收藏 + 稍后看（[维度重构 2026-10-03] 新增，修「能力绑路由不绑对象」的错位 A）。
             放在导出入口之后、翻译 banner 之前：两者都是「对这本小说」的持久化动作，
             与「评论/导出」同属元信息动作，语义相邻。 -->
        <view
          v-if="novel"
          class="mt-3 flex flex-row items-stretch"
        >
          <view class="flex-1 flex items-center justify-center">
            <BookmarkButton
              class="self-center"
              :key="novel.id"
              target-kind="novel"
              :illust-id="novel.id"
              :initial-bookmarked="novel.is_bookmarked"
              :bookmark-count="novel.total_bookmarks"
            />
          </view>
          <view class="flex-1 min-w-0" @tap.stop>
            <ActionButton
              class="w-full"
              :icon="LATER_ICON"
              :label="laterAdded ? t('later.action.added') : t('later.action.add')"
              :active="laterAdded"
              :disabled="false"
              @tap="toggleWatchLater"
            />
          </view>
        </view>
        <!-- 翻译入口（spec §6.2 顶部 banner 位置）：FAB 内联；R18/AI 受限时隐藏 -->
        <view v-if="translationEnabled" class="mt-3">
          <TranslateButton
            :novel-id="novelId"
            :chapter-id="novelId"
            :paragraphs="paragraphs"
            :x-restrict="xRestrict"
            :configured="endpointConfigured"
            @translate-configure="goConfigureTranslation"
          />
          <view v-if="translateStore.isCached[novelId] || translateStore.status === 'completed'" class="mt-2">
            <TranslateModeSwitch :enabled="true" />
          </view>
          <!-- 翻译失败内联条（§6.4 最小形态）：不再让失败对用户静默 -->
          <view
            v-if="translateErrorText"
            class="mt-2 flex flex-row items-center justify-between"
          >
            <text class="text-label-medium text-error flex-1">{{
              translateErrorText
            }}</text>
            <text
              class="text-label-medium text-primary ml-3"
              @tap="goConfigureTranslation"
              >{{ t('novelTranslate.action.configure_translate') }}</text
            >
          </view>
        </view>
        <!-- 入队内联提示（lynx 无全局 toast）：约 4s 后自动隐藏 -->
        <text v-if="exportNotice" class="text-label-medium text-primary mt-1.5">{{ exportNotice }}</text>
      </view>
      </list-item>
      <!-- 渲染源 = displayParagraphs（store 单点决定译文/原文；spec §6.3 整段切换） -->
      <list-item
        v-for="(p, idx) in displayParagraphs"
        :key="selection.paragraphId(idx)"
        :item-key="selection.paragraphId(idx)"
        :estimated-main-axis-size-px="estimatedHeightPx"
        class="w-full px-4 mb-4"
      >
        <!-- 正文选中（spec app-lynx-novel-text-selection）：三条属性**必须静态字面量**——
             vue-lynx 会吞掉动态布尔绑定（设备实证），届时引擎自带菜单不会被替换。
             T10/ADR-0206 决策 3：删掉自选 leading-[44rpx]，行高由 text-body-large 档位携带
             （body-large = 16sp 字号 / 24sp 行高 = 32rpx / 48rpx）。
             ⚠️ 连带项：`primitives/novelParagraphEstimate.ts` 的 lineHeightPx=22（=44rpx@375）
             仍按旧行高估算列表 estimated 高度（该文件自述「仅影响滚动条预热，不影响正确性」），
             需另开改动同步为 24（=48rpx@375）；不在本票可改范围。 -->
        <text
          :id="selection.paragraphId(idx)"
          :class="p === untranslatedPlaceholder
            ? 'text-body-large italic text-surface-on-variant'
            : 'text-body-large text-surface-on'"
          text-selection="true"
          flatten="false"
          custom-context-menu="true"
          :bindselectionchange="selection.onSelectionChange"
          >{{ p }}</text
        >
      </list-item>
      <list-item :key="'end'" :item-key="'end'" class="w-full">
        <view class="flex items-center justify-center p-6">
          <text class="text-body-small text-outline">{{ t('novelDetail.end') }}</text>
        </view>
      </list-item>
      <list-item :key="'fab-allowance'" item-key="fab-allowance" class="w-full" full-span>
        <FabAllowanceSpacer />
      </list-item>
    </list>

    <!-- 受限小说：列表结构性改动不涉及（不拉正文），保留原头部+遮罩形态 -->
    <view v-else class="w-full flex-1 min-h-0 p-4 relative">
      <view class="py-5 px-4 bg-surface-container-lowest mb-3">
        <!-- 头部精简同 meta 卡（票 #589）；受限遮罩/追更询问行为不变 -->
        <!-- T07 档位清理：同上（与 meta 卡同一判定：内容标题 → 500，不压过屏标题） -->
        <text class="text-title-large font-regular text-surface-on">{{ artworkTitle(novel?.title) }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
        <!-- 评论入口（与 meta 卡一致） -->
        <view
          v-if="novel?.total_comments !== undefined"
          class="mt-2 flex flex-row items-center"
          @tap="showComments = true"
        >
          <AppIcon name="chat_bubble" />
          <text class="text-label-medium text-outline ml-1">{{ novel?.total_comments }}</text>
        </view>
      </view>
      <view class="relative p-4">
        <view class="min-h-[60vw]" />
        <RestrictOverlay v-if="novel && isRestricted(novel)" :level="novel.x_restrict === 2 ? 2 : 1" />
        <AiOverlay v-else-if="novel && isAiRestricted(novel)" :ai-type="novel.novel_ai_type ?? 0" />
      </view>
    </view>

    <!-- 选中操作菜单（spec app-lynx-novel-text-selection §ID 4）：root 内、正文列表之后的绝对定位胶囊
         （DOM 顺序即层序；必须避开 list 的 v-else-if / v-else 相邻约束）；不铺全屏层（ADR-0123）。
         收起路径：点空白/点别处 = 根 view 的 @tap 转发（设备实测：引擎对点空白**不派发**清空事件）；
         长按抬手的那次 tap 由 @longpress 打标消费（否则菜单会被自己这次长按的抬手收掉） -->
    <TextSelectionToolbar :view="selection.view" @action="onSelectionAction" />

    <!-- 评论弹层（issue #164 / 布局流修复 issue #139 同族）：必须 absolute 脱离 flex 流，
         否则文档流内 w-full h-full 兄弟会被 h-full 的 list 顶出视口（弹层在屏幕外挂载） -->
    <view v-if="showComments" class="absolute inset-0">
      <CommentOverlay type="novel" :target-id="novelId" @close="showComments = false" />
    </view>

    <!-- 导出弹层（spec §7.2）：同一覆盖层挂载契约（absolute inset-0 宿主脱离文档流） -->
    <view v-if="exportOpen" class="absolute inset-0">
      <NovelExportSheet
        :open="exportOpen"
        :default-format="settings.novelExportFormat"
        :options="settings.novelExportOptions"
        @close="exportOpen = false"
        @export="enqueueNovelExport"
      />
    </view>

    <!-- 追更询问弹窗（issue #226 / spec §US5）：open 期间自行注册 modalStack，
         返回键优先关弹窗 = cancel（留在详情页） -->
    <WatchlistPromptDialog
      :open="prompt?.dialogOpen ?? false"
      :series-title="novel?.series?.title ?? ''"
      :author-name="novel?.user.name ?? ''"
      :busy="prompt?.dialogBusy ?? false"
      :error-msg="prompt?.dialogError ?? ''"
      @confirm="onWatchlistConfirm"
      @decline="onWatchlistDecline"
      @cancel="onWatchlistCancel"
    />
  </view>
</template>
