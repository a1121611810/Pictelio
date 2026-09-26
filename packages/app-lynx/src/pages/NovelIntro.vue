<script setup lang="ts">
// ─── 小说介绍页（地图 #575 / spec #585 / 票 #587）：三段式导航 list → intro → reader 的中间页 ───
// D 轮播同族视觉（票 #583）：全屏封面 aspectFill 铺满 + 底部渐变 scrim 承载全部元信息；页内不滚动。
// 信息架构（票 #577）：AI 徽章 / 系列行(+已追更 chip) / 标题 / 作者行(→用户主页) / 标签行(→搜索) /
// 简介 2 行截断（点开弹 NovelCaptionSheet 读全文，#584）/ 统计行 / 评论入口 + 底部两行 CTA 区：
//   Row 1 = 四个次级动作（收藏·追更·下载·系列目录，等宽四列，spec #734 §US5 D2 / §5.1）；
//   Row 2 = 全宽主 CTA「开始阅读」（沿用既有 h-[12.8vw] rounded-full primary 范式）。
// 受限/AI 语义（票 #580/#581）：谓词复用正文页同款（settings.isRestricted / isAiRestricted）——
// 封面/标题/作者可见，简介位遮罩（RestrictOverlay/AiOverlay 同款），两行 CTA + 简介展开入口置灰
//（spec §US5 D6 / DR#0189 决策「5 个按钮在受限态一致置灰」）。追更按钮仅 series 存在时渲染（D8），
//「系列目录」按钮同样仅 series 存在时渲染（D9），下载按钮始终渲染（D10）。
// 数据复用正文页详情端点（零新增 API）；代闸防竞态范式同 NovelDetail。介绍页导出文本用 captionText
// 作为 fallback（介绍页不预取正文，纯 JS 上下文 fetch 正文 + 入队不在本期范围；spec #734 §US4 / D1）。
// [lynx:fix] KeepAlive name：本页按 :id 加载，不入缓存白名单（同正文页——缓存旧 id 实例会显示错误内容）
defineOptions({ name: 'novel-intro' })
import { computed, defineComponent, h, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { currentParams, goBack, navigate } from '../router'
import { loadNovelDetail, loadNovelSeries, addNovelWatchlist } from '../api/novel'
import { toNovelId, toSeriesId } from '../api/id'
import type { PixivNovel } from '../api/types'
import type { NovelExportFormat } from '@pictelio/novel-export'
import { buildNovelExportPayload, buildNovelExportTaskDraft } from '@pictelio/novel-export'
import { presentError } from '../utils/errorPresentation'
import { proxyImageUrl } from '../utils/imageUrl'
import { stripNovelCaptionHtml } from '../utils/novelCaption'
import { isNovelDownloaded } from '../utils/novelDownloadStatus'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useSettingsStore } from '../stores/settingsStore'
import { useDownloadStore } from '../stores/downloadStore'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { isDismissed, markDismissed, setWatchState, getWatchState } from '../stores/watchlistStore'
import { createWatchlistPrompt, type WatchlistPromptController } from '../primitives/createWatchlistPrompt'
import { useNovelWatchlistToggle } from '../composables/useNovelWatchlistToggle'
import CoverImage from '../components/CoverImage.vue'
import AdaptiveTagRow from '../components/AdaptiveTagRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import ActionButton from '../components/ActionButton.vue'
import SeriesSheet from '../components/SeriesSheet.vue'
import NovelExportSheet from '../components/NovelExportSheet.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import AiOverlay from '../components/AiOverlay.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import NovelCaptionSheet from '../components/NovelCaptionSheet.vue'
import { t } from '../i18n'

const settings = useSettingsStore()
// 谓词与正文页同源（差分对齐，spec 测试决策）：R-18/R-18G 开关 + AI mask 模式
const isRestricted = settings.isRestricted
const isAiRestricted = settings.isAiRestricted

const novel = ref<PixivNovel | null>(null)
const loading = ref(true)
const errorMsg = ref('')
const showComments = ref(false)
const captionOpen = ref(false)

