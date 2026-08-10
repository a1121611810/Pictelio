<script setup lang="ts">
// 关注 Feed（P0-T4）：关注作者的插画时间线，waterfall 分页（复用推荐页模式）。
// M3 NavigationBar 顶层 tab（推荐/关注/小说/我的）——无返回箭头。
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadFollow, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { presentError } from '../utils/errorPresentation'
import { isRestricted } from '../stores/settingsStore'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import NavigationBar, { type NavTab } from '../components/NavigationBar.vue'

// 底部导航 tabs：推荐/关注（本页）/小说/我的
const navTabs: NavTab[] = [
  { name: 'recommended', path: '/recommended', icon: '⌂', label: '推荐', a11yLabel: '推荐' },
  { name: 'following', path: '/following', icon: '♥', label: '关注', a11yLabel: '关注' },
  { name: 'novels', path: '/novels', icon: '✎', label: '小说', a11yLabel: '小说' },
  { name: 'me', path: '/me', icon: '◎', label: '我的', a11yLabel: '我的' },
]

function onNavSelect(tab: NavTab) {
  if (tab.name === 'following') return
  void navigate(tab.path, { replace: true })
}

const illusts = ref<PixivIllust[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
// [lynx:fix] loadMore 双重防抖（与 Recommended 同款，ADR-0045）
let lastLoadMoreAt = 0
let lastLoadEndedAt = 0

async function fetchFirstPage() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadFollow()
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    illusts.value = res.illusts
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '加载失败')
  } finally {
    loading.value = false
    lastLoadEndedAt = Date.now()
  }
}

async function loadMore() {
  const now = Date.now()
  if (now - lastLoadEndedAt < 3000) return
  if (now - lastLoadMoreAt < 800) return
  if (!nextUrl.value || loadingMore.value) return
  lastLoadMoreAt = now
  loadingMore.value = true
  try {
    const res = await loadNext(nextUrl.value)
    const seen = new Set(illusts.value.map((i) => i.id))
    const fresh = res.illusts.filter((i) => !seen.has(i.id))
    illusts.value.push(...fresh)
    // 空页防护：基于服务端原始返回判空（issue #91）
    nextUrl.value = res.illusts.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '加载更多失败')
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: PixivIllust) {
  if (!isRestricted(item)) openDetail(item.id)
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-on-surface">关注</text>
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
          <text class="text-body-large text-on-surface mt-3">暂无关注更新</text>
          <text class="text-body-medium text-on-surface-variant mt-1.5">关注你喜欢的作者后，这里会展示他们的新作品</text>
        </view>
    </view>

    <list
      v-else
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
          <view class="relative" @tap.stop="onImageTap(item)">
            <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
            <!-- 受限条目图片区遮罩（issue #91） -->
            <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <text class="text-title-small font-medium text-on-surface mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <text class="text-body-small text-on-surface-variant mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton
              :illust-id="item.id"
              :initial-bookmarked="item.is_bookmarked"
              :bookmark-count="item.total_bookmarks"
            />
          </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
    </list>

    <!-- M3 NavigationBar：底部四 tab -->
    <NavigationBar :tabs="navTabs" :active-name="'following'" @select="onNavSelect" />
  </view>
</template>
