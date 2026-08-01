<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, goBack } from '../router'
import { loadDetail } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl } from '../utils/imageUrl'

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
  <view class="Page">
    <view class="AppBar">
      <text class="Back" @tap="goBack">‹ 返回</text>
      <text class="AppBarTitle">作品详情</text>
    </view>

    <view v-if="loading" class="Center">
      <text class="Loading">加载中…</text>
    </view>
    <view v-else-if="errorMsg" class="Center">
      <text class="Error">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else-if="illust" class="Body" scroll-orientation="vertical">
      <image class="Hero" :src="currentImage" :mode="'widthFix'" />
      <view v-if="pages.length > 1" class="PageNav">
        <text class="PageBtn" @tap="prevPage">‹</text>
        <text class="PageIdx">{{ currentPage + 1 }} / {{ pages.length }}</text>
        <text class="PageBtn" @tap="nextPage">›</text>
      </view>
      <view class="Info">
        <text class="Title">{{ illust.title }}</text>
        <text class="Author">by {{ illust.user.name }}</text>
        <text class="Meta">{{ illust.width }} × {{ illust.height }}</text>
        <text v-if="illust.total_bookmarks > 0" class="Meta">♥ {{ illust.total_bookmarks }}</text>
        <view class="Tags">
          <text v-for="tag in illust.tags.slice(0, 8)" :key="tag.name" class="Tag">
            #{{ tag.translated_name || tag.name }}
          </text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style scoped>
.Page {
  width: 100%;
  height: 100%;
  background-color: var(--colorNeutralBackground2);
}

.AppBar {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 11.733vw;
  padding: 0 4.267vw;
  background-color: var(--colorNeutralBackground1);
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke2);
}

.Back {
  font-size: 26rpx;
  color: var(--colorBrandForeground1);
  padding-right: 4.267vw;
}

.AppBarTitle {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
}

.Body {
  width: 100%;
  height: 100%;
}

.Center {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.Loading {
  font-size: 26rpx;
  color: var(--colorNeutralForeground3);
}

.Error {
  font-size: 24rpx;
  color: var(--colorPaletteRedBackground3);
  padding: 4.267vw;
}

.Hero {
  width: 100%;
  background-color: var(--colorNeutralBackground1);
}

.PageNav {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 3.200vw;
}

.PageBtn {
  font-size: 36rpx;
  color: var(--colorBrandForeground1);
  padding: 2.133vw 6.400vw;
}

.PageIdx {
  font-size: 24rpx;
  color: var(--colorNeutralForeground2);
  margin: 0 4.267vw;
}

.Info {
  padding: 4.267vw;
  background-color: var(--colorNeutralBackground1);
}

.Title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--colorNeutralForeground1);
}

.Author {
  font-size: 26rpx;
  color: var(--colorBrandForeground1);
  margin-top: 2.133vw;
}

.Meta {
  font-size: 22rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 1.600vw;
}

.Tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 3.200vw;
}

.Tag {
  font-size: 20rpx;
  color: var(--colorBrandForeground1);
  background-color: var(--colorNeutralBackground3);
  border-radius: var(--borderRadiusMedium);
  padding: 1.067vw 2.667vw;
  margin: 1.067vw;
}
</style>