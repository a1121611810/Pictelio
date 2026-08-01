<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { navigate, goBack } from '../router'
import { loadRecommendedNovels, loadNovelNext } from '../api/novel'
import type { PixivNovel } from '../api/types'

const novels = ref<PixivNovel[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')

async function fetchFirstPage() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadRecommendedNovels()
    novels.value = res.novels
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!nextUrl.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await loadNovelNext(nextUrl.value)
    const seen = new Set(novels.value.map((n) => n.id))
    const fresh = res.novels.filter((n) => !seen.has(n.id))
    novels.value.push(...fresh)
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
  }
}

function openDetail(id: number) {
  void navigate(`/novel/${id}`)
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="w-full h-full bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <text class="text-lg text-brand-foreground pr-4" @tap="goBack">‹ 返回</text>
      <text class="flex-1 text-2xl font-semibold text-foreground">推荐小说</text>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <list
      v-if="!loading || novels.length > 0"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in novels"
        :key="item.id"
        :item-key="item.id"
        class="w-full"
        @tap="openDetail(item.id)"
      >
        <view class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]">
          <view class="flex-1 flex flex-col">
            <text class="text-xl font-semibold text-foreground [max-line:2]">{{ item.title }}</text>
            <text class="text-sm text-brand-foreground mt-1.5">by {{ item.user.name }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-xs text-foreground-3 mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-xs text-foreground-3 mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
            <view class="flex flex-row flex-wrap mt-2">
              <text
                v-for="tag in item.tags.slice(0, 3)"
                :key="tag.name"
                class="text-[18rpx] text-brand-foreground bg-background-3 rounded-[var(--borderRadiusMedium)] py-0.5 px-2 m-0.5"
              >
                #{{ tag.translated_name || tag.name }}
              </text>
            </view>
          </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>
