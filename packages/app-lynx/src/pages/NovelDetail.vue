<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { currentParams, goBack, requestBack, registerBackGuard } from '../router'
import { loadNovelDetail, fetchNovelText, loadNovelSeries, addNovelWatchlist } from '../api/novel'
import type { PixivNovel } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { isRestricted } from '../stores/settingsStore'
import { isDismissed, markDismissed, setWatchState } from '../stores/watchlistStore'
import {
  createWatchlistPrompt,
  type WatchlistPromptController,
} from '../primitives/createWatchlistPrompt'
import { computeReadProgress } from '../primitives/watchlistPrompt'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import SkeletonNovel from '../components/SkeletonNovel.vue'
import WatchlistPromptDialog from '../components/WatchlistPromptDialog.vue'
import { t0log } from '../debug/t0Diag' // [T0-DIAG]

const novel = ref<PixivNovel | null>(null)
const text = ref('')
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

// ─── 评论弹层（issue #164）：入口在作者/元信息行附近；弹层挂根 view 内、scroll-view 之后 ───
const showComments = ref(false)

// ─── 追更询问（issue #226 / spec §US4 接线半） ───
// 页面保持薄：预取 + 触发判定 + 弹窗状态机全部在 createWatchlistPrompt；
// 本页只做三件事——喂滚动事件、把 requestBack 接进返回守卫、按状态渲染弹窗。
// novel-detail 不在 App.vue KeepAlive include 白名单（详情页按 :id 加载，不缓存）；
// 守卫在 setup 顶层注册（registerBackGuard）+ onUnmounted 注销，prompt 随详情落地创建——
// 对非缓存组件 setup/onUnmounted 与 onMounted 等价，无需 onActivated/onDeactivated。
let prompt: WatchlistPromptController | null = null

/** 详情加载完成后创建 prompt（此时 novel.series 已知，预取才能发起） */
function setupPrompt(): void {
  prompt = createWatchlistPrompt({
    getSeries: () => novel.value?.series ?? null,
    loadWatchState: async (seriesId) =>
      (await loadNovelSeries(seriesId)).novel_series_detail.watchlist_added,
    isDismissed,
    markDismissed,
    setWatchState,
    addWatchlist: addNovelWatchlist,
  })
}

function teardownPrompt(): void {
  prompt?.dispose()
  prompt = null
}

// 系统返回桥（ADR-0066 扩展）：guard 在 modalStack 之后、历史栈 pop 之前裁决；
// prompt 未创建（加载期/非系列）时放行，与左上角 requestBack() 共用同一守卫链
const unregisterBackGuard = registerBackGuard(() => prompt?.requestBack() ?? false)

// ─── 滚动跟踪（T0 平台结论） ───
// Lynx scroll-view 的 @scroll 是 per-frame 特性（ADR-0109：LynxScrollEvent payload
// 含 scrollTop/scrollHeight；ADR-0110 平台事实②只裁剪了 <list>，未裁剪 scroll-view）。
// payload 无 viewport 高度：web-core 用 window.innerHeight，原生端退化为
// scrollTop/scrollHeight 近似（computeReadProgress 注释）；到达底部由
// @scrolltolower 权威兜底（多页面已实证），两路并进——即使原生 @scroll 不派发，
// 底部触发仍然成立（spec §7 降级预案天然内建于双路设计）。
const reachedBottom = ref(false)

function getViewportHeight(): number {
  // 原生 LynxView 背景线程无 window；web-core 预览有 innerHeight
  return typeof window !== 'undefined' && typeof window.innerHeight === 'number'
    ? window.innerHeight
    : 0
}

// [T0-DIAG] 进度分桶状态
let lastProgressBucket = -1

function onNovelScroll(e: { detail?: { scrollTop?: number; scrollHeight?: number } }): void {
  const detail = e?.detail
  if (!detail) return
  const progress = computeReadProgress(
    Number(detail.scrollTop ?? 0),
    Number(detail.scrollHeight ?? 0),
    getViewportHeight(),
  )
  // [T0-DIAG] 临时诊断打点：progress 跨 0.1 桶时记一条（防刷屏），修复后移除
  const bucket = Math.floor(progress * 10)
  if (bucket !== lastProgressBucket) {
    lastProgressBucket = bucket
    t0log('[novel]', `progress=${progress.toFixed(2)} top=${detail.scrollTop} h=${detail.scrollHeight}`)
  }
  prompt?.notifyScroll(progress, reachedBottom.value)
}

function onNovelToBottom(): void {
  t0log('[novel]', 'scrollview TOBOTTOM') // [T0-DIAG]
  reachedBottom.value = true
  prompt?.notifyScroll(1, true)
}

// MVP：整段渲染，不做行级虚拟化（无 canvas/measureText，pretext 不可迁移）。
// 超长文本由 scroll-view 引擎滚动承接；后续原生集成阶段可换分段渲染。
const paragraphs = computed(() => {
  if (!text.value) return []
  return text.value
    .split(/\n+/u)
    .map((p) => p.trim())
    .filter(Boolean)
})

// generation-gate：章节内跳转（watch novelId 触发重载）后旧响应不得覆盖新数据
let loadGeneration = 0

