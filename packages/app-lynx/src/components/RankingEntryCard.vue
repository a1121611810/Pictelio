<script setup lang="ts">
// 插画页推荐 tab 顶部排行榜入口大卡（spec docs/specs/ranking.md §5.1/§5.2；#519）。
// 固定「日榜·今日」：createRankingFeed 默认 (daily,today)，与榜单页共用同 query key（进榜单页不二次首屏）。
// 受 rankingEntry 开关控制（宿主 v-if，关闭时不构造数据源）；收起当次隐藏（refreshEpoch 变化恢复）。
// 样式：Tailwind utility + M3 语义色，无 scoped CSS、无 rem。
defineOptions({ name: 'ranking-entry-card' })
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { DEFAULT_RANK_MODE } from '@pictelio/ranking-core'
import type { PixivIllust } from '../api/types'
import { navigate } from '../router'
import { proxyImageUrl, thumbUrl } from '../utils/imageUrl'
import { createRankingFeed } from '../primitives/createRankingFeed'
import { isEntryVisible, shouldResetDismissed } from '../primitives/rankingEntryState'
import SkeletonImage from './SkeletonImage.vue'
import { t } from '../i18n'

const props = defineProps<{ refreshEpoch?: number }>()

const feed = createRankingFeed({ mode: DEFAULT_RANK_MODE, date: null }, () => sync())

const illusts = ref<PixivIllust[]>([])
const loading = ref(false)
const error = ref('')
const dismissed = ref(false)

const hero = computed(() => illusts.value[0])
const runners = computed(() =>
  illusts.value.slice(1, 3).map((illust, i) => ({ rank: i + 2, illust })),
)
const heroSrc = computed(() => {
  const urls = hero.value?.image_urls
  return urls ? proxyImageUrl(urls.large || urls.medium || '') : ''
})

function sync() {
  illusts.value = feed.items()
  loading.value = feed.loading()
  error.value = feed.error() ?? ''
}

const visible = computed(() =>
  isEntryVisible({ dismissed: dismissed.value, hasError: !!error.value, itemCount: illusts.value.length }),
)

// 宿主下拉刷新（refreshEpoch 变化）→ 恢复被收起的入口
watch(
  () => props.refreshEpoch,
  (next, prev) => {
    if (shouldResetDismissed(prev, next)) dismissed.value = false
  },
)

// KeepAlive 返回重进（IllustList 在 include 白名单）→ 收起态不跨挂载保留（spec §5.1「重进恢复」）
onActivated(() => {
  dismissed.value = false
})

// 失败可见化（禁静默降级；入口失败即隐藏，不留永久骨架）
watch(error, (msg) => {
  if (msg) console.warn('[RankingEntryCard] 排行榜入口加载失败，隐藏入口:', msg)
})

async function refresh() {
  loading.value = true
  await feed.refresh()
  sync()
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

function openAll() {
  void navigate('/ranking')
}

onMounted(refresh)
onUnmounted(() => feed.dispose())
</script>

<template>
  <view v-if="visible" class="mx-3 mt-3">
    <!-- 有数据：榜首编辑大卡（第 1 名全幅背景 + 信息叠加 + 右侧 2/3 名竖排 + 收起） -->
    <view
      v-if="illusts.length > 0"
      class="relative w-full h-[62vw] rounded-[var(--md-shape-large)] overflow-hidden"
      accessibility-element
      :accessibility-label="t('ranking.entry.stripAria')"
      @tap="openAll"
    >
      <SkeletonImage v-if="heroSrc" :src="heroSrc" height="62vw" lazy-load />
      <view
        class="absolute inset-x-0 bottom-0 h-[36vw]"
        :style="{ background: 'var(--md-scrim-overlay)' }"
      />
      <!-- 左下信息叠加：第 1 名徽章 / 榜名·今日 / 标题 / 作者 -->
      <view class="absolute left-3 bottom-3 right-[30vw]">
        <view class="flex flex-row items-center gap-1.5">
          <view class="px-2 py-0.5 rounded-[var(--md-shape-full)] bg-primary">
            <text class="text-body-small font-medium text-primary-on">{{ t('ranking.entry.firstBadge') }}</text>
          </view>
          <text class="text-body-small text-white">{{ t('ranking.mode.daily') }} · {{ t('ranking.today') }}</text>
        </view>
        <text class="text-title-medium font-medium text-white mt-1.5 [max-line:1]">{{ hero?.title }}</text>
        <text class="text-body-small text-white opacity-80 [max-line:1]">{{ hero?.user.name }}</text>
      </view>
      <!-- 右侧竖排 2/3 名 +「全部 ›」 -->
      <view class="absolute right-2.5 bottom-3 flex flex-col gap-2">
        <view
          v-for="e in runners"
          :key="e.illust.id"
          class="relative w-[16vw] h-[16vw] rounded-[var(--md-shape-medium)] overflow-hidden"
          accessibility-element
          :accessibility-label="t('ranking.entry.itemAria', { rank: e.rank, title: e.illust.title })"
          @tap.stop="openDetail(e.illust.id)"
        >
          <SkeletonImage :src="thumbUrl(e.illust.image_urls)" height="16vw" lazy-load />
          <view class="absolute left-0 bottom-0 px-1 rounded-tr-[var(--md-shape-medium)] bg-primary">
            <text class="text-body-small font-medium text-primary-on">{{ e.rank }}</text>
          </view>
        </view>
        <view
          class="w-[16vw] flex items-center justify-center"
          accessibility-element
          :accessibility-label="t('ranking.entry.viewAllAria')"
          @tap.stop="openAll"
        >
          <text class="text-body-small text-white opacity-90">{{ t('ranking.entry.viewAll') }} ›</text>
        </view>
      </view>
      <!-- 收起（当次隐藏） -->
      <view
        class="absolute right-2 top-2 w-[10.667vw] h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)] bg-[var(--md-scrim)] active:opacity-80"
        accessibility-element
        :accessibility-label="t('ranking.entry.collapseAria')"
        @tap.stop="dismissed = true"
      >
        <text class="text-title-medium text-white">✕</text>
      </view>
    </view>
    <!-- 无数据：首载骨架（用户故事 24：入口无数据时显示骨架而非空白） -->
    <view v-else class="w-full h-[62vw] rounded-[var(--md-shape-large)] bg-surface-container-lowest shimmer" />
  </view>
</template>
