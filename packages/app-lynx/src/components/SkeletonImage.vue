<script setup lang="ts">
import { ref } from 'vue'

// 图片级骨架屏：容器按 aspect-ratio 占位，图片 @load 后才隐藏 shimmer 显示图片。
// 图片始终渲染（容器有确定高度 → 触发加载），shimmer 绝对定位覆盖在上层。
// 加载失败（@error）显示灰底 + 文字提示，避免永久 shimmer。
defineProps<{
  src: string
  /** 容器宽高比：列表方形 "1 / 1"，详情页用 API 的 `${width} / ${height}` */
  aspectRatio: string
  /** 可选 min-height 兜底（vw 字符串，如 "40vw"），防 aspect-ratio 不生效时高度塌陷（ADR-0045） */
  minH?: string
}>()

const loaded = ref(false)
const failed = ref(false)
function onLoad() {
  loaded.value = true
}
function onError() {
  failed.value = true
}
</script>

<template>
  <view
    class="relative bg-background-3 overflow-hidden"
    :style="{ aspectRatio, minHeight: minH }"
  >
    <!-- 加载中：shimmer 覆盖在 image 上层（DOM 顺序靠后即在上层） -->
    <view v-if="!loaded && !failed" class="shimmer absolute top-0 left-0 w-full h-full" />
    <image
      class="w-full h-full"
      :src="src"
      :mode="'aspectFill'"
      @load="onLoad"
      @error="onError"
    />
    <!-- 加载失败：灰底 + 文字提示 -->
    <view v-if="failed" class="absolute top-0 left-0 w-full h-full flex items-center justify-center">
      <text class="text-sm text-foreground-3">图片加载失败</text>
    </view>
  </view>
</template>
