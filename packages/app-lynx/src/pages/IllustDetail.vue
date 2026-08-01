<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, goBack } from '../router'
import { loadDetail } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl } from '../utils/imageUrl'
import SkeletonImage from '../components/SkeletonImage.vue'

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
      <text class="text-lg text-brand-foreground pr-4" @tap="goBack">‹ 返回</text>
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
      <!-- [lynx:fix] 详情大图（SkeletonImage）：API 宽高比动态 aspect-ratio + aspectFill 完整显示；
           图片 @load 后才隐藏 shimmer（widthFix 在 lynx 不存在须用 aspect-ratio，且骨架关闭时机 = 图片加载完成） -->
      <SkeletonImage :src="currentImage" :aspect-ratio="`${illust.width} / ${illust.height}`" />
      <view v-if="pages.length > 1" class="flex flex-row items-center justify-center p-3">
        <text class="text-4xl text-brand-foreground py-2 px-6" @tap="prevPage">‹</text>
        <text class="text-base text-foreground-2 mx-4">{{ currentPage + 1 }} / {{ pages.length }}</text>
        <text class="text-4xl text-brand-foreground py-2 px-6" @tap="nextPage">›</text>
      </view>
      <view class="p-4 bg-background">
        <text class="text-3xl font-bold text-foreground">{{ illust.title }}</text>
        <text class="text-lg text-brand-foreground mt-2">by {{ illust.user.name }}</text>
        <text class="text-sm text-foreground-3 mt-1.5">{{ illust.width }} × {{ illust.height }}</text>
        <text v-if="illust.total_bookmarks > 0" class="text-sm text-foreground-3 mt-1.5">
          ♥ {{ illust.total_bookmarks }}
        </text>
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