const novelId = computed(() => Number(currentParams.value.id ?? 0))

/** 封面 URL（已过代理）；缺省空串 → CoverImage 判 failed（isUnloadableSrc，非静默降级） */
const coverSrc = computed(() => {
  const urls = novel.value?.image_urls
  return proxyImageUrl(urls?.large || urls?.medium || '')
})

/** 简介纯文本（Pixiv caption 含 <br> 等标签，直接上屏漏字面量——2026-09-18 实证）；空 = 无简介 */
const captionText = computed(() => stripNovelCaptionHtml(novel.value?.caption ?? ''))

// ─── 受限/AI 派生态（票 #580：对齐正文页语义） ───
const r18Masked = computed(() => !!novel.value && isRestricted(novel.value))
const aiMasked = computed(() => !!novel.value && isAiRestricted(novel.value))
/** CTA / 简介展开入口置灰判定：R-18 或 AI mask 任一命中 */
const masked = computed(() => r18Masked.value || aiMasked.value)
/** AI 徽章文案（novel_ai_type：0=非 AI 不显示；1=辅助 2=纯 AI，复用 aiOverlay 文案单点派生） */
const aiBadge = computed(() => {
  const aiType = novel.value?.novel_ai_type ?? 0
  if (aiType === 2) return t('aiOverlay.pure')
  if (aiType === 1) return t('aiOverlay.assisted')
  return ''
})

// ─── 已追更 chip（系列行）：复用 createWatchlistPrompt 深模块取 watchAdded——
// 仅消费其预取状态渲染 chip；不注册返回守卫、不渲染弹窗（票 #582：介绍页返回不触发询问）
const prompt = shallowRef<WatchlistPromptController | null>(null)

function setupPrompt(): void {
  prompt.value = createWatchlistPrompt({
    getSeries: () => novel.value?.series ?? null,
    loadWatchState: async (seriesId) =>
      (await loadNovelSeries(toSeriesId(seriesId))).novel_series_detail.watchlist_added,
    isDismissed,
    markDismissed,
    setWatchState,
    // ADR-0189 D5：computed watchAdded 派生来源——介绍页 inline toggle 写 cache 后 chip 同步翻转
    getWatchState,
    addWatchlist: (seriesId) => addNovelWatchlist(toSeriesId(seriesId)),
  })
}

function teardownPrompt(): void {
  prompt.value?.dispose()
  prompt.value = null
}

// 代闸：路由复用/卸载后在飞响应一律作废（同 NovelDetail loadGeneration 范式）
let loadGeneration = 0

async function loadNovel(): Promise<void> {
  const gen = ++loadGeneration
  loading.value = true
  errorMsg.value = ''
  teardownPrompt()
  try {
    const res = await loadNovelDetail(toNovelId(novelId.value))
    if (gen !== loadGeneration) return
    novel.value = res.novel
    // prompt 仅承载 watchAdded 预取（chip 显示）；详情落地后系列才已知
    setupPrompt()
  } catch (err) {
    if (gen !== loadGeneration) return
    errorMsg.value = presentError(err, t('error.fallback.loadFailed')) // i18n: 构造时快照（瞬态）
  } finally {
    if (gen === loadGeneration) loading.value = false
  }
}

onMounted(() => {
  void loadNovel()
})

onUnmounted(() => {
  teardownPrompt()
  loadGeneration++ // 卸载后任何在飞响应落地即作废
})

// 章节内跳转（同正文页范式）：路由参数变化 = 同一组件实例复用，代闸作废旧在飞 + 全量重载。
// 介绍页自身是搜索入口落点（标签 → 搜索 → 另一小说结果），实例复用暴露概率高于普通详情页。
watch(novelId, (id, prev) => {
  if (!id || id === prev) return
  captionOpen.value = false
  showComments.value = false
  void loadNovel()
})

// ─── 交互（全部 UI 改道相关动作，票 #576） ───

