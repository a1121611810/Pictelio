<script setup lang="ts">
// 关注 Feed（P0-T4）：关注作者的插画时间线，waterfall 分页（复用推荐页模式）。
// 不进 KeepAlive 白名单（按需进入，每次挂载重新加载）。
import { ref, onMounted } from 'vue'
import { navigate, goBack } from '../router'
import { loadFollow, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { isRestricted } from '../stores/settingsStore'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'

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
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
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
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

// 受限条目图片区：吞没 tap（遮罩点击无任何反应，issue #91）
function swallowRestricted() {}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="w-full h-full bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground">关注</text>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <!-- 骨架屏：首屏加载时 shimmer 卡片占位（与真实卡片同比例，避免 reflow） -->
    <view v-if="loading && illusts.length === 0" class="w-full h-full flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>

    <!-- 空态（加载失败时由 errorMsg 显示错误，不显示空态） -->
    <view v-else-if="!loading && !errorMsg && illusts.length === 0" class="w-full h-full flex items-center justify-center">
      <text class="text-base text-foreground-3">暂无关注更新</text>
    </view>

    <list
      v-else
      class="w-full h-full"
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
        class="bg-background rounded-[var(--borderRadiusXLarge)] flex flex-col overflow-hidden"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效 → 内容 view 绑 tap（ADR-0055） -->
        <view class="w-full flex flex-col" @tap="openDetail(item.id)">
          <view class="relative" @tap.stop="swallowRestricted">
            <SkeletonImage :src="thumbUrl(item.image_urls)" aspect-ratio="1 / 1" min-h="40vw" lazy-load />
            <!-- 受限条目图片区遮罩（issue #91） -->
            <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <text class="text-lg font-semibold text-foreground mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <text class="text-sm text-foreground-2 mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
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
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>
