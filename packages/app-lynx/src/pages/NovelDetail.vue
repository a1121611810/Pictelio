<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch } from 'vue'
import { useMainThreadRef, runOnBackground } from 'vue-lynx'
import { computeReadProgress } from '../primitives/watchlistPrompt'
import { novelAverageParagraphHeightPx } from '../primitives/novelParagraphEstimate'
import { currentParams, goBack, requestBack, registerBackGuard } from '../router'
import { loadNovelDetail, fetchNovelData, loadNovelSeries, addNovelWatchlist } from '../api/novel'
import type { NovelExportFormat, NovelImagesMap } from '@pictelio/novel-export'
import { buildNovelExportPayload, buildNovelExportTaskDraft } from '@pictelio/novel-export'
import type { PixivNovel } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useSettingsStore } from '../stores/settingsStore'
import { useDownloadStore } from '../stores/downloadStore'
import { useNovelTranslateStore } from '../stores/novelTranslateStore'
import { isDismissed, markDismissed, setWatchState } from '../stores/watchlistStore'
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
import SkeletonNovel from '../components/SkeletonNovel.vue'
import WatchlistPromptDialog from '../components/WatchlistPromptDialog.vue'
import TextSelectionToolbar from '../components/TextSelectionToolbar.vue'
import { useTextSelection } from '../composables/useTextSelection'

const novel = ref<PixivNovel | null>(null)
const text = ref('')
/** 正文内嵌图片映射（[pixivimage:id] → 图片 URL 档位），导出 payload 用 */
const novelImages = ref<NovelImagesMap>({})
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

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
      (await loadNovelSeries(seriesId)).novel_series_detail.watchlist_added,
    isDismissed,
    markDismissed,
    setWatchState,
    addWatchlist: addNovelWatchlist,
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
  // DEV hook：模拟器测试强制放行 R-18（dev only；正式 release 必须 revert）
  // 与 settingsStore.dev_force_r18 hook 联动：showR18 && showR18G 同开视为 dev 强制
  if (settings.showR18 && settings.showR18G) {
    return paragraphs.value.length > 0
  }
  return paragraphs.value.length > 0 && xRestrict.value === 0
})

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

async function loadNovel(): Promise<void> {
  const gen = ++loadGeneration
  loading.value = true
  errorMsg.value = ''
  novel.value = null
  text.value = ''
  novelImages.value = {}
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
    // AI 遮罩态同样不拉正文（与 R18 一致：遮罩是内容不可达而非仅视觉遮挡，ADR-0155）
    if (!isRestricted(detailRes.novel) && !isAiRestricted(detailRes.novel)) {
      const data = await fetchNovelData(novelId.value)
      if (gen !== loadGeneration) return
      // 保留原 fetchNovelText 的空正文语义：提取失败 → 走 catch 展示错误
      if (!data.text) throw new Error(t('novelDetail.bodyExtractFailed')) // i18n: 构造时快照（瞬态）
      text.value = data.text
      novelImages.value = data.images
    }
  } catch (err) {
    if (gen !== loadGeneration) return
    errorMsg.value = presentError(err, t('error.fallback.loadFailed'))
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
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <!-- 左上角返回改走 requestBack：与系统返回共用同一守卫链（spec §US3） -->
      <view class="py-1 pr-2" @tap="requestBack"><text class="text-[6.4vw] leading-none text-surface-on">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-surface-on">{{ t('novelDetail.title') }}</text>
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
        <text class="text-title-large font-bold text-surface-on">{{ novel?.title }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
        <!-- 评论入口（issue #164）：💬 + total_comments，字段缺失时不显示（对齐插画页惯例）；票 #578 两端都留 -->
        <view
          v-if="novel?.total_comments !== undefined"
          class="mt-2 flex flex-row items-center"
          @tap="showComments = true"
        >
          <text class="text-[6.4vw] leading-none">💬</text>
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
          <text class="text-[6.4vw] leading-none">⬆</text>
          <text class="text-label-medium text-outline ml-1">{{ t('novelDetail.export.action') }}</text>
        </view>
        <!-- 翻译入口（spec §6.2 顶部 banner 位置）：FAB 内联；R18/AI 受限时隐藏 -->
        <view v-if="translationEnabled" class="mt-3">
          <TranslateButton
            :novel-id="novelId"
            :chapter-id="novelId"
            :paragraphs="paragraphs"
          />
          <view v-if="translateStore.isCached[novelId] || translateStore.status === 'completed'" class="mt-2">
            <TranslateModeSwitch :enabled="true" />
          </view>
        </view>
        <!-- 入队内联提示（lynx 无全局 toast）：约 4s 后自动隐藏 -->
        <text v-if="exportNotice" class="text-label-medium text-primary mt-1.5">{{ exportNotice }}</text>
      </view>
      </list-item>
      <list-item
        v-for="(p, idx) in paragraphs"
        :key="selection.paragraphId(idx)"
        :item-key="selection.paragraphId(idx)"
        :estimated-main-axis-size-px="estimatedHeightPx"
        class="w-full px-4 mb-4"
      >
        <!-- 正文选中（spec app-lynx-novel-text-selection）：三条属性**必须静态字面量**——
             vue-lynx 会吞掉动态布尔绑定（设备实证），届时引擎自带菜单不会被替换 -->
        <text
          :id="selection.paragraphId(idx)"
          class="text-body-large leading-[44rpx] text-surface-on"
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
    </list>

    <!-- 受限小说：列表结构性改动不涉及（不拉正文），保留原头部+遮罩形态 -->
    <view v-else class="w-full flex-1 min-h-0 p-4 relative">
      <view class="py-5 px-4 bg-surface-container-lowest mb-3">
        <!-- 头部精简同 meta 卡（票 #589）；受限遮罩/追更询问行为不变 -->
        <text class="text-title-large font-bold text-surface-on">{{ novel?.title }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
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