function openAuthor(): void {
  const id = novel.value?.user.id
  if (id) void navigate(`/user/${id}`)
}

/** 标签 chip → 全局搜索弹层（原始 tag.name，ADR-0133；同列表卡语义） */
function onTagTap(name: string): void {
  useSearchSheetStore().openSearch(name)
}

/** 标签长按静音（ADR-0187 D5 / #732）：加入词表 + 轻提示（App.vue 宿主消费 muteTagHint） */
function onTagLongPress(name: string): void {
  settings.muteTag(name)
}

/**
 * +N/截断 chip：介绍页无「全部标签」承 surface（D 案页内不滚动），按 AdaptiveTagRow
 * 「页面决定」契约收敛为以首个标签发起搜索（探索语义，非静默死交互）
 */
function onTagOverflow(): void {
  const first = novel.value?.tags[0]?.name
  if (first) useSearchSheetStore().openSearch(first)
}

/** 简介 2 行截断 → 弹全文面板（#584）；受限态置灰不打开（与 CTA 同判定） */
function openCaption(): void {
  if (masked.value || !captionText.value) return
  captionOpen.value = true
}

/** 「开始阅读」：进入正文页固定从头开始（票 #579）；受限态置灰不可点（票 #580） */
function startReading(): void {
  if (masked.value) return
  void navigate(`/novel/${novelId.value}`)
}

// ─── 底部动作行：Row 1 = 4 个次级按钮状态（spec #734 §US4 / §US5）───
// 「已下载」派生自 downloads.state（Pinia setup store 状态自动解包），沿 ADR-0189 D3 / spec D1。
const downloads = useDownloadStore()
const downloaded = computed(() =>
  novel.value ? isNovelDownloaded(downloads.state, novel.value.id) : false,
)

/** 弹层状态（spec §US3 / §US4）：exportOpen 复刻 NovelDetail 字段命名，seriesSheetOpen 为新弹层 */
const exportOpen = ref(false)
const seriesSheetOpen = ref(false)
/** 导出内联提示（lynx 无全局 toast）：约 4s 后自动隐藏，同 NovelDetail exportNotice 范式 */
const exportNotice = ref('')
let exportNoticeTimer: ReturnType<typeof setTimeout> | undefined

/** 打开导出面板：受限态下 ActionButton 已 opacity-50 pointer-events-none；此处再守一道防御 */
function openExportSheet(): void {
  if (masked.value) return
  exportOpen.value = true
}

/** 打开系列目录弹层：仅 novel.series 存在时调用（宿主层 v-if 已守）；masked 二次防御 */
function openSeriesSheet(): void {
  if (masked.value || !novel.value?.series) return
  seriesSheetOpen.value = true
}

/** 系列章节点击：关闭弹层 + navigate 到该章节正文页（spec D7 / ADR-0189「弹层内导航」） */
function onSeriesSelect(novelId: number): void {
  seriesSheetOpen.value = false
  void navigate(`/novel/${novelId}`)
}

/**
 * 构造导出载荷并加入下载队列（沿用 NovelDetail §8.1 同形态）。
 * 介绍页不预取正文（fetchNovelData 不在本页 setup 调用），`text` 字段走 captionText 兜底——
 * 导出产物 = 元信息（meta）+ 简介文本作为最小内容切片，明确为「介绍页快照导出」
 *（spec #734 §US4 D1「复用现有导出」，与正文页导出端点相同但内容范围收窄）。
 */
