<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useMainThreadRef, runOnBackground } from 'vue-lynx'
import { computeReadProgress } from '../primitives/watchlistPrompt'
import { novelAverageParagraphHeightPx } from '../primitives/novelParagraphEstimate'
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
import RestrictOverlay from '../components/RestrictOverlay.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import SkeletonNovel from '../components/SkeletonNovel.vue'
import WatchlistPromptDialog from '../components/WatchlistPromptDialog.vue'

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

// ─── 滚动跟踪（ADR-0134：MT 信号；BT @scroll 不派发） ───
// [prototype→spike] 滚动信号面：官方 list 只有边界事件（scrolltolower/scrolltoupper）；
// 到「底部」由 @scrolltolower 权威触发（reachBottom 供追更询问），上端进度信号见 MT 实验。
const reachedBottom = ref(false)

// 主线程滚动信号（ADR-0134）：<list> 经 :main-thread-bindscroll 接收 scrollTop（BT @scroll 不派发）。
// MT→BT 传递用 runOnBackground 官方桥（BT 读 .value 的跨线程同步不可靠——真机实证）；节流：
// 上次上报后滚动增量 <8% 高度不重复上报（防每帧跨线程消息风暴）。
const mtReportedTop = useMainThreadRef(-1)
const mtHeightWarned = useMainThreadRef(false)
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
  void runOnBackground((t: number, h: number) => {
    // 在背景线程执行：live 读 prompt/reachedBottom；进度纯函数复用 computeReadProgress
    //（viewport=0 保守口径，单测已覆盖 watchlistPrompt.test.ts）
    reportNovelProgress(computeReadProgress(t, h, 0))
  })(top, height)
}


function onNovelToBottom(): void {
  reachedBottom.value = true
  prompt?.notifyScroll(1, true)
}

/** MT→BT 桥回调（runOnBackground）：向追更 prompt 喂最新进度（≥70% 双路判定输入） */
function reportNovelProgress(progress: number): void {
  prompt?.notifyScroll(progress, reachedBottom.value)
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
    <!-- [prototype→spike] 正文改 <list single> 引擎虚拟化（官方指南：超三屏用 list）。
         红线：Vue :key 与 Lynx :item-key 双份一致 + 稳定 id；estimated 估算滚动条。
         附带实验：:main-thread-bindscroll 真机派发（BT @scroll 实证不派发）。 -->
    <list
      v-else-if="novel && !isRestricted(novel)"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      :main-thread-bindscroll="onNovelScrollMT"
      @scrolltolower="onNovelToBottom"
    >
      <list-item :key="'meta'" :item-key="'meta'" :estimated-main-axis-size-px="estimatedHeightPx" class="w-full">
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
      </list-item>
      <list-item
        v-for="(p, idx) in paragraphs"
        :key="`p-${idx}`"
        :item-key="`p-${idx}`"
        :estimated-main-axis-size-px="estimatedHeightPx"
        class="w-full px-4 mb-4"
      >
        <text class="text-body-large leading-[44rpx] text-surface-on">{{ p }}</text>
      </list-item>
      <list-item :key="'end'" :item-key="'end'" class="w-full">
        <view class="flex items-center justify-center p-6">
          <text class="text-body-small text-outline">— 完 —</text>
        </view>
      </list-item>
    </list>
    <!-- 受限小说：列表结构性改动不涉及（不拉正文），保留原头部+遮罩形态 -->
    <view v-else class="w-full h-full p-4 relative">
      <view class="py-5 px-4 bg-surface-container-lowest mb-3">
        <text class="text-title-large font-bold text-surface-on">{{ novel?.title }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
        <text class="text-label-medium text-outline mt-1.5">
          {{ novel?.text_length }} 字
          <template v-if="novel?.total_bookmarks != null">
             · ♥ {{ novel?.total_bookmarks }}
          </template>
        </text>
        <!-- 系列信息行（与 meta 卡一致；受限小说保留，spec 回归项） -->
        <view v-if="novel?.series" class="mt-1.5 flex flex-row items-center">
          <text class="text-label-medium text-outline">《{{ novel.series.title }}》</text>
          <view
            v-if="prompt?.watchAdded === true"
            class="ml-2 px-2 py-0.5 rounded-[var(--md-shape-full)] bg-secondary-container"
          >
            <text class="text-label-small text-secondary-on-container">已追更</text>
          </view>
        </view>
        <!-- 评论入口（与 meta 卡一致） -->
        <view
          v-if="novel?.total_comments !== undefined"
          class="mt-2 flex flex-row items-center"
          @tap="showComments = true"
        >
          <text class="text-[6.4vw] leading-none">💬</text>
          <text class="text-label-medium text-outline ml-1">{{ novel?.total_comments }}</text>
        </view>
      </view>
      <view class="relative p-4">
        <view class="min-h-[60vw]" />
        <RestrictOverlay :level="novel && novel.x_restrict === 2 ? 2 : 1" />
      </view>
    </view>

    <!-- 评论弹层（issue #164）：根 view 内、正文列表之后的覆盖层 → 弹层打开时滚动位置不丢失 -->
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
