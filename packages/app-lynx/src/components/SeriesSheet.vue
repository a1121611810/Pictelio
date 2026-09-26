<script setup lang="ts">
// ─── 系列目录底部弹层（app-lynx，spec docs/specs/app-lynx-novel-intro-action-row §US3 / §5.3 / §6.3）───
// 对齐 webview `packages/app/src/components/SeriesSheet.tsx` 行为：宿主以 modalStack 模式挂载
// （v-if + absolute inset-0 + @tap 关闭 + @tap.stop 防穿透，与 CommentOverlay / NovelExportSheet 同款）。
// 数据走本项目 US1 扩展的 `loadNovelSeriesChapters` / `loadNovelSeriesChaptersNext`
//（端点 GET /v2/novel/series，含 novels[] 列表与 next_url 分页游标）。
//
// 交互：
// - scrim 点击 → emit('close')
// - 章节点击 → emit('select', novelId)；宿主（NovelIntro）决定如何 navigate（spec D7）
// - 拖把顶栏点击 → emit('close')
// - 返回键 → modalStack 通道自动调用 emit('close')
//
// ADR-0123 合规：scrim/面板/拖把都挂 @tap 句柄或 v-if 条件渲染——禁止 pointer-events-none
// 兜底（lynx 原生 hit-testing 不识别 pointer-events，全屏覆盖层不挂 @tap 会吞掉下面所有点击）。
//
// 代闸（generation gate）：seriesId 变化或重挂载时，loadInitial 自增 loadGeneration；旧
// loadInitial / loadMore 响应到达后若 myGen !== loadGeneration 则丢弃（防竞态，spec D7
// 系列弹层章节点击触发宿主 navigate 重挂载时旧响应覆盖新数据）。
//
// 系列弹层 4 个 key（seriesSheet.empty / .current / .loadFailed / .loadMoreFailed）
// 已于 spec #734 T5c 阶段注册到 zh-CN/en 字典。tt() 包装保留作 verbatim 字符串拼接的容错通道
// （即使 key 已注册，tt('foo' as unknown as I18nKey) 仍可走字符串直传，避免类型联合收紧）。
// 复用既有 key：novels.footer.loading / novels.footer.end / novelIntro.retry / novels.charCount。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { PixivNovel } from '../api/types'
import { loadNovelSeriesChapters, loadNovelSeriesChaptersNext } from '../api/novel'
import { toSeriesId } from '../api/id'
import { presentError } from '../utils/errorPresentation'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t, type I18nKey } from '../i18n'
import { useModalStack } from '../stores/modalStack'

const props = defineProps<{
  /** 系列 id（系列行点击进入传 series.id） */
  seriesId: number
  /** 系列名（弹层标题显示） */
  seriesTitle: string
  /** 当前作品 id（用于章节列表「当前」高亮） */
  currentNovelId: number
}>()

const emit = defineEmits<{
  /** 关闭弹层（scrim / 拖把 / 返回键 / 宿主决定关闭时） */
  close: []
  /** 章节点击：参数 = 章节 novelId，宿主负责 navigate */
  select: [novelId: number]
}>()

/**
 * 本期新增 i18n key 包装（spec §10：T5 worker 负责完整翻译）。
 * t() 类型签名要求 I18nKey = keyof typeof zhCN，新 key 尚未在 zh-CN/en 字典中注册，
 * 统一走 tt() 包装做 unknown-as 旁路；运行时由 t() 缺 key 回退路径处理（约定行为），
 * 渲染产物 = key 字符串本身（本组件 template.test.ts 钉住「t() 缺 key 不抛错 + 返回 key」）。
 */
function tt(key: string, vars?: Record<string, string | number>): string {
  return t(key as unknown as I18nKey, vars)
}