async function loadNovel(): Promise<void> {
  const gen = ++loadGeneration
  loading.value = true
  errorMsg.value = ''
  novel.value = null
  text.value = ''
  reachedBottom.value = false
  teardownPrompt()
  try {
    // 先取详情判定受限态：受限小说不再拉正文（遮罩是内容不可达而非仅视觉遮挡）
    const detailRes = await loadNovelDetail(novelId.value)
    if (gen !== loadGeneration) return
    novel.value = detailRes.novel
    // [T0-DIAG] 系列信息打点（hasSeries 是追更询问第一判定条件），修复后移除
    t0log('[novel]', `loaded id=${novelId.value} hasSeries=${detailRes.novel.series != null} sid=${detailRes.novel.series?.id ?? 'none'}`,)
    // prompt 在详情落地后创建：getSeries 此时已知，系列预取才能发起；
    // 停留计时（dwellMs）从详情就绪起算，语义上更贴近「实质阅读时长」
    setupPrompt()
    if (!isRestricted(detailRes.novel)) {
      const fullText = await fetchNovelText(novelId.value)
      if (gen !== loadGeneration) return
      text.value = fullText
    }
  } catch (err) {
    if (gen !== loadGeneration) return
    errorMsg.value = presentError(err, '加载失败')
  } finally {
    if (gen === loadGeneration) loading.value = false
  }
}

onMounted(() => {
  void loadNovel()
})

onUnmounted(() => {
  unregisterBackGuard()
  teardownPrompt()
  loadGeneration++ // 卸载后任何在飞响应落地即作废
})

// 章节内跳转（spec §6-2）：路由参数变化 = 同一组件实例复用，
// dispose 旧 prompt（代递增废掉在飞预取）+ 全量重载（含新实例重建）
watch(novelId, (id, prev) => {
  if (!id || id === prev) return
  void loadNovel()
})

// ─── 弹窗事件语义差（spec §US5）：decline/confirm 继续原返回动作，cancel 留在详情页 ───
function onWatchlistDecline(): void {
  prompt?.decline()
  goBack()
}

async function onWatchlistConfirm(): Promise<void> {
  const p = prompt
  if (!p) return
  await p.confirm()
  // 成功 → 弹窗已关 → 继续返回；失败 → 弹窗保留（错误条 + 可重试），留在详情页。
  // prompt === p 守：在飞期间章节跳转重建实例后，旧 confirm 落地不得驱动返回
  if (prompt === p && !p.dialogOpen) goBack()
}

function onWatchlistCancel(): void {
  prompt?.cancel()
}
</script>

<template>
  <view class="w-full h-full bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <!-- 左上角返回改走 requestBack：与系统返回共用同一守卫链（spec §US3） -->
      <view class="py-1 pr-2" @tap="requestBack"><text class="text-[6.4vw] leading-none text-surface-on">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-surface-on">小说</text>
    </view>

    <!-- 加载期骨架（issue #91）：header 照常渲染，正文区骨架占位 -->
    <SkeletonNovel v-if="loading" />
    <view v-else-if="errorMsg" class="w-full h-full flex items-center justify-center">
      <text class="text-body-medium text-error p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view
      v-else
      class="w-full h-full"
      scroll-orientation="vertical"
      @scroll="onNovelScroll"
      @scrolltolower="onNovelToBottom"
    >
      <view class="py-5 px-4 bg-surface-container-lowest mb-3">
        <text class="text-title-large font-bold text-surface-on">{{ novel?.title }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
        <text class="text-label-medium text-outline mt-1.5">
          {{ novel?.text_length }} 字
          <template v-if="novel?.total_bookmarks != null">
             · ♥ {{ novel?.total_bookmarks }}
          </template>
        </text>
        <!-- 系列信息行（spec §US4）：已追更显示 M3 assist-chip 风格标记 -->
        <view v-if="novel?.series" class="mt-1.5 flex flex-row items-center">
          <text class="text-label-medium text-outline">《{{ novel.series.title }}》</text>
          <view
            v-if="prompt?.watchAdded === true"
            class="ml-2 px-2 py-0.5 rounded-[var(--md-shape-full)] bg-secondary-container"
          >
            <text class="text-label-small text-secondary-on-container">已追更</text>
          </view>
        </view>
        <!-- 评论入口（issue #164）：💬 + total_comments，字段缺失时不显示（对齐插画页惯例） -->
        <view
          v-if="novel?.total_comments !== undefined"
          class="mt-2 flex flex-row items-center"
          @tap="showComments = true"
        >
          <text class="text-[6.4vw] leading-none">💬</text>
          <text class="text-label-medium text-outline ml-1">{{ novel?.total_comments }}</text>
        </view>
      </view>
      <!-- 正文区：受限小说标题/作者/元信息可见，正文被遮罩挡住（issue #91） -->
      <view class="relative p-4">
        <template v-if="novel && isRestricted(novel)">
          <view class="min-h-[60vw]" />
          <RestrictOverlay :level="novel.x_restrict === 2 ? 2 : 1" />
        </template>
        <template v-else>
          <text v-for="(p, idx) in paragraphs" :key="idx" class="text-body-large leading-[44rpx] text-surface-on mb-4 block">
            {{ p }}
          </text>
        </template>
      </view>
      <view class="flex items-center justify-center p-6">
        <text class="text-body-small text-outline">— 完 —</text>
      </view>
    </scroll-view>

    <!-- 评论弹层（issue #164）：根 view 内、scroll-view 之后的覆盖层 → 弹层打开时正文滚动位置不丢失 -->
    <CommentOverlay v-if="showComments" type="novel" :target-id="novelId" @close="showComments = false" />

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
