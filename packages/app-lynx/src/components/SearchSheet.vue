<script setup lang="ts">
// ─── 全局搜索弹层（app-lynx，issue #295 / spec app-lynx-global-search D5）───
// 弹层主体：遮罩 + 底部 80vh 面板，形态蓝本 = throwaway 分支 PrototypeSearch.vue
// 变体 A（遮罩 @tap 关闭、面板 @tap.stop 防穿透、DOM 顺序靠后覆盖——App.vue 内
// 挂于 GlobalFab 之后，见 glossary「弹层全局单例」：全 App 只挂一份，开合经
// searchSheetStore 全局单例控制，各页不各自 v-if）。
// 数据走 useSearch（spec D2）：state 是 getter 返回的只读快照（computed 聚合），
// 模板直接读 state.status / state.results 等；本组件负责生命周期（onMounted
// loadHistory + 自动聚焦、onBeforeUnmount dispose）与搜索历史写入（提交点，
// glossary「搜索提交点」：回车 / 点历史词条 / 点结果行——输入中间态不写历史）。
// 返回键：openSearch 时 searchSheetStore 已向 modalStack 注册返回键关闭（D4），
// 组件不重复注册；所有关闭路径（遮罩 / × / 返回键）收敛到 closeSearch()，
// App.vue 的 v-if 卸载本组件 = 关闭即重置（keyword/结果清空，历史保留）。
// IME 注记：vue-lynx 运行的 v-model 在 isComposing=true 时跳过赋值、但用户
// @input 处理器仍会被调用（runtime injectVModelEvent 先 v-model 后 user
// handler）——故 onInput 按事件 detail.isComposing 过滤，组合态不搜，
// 组合结束的 lynxinput 事件（isComposing=false）自然触发即输即搜
// （docs/research/global-search-patterns.md §4.2）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { navigate } from '../router'
import type { SearchState, SearchResultItem } from '../primitives/useSearch'
import { useSearch } from '../primitives/useSearch'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import { useSearchHistoryStore } from '../stores/searchHistoryStore'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { thumbUrl } from '../utils/imageUrl'
import { SEARCH_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import SkeletonImage from './SkeletonImage.vue'
import {
  BOOKMARK_BANDS,
  countActiveFilters,
  DEFAULT_SEARCH_FILTERS,
  resolveAiMode,
  type SearchFilters,
} from '@pictelio/search-core'
import type { SearchScope, SearchSort } from '../api/types'

const searchHistory = useSearchHistoryStore()
const searchSheet = useSearchSheetStore()
const settings = useSettingsStore()
const isRestricted = settings.isRestricted

const controller = useSearch()
// state 是 getter 返回的只读快照 → 用 computed 包裹保持响应式（模板自动解包）
const state = computed<SearchState>(() => controller.state)
/** 仅看态：非 AI 结果从渲染流移除（分页/空态仍基于服务端返回语义） */
const rawResults = computed(() => state.value.results)
/** 有效 AI 模式（#479 面板覆盖：follow=账号设置 / all=show / hide=mask；解析单点 search-core） */
const effectiveAiMode = computed(() =>
  resolveAiMode(settings.aiFilterMode, state.value.filters.aiOverride),
)
/** 仅看态移除非 AI 行（ADR-0155 only 语义）；mask 走行遮罩，不在数据层移除 */
const visibleResults = computed(() => {
  const rows = rawResults.value
  return effectiveAiMode.value === 'only'
    ? rows.filter((r) => !settings.isAiWork(r.entity))
    : rows
})

/** 首载三态（ADR-0150）：首搜无旧结果 → 骨架；换词保留旧结果（hasItems 优先 → 内容）；ready 且空 → 空态 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: visibleResults.value.length > 0,
    loading: state.value.isSearching || state.value.status === 'loading',
    settled: state.value.status === 'ready',
    hasError: state.value.status === 'error',
  }),
)

// 关键词（组件私有）：v-model 输入；清空/历史词条点选时同步赋值
const keyword = ref('')

/** 输入框 ref：弹层打开自动聚焦（ADR-0132 风险表验证点：web-core x-input 有
 * focus()，原生 LynxView input.focus() 同可用；延迟一帧确保已挂载） */
const inputRef = ref<{ focus?: () => void } | null>(null)
let focusTimer: ReturnType<typeof setTimeout> | undefined

// ── scope / sort 段（spec D5；空词时 setScope/setSort 只更新状态，输入后生效） ──
// 段内 chips 为常量三态（全部/插画/小说、最新/最早/热门），模板显式写出（a11y 标注
// 逐 chip 静态绑定，区别于 v-for 动态 label）；选中态类出自下方两对纯函数。

// scope/sort chip 共用类（选中态 / 非选中态）
const scopeCls = (active: boolean) =>
  active ? 'bg-secondary-container' : 'bg-surface-container-high'
const scopeTextCls = (active: boolean) =>
  active ? 'text-secondary-on-container' : 'text-surface-on-variant'
const sortCls = (active: boolean) =>
  active ? 'bg-primary-container' : 'bg-surface-container-high'
const sortTextCls = (active: boolean) =>
  active ? 'text-primary-on-container' : 'text-surface-on-variant'

// ── 筛选折叠区（#474/#477：SearchSheet 内折叠筛选区，默认折叠；spec §4/§5） ──
// 交互语义与 webview SearchFilterSheet 同规格（#476）：即改即搜（450ms debounce 在
// controller.setFilters）；再点已选回默认=逐维可清；scope=novel 比例/分辨率置灰不清值；
// 热门排序收藏数置灰（popular-preview 忽略区间）；关闭弹层随 controller.dispose 重置（Q1）。
const filterOpen = ref(false)
const filters = computed(() => state.value.filters)
const activeFilterCount = computed(() => countActiveFilters(filters.value))
const illustDimmed = computed(() => state.value.scope === 'novel')
const bookmarkDimmed = computed(() => state.value.sort === 'popular_desc')

function onFilterChange(next: SearchFilters): void {
  controller.setFilters(next)
}

function chipCls(active: boolean, disabled = false): string {
  const tone = active ? 'bg-primary-container' : 'bg-surface-container-high'
  return `h-[10.667vw] px-3 rounded-[var(--md-shape-full)] flex items-center ${tone}${disabled ? ' opacity-40' : ''}`
}
function chipTextCls(active: boolean): string {
  return active ? 'text-primary-on-container font-medium' : 'text-surface-on-variant'
}

const PERIOD_PRESETS: { value: '1d' | '1w' | '1m' | '6m' | '1y'; label: string }[] = [
  { value: '1d', label: '24 小时内' },
  { value: '1w', label: '一周内' },
  { value: '1m', label: '一个月内' },
  { value: '6m', label: '半年内' },
  { value: '1y', label: '一年内' },
]
const RES_OPTIONS = [1000, 2000, 3000]
const AI_OPTIONS: { value: SearchFilters['aiOverride']; label: string }[] = [
  { value: 'follow', label: '跟随设置' },
  { value: 'all', label: '全部显示' },
  { value: 'hide', label: '隐藏 AI' },
]

function bandLabel(band: { min: number; max: number | null }): string {
  return band.max === null ? `${band.min}+` : `${band.min}-${band.max}`
}
function isPresetActive(v: (typeof PERIOD_PRESETS)[number]['value']): boolean {
  const p = filters.value.period
  return p.kind === 'preset' && p.preset === v
}
function togglePeriodPreset(v: (typeof PERIOD_PRESETS)[number]['value']): void {
  const p = filters.value.period
  onFilterChange({
    ...filters.value,
    period: p.kind === 'preset' && p.preset === v ? { kind: 'any' } : { kind: 'preset', preset: v },
  })
}
function isBandActive(band: { min: number; max: number | null }): boolean {
  const b = filters.value.bookmark
  return b !== null && b.min === band.min && b.max === band.max
}
function toggleBookmark(band: { min: number; max: number | null }): void {
  const b = filters.value.bookmark
  onFilterChange({
    ...filters.value,
    bookmark: b !== null && b.min === band.min && b.max === band.max ? null : { ...band },
  })
}
function setRatio(v: 'landscape' | 'portrait' | 'square' | null): void {
  onFilterChange({ ...filters.value, ratio: v })
}
function setMinPixels(v: number | null): void {
  onFilterChange({ ...filters.value, minPixels: v })
}
function setAiOverride(v: SearchFilters['aiOverride']): void {
  onFilterChange({ ...filters.value, aiOverride: v })
}
function clearAllFilters(): void {
  onFilterChange({ ...DEFAULT_SEARCH_FILTERS })
}

// ── 结果行渲染辅助 ──
function rowKey(row: SearchResultItem): string {
  // item-key 必须 String（ADR-0055/0056）：type 前缀防插画/小说 id 撞 key
  return `${row.type}-${row.entity.id}`
}

function rowThumb(row: SearchResultItem): string {
  // 插画/小说共用 image_urls 契约（square_medium 加速行内缩略图）
  return thumbUrl(row.entity.image_urls)
}

/** 行式副标题：作者 · 类型/字数（spec D5；字数对齐各列表页 `{{ text_length }} 字` 惯例） */
function rowSub(row: SearchResultItem): string {
  if (row.type === 'novel') return `${row.entity.text_length} 字`
  const t = row.entity.type
  return t === 'manga' ? '漫画' : t === 'ugoira' ? '动图' : '插画'
}

/** R18 等级派生（对齐 RestrictedNovelCard：x_restrict===2 → R-18G，否则 R-18） */
function restrictLevel(row: SearchResultItem): 1 | 2 {
  return row.entity.x_restrict === 2 ? 2 : 1
}

// ── AI 三态（ADR-0155）行遮罩辅助 ──

/** 行是否处于遮罩态：R18 受限 或 AI 遮罩态（R18 优先；AI 段走有效模式注入，#479） */
function isRowMasked(row: SearchResultItem): boolean {
  return (
    isRestricted(row.entity) ||
    (effectiveAiMode.value === 'mask' && settings.isAiWork(row.entity))
  )
}

/** AI 等级派生（novel_ai_type===2 → 纯 AI，否则 AI 辅助） */
function aiLevel(row: SearchResultItem): 1 | 2 {
  const t = row.entity.illust_ai_type ?? row.entity.novel_ai_type ?? 0
  return t === 2 ? 2 : 1
}

/** 遮罩行徽章文案（R18 优先） */
function rowMaskLabel(row: SearchResultItem): string {
  if (isRestricted(row.entity)) return restrictLevel(row) === 2 ? 'R-18G' : 'R-18'
  return aiLevel(row) === 2 ? 'AI' : 'AI辅助'
}

/** 遮罩行原因文案 */
function rowMaskHint(row: SearchResultItem): string {
  return isRestricted(row.entity) ? '受浏览限制，不予显示' : 'AI 作品，已在设置中遮罩'
}

// ── 输入 ──
interface LynxInputEvent {
  detail?: { value?: string; isComposing?: boolean }
}

function onInput(data: LynxInputEvent): void {
  // vue-lynx 运行时保证 v-model 赋值先于用户 @input（injectVModelEvent）；
  // IME 组合态（isComposing=true）v-model 跳过赋值 → 此处不搜，组合结束再搜
  if (data?.detail?.isComposing) return
  // 即输即搜：300ms debounce 在 controller.search 内层实现（spec D2），
  // 本组件方向单向：输入 → controller.search；空词 controller 立即清空回 idle
  controller.search(keyword.value)
}

// ── 搜索历史提交点（glossary「搜索提交点」：仅三处写入，输入中间态不写） ──
/** 提交点① 回车确认（soft keyboard confirm / 硬件 Enter → lynx confirm 事件） */
function onConfirm(): void {
  searchHistory.addHistory(keyword.value)
}

/** 提交点② 点击历史词条：设词 + 写历史 + 立即搜（不 debounce，搜索点 = 点选即搜） */
function onHistoryTap(word: string): void {
  keyword.value = word
  searchHistory.addHistory(word)
  controller.search(word)
}

/** 提交点③ 点击结果行：写历史 + 关层 + 跳详情（回原页位置感由导航历史保持） */
function onResultTap(row: SearchResultItem): void {
  searchHistory.addHistory(keyword.value)
  searchSheet.closeSearch()
  void navigate(row.type === 'novel' ? `/novel/${row.entity.id}` : `/illust/${row.entity.id}`)
}

function onHistoryRemove(word: string): void {
  searchHistory.removeHistory(word)
}

function onClearHistory(): void {
  searchHistory.clearHistory()
}

// 输入清除 ×：keyword 清空 → controller.search('') 立即清空回 idle（spec US8）
function onClearInput(): void {
  keyword.value = ''
  controller.search('')
}

// scope / sort / 分页 / 重试
function onScopeTap(scope: SearchScope): void {
  controller.setScope(scope)
}
function onSortTap(sort: SearchSort): void {
  controller.setSort(sort)
}
function onLoadMore(): void {
  void controller.loadMore()
}
function onRetry(): void {
  void controller.refresh()
}

// 统一关闭路径：遮罩 / × 都走 closeSearch()（返回键由 modalStack 回调同一函数）
function onClose(): void {
  searchSheet.closeSearch()
}

onMounted(() => {
  // 打开即拉历史（D3：首拉持久化历史；chips 展示）
  void searchHistory.loadHistory()
  // 预填词（ADR-0133 决策 2/5）：标签点击进入——一次性消费（读取即清），
  // 词入 keyword 后走同一 controller.search 链（即输即搜），且**不写搜索历史**
  // （程序化唤起 ≠ 提交点；对齐 webview SearchableTag 的 hydration 路径行为）。
  const prefill = searchSheet.consumePrefillKeyword()
  if (prefill) {
    keyword.value = prefill
    controller.search(prefill)
  }
  // 自动聚焦（spec US6 / ADR-0132 风险表「输入框自动聚焦」验证点）：
  // 弹层挂载后延迟一帧 focus，避免原生 input 尚未完成挂载
  focusTimer = setTimeout(() => inputRef.value?.focus?.(), 50)
})

onBeforeUnmount(() => {
  if (focusTimer !== undefined) clearTimeout(focusTimer)
  // 释放：abort 全部在途 + 取消待发 debounce；此后 controller 全方法 no-op
  controller.dispose()
})
</script>

<template>
  <!-- 根 view：absolute inset-0 锚在 page 根（与 exitHint/GlobalFab 同为离流定位——
       App.vue 内流内兄弟会排在 100% 高的页面组件之后、被顶出视口（实测 10:44 弹层
       在屏幕外挂载）；z-40 vs GlobalFab 同层时 DOM 后序胜出（App.vue 先 GlobalFab
       后 SearchSheet），也盖过页面内 z-30 分页 FAB（RefreshableList，review P1-1）。 -->
  <view class="absolute inset-0 z-40">
    <!-- 遮罩：absolute inset-0，@tap 关闭（关闭即重置：App.vue v-if 卸载） -->
    <view class="absolute inset-0 bg-scrim" @tap="onClose" />

    <!-- 底部面板：@tap.stop 防面板内点击穿透到遮罩（CommentOverlay 同款） -->
    <view
      class="absolute bottom-0 left-0 right-0 h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col"
      @tap.stop
    >
      <!-- 标题栏：居中「搜索」+ × 关闭 -->
      <view class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0">
        <view class="w-[8vw]" />
        <text class="flex-1 text-center text-title-large font-medium text-surface-on">搜索</text>
        <view
          class="w-[8vw] h-[8vw] flex items-center justify-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.close"
          @tap="onClose"
        >
          <text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>
        </view>
      </view>

      <!-- 输入行：占位「输入标签 / 关键词」+ 有词时清除 ×；输入 → controller.search（300ms 防抖在控制器内）；
           回车 / 键盘搜索键 → @confirm（submit 事件映射，web-core 实证）→ 提交点①写历史 -->
      <view class="flex flex-row items-center gap-2 px-4 flex-shrink-0">
        <input
          ref="inputRef"
          v-model="keyword"
          confirm-type="search"
          class="flex-1 h-[11.2vw] box-border bg-surface-container-highest rounded-[var(--md-shape-full)] text-body-medium text-surface-on px-5"
          placeholder="输入标签 / 关键词"
          placeholder-color="#41474e"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.input"
          @input="onInput"
          @confirm="onConfirm"
        />
        <view
          v-if="keyword"
          class="w-[8vw] h-[8vw] flex items-center justify-center flex-shrink-0"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.clear"
          @tap="onClearInput"
        >
          <text class="text-[5.5vw] leading-none text-surface-on-variant">×</text>
        </view>
      </view>

      <!-- 词条区（idle 且无词：spec D5）：搜索历史 chips（单删 × + 全清入口）/ 无历史提示 -->
      <view v-if="!keyword.trim()" class="flex-shrink-0 px-4 mt-4">
        <view class="flex flex-row items-center justify-between">
          <text class="text-label-large text-surface-on">搜索历史</text>
          <text
            v-if="searchHistory.history.length > 0"
            class="text-label-medium text-primary"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="SEARCH_A11Y_LABELS.clearHistory"
            @tap="onClearHistory"
          >清空</text>
        </view>
        <view v-if="searchHistory.history.length > 0" class="flex flex-row flex-wrap gap-2 mt-2">
          <view
            v-for="w in searchHistory.history"
            :key="w"
            class="h-[10.667vw] px-4 bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center"
            @tap="onHistoryTap(w)"
          >
            <text class="text-body-small text-surface-on [max-line:1]" style="word-break: break-all">{{ w }}</text>
            <text class="text-body-small text-surface-on-variant ml-2 flex-shrink-0" @tap.stop="onHistoryRemove(w)">×</text>
          </view>
        </view>
        <text v-else class="text-body-medium text-outline mt-3 block">输入关键词开始搜索</text>
      </view>

      <!-- scope 段：全部 / 插画 / 小说（空词只更新状态；有词立即重搜，spec US10） -->
      <view class="flex flex-row gap-2 px-4 mt-4 flex-shrink-0">
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="scopeCls(state.scope === 'all')"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.scopeAll"
          @tap="onScopeTap('all')"
        >
          <text class="text-body-small" :class="scopeTextCls(state.scope === 'all')">全部</text>
        </view>
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="scopeCls(state.scope === 'illust')"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.scopeIllust"
          @tap="onScopeTap('illust')"
        >
          <text class="text-body-small" :class="scopeTextCls(state.scope === 'illust')">插画</text>
        </view>
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="scopeCls(state.scope === 'novel')"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.scopeNovel"
          @tap="onScopeTap('novel')"
        >
          <text class="text-body-small" :class="scopeTextCls(state.scope === 'novel')">小说</text>
        </view>
      </view>

      <!-- sort 段（紧凑行）：最新 / 最早 / 热门（热门走独立端点无分页，spec US11） -->
      <view class="flex flex-row gap-2 px-4 mt-2 flex-shrink-0">
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="sortCls(state.sort === 'date_desc')"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.sortNewest"
          @tap="onSortTap('date_desc')"
        >
          <text class="text-label-medium" :class="sortTextCls(state.sort === 'date_desc')">最新</text>
        </view>
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="sortCls(state.sort === 'date_asc')"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.sortOldest"
          @tap="onSortTap('date_asc')"
        >
          <text class="text-label-medium" :class="sortTextCls(state.sort === 'date_asc')">最早</text>
        </view>
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="sortCls(state.sort === 'popular_desc')"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.sortPopular"
          @tap="onSortTap('popular_desc')"
        >
          <text class="text-label-medium" :class="sortTextCls(state.sort === 'popular_desc')">热门</text>
        </view>
      </view>

      <!-- 筛选折叠区开关（#474/#477：默认折叠；激活数徽标；chevron 翻转用字符切换） -->
      <view class="flex flex-row gap-2 px-4 mt-2 flex-shrink-0">
        <view
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center flex-1"
          :class="filterOpen ? 'bg-primary-container' : 'bg-surface-container-high'"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SEARCH_A11Y_LABELS.filterToggle"
          @tap="filterOpen = !filterOpen"
        >
          <text
            class="text-label-medium"
            :class="filterOpen ? 'text-primary-on-container font-medium' : 'text-surface-on-variant'"
          >筛选</text>
          <view
            v-if="activeFilterCount > 0"
            class="ml-2 min-w-[5.333vw] h-[5.333vw] px-[1.6vw] rounded-full bg-primary flex items-center justify-center"
          >
            <text class="text-[3.2vw] leading-none text-primary-on">{{ activeFilterCount }}</text>
          </view>
          <text class="text-label-medium ml-auto text-surface-on-variant">{{ filterOpen ? '⌃' : '⌄' }}</text>
        </view>
      </view>

      <!-- 折叠筛选区：view 不滚动 → scroll-view（lynx 滚动容器）；范围/排序联动置灰在 computed -->
      <scroll-view
        v-if="filterOpen"
        scroll-orientation="vertical"
        class="mx-4 mt-2 max-h-[42vh] flex-shrink-0 border border-outline rounded-[var(--md-shape-large)] p-3 flex flex-col gap-3"
      >
        <view v-if="activeFilterCount > 0" class="flex flex-row justify-end">
          <text class="text-label-medium text-primary" @tap="clearAllFilters">清除全部</text>
        </view>

        <view>
          <text class="text-label-medium text-outline">期间</text>
          <view class="flex flex-row flex-wrap gap-2 mt-1">
            <view :class="chipCls(filters.period.kind === 'any')" @tap="onFilterChange({ ...filters, period: { kind: 'any' } })">
              <text class="text-body-small" :class="chipTextCls(filters.period.kind === 'any')">全部</text>
            </view>
            <view
              v-for="p in PERIOD_PRESETS"
              :key="p.value"
              :class="chipCls(isPresetActive(p.value))"
              @tap="togglePeriodPreset(p.value)"
            >
              <text class="text-body-small" :class="chipTextCls(isPresetActive(p.value))">{{ p.label }}</text>
            </view>
          </view>
        </view>

        <view>
          <text class="text-label-medium text-outline">收藏数</text>
          <view class="flex flex-row flex-wrap gap-2 mt-1">
            <view
              :class="chipCls(filters.bookmark === null, bookmarkDimmed)"
              @tap="!bookmarkDimmed && onFilterChange({ ...filters, bookmark: null })"
            >
              <text class="text-body-small" :class="chipTextCls(filters.bookmark === null)">不限</text>
            </view>
            <view
              v-for="band in BOOKMARK_BANDS"
              :key="band.min"
              :class="chipCls(isBandActive(band), bookmarkDimmed)"
              @tap="!bookmarkDimmed && toggleBookmark(band)"
            >
              <text class="text-body-small" :class="chipTextCls(isBandActive(band))">{{ bandLabel(band) }}</text>
            </view>
          </view>
          <text v-if="bookmarkDimmed" class="text-label-small text-outline mt-1 block">热门榜不支持按收藏数筛（切回最新/最早恢复）</text>
        </view>

        <view>
          <text class="text-label-medium text-outline">比例 · 仅插画</text>
          <view class="flex flex-row flex-wrap gap-2 mt-1">
            <view
              :class="chipCls(filters.ratio === null, illustDimmed)"
              @tap="!illustDimmed && setRatio(null)"
            >
              <text class="text-body-small" :class="chipTextCls(filters.ratio === null)">全部</text>
            </view>
            <view
              v-for="r in ['landscape', 'portrait', 'square']"
              :key="r"
              :class="chipCls(filters.ratio === r, illustDimmed)"
              @tap="!illustDimmed && setRatio(filters.ratio === r ? null : r)"
            >
              <text class="text-body-small" :class="chipTextCls(filters.ratio === r)">{{ r === 'landscape' ? '横图' : r === 'portrait' ? '竖图' : '方图' }}</text>
            </view>
          </view>
          <text v-if="illustDimmed" class="text-label-small text-outline mt-1 block">切到「插画」范围后可用（已设的值会保留）</text>
        </view>

        <view>
          <text class="text-label-medium text-outline">分辨率 · 仅插画</text>
          <view class="flex flex-row flex-wrap gap-2 mt-1">
            <view
              :class="chipCls(filters.minPixels === null, illustDimmed)"
              @tap="!illustDimmed && setMinPixels(null)"
            >
              <text class="text-body-small" :class="chipTextCls(filters.minPixels === null)">不限</text>
            </view>
            <view
              v-for="px in RES_OPTIONS"
              :key="px"
              :class="chipCls(filters.minPixels === px, illustDimmed)"
              @tap="!illustDimmed && setMinPixels(filters.minPixels === px ? null : px)"
            >
              <text class="text-body-small" :class="chipTextCls(filters.minPixels === px)">≥{{ px }}px</text>
            </view>
          </view>
        </view>

        <view>
          <text class="text-label-medium text-outline">AI 作品</text>
          <view class="flex flex-row flex-wrap gap-2 mt-1">
            <view
              v-for="opt in AI_OPTIONS"
              :key="opt.value"
              :class="chipCls(filters.aiOverride === opt.value)"
              @tap="setAiOverride(opt.value)"
            >
              <text class="text-body-small" :class="chipTextCls(filters.aiOverride === opt.value)">{{ opt.label }}</text>
            </view>
          </view>
          <text class="text-label-small text-outline mt-1 block">只影响本次搜索，不改动设置里的 AI 偏好</text>
        </view>
      </scroll-view>

      <!-- 结果区（有关键词时）：五态 = 搜索中（保留旧结果+轻量指示）/ 首载错误 / 无结果 / 结果列表（含分页 footer） / idle -->
      <view v-if="keyword.trim()" class="flex-1 min-h-0 mt-3 flex flex-col">
        <!-- 首载错误：关键词保留 + 重试按钮（refresh；spec US16，不静默清空） -->
        <view
          v-if="view === 'error'"
          class="flex-1 min-h-0 flex flex-col items-center justify-center px-8"
        >
          <text class="text-body-small text-error text-center">{{ state.error ?? '搜索失败，请重试' }}</text>
          <view
            class="mt-4 px-6 h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="SEARCH_A11Y_LABELS.retry"
            @tap="onRetry"
          >
            <text class="text-label-large font-medium text-primary-on">重试</text>
          </view>
        </view>

        <!-- 非错误态：首搜骨架 / 指示条 + 列表并存（loading 保留旧结果，spec D5「搜索五态」） -->
        <template v-else>
          <!-- 首搜骨架（ADR-0150）：无旧结果可保留时显示结果行骨架，取代纯「搜索中…」文字 -->
          <view v-if="view === 'skeleton'" class="flex-1 min-h-0">
            <view v-for="n in 6" :key="n" class="flex flex-row items-center px-4 py-3">
              <view class="shimmer w-[14vw] h-[14vw] rounded-[var(--md-shape-small)] flex-shrink-0" />
              <view class="flex-1 ml-3">
                <view class="shimmer h-[4.267vw] w-[60%] rounded-[var(--md-shape-extra-small)]" />
                <view class="shimmer h-[3.733vw] w-[40%] mt-2 rounded-[var(--md-shape-extra-small)]" />
              </view>
            </view>
          </view>
          <template v-else>
          <!-- 顶部轻量指示：debounce 窗口（isSearching）+ 搜索中（loading）——换词保留旧结果，不闪空白 -->
          <view v-if="state.isSearching || state.status === 'loading'" class="px-4 py-2 flex-shrink-0">
            <text class="text-label-medium text-outline">搜索中…</text>
          </view>

          <!-- ready 且空结果：换词提示（spec US17 / glossary「搜索五态」：不合并「未搜索」与「无结果」） -->
          <view
            v-if="view === 'empty'"
            class="flex-1 min-h-0 flex items-center justify-center px-5"
          >
            <text class="text-body-medium text-outline text-center">没有找到相关内容，试试换一个关键词</text>
          </view>

          <!-- 结果列表：行式（缩略图 + 标题 + 作者 · 类型/字数）；item-key 必须 String（ADR-0055/0056）。
               loading 期间旧结果保留展示；首搜无旧结果时列表为空 + 上方轻量指示 -->
          <list
            v-else-if="visibleResults.length > 0"
            class="flex-1 min-h-0"
            list-type="single"
            scroll-orientation="vertical"
            :lower-threshold-item-count="5"
            @scrolltolower="onLoadMore"
          >
            <list-item
              v-for="row in visibleResults"
              :key="rowKey(row)"
              :item-key="rowKey(row)"
              class="w-full"
            >
              <view class="flex flex-row items-center px-4 py-3" @tap="onResultTap(row)">
                <!-- 缩略图：R18/R18G 行 = scrim 遮罩 + 中央徽章（等效行内遮罩，RestrictOverlay
                     流内模式含两行文案，14vw 盒内溢出——badge-only 缩放复用；不预过滤 isRestricted()） -->
                <view
                  class="w-[14vw] h-[14vw] rounded-[var(--md-shape-small)] overflow-hidden flex-shrink-0 bg-surface-container-highest"
                  :class="isRowMasked(row) ? 'bg-scrim flex items-center justify-center' : ''"
                >
                  <SkeletonImage
                    v-if="!isRowMasked(row)"
                    :src="rowThumb(row)"
                    aspect-ratio="1 / 1"
                    min-h="14vw"
                    lazy-load
                    class="w-full h-full"
                  />
                  <text
                    v-else
                    class="text-label-medium font-semibold px-2 py-0.5 rounded-[var(--md-shape-extra-small)]"
                    :class="isRestricted(row.entity) ? (restrictLevel(row) === 2 ? 'bg-error text-error-on' : 'bg-error-container text-error-on-container') : 'bg-secondary-container text-secondary-on-container'"
                  >{{ rowMaskLabel(row) }}</text>
                </view>

                <!-- 文本区：遮罩行标题遮蔽（scrim 条 + 文案），作者行照常 -->
                <view class="flex-1 ml-3 min-w-0">
                  <template v-if="isRowMasked(row)">
                    <view class="h-[4.267vw] bg-scrim rounded-[var(--md-shape-extra-small)] w-full" />
                    <text class="text-body-small text-surface-on-variant mt-1 [max-line:1]">{{ rowMaskHint(row) }}</text>
                  </template>
                  <template v-else>
                    <text class="text-body-medium text-surface-on [max-line:1]" style="word-break: break-all">{{ row.entity.title }}</text>
                    <text class="text-body-small text-surface-on-variant mt-1 [max-line:1]" style="word-break: break-all">{{ row.entity.user.name }} · {{ rowSub(row) }}</text>
                  </template>
                </view>

                <text class="text-[3.2vw] text-surface-on-variant flex-shrink-0 ml-2">查看 ›</text>
              </view>
            </list-item>

            <!-- 分页失败：保留结果 + 底部内联重试行（paginationError；spec US15，不丢已看内容） -->
            <list-item
              v-if="state.paginationError"
              key="pagination-error"
              item-key="pagination-error"
              full-span
              class="w-full py-4 flex flex-col items-center"
            >
              <text class="text-label-medium text-error">加载更多失败</text>
              <view
                class="mt-3 px-5 h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
                :accessibility-element="A11Y_ELEMENT_ENABLED"
                :accessibility-label="SEARCH_A11Y_LABELS.retry"
                @tap="onLoadMore"
              >
                <text class="text-label-large font-medium text-primary-on">重试</text>
              </view>
            </list-item>

            <!-- 没有更多了 footer（hasMore=false；spec US14） -->
            <list-item
              v-else-if="!state.hasMore"
              key="no-more"
              item-key="no-more"
              full-span
              class="w-full py-4 flex items-center justify-center"
            >
              <text class="text-label-medium text-outline">没有更多了</text>
            </list-item>
          </list>
          </template>
        </template>
      </view>
    </view>
  </view>
</template>
