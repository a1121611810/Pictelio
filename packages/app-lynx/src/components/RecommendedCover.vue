<script setup lang="ts">
// ─── 推荐轮播沉浸封面：图片三态（骨架 / 图片 / 失败+重试）───
// spec: app-lynx-recommended-carousel-image-fab-polish §2.1 / §3.1。
// 复用 SkeletonImage 的三态思路，但去掉卡片框、做成全 bleed（absolute inset-0）。
// [变形修复] 用 Lynx 原生 mode='aspectFill'（fill+crop 不变形）替换 <image> 的 CSS object-fit（原生不生效→变形）。
// [竞态] 每张封面独立引用（v-for 内每 item 一个实例）；重试用 :key 强制 <image> 重挂载 + cache-bust src。
import { ref, computed, watch } from 'vue'
import { deriveCoverState, deriveRetryState } from '../utils/coverImage'

const props = defineProps<{
  /** 封面 URL（已过 proxyImageUrl）；空串视为失败（避免无限骨架） */
  src: string
}>()

const imageSrc = ref(props.src)
const loaded = ref(false)
const failed = ref(false)

// 空 src（coverSrc 在 image_urls 全空时经 || '' 可能为空）：直接进失败态，避免 <image src=""> 不触发 @error 而无限骨架（spec §3.4 非静默降级）
failed.value = props.src ? false : true

/** props.src 变化时复位（轮播复用同一实例换图时避免残留旧态，spec §3.1） */
watch(
  () => props.src,
  () => {
    imageSrc.value = props.src
    loaded.value = false
    failed.value = props.src ? false : true
  },
)

function onLoad() {
  loaded.value = true
  failed.value = false
}
function onError() {
  loaded.value = false
  failed.value = true
}
/** 「重试」：从干净 base src 重建（带新 retry 参数，防 &retry 累积），复位回骨架。仅重载该图，不整页刷新。 */
function retry() {
  const s = deriveRetryState(props.src)
  imageSrc.value = s.imageSrc
  loaded.value = s.loaded
  failed.value = s.failed
}

const state = computed(() => deriveCoverState(loaded.value, failed.value))
</script>

<template>
  <view class="absolute inset-0 bg-surface-container-high overflow-hidden">
    <!-- 封面图（Lynx mode=aspectFill；失败时不渲染，避免空 image 图覆盖占位） -->
    <image
      v-if="state !== 'failed'"
      class="w-full h-full"
      :src="imageSrc"
      :mode="'aspectFill'"
      :key="imageSrc"
      @load="onLoad"
      @error="onError"
    />
    <!-- 骨架：加载中（shimmer）叠于 image 上层，@load 后隐藏 -->
    <view v-if="state === 'skeleton'" class="shimmer absolute inset-0" />
    <!-- 失败占位：纯文字提示 + 重试按钮（无 emoji；触控≥48dp） -->
    <view
      v-else-if="state === 'failed'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container-high"
    >
      <text class="text-body-medium text-outline">图片加载失败</text>
      <view
        class="min-w-[12.8vw] min-h-[12.8vw] flex items-center justify-center px-5 rounded-[var(--md-shape-full)] border border-outline bg-surface-container-lowest active:bg-surface-container-high"
        @tap.stop="retry"
      >
        <text class="text-label-large text-primary">重试</text>
      </view>
    </view>
  </view>
</template>
