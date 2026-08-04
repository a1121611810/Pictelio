<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, goBack } from '../router'
import { loadNovelDetail, fetchNovelText } from '../api/novel'
import type { PixivNovel } from '../api/types'
import { isRestricted } from '../stores/settingsStore'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import SkeletonNovel from '../components/SkeletonNovel.vue'

const novel = ref<PixivNovel | null>(null)
const text = ref('')
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

// MVP：整段渲染，不做行级虚拟化（无 canvas/measureText，pretext 不可迁移）。
// 超长文本由 scroll-view 引擎滚动承接；后续原生集成阶段可换分段渲染。
const paragraphs = computed(() => {
  if (!text.value) return []
  return text.value
    .split(/\n+/u)
    .map((p) => p.trim())
    .filter(Boolean)
})

onMounted(async () => {
  try {
    // 先取详情判定受限态：受限小说不再拉正文（遮罩是内容不可达而非仅视觉遮挡）
    const detailRes = await loadNovelDetail(novelId.value)
    novel.value = detailRes.novel
    if (!isRestricted(detailRes.novel)) {
      text.value = await fetchNovelText(novelId.value)
    }
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
      <text class="flex-1 text-2xl font-semibold text-foreground">小说</text>
    </view>

    <!-- 加载期骨架（issue #91）：header 照常渲染，正文区骨架占位 -->
    <SkeletonNovel v-if="loading" />
    <view v-else-if="errorMsg" class="w-full h-full flex items-center justify-center">
      <text class="text-base text-danger p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else class="w-full h-full" scroll-orientation="vertical">
      <view class="py-5 px-4 bg-background mb-3">
        <text class="text-4xl font-bold text-foreground">{{ novel?.title }}</text>
        <text class="text-base text-brand-foreground mt-2">by {{ novel?.user.name }}</text>
        <text class="text-xs text-foreground-3 mt-1.5">
          {{ novel?.text_length }} 字
          <template v-if="novel?.total_bookmarks != null">
             · ♥ {{ novel?.total_bookmarks }}
          </template>
        </text>
      </view>
      <!-- 正文区：受限小说标题/作者/元信息可见，正文被遮罩挡住（issue #91） -->
      <view class="relative p-4">
        <template v-if="novel && isRestricted(novel)">
          <view class="min-h-[60vw]" />
          <RestrictOverlay :level="novel.x_restrict === 2 ? 2 : 1" />
        </template>
        <template v-else>
          <text v-for="(p, idx) in paragraphs" :key="idx" class="text-xl leading-[44rpx] text-foreground mb-4 block">
            {{ p }}
          </text>
        </template>
      </view>
      <view class="flex items-center justify-center p-6">
        <text class="text-sm text-foreground-3">— 完 —</text>
      </view>
    </scroll-view>
  </view>
</template>
