<script setup lang="ts">
// 榜单页（/ranking）：日榜·今日骨架（spec docs/specs/ranking.md §5.3 / §5.6 / §6.3；#517）。
// 数据层复用 createMixFeed 单源（createRankingFeed），名次 = 渲染流下标 + 1，跨页保序；
// 受限条目（R18/R18G/AI）**保留并盖遮罩、名次不变**（本端口径，spec §5.6）。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'ranking' })
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { navigate, goBack } from '../router'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { createRankingFeed } from '../primitives/createRankingFeed'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import { useSettingsStore } from '../stores/settingsStore'
import SkeletonImage from '../components/SkeletonImage.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import AiOverlay from '../components/AiOverlay.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { t } from '../i18n'

const settings = useSettingsStore()
const isRestricted = settings.isRestricted
const isAiRestricted = settings.isAiRestricted

// 单源分页 feed：autoStart=false，构造不首载，onMounted 由 refreshFeed 触发
const feed = createRankingFeed({ mode: 'daily', date: null }, () => sync())

const illusts = ref<PixivIllust[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
/** 有数据时的分页失败错误文案（底部内联可点重试，ADR-0104 槽位分离；防静默吞错） */
const pageErrorMsg = ref('')
const endOfFeed = ref(false)
/** 首载是否已成功落定（成功含 0 条）——三态判定输入（ADR-0150） */
const settled = ref(false)

/** 页级首载三态（ADR-0150）：骨架 / 错误 / 空态 / 内容 的唯一判定源 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: illusts.value.length > 0,
    loading: loading.value,
    settled: settled.value,
    hasError: !!errorMsg.value,
  }),
)

function sync() {
  illusts.value = feed.items()
  loading.value = feed.loading()
  loadingMore.value = feed.loadingMore()
  settled.value = feed.settled()
  errorMsg.value = feed.error() ?? ''
  pageErrorMsg.value = feed.pageError() ?? ''
  endOfFeed.value =
    feed.nextUrl() === null && illusts.value.length > 0 && !loading.value && !loadingMore.value
}

/** list 强制重建代（refresh 后 ++，驱动 :key 替换，规避 vue-lynx patch 索引错位 ADR-0107 D4） */
const refreshEpoch = ref(0)

async function refreshFeed() {
  // 发起前同步进入加载态并清错误：骨架立即占位（ADR-0150）
  loading.value = true
  errorMsg.value = ''
  pageErrorMsg.value = ''
  await feed.refresh()
  sync()
  refreshEpoch.value++
}

async function loadMore() {
  await feed.fetchMore()
  sync()
}

/** 受限条目（R18/R18G/AI）不跳详情，与 feed 层遮罩口径一致（spec §5.6） */
function onRowTap(item: PixivIllust) {
  if (isRestricted(item) || isAiRestricted(item)) return
  void navigate(`/illust/${item.id}`)
}

onMounted(refreshFeed)
onUnmounted(() => feed.dispose())
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack">
        <text class="text-[6.4vw] leading-none text-surface-on">‹</text>
      </view>
      <text class="flex-1 text-title-large font-medium text-surface-on">{{ t('ranking.page.title') }}</text>
    </view>

    <!-- 首载三态（ADR-0150）：骨架 → 错误 → 空态 → 内容，互斥单链；不依赖 loading 标志 -->
    <view v-if="view === 'skeleton'" class="w-full flex-1 min-h-0">
      <view
        v-for="n in 8"
        :key="n"
        class="flex flex-row items-center mx-3 my-1.5 p-2.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
      >
        <view class="shimmer w-[8vw] h-[5.333vw] rounded-[var(--md-shape-extra-small)]" />
        <view class="shimmer w-[14vw] h-[14vw] rounded-[var(--md-shape-medium)] ml-2" />
        <view class="flex flex-col ml-3 flex-1">
          <view class="shimmer h-[28rpx] rounded-[var(--md-shape-extra-small)] w-[55%]" />
          <view class="shimmer h-[22rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[30%]" />
        </view>
      </view>
    </view>
    <view v-else-if="view === 'error'" class="w-full flex-1 min-h-0 flex flex-col items-center justify-center px-8">
      <text class="text-body-small text-error text-center">{{ errorMsg }}</text>
      <view
        class="mt-4 px-6 h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        @tap="refreshFeed"
      >
        <text class="text-label-large font-medium text-primary-on">{{ t('ranking.page.retry') }}</text>
      </view>
    </view>
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">▲</text>
        <text class="text-body-large text-surface-on mt-3">{{ t('ranking.page.empty') }}</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">{{ t('ranking.page.emptyHint') }}</text>
      </view>
    </view>

    <RefreshableList v-else :refresh="refreshFeed" @back-to-top="refreshEpoch++">
    <template #default="{ onScroll }">
    <!-- 间距走 list 官方轴间距属性（:style 对象绑定，attribute 形式 web-core 不响应，ADR-0048） -->
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="5"
      :scroll-event-throttle="0"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <list-item v-for="(item, idx) in illusts" :key="item.id" :item-key="String(item.id)" class="w-full">
        <view
          class="flex flex-row items-center mx-3 p-2.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
          @tap="onRowTap(item)"
        >
          <text
            class="w-[8vw] text-center text-title-small font-medium"
            :class="idx < 3 ? 'text-primary' : 'text-outline'"
          >{{ idx + 1 }}</text>
          <!-- 缩略图：list-item 图片必须显式高度（原生 LynxView aspect-ratio 解析为 0，issue #140）；
               受限条目保留并盖遮罩（RestrictOverlay/AiOverlay 流内模式，spec §5.6） -->
          <view
            class="w-[14vw] h-[14vw] shrink-0 rounded-[var(--md-shape-medium)] overflow-hidden ml-2 flex items-center justify-center"
            :class="isRestricted(item) || isAiRestricted(item) ? 'bg-[var(--md-scrim)]' : ''"
          >
            <RestrictOverlay
              v-if="isRestricted(item)"
              :overlay="false"
              :level="item.x_restrict === 2 ? 2 : 1"
            />
            <AiOverlay
              v-else-if="isAiRestricted(item)"
              :overlay="false"
              :ai-type="item.illust_ai_type ?? 0"
            />
            <SkeletonImage v-else :src="thumbUrl(item.image_urls)" height="14vw" lazy-load />
          </view>
          <view class="flex flex-col ml-3 flex-1">
            <text class="text-title-small font-medium text-surface-on [max-line:1]">{{ item.title }}</text>
            <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ item.user.name }}</text>
          </view>
          <text class="text-label-medium text-outline ml-2">★{{ item.total_bookmarks }}</text>
        </view>
      </list-item>
      <list-item
        v-if="loadingMore || pageErrorMsg || endOfFeed"
        :key="'footer'"
        item-key="footer"
        class="w-full h-10 flex items-center justify-center"
        full-span
      >
        <text v-if="loadingMore" class="text-body-medium text-outline">{{ t('ranking.footer.loading') }}</text>
        <!-- 分页失败：底部内联可点重试（spec §5.3；lynx 无 InlineRetryBar，按本端惯例做成可点行） -->
        <view v-else-if="pageErrorMsg" class="flex flex-row items-center" @tap="loadMore">
          <text class="text-body-medium text-error">{{ pageErrorMsg }}</text>
          <text class="text-body-medium text-primary ml-2">{{ t('ranking.page.retry') }}</text>
        </view>
        <text v-else class="text-body-medium text-outline">{{ t('ranking.footer.end') }}</text>
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>