function enqueueNovelExport(format: NovelExportFormat): void {
  const n = novel.value
  if (!n) return
  const payload = buildNovelExportPayload({
    novel: n,
    text: captionText.value,
    images: {},
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

// ─── 追更直击切换 inline 组件（spec §US2 / §US5）───
// 关键不变量（继承 useNovelWatchlistToggle 6 条 + :key 重挂载契约）：
//   1. composable 顶层 setup 内调用（不在 v-if / computed 内）
//   2. series 切换通过 :key="novel.series.id" 强制 remount 承载（BookmarkButton :key 同范式）
//   3. active 态 = filled star ★ / label 切「已追更」；默认 ☆ / 「追更」（spec §5.1 三态表）
//   4. masked 态 = opacity-50 + pointer-events-none（ActionButton 内部 disabled 分支）
// 该组件不导出——script-setup 顶层 const 自动暴露给同文件模板（<script setup> 编译契约）。
const WatchlistAction = defineComponent({
  name: 'WatchlistAction',
  props: {
    seriesId: { type: Number, required: true },
    initialAdded: { type: Boolean, required: true },
    masked: { type: Boolean, required: true },
  },
  setup(props) {
    const wl = useNovelWatchlistToggle({
      seriesId: props.seriesId,
      initialAdded: props.initialAdded,
    })
    // render function 内 reactive deps = wl.added + props.masked + locale（t() 内访问）
    return () => {
      const added = wl.added.value
      return h(ActionButton, {
        icon: added ? '★' : '☆',
        label: added
          ? t('novelIntro.actionWatched')
          : t('novelIntro.actionWatch'),
        active: added,
        disabled: props.masked,
        onTap: () => wl.toggle(),
      })
    }
  },
})
</script>

<template>
  <view class="w-full h-full relative bg-surface">
    <!-- 加载态：全屏封面位骨架（shimmer 铺满；D 案页内不滚动，无内容区骨架） -->
    <view v-if="loading" class="absolute inset-0 shimmer" />

    <!-- 错误态：统一错误文案 + 重试 -->
    <view v-else-if="errorMsg" class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
      <text class="text-body-medium text-error text-center">{{ errorMsg }}</text>
      <view
        class="min-h-12 flex items-center justify-center px-5 rounded-[var(--md-shape-full)] border border-outline bg-surface-container-lowest active:bg-state-pressed-on-surface"
        @tap="loadNovel"
      >
        <text class="text-label-large text-primary">{{ t('novelIntro.retry') }}</text>
      </view>
    </view>

    <!-- 成功态：全屏封面 + 底部渐变 scrim 承载全部元信息（D 案，票 #583） -->
    <view v-else-if="novel" class="absolute inset-0">
      <CoverImage :src="coverSrc" layout="full" retry />
      <view
        class="absolute bottom-0 left-0 right-0 px-6 pt-[24vw] pb-[6vw]"
        style="background: var(--md-scrim-overlay)"
      >
        <!-- AI 徽章（票 #577；文案复用 aiOverlay 单点派生） -->
        <view v-if="aiBadge" class="self-start">
          <text class="text-label-medium font-semibold px-2 py-0.5 rounded-[var(--md-shape-extra-small)] bg-secondary-container text-secondary-on-container">{{ aiBadge }}</text>
        </view>

        <!-- 系列行（票 #577）：系列名 + 已追更 chip（复用 novelDetail.watchAdded 文案单点） -->
        <view v-if="novel.series" class="mt-2 flex flex-row items-center">
          <text class="text-label-medium text-white/85">{{ t('novelDetail.seriesTitle', { title: novel.series.title }) }}</text>
          <view v-if="prompt?.watchAdded === true" class="ml-2 px-2 py-0.5 rounded-[var(--md-shape-full)] bg-secondary-container">
            <text class="text-label-small text-secondary-on-container">{{ t('novelDetail.watchAdded') }}</text>
          </view>
        </view>

        <!-- 标题 -->
        <text
          class="text-title-large font-semibold text-white leading-[1.3] [max-line:2]"
          :class="aiBadge || novel.series ? 'mt-2' : ''"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="novel.title"
        >{{ novel.title }}</text>

        <!-- 作者行（票 #577：可点 → 用户主页） -->
        <text
          class="text-body-medium text-white/85 mt-2"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelIntro.authorA11y')"
          @tap="openAuthor"
        >{{ novel.user.name }}</text>

        <!-- 标签胶囊行（票 #577：复用「标签自适应折叠」；chip → 全局搜索弹层；长按 → 静音 #732） -->
        <AdaptiveTagRow
          v-if="novel.tags.length > 0"
          class="mt-2"
          :tags="novel.tags"
          @tag-tap="onTagTap"
          @tag-long-press="onTagLongPress"
          @overflow-tap="onTagOverflow"
        />

        <!-- 简介（票 #584）：纯文本 2 行截断；点开弹全文面板；受限态遮罩 + 入口置灰 -->
        <view class="mt-3 relative" @tap="openCaption">
          <text v-if="captionText" class="text-body-small text-white/85 leading-[1.5] [max-line:2]">{{ captionText }}</text>
          <text v-else class="text-body-small text-white/60 leading-[1.5]">{{ t('novelIntro.noCaption') }}</text>
          <!-- 谓词与正文页同款（票 #580）：R-18 优先、AI mask 次之 -->
          <RestrictOverlay v-if="r18Masked" :level="novel.x_restrict === 2 ? 2 : 1" />
          <AiOverlay v-else-if="aiMasked" :ai-type="novel.novel_ai_type ?? 0" />
        </view>

        <!-- 统计行（票 #577）：字数 · 收藏 · 浏览；可选字段缺省显式降级（对应段隐藏） -->
        <view class="mt-3 flex flex-row items-center">
          <text class="text-label-medium text-white/70 mr-4">{{ t('novels.charCount', { count: novel.text_length }) }}</text>
          <text v-if="novel.total_bookmarks > 0" class="text-label-medium text-white/70 mr-4">♥ {{ novel.total_bookmarks }}</text>
          <text v-if="novel.total_view != null" class="text-label-medium text-white/70">👁 {{ novel.total_view }}</text>
        </view>

        <!-- 评论入口（票 #577：两端都留） -->
        <view
          v-if="novel.total_comments !== undefined"
          class="mt-3 flex flex-row items-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelIntro.commentsA11y')"
          @tap="showComments = true"
        >
          <text class="text-[6.4vw] leading-none">💬</text>
          <text class="text-label-medium text-white/70 ml-1">{{ novel.total_comments }}</text>
        </view>

        <!-- 底部固定动作区（spec #734 §US5 D1 / ADR-0189 D1）：
             Row 1 = 4 个次级按钮（收藏·追更·下载·系列目录，等宽四列），追更/系列目录仅 series 存在时渲染；
             Row 2 = 全宽主 CTA「开始阅读」。两行按钮在 R-18/R-18G/AI 屏蔽态一致置灰（#580 / spec D6）。
             ADR-0123：opacity-50 + pointer-events-none 仅用于真正的 disabled 态（ActionButton 内部），
             不用于全屏遮罩期望下层穿透的反模式；BookmarkButton 无 disabled prop → 外层 wrap 一道置灰。 -->
        <view class="mt-4 flex flex-row items-stretch">
          <!-- 收藏：BookmarkButton 自带 chip+计数；wrap 一道 flex-1 + masked 置灰（件外置 pointer-events-none 合法禁用语义）
               self-center 保留以让 chip 在 row 中垂直居中（hit-chip 默认 hug content，align-self 由 wrap 决定） -->
          <view
            class="flex-1 flex items-center justify-center"
            :class="masked ? 'opacity-50 pointer-events-none' : ''"
          >
            <BookmarkButton
              class="self-center"
              :key="novel.id"
              target-kind="novel"
              :illust-id="novel.id"
              :initial-bookmarked="novel.is_bookmarked"
              :bookmark-count="novel.total_bookmarks"
            />
          </view>
          <!-- 追更（仅 series 存在，D8）：:key 强制重挂载承载 series 切换（BookmarkButton :key 同范式） -->
          <WatchlistAction
            v-if="novel.series"
            :key="novel.series.id"
            :series-id="novel.series.id"
            :initial-added="prompt?.watchAdded === true"
            :masked="masked"
          />
          <!-- 下载（D10：始终渲染；已下载态同样可点，按 D11 重新打开格式选择器） -->
          <ActionButton
            :icon="downloaded ? '✓' : '↓'"
            :label="downloaded
              ? t('novelIntro.actionDownloaded')
              : t('novelIntro.actionDownload')"
            :active="downloaded"
            :disabled="masked"
            @tap="openExportSheet"
          />
          <!-- 系列目录（D9：仅 series 存在） -->
          <ActionButton
            v-if="novel.series"
            :icon="'≡'"
            :label="t('novelIntro.actionSeries')"
            :active="false"
            :disabled="masked"
            @tap="openSeriesSheet"
          />
        </view>

        <!-- Row 2 全宽主 CTA「开始阅读」（沿用 #580 范式：masked 态 bg-white/20 + text-white/50） -->
        <view
          class="mt-3 w-full h-[12.8vw] rounded-[var(--md-shape-full)] flex items-center justify-center"
          :class="masked ? 'bg-white/20' : 'bg-primary active:opacity-80'"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelIntro.startReadingA11y')"
          @tap="startReading"
        >
          <text class="text-label-large font-medium" :class="masked ? 'text-white/50' : 'text-primary-on'">{{ t('novelIntro.startReading') }}</text>
        </view>
      </view>
    </view>

    <!-- 返回键：三态之上、弹层宿主之下（DOM 顺序即层序，原生 LynxView 不吃 z-index）——
         弹层打开时盖住返回键，返回路径统一走 modalStack（系统返回键优先关弹层，#163）；
         code-review P1：直连 goBack 的按钮若浮于弹层之上，会把「关面板」变成「弹掉整页」 -->
    <view class="absolute top-2 left-1 py-1 pr-2" @tap="goBack">
      <text class="text-[6.4vw] leading-none text-white">‹</text>
    </view>

    <!-- 评论弹层（挂载契约同正文页：absolute inset-0 宿主脱离文档流） -->
    <view v-if="showComments" class="absolute inset-0">
      <CommentOverlay type="novel" :target-id="novelId" @close="showComments = false" />
    </view>

    <!-- 简介全文面板（票 #584：scrim 内展开） -->
    <view v-if="captionOpen" class="absolute inset-0">
      <NovelCaptionSheet :caption="captionText" @close="captionOpen = false" />
    </view>

    <!-- 系列目录弹层（spec §US3 / ADR-0189 D1）：同 modalStack 挂载契约（absolute inset-0 宿主脱离文档流）。
         内部走 modalStack + SeriesSheet 自处理返回键（spec §5.3 / SeriesSheet.vue 自挂 modalStack） -->
    <view v-if="seriesSheetOpen && novel?.series" class="absolute inset-0">
      <SeriesSheet
        :series-id="novel.series.id"
        :series-title="novel.series.title"
        :current-novel-id="novel.id"
        @close="seriesSheetOpen = false"
        @select="onSeriesSelect"
      />
    </view>

    <!-- 导出面板（spec §US4 / §5.4）：沿用 NovelDetail.vue 同挂载契约；区别仅 enqueue 适配介绍页
         （text 走 captionText 兜底，详见 enqueueNovelExport 注释）。已下载/未下载都点开格式选择器（D11） -->
    <view v-if="exportOpen" class="absolute inset-0">
      <NovelExportSheet
        :open="exportOpen"
        :default-format="settings.novelExportFormat"
        :options="settings.novelExportOptions"
        @close="exportOpen = false"
        @export="enqueueNovelExport"
      />
    </view>

    <!-- 导出内联提示（spec #734 §US4 / NovelDetail §8.1 同形态）：绝对定位浮于 scrim 上、底部安全区上方 -->
    <view
      v-if="exportNotice"
      class="absolute left-0 right-0 bottom-8 mx-6 py-2 px-4 rounded-[var(--md-shape-medium)] bg-inverse-surface"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
    >
      <text class="text-label-medium text-inverse-on-surface text-center block">{{ exportNotice }}</text>
    </view>
  </view>
</template>
