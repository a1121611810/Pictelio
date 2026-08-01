<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, goBack } from '../router'
import { loadDetail } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl } from '../utils/imageUrl'
import BookmarkButton from '../components/BookmarkButton.vue'

const illust = ref<PixivIllust | null>(null)
const loading = ref(true)
const errorMsg = ref('')
const currentPage = ref(0)

const illustId = computed(() => Number(currentParams.value.id ?? 0))

// 多页作品：meta_pages 或单页
const pages = computed(() => {
  if (!illust.value) return []
  if (illust.value.meta_pages?.length) {
    return illust.value.meta_pages.map((p) => p.image_urls)
  }
  return [
    illust.value.meta_single_page?.original_image_url
      ? { large: illust.value.meta_single_page.original_image_url }
      : illust.value.image_urls,
  ]
})

const currentImage = computed(() => {
  const list = pages.value
  if (!list.length) return ''
  const page = list[Math.min(currentPage.value, list.length - 1)]
  return proxyImageUrl(page.large || page.medium || '')
})

function nextPage() {
  if (currentPage.value < pages.value.length - 1) currentPage.value += 1
}
function prevPage() {
  if (currentPage.value > 0) currentPage.value -= 1
}

onMounted(async () => {
  try {
    const res = await loadDetail(illustId.value)
    illust.value = res.illust
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <view class="w-full h-full bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground">作品详情</text>
    </view>

    <!-- [lynx:fix] 骨架屏：加载中显示 shimmer 占位（图片区 1:1 + 文字条），数据就绪后切换 scroll-view -->
    <view v-if="loading" class="w-full h-full bg-background-2">
      <view class="shimmer aspect-[1/1] w-full" />
      <view class="p-4">
        <view class="shimmer h-[32rpx] rounded-[var(--borderRadiusSmall)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-2 w-[40%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-1.5 w-[60%]" />
      </view>
    </view>
    <view v-else-if="errorMsg" class="w-full h-full flex items-center justify-center">
      <text class="text-base text-danger p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else-if="illust" class="w-full h-full" scroll-orientation="vertical">
      <!-- [lynx:fix] 详情大图：SkeletonImage 的 style aspectRatio/minHeight 在原生 scroll-view 内
           失效 → 容器高度 0、大图空白（真机实测 2026-08-02）。改固定高度容器
           （Tailwind h-[100vw]）+ 裸 image（aspectFill），不依赖 aspect-ratio style -->
      <view class="relative w-full h-[100vw] bg-background-3 overflow-hidden">
        <image v-if="currentImage" class="w-full h-full" :src="currentImage" :mode="'aspectFill'" />
      </view>
      <view v-if="pages.length > 1" class="flex flex-row items-center justify-center p-3">
        <view class="py-1 pr-2" @tap="prevPage"><text class="text-4xl text-brand-foreground py-2 px-6">‹</text></view>
        <text class="text-base text-foreground-2 mx-4">{{ currentPage + 1 }} / {{ pages.length }}</text>
        <view class="py-2 px-3" @tap="nextPage"><text class="text-4xl text-brand-foreground py-2 px-6">›</text></view>
      </view>
      <view class="p-4 bg-background">
        <text class="text-3xl font-bold text-foreground">{{ illust.title }}</text>
        <text class="text-lg text-brand-foreground mt-2">by {{ illust.user.name }}</text>
        <text class="text-sm text-foreground-3 mt-1.5">{{ illust.width }} × {{ illust.height }}</text>
        <view class="mt-2">
          <BookmarkButton
            :illust-id="illust.id"
            :initial-bookmarked="illust.is_bookmarked"
            :bookmark-count="illust.total_bookmarks"
          />
        </view>
        <view class="flex flex-row flex-wrap mt-3">
          <text
            v-for="tag in illust.tags.slice(0, 8)"
            :key="tag.name"
            class="text-xs text-brand-foreground bg-background-3 rounded-[var(--borderRadiusMedium)] px-2.5 py-1 m-1"
          >
            #{{ tag.translated_name || tag.name }}
          </text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>