// ─── 状态（按 spec §6.3 状态机）───
const chapters = ref<PixivNovel[]>([])
const loading = ref(true)
const errorMsg = ref('')
const loadingMore = ref(false)
const nextUrl = ref<string | null>(null)
const hasMore = computed(() => nextUrl.value !== null)

/** 代闸：每次 loadInitial 自增；旧 in-flight 响应在 myGen !== loadGeneration 时丢弃 */
let loadGeneration = 0

async function loadInitial(): Promise<void> {
  const myGen = ++loadGeneration
  chapters.value = []
  nextUrl.value = null
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadNovelSeriesChapters(toSeriesId(props.seriesId))
    if (myGen !== loadGeneration) return
    chapters.value = res.novels
    nextUrl.value = res.next_url
  } catch (err) {
    if (myGen !== loadGeneration) return
    // 测试硬约束 #3：禁止静默降级 — 错误必须显式暴露（console.warn + errorMsg 文案）
    console.warn('[SeriesSheet] loadInitial failed', err)
    errorMsg.value = presentError(err, tt('seriesSheet.loadFailed'))
  } finally {
    if (myGen === loadGeneration) loading.value = false
  }
}

async function loadMore(): Promise<void> {
  // 多重互斥：nextUrl 为空 / 已经在加载更多 / 首屏未完成 → no-op
  if (!nextUrl.value || loadingMore.value || loading.value) return
  const myGen = loadGeneration
  loadingMore.value = true
  try {
    const res = await loadNovelSeriesChaptersNext(nextUrl.value)
    if (myGen !== loadGeneration) return
    // 增量追加（不替换）——append-only，分页不重建列表（ADR-0107 D4 安全追加）
    chapters.value = [...chapters.value, ...res.novels]
    nextUrl.value = res.next_url
  } catch (err) {
    if (myGen !== loadGeneration) return
    console.warn('[SeriesSheet] loadMore failed', err)
    // 内联错误（与列表 inline pagination error 一致）—— 不弹窗、不重置已有数据
    errorMsg.value = presentError(err, tt('seriesSheet.loadMoreFailed'))
  } finally {
    if (myGen === loadGeneration) loadingMore.value = false
  }
}

function reload(): void {
  void loadInitial()
}

function onChapterTap(novelId: number): void {
  emit('select', novelId)
}

// ─── 返回键拦截（modalStack 通道）：挂载时注册，卸载/关闭时注销 ───
let unregisterModal: (() => void) | null = null

onMounted(() => {
  unregisterModal = useModalStack().registerModal(() => emit('close'))
  void loadInitial()
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
})

/** 暴露 loadMore 给宿主（宿主可经模板 ref 触发；本期默认不接 sentinel，留接口备扩展） */
defineExpose({ loadMore })
</script>

