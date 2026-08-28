<script setup lang="ts">
// ─── 深模块：图片三态（骨架 / 图片 / 失败+重试）统一承载 ───
// spec: app-lynx-cover-image-deep-module / ADR-0117。
// 小接口（src / layout: 'full'|'box' / retry? / lazyLoad?，box 加尺寸 prop），大行为藏内——
// 三态机（deriveCoverState）+ watch(src) 复位 + 空 src→failed + retry（deriveRetryState 干净 src 重建，
// 防 &retry 累积）+ <image mode="aspectFill">（原生等比不变形，替换 CSS object-fit）+ shimmer 骨架 +
// 失败 overlay（+可选重试按钮）+ 容器（full-bleed absolute inset-0 vs resolveSkeletonStyle 盒）。
// [复用] RecommendedCover（layout="full" retry）与 SkeletonImage（layout="box" 薄盒适配器）均经它渲染，
// 避免各组件再各自抄三态（S2 修复）。
import { ref, computed, watch } from 'vue'
import { resolveSkeletonStyle } from './skeletonStyle'
import { deriveCoverState, deriveRetryState, isUnloadableSrc } from '../utils/coverImage'

const props = withDefaults(
  defineProps<{
    /** 图片 URL（已过代理）；空串视为失败（isUnloadableSrc，避免 <image src=""> 不触发 @error 而无限骨架，非静默降级） */
    src: string
    /** 容器布局（必填）：'full' 全 bleed（absolute inset-0）；'box' 按 resolveSkeletonStyle 尺寸盒子 */
    layout: 'full' | 'box'
    /** 失败时是否显示「重试」按钮（仅全 bleed 封面开启；盒图不显示保行为） */
    retry?: boolean
    /** 懒加载（默认关闭）：列表盒图传 true；详情大图/hero（首屏即需）可不传=非懒加载 */
    lazyLoad?: boolean
    /** box 模式：显式容器高度（vw，如 "48.4vw"） */
    height?: string
    /** box 模式：容器宽高比（如 "1 / 1"） */
    aspectRatio?: string
    /** box 模式：min-height 兜底（vw） */
    minH?: string
  }>(),
  { retry: false, lazyLoad: false },
)

const imageSrc = ref(props.src)
const loaded = ref(false)
const failed = ref(isUnloadableSrc(props.src))

/** props.src 变化复位（列表复用组件换图时避免残留旧态） */
watch(
  () => props.src,
  (s) => {
    imageSrc.value = s
    loaded.value = false
    failed.value = isUnloadableSrc(s)
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
/** 「重试」：从干净 base src 重建（带新 retry 参数，防 &retry 累积），复位回骨架。仅重载该图。 */
function onRetry() {
  const r = deriveRetryState(props.src)
  imageSrc.value = r.imageSrc
  loaded.value = r.loaded
  failed.value = r.failed
}

const state = computed(() => deriveCoverState(loaded.value, failed.value))
</script>

<template>
  <view
    class="overflow-hidden"
    :class="layout === 'full' ? 'absolute inset-0 bg-surface-container-high' : 'relative bg-surface-container-highest'"
    :style="layout === 'box' ? resolveSkeletonStyle(height, aspectRatio, minH) : undefined"
  >
    <!-- 图片（Lynx mode=aspectFill；失败时不渲染，避免空 image 覆盖占位） -->
    <image
      v-if="state !== 'failed'"
      class="w-full h-full"
      :src="imageSrc"
      :mode="'aspectFill'"
      :key="imageSrc"
      :lazy-load="lazyLoad"
      @load="onLoad"
      @error="onError"
    />
    <!-- 骨架：加载中（shimmer）叠于 image 上层，@load 后隐藏 -->
    <view v-if="state === 'skeleton'" class="shimmer absolute inset-0" />
    <!-- 失败占位：纯文字提示 + 可选重试按钮（无 emoji；触控≥48dp） -->
    <view
      v-else-if="state === 'failed'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3"
    >
      <text class="text-body-medium text-outline">图片加载失败</text>
      <view
        v-if="retry"
        class="min-w-12 min-h-12 flex items-center justify-center px-5 rounded-[var(--md-shape-full)] border border-outline bg-surface-container-lowest active:bg-state-pressed-on-surface"
        @tap.stop="onRetry"
      >
        <text class="text-label-large text-primary">重试</text>
      </view>
    </view>
  </view>
</template>
