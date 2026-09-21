<script setup lang="ts">
// ─── 小说介绍页（地图 #575 / spec #585 / 票 #587）：三段式导航 list → intro → reader 的中间页 ───
// D 轮播同族视觉（票 #583）：全屏封面 aspectFill 铺满 + 底部渐变 scrim 承载全部元信息；页内不滚动。
// 信息架构（票 #577）：AI 徽章 / 系列行(+已追更 chip) / 标题 / 作者行(→用户主页) / 标签行(→搜索) /
// 简介 2 行截断（点开弹 NovelCaptionSheet 读全文，#584）/ 统计行 / 评论入口 + 底部「开始阅读」+ 收藏。
// 受限/AI 语义（票 #580/#581）：谓词复用正文页同款（settings.isRestricted / isAiRestricted）——
// 封面/标题/作者可见，简介位遮罩（RestrictOverlay/AiOverlay 同款），CTA 与简介展开入口置灰。
// 数据复用正文页详情端点（零新增 API）；代闸防竞态范式同 NovelDetail。
// [lynx:fix] KeepAlive name：本页按 :id 加载，不入缓存白名单（同正文页——缓存旧 id 实例会显示错误内容）
defineOptions({ name: 'novel-intro' })
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { currentParams, goBack, navigate } from '../router'
import { loadNovelDetail, loadNovelSeries, addNovelWatchlist } from '../api/novel'
import { toNovelId, toSeriesId } from '../api/id'
import type { PixivNovel } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { proxyImageUrl } from '../utils/imageUrl'
import { stripNovelCaptionHtml } from '../utils/novelCaption'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useSettingsStore } from '../stores/settingsStore'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { isDismissed, markDismissed, setWatchState } from '../stores/watchlistStore'
import { createWatchlistPrompt, type WatchlistPromptController } from '../primitives/createWatchlistPrompt'
import CoverImage from '../components/CoverImage.vue'
import AdaptiveTagRow from '../components/AdaptiveTagRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
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

        <!-- 标签胶囊行（票 #577：复用「标签自适应折叠」；chip → 全局搜索弹层） -->
        <AdaptiveTagRow
          v-if="novel.tags.length > 0"
          class="mt-2"
          :tags="novel.tags"
          @tag-tap="onTagTap"
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

        <!-- 底部固定动作区（票 #577）：收藏 + 「开始阅读」主按钮（受限态置灰） -->
        <view class="mt-4 flex flex-row items-center">
          <BookmarkButton
            :key="novel.id"
            target-kind="novel"
            :illust-id="novel.id"
            :initial-bookmarked="novel.is_bookmarked"
            :bookmark-count="novel.total_bookmarks"
          />
          <view
            class="flex-1 ml-3 h-[12.8vw] rounded-[var(--md-shape-full)] flex items-center justify-center"
            :class="masked ? 'bg-white/20' : 'bg-primary active:opacity-80'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="t('novelIntro.startReadingA11y')"
            @tap="startReading"
          >
            <text class="text-label-large font-medium" :class="masked ? 'text-white/50' : 'text-primary-on'">{{ t('novelIntro.startReading') }}</text>
          </view>
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
  </view>
</template>
