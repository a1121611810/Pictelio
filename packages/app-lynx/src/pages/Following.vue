<script setup lang="ts">
// 关注 Feed（P0-T4）：关注作者的插画时间线，waterfall 分页（复用推荐页模式）。
// M3 NavigationBar 顶层 tab（推荐/关注/小说/我的）——无返回箭头。
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadFollow, loadNext } from '../api/illust'
import type { PixivIllust, PixivIllustListResponse } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { createMixFeed, type MixFeedItem } from '../primitives/createMixFeed'
import { isRestricted } from '../stores/settingsStore'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import NavigationBar from '../components/NavigationBar.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { NAV_TABS, type NavTab } from '../components/navTabs'

// 底部导航 tabs 取共享 NAV_TABS（推荐/插画/小说/我的；已不含 following tab）。
// /following 已不在导航可达：active-name='following' 无对应 tab 故无高亮（可接受），
// 本页 tab 判断（if tab.name === 'following'）永不命中，点击任何 tab 正常 navigate。
function onNavSelect(tab: NavTab) {
  if (tab.name === 'following') return
  void navigate(tab.path, { replace: true })
}

// ─── 分页收敛（ADR-0104）：迁移到 createMixFeed 深模块 ───
// 单源关注 feed（/v2/illust/follow，offset 分页）；双防抖/竞态/空页防护/15s 超时/
// 错误槽分流（error=首屏顶部、pageError=分页底部内联）全部由 createMixFeed 承载。
function mapIllusts(r: PixivIllustListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: 'illust' as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}

const feed = ref(
  createMixFeed({
    autoStart: false,
    sources: [
      {
        name: 'illust',
        fetchPage: (signal, nextUrl) =>
          nextUrl ? loadNext(nextUrl, signal).then(mapIllusts) : loadFollow('public', signal).then(mapIllusts),
      },
    ],
  }),
)

const illusts = ref<PixivIllust[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const pageErrorMsg = ref('')
const endOfFeed = ref(false)

function sync() {
  illusts.value = feed.value.items().map((i) => i.data as PixivIllust)
  loading.value = feed.value.loading()
  loadingMore.value = feed.value.loadingMore()
  errorMsg.value = feed.value.error() ?? ''
  pageErrorMsg.value = feed.value.pageError() ?? ''
  // 到底态：所有源耗尽且列表非空（ADR-0104：footer「没有更多了」）
  endOfFeed.value =
    feed.value.nextUrl() === null &&
    feed.value.items().length > 0 &&
    !loading.value &&
    !loadingMore.value
}

async function refreshFeed() {
  await feed.value.refresh()
  sync()
}

// 下拉刷新入口（ADR-0106）：RefreshableList @refresh；try/finally 保证失败也收起 header
const refreshing = ref(false)
async function onRefresh() {
  refreshing.value = true
  try {
    await refreshFeed()
  } finally {
    refreshing.value = false
  }
}

async function loadMore() {
  await feed.value.fetchMore()
  sync()
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: PixivIllust) {
  if (!isRestricted(item)) openDetail(item.id)
}

onMounted(() => {
  void refreshFeed()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">关注</text>
    </view>

    <text v-if="errorMsg && !loading" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- 骨架屏：首屏加载时 shimmer 卡片占位（与真实卡片同比例，避免 reflow） -->
    <!-- [lynx:fix] 骨架屏不占满全屏高度（h-full 会溢出覆盖底部导航栏，拦截 tap，issue #129） -->
    <view v-if="loading && illusts.length === 0" class="w-full flex-1 min-h-0 flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>

    <!-- 空态（加载失败时由 errorMsg 显示错误，不显示空态） -->
    <view v-else-if="!loading && !errorMsg && illusts.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
          <text class="text-[10.667vw] leading-none text-outline-variant">♡</text>
          <text class="text-body-large text-surface-on mt-3">暂无关注更新</text>
          <text class="text-body-medium text-surface-on-variant mt-1.5">关注你喜欢的作者后，这里会展示他们的新作品</text>
        </view>
    </view>

    <RefreshableList v-else :refreshing="refreshing" @refresh="onRefresh">
    <list
      class="w-full flex-1 min-h-0"
      list-type="waterfall"
      scroll-orientation="vertical"
      :span-count="2"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="2"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="String(item.id)"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden shadow-[var(--md-elevation-1)]"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效 → 内容 view 绑 tap（ADR-0055） -->
        <view class="w-full flex flex-col" @tap="openDetail(item.id)">
          <view
            v-if="isRestricted(item)" @tap.stop
            class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
          >
            <RestrictOverlay :overlay="false" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <view v-else class="relative" @tap.stop="onImageTap(item)">
            <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
          </view>
          <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton
              :illust-id="item.id"
              :initial-bookmarked="item.is_bookmarked"
              :bookmark-count="item.total_bookmarks"
            />
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

    <!-- M3 NavigationBar：底部四 tab（NAV_TABS 共享；active-name 无匹配故无高亮，可接受） -->
    <NavigationBar :tabs="NAV_TABS" :active-name="'following'" @select="onNavSelect" />
  </view>
</template>
