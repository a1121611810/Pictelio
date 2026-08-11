<script setup lang="ts">
import { ref } from 'vue'
import { resolveSkeletonStyle } from './skeletonStyle'

// 图片级骨架屏：容器按 aspect-ratio 占位，图片 @load 后才隐藏 shimmer 显示图片。
// 加载失败（@error）显示灰底 + 文字提示，避免永久 shimmer。
// [lynx:fix] 列表场景必须开启 lazyLoad：web-core 预览下 list 不做 item 回收，
// 90 条数据会全量渲染并全量触发图片加载（图片加载风暴）。lazy-load 是 Lynx
// 引擎级懒加载（进入视口附近才请求），官方 list 内图片最佳实践。
const props = defineProps<{
  src: string
  /** 容器宽高比：列表方形 "1 / 1"，详情页用 API 的 `${width} / ${height}`；传 height 时可不传（issue #138） */
  aspectRatio?: string
  /** 可选 min-height 兜底（vw 字符串，如 "40vw"），防 aspect-ratio 不生效时高度塌陷（ADR-0045） */
  minH?: string
  /** 显式容器高度（vw 字符串，如 "48.4vw"）：原生 LynxView 下 aspect-ratio 容器内 <image> 的百分比高度解析为 0，显式 height 可规避（issue #138） */
  height?: string
  /** 懒加载（默认开启）：列表卡片传 true，详情大图（首屏即需）可不传 */
  lazyLoad?: boolean
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
    class="relative bg-surface-container-highest overflow-hidden"
    :style="resolveSkeletonStyle(props.height, props.aspectRatio, props.minH)"
  >
    <!-- 加载中：shimmer 覆盖在 image 上层（DOM 顺序靠后即在上层） -->
    <view v-if="!loaded && !failed" class="shimmer absolute top-0 left-0 w-full h-full" />
    <image
      class="w-full h-full"
      :src="src"
      :mode="'aspectFill'"
      :lazy-load="lazyLoad"
      @load="onLoad"
      @error="onError"
    />
    <!-- 加载失败：灰底 + 文字提示 -->
    <view v-if="failed" class="absolute top-0 left-0 w-full h-full flex items-center justify-center">
      <text class="text-body-small text-outline">图片加载失败</text>
    </view>
  </view>
</template>
