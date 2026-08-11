<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, goBack } from '../router'
import { loadNovelDetail, fetchNovelText } from '../api/novel'
import type { PixivNovel } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { isRestricted } from '../stores/settingsStore'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import SkeletonNovel from '../components/SkeletonNovel.vue'

const novel = ref<PixivNovel | null>(null)
const text = ref('')
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

// ─── 评论弹层（issue #164）：入口在作者/元信息行附近；弹层挂根 view 内、scroll-view 之后 ───
const showComments = ref(false)

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
    errorMsg.value = presentError(err, '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <view class="w-full h-full bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-[6.4vw] leading-none text-surface-on">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-surface-on">小说</text>
    </view>

    <!-- 加载期骨架（issue #91）：header 照常渲染，正文区骨架占位 -->
    <SkeletonNovel v-if="loading" />
    <view v-else-if="errorMsg" class="w-full h-full flex items-center justify-center">
      <text class="text-body-medium text-error p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else class="w-full h-full" scroll-orientation="vertical">
      <view class="py-5 px-4 bg-surface-container-lowest mb-3">
        <text class="text-title-large font-bold text-surface-on">{{ novel?.title }}</text>
        <text class="text-body-medium text-surface-on-variant mt-2">by {{ novel?.user.name }}</text>
        <text class="text-label-medium text-outline mt-1.5">
          {{ novel?.text_length }} 字
          <template v-if="novel?.total_bookmarks != null">
             · ♥ {{ novel?.total_bookmarks }}
          </template>
        </text>
        <!-- 评论入口（issue #164）：💬 + total_comments，字段缺失时不显示（对齐插画页惯例） -->
        <view
          v-if="novel?.total_comments !== undefined"
          class="mt-2 flex flex-row items-center"
          @tap="showComments = true"
        >
          <text class="text-[6.4vw] leading-none">💬</text>
          <text class="text-label-medium text-outline ml-1">{{ novel?.total_comments }}</text>
        </view>
      </view>
      <!-- 正文区：受限小说标题/作者/元信息可见，正文被遮罩挡住（issue #91） -->
      <view class="relative p-4">
        <template v-if="novel && isRestricted(novel)">
          <view class="min-h-[60vw]" />
          <RestrictOverlay :level="novel.x_restrict === 2 ? 2 : 1" />
        </template>
        <template v-else>
          <text v-for="(p, idx) in paragraphs" :key="idx" class="text-body-large leading-[44rpx] text-surface-on mb-4 block">
            {{ p }}
          </text>
        </template>
      </view>
      <view class="flex items-center justify-center p-6">
        <text class="text-body-small text-outline">— 完 —</text>
      </view>
    </scroll-view>

    <!-- 评论弹层（issue #164）：根 view 内、scroll-view 之后的覆盖层 → 弹层打开时正文滚动位置不丢失 -->
    <CommentOverlay v-if="showComments" type="novel" :target-id="novelId" @close="showComments = false" />
  </view>
</template>