<template>
  <!-- 根：absolute inset-0 宿主（modalStack 模式 + ADR-0123 交互面）
       不挂 @tap——关闭由内层 scrim @tap 触发（避免重复触发与冒泡路径分叉） -->
  <view class="absolute inset-0">
    <!-- 半透明遮罩：@tap 关闭（ADR-0123 红线：全屏覆盖层必须可点关闭）
         bg-scrim = M3 scrim token（spec §5.3 推荐 bg-black/50；项目约定用 token） -->
    <view
      class="absolute inset-0 bg-scrim"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="t('novelIntro.closeA11y')"
      @tap="emit('close')"
    />

    <!-- 底部面板：max-h-[80vh] + 圆角顶部（M3 弹层高度约束）+ @tap.stop 防穿透到 scrim -->
    <view
      class="absolute bottom-0 left-0 right-0 max-h-[80vh] bg-surface-container-lowest
        rounded-t-[var(--md-shape-extra-large)] flex flex-col"
      @tap.stop
    >
      <!-- 拖把式顶栏（视觉提示，可点关闭） -->
      <view class="w-full flex justify-center pt-2 pb-1">
        <view
          class="w-12 h-1 rounded-full bg-outline"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelIntro.closeA11y')"
          @tap="emit('close')"
        />
      </view>

      <!-- 标题：系列名（spec §5.3） -->
      <text
        class="block px-6 pt-2 pb-3 text-title-medium font-semibold text-surface-on"
        number-of-lines="1"
      >
        {{ seriesTitle }}
      </text>

      <!-- 三态：加载中 / 错误+重试 / 空态 -->
      <view v-if="loading" class="px-6 py-8 flex items-center justify-center">
        <text class="text-body-medium text-surface-on-variant">{{ t('novels.footer.loading') }}</text>
      </view>

      <view v-else-if="errorMsg" class="px-6 py-8 flex flex-col items-center gap-3">
        <text class="text-body-medium text-error text-center">{{ errorMsg }}</text>
        <view
          class="min-h-12 px-5 rounded-[var(--md-shape-full)] border border-outline
            bg-surface-container-lowest flex items-center justify-center
            active:bg-state-pressed-on-surface"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelIntro.retry')"
          @tap="reload"
        >
          <text class="text-label-large text-primary">{{ t('novelIntro.retry') }}</text>
        </view>
      </view>

      <view v-else-if="chapters.length === 0" class="px-6 py-8 flex items-center justify-center">
        <text class="text-body-medium text-surface-on-variant">{{ tt('seriesSheet.empty') }}</text>
      </view>

      <!-- 章节列表：vue-lynx 原生 list / list-item（item-key 必须 String，ADR-0056） -->
      <list v-else class="px-4 pb-4" style="max-height: 60vh">
        <list-item
          v-for="(chapter, idx) in chapters"
          :key="chapter.id"
          :item-key="String(chapter.id)"
          class="min-h-12 px-4 rounded-[var(--md-shape-medium)] flex items-center justify-between
            active:bg-state-pressed-on-surface"
          :class="chapter.id === currentNovelId ? 'bg-secondary-container' : ''"
          @tap="onChapterTap(chapter.id)"
        >
          <view class="flex-1 min-w-0">
            <text
              class="text-body-medium text-surface-on"
              :class="chapter.id === currentNovelId ? 'font-semibold' : ''"
              number-of-lines="2"
            >
              {{ idx + 1 }}. {{ chapter.title }}
            </text>
            <text
              v-if="chapter.text_length"
              class="block text-label-small text-surface-on-variant mt-1"
            >
              {{ t('novels.charCount', { count: chapter.text_length }) }}
            </text>
          </view>
          <!-- 当前章节标记 chip（仅匹配 currentNovelId 时显示） -->
          <view
            v-if="chapter.id === currentNovelId"
            class="ml-2 px-2 py-0.5 rounded-full bg-primary flex-shrink-0"
          >
            <text class="text-label-small text-primary-on">{{ tt('seriesSheet.current') }}</text>
          </view>
        </list-item>

        <!-- 分页 footer 三态（spec §6.3）：loading-more / end-of-list / sentinel
             sentinel：本期默认不接 @scrolltolower，靠 defineExpose 暴露的 loadMore 触发（更稳） -->
        <list-item
          v-if="loadingMore"
          :key="'loading-more'"
          item-key="loading-more"
          full-span
          class="py-4 flex items-center justify-center"
        >
          <text class="text-label-medium text-surface-on-variant">{{ t('novels.footer.loading') }}</text>
        </list-item>
        <list-item
          v-else-if="!hasMore && chapters.length > 0"
          :key="'end'"
          item-key="end"
          full-span
          class="py-4 flex items-center justify-center"
        >
          <text class="text-label-medium text-surface-on-variant">{{ t('novels.footer.end') }}</text>
        </list-item>
        <list-item
          v-else-if="hasMore"
          :key="'loadmore-sentinel'"
          item-key="loadmore-sentinel"
          full-span
          class="py-2"
        >
          <view class="h-1" />
        </list-item>
      </list>
    </view>
  </view>
</template>