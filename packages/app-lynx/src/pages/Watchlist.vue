<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'watchlist' })
import { ref, watch, onMounted } from 'vue'
import { navigate, goBack } from '../router'
import { registerModal } from '../stores/modalStack'
import {
  loadWatchlistNovels,
  loadWatchlistNovelsNext,
  addNovelWatchlist,
  deleteNovelWatchlist,
} from '../api/novel'
import type { WatchlistSeries } from '../api/types'
import { isWatchlistSeriesMasked } from '../api/types'
import { createWatchlistFeed } from '../primitives/watchlistFeed'
import { createWatchlistToggle, type WatchlistToggleState } from '../primitives/createWatchlistToggle'
import { setWatchState } from '../stores/watchlistStore'
import { proxyImageUrl } from '../utils/imageUrl'
import { WATCHLIST_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import RefreshableList from '../components/RefreshableList.vue'

// ─── 追更列表页（issue #225 / spec app-lynx-novel-series-watchlist §US7） ───
// 条目是**系列**而非作品（服务端响应顶层字段即 series）：
// - 点击正常条目 → 直达最新一话（latest_content_id 是小说 id，决策 D4）
// - mask 条目（isWatchlistSeriesMasked：被屏蔽/下架）只读展示 mask_text，不可点、无取消按钮
// 分页合并/竞态/错误槽全部内收 createWatchlistFeed，页面只做 ref 快照桥接（对齐 NovelList）。
const feed = createWatchlistFeed({
  fetchFirst: loadWatchlistNovels,
  fetchNext: loadWatchlistNovelsNext,
})

const series = ref<WatchlistSeries[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const pageErrorMsg = ref('')
const endOfFeed = ref(false)

function sync() {
  series.value = feed.items()
  loading.value = feed.loading()
  loadingMore.value = feed.loadingMore()
  errorMsg.value = feed.error() ?? ''
  pageErrorMsg.value = feed.pageError() ?? ''
  endOfFeed.value =
    feed.nextUrl() === null && feed.items().length > 0 && !loading.value && !loadingMore.value
}

/** list 强制重建代（refresh 后 ++，对齐 NovelList 的 refreshEpoch 语义，ADR-0107 D4） */
const refreshEpoch = ref(0)

async function refreshFeed() {
  await feed.refresh()
  sync()
  refreshEpoch.value++
}

async function loadMore() {
  await feed.fetchMore()
  sync()
}

/** 决策 D4：直达最新一话（latest_content_id 是作品 id） */
function openLatest(item: WatchlistSeries) {
  if (isWatchlistSeriesMasked(item)) return
  void navigate(`/novel/${item.latest_content_id}`)
}

// ─── 取消追更（M3 Dialog 二次确认 + createWatchlistToggle 状态机） ───
const unwatchTarget = ref<WatchlistSeries | null>(null)
const unwatchToggle = ref<WatchlistToggleState | null>(null)

function askUnwatch(item: WatchlistSeries) {
  unwatchTarget.value = item
  unwatchToggle.value = createWatchlistToggle(item.id, true, {
    add: addNovelWatchlist,
    remove: deleteNovelWatchlist,
    onChange: (added) => {
      if (added) return
      // 取消成功：从 feed 内部 items 移除（防下次分页 sync 复活，review P1-2）
      // + 快照桥接 + 写 watchlistStore（详情页系列行标记联动，spec §US6/US7）
      feed.removeItem(item.id)
      sync()
      setWatchState(item.id, false)
      unwatchTarget.value = null
      unwatchToggle.value = null
    },
  })
}

function cancelUnwatch() {
  if (unwatchToggle.value?.busy) return
  unwatchTarget.value = null
  unwatchToggle.value = null
}

// review P2-1：取消确认弹窗接入 modalStack——打开期间系统返回优先关弹窗，
// 而不是直接 pop /watchlist 页面（对齐 WatchlistPromptDialog 行为与 issue #163 语义）
watch(unwatchTarget, (target, _prev, onCleanup) => {
  if (!target) return
  const unregister = registerModal(() => cancelUnwatch())
  onCleanup(unregister)
})

function confirmUnwatch() {
  void unwatchToggle.value?.toggle()
}

onMounted(() => {
  void refreshFeed()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回箭头 + 居中标题（对齐 NovelDetail 头部模式） -->
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="WATCHLIST_A11Y_LABELS.back"
        @tap="goBack"
      >
        <text class="text-[6.4vw] leading-none text-surface-on">‹</text>
      </view>
      <text
        class="flex-1 text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="WATCHLIST_A11Y_LABELS.pageTitle"
        >追更列表</text
      >
    </view>

    <text v-if="errorMsg && !loading" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- 首屏骨架（对齐 NovelList issue #91 模式） -->
    <view v-if="loading && series.length === 0" class="w-full flex-1 min-h-0">
      <view v-for="n in 5" :key="n" class="m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view class="flex flex-row">
          <view class="shimmer w-[21.333vw] h-[21.333vw] rounded-[var(--md-shape-small)]" />
          <view class="flex-1 ml-3">
            <view class="shimmer h-[32rpx] rounded-[var(--md-shape-extra-small)] w-[75%]" />
            <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[40%]" />
            <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[60%]" />
          </view>
        </view>
      </view>
    </view>

    <!-- 空态 -->
    <view v-if="!loading && !errorMsg && series.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✦</text>
        <text class="text-body-large text-surface-on mt-3">暂无追更系列</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">阅读系列小说时可以选择追更</text>
      </view>
    </view>

    <RefreshableList v-if="series.length > 0" :refresh="refreshFeed" @back-to-top="refreshEpoch++">
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in series"
        :key="item.id"
        :item-key="String(item.id)"
        class="w-full"
      >
        <!-- [lynx:fix] 单一稳定根 view（对齐 Following/UserHome 等已验证 list 结构）：
             list-item 根不得在 v-if/v-else 间交替，否则真机 Lynx 对该 item 的
             FlushActionsAsRoot 父级挂接/测量异常（实测 2026-08-27：mask 条目占位
             但不渲染内容）；条件分支全部内收。 -->
        <view class="w-full">
          <!-- mask 条目（被屏蔽/下架）：只读展示 mask_text，不可点、无取消按钮（spec §6-7） -->
          <view
            v-if="isWatchlistSeriesMasked(item)"
            class="m-1.5 mx-3 p-3.5 min-h-[13.333vw] flex items-center bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
          >
            <text class="text-body-medium text-outline">{{ item.mask_text }}</text>
          </view>
          <view
            v-else
            class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="WATCHLIST_A11Y_LABELS.openLatest"
            @tap="openLatest(item)"
          >
            <image
              v-if="item.url"
              class="w-[21.333vw] h-[21.333vw] rounded-[var(--md-shape-small)] bg-surface-container-high"
              :src="proxyImageUrl(item.url)"
            />
            <view class="flex-1 flex flex-col ml-3">
              <text class="text-title-medium font-medium text-surface-on [max-line:2]">{{ item.title }}</text>
              <text class="text-body-medium text-surface-on-variant mt-1.5">by {{ item.user.name }}</text>
              <view class="flex flex-row mt-1.5">
                <text class="text-label-medium text-surface-on-variant mr-4">共 {{ item.published_content_count }} 话</text>
                <text v-if="item.latest_content_date" class="text-label-medium text-surface-on-variant">更新于 {{ item.latest_content_date.slice(0, 10) }}</text>
              </view>
            </view>
            <view
              class="self-center h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="WATCHLIST_A11Y_LABELS.unwatch"
              @tap.stop="askUnwatch(item)"
            >
              <text class="text-label-large text-primary">取消追更</text>
            </view>
          </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore || pageErrorMsg || endOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text v-if="loadingMore" class="text-body-medium text-outline">加载中…</text>
        <text v-else-if="pageErrorMsg" class="text-body-medium text-error">{{ pageErrorMsg }}</text>
        <text v-else class="text-body-medium text-outline">没有更多了</text>
      </list-item>
    </list>
    </RefreshableList>

    <!-- M3 Dialog（取消追更二次确认）：结构对齐 Me.vue ugoiraConfirm -->
    <view v-if="unwatchTarget" class="fixed inset-0 bg-scrim z-50 flex items-center justify-center">
      <view class="w-[74.667vw] max-w-[74.667vw] bg-surface-container-high rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]">
        <text class="text-headline-small font-medium text-surface-on">取消追更？</text>
        <text class="text-body-medium text-surface-on-variant mt-4 leading-snug">
          《{{ unwatchTarget.title }}》将从追更列表移除
        </text>
        <text v-if="unwatchToggle?.errorMsg" class="text-body-small text-error mt-3">{{ unwatchToggle.errorMsg }}</text>
        <view class="flex flex-row justify-end mt-6 gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center active:bg-layer-pressed-primary"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="WATCHLIST_A11Y_LABELS.unwatchCancel"
            @tap="cancelUnwatch"
          >
            <text class="text-label-large font-medium text-primary">保留追更</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center active:bg-layer-pressed-primary"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="WATCHLIST_A11Y_LABELS.unwatchConfirm"
            @tap="confirmUnwatch"
          >
            <text class="text-label-large font-medium text-error">{{ unwatchToggle?.busy ? '处理中…' : '取消追更' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
