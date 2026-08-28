<script setup lang="ts">
// ─── 自研单卡 swipe 轮播（ADR-0115 / spec: app-lynx-recommended-carousel §3.1；
// 吸附阈值 + fling = ADR-0118 / spec: app-lynx-recommended-carousel-polish-r2 §2.2）───
// 非原生 <swiper> 元素：按 vue-lynx 官方教程《商品详情页图片轮播》手写。
// [方案偏离 ADR-0115] 教程的「主线程脚本」（'main thread' + :main-thread-bindtouch*）在
//   本项目原生 LynxView 上会导致组件整块渲染空白（真机验证：加回 main-thread-* 绑定 → 空白，
//   移除 → 正常；与 display 模式 / helper 无关）。故回退到**后台线程**方案：
//   触摸用 @touchstart/@touchmove/@touchend（后台线程），translateX 经 Vue 响应式 :style 绑定。
//   代价：拖拽非零延迟（主线程方案的本意），但可正常渲染与滑动。见 ADR-0115「待验证项」与
//   docs/research/vue-lynx-swiper-tutorial.md。
// [ADR-0118] 松手吸附改用 calcSnapTarget（1/3 屏宽阈值 + fling 甩动）：touchend 前用最后一段
//   移动计算瞬时速度（px/ms），位移未过 1/3 时若速度超阈值也沿速度方向翻页（快甩短距离也翻页）。
// [单位] slide 宽度 / 吸附 / translateX 全程 px（SystemInfo.pixelWidth/pixelRatio，官方一致）。
declare const SystemInfo: { pixelWidth: number; pixelRatio: number }

import { ref } from 'vue'
import { calcSnapTarget, clampOffset } from '../primitives/swiperMath'

const props = withDefaults(
  defineProps<{
    /** 滑页条目数组（父组件喂渲染流；长度增长时自动扩展滑动边界） */
    slides: unknown[]
    /** 每个滑页宽度（CSS px）。缺省 = 屏幕逻辑像素宽（一滑页 = 全宽），官方默认值 */
    itemWidth?: number
    /** 当前页索引变化回调（BG 侧） */
    onIndexChange?: (index: number) => void
    /** 滑近末尾回调（供父组件 fetchMore，BG 侧） */
    onReachEnd?: () => void
    /** 距末尾多少条触发 onReachEnd，默认 3 */
    distanceToEnd?: number
  }>(),
  {
    itemWidth: () =>
      typeof SystemInfo !== 'undefined' ? SystemInfo.pixelWidth / SystemInfo.pixelRatio : 375,
    onIndexChange: undefined,
    onReachEnd: undefined,
    distanceToEnd: 3,
  },
)

// ─── 后台线程响应式状态（translateX 以 :style 绑定，无需直接 DOM 访问）───
const containerOffset = ref(0) // px translateX（负值向左滑）
const touchStartX = ref(0)
const touchStartOffset = ref(0)
const currentIndex = ref(0)
const lastReachEndIndex = ref(0)
let rafId: number | null = null

// ─── fling 速度采样（ADR-0118：模块级 let，不走响应式 ref 避免高频 churn）───
let lastMoveX = 0
let lastMoveAt = 0
let gestureStartAt = 0
let moveCount = 0
let lastVelocityPxPerMs = 0

function cancelAnimate() {
  if (rafId != null) cancelAnimationFrame(rafId)
  rafId = null
}

function updateOffset(raw: number) {
  const bound = clampOffset(raw, props.slides.length, props.itemWidth)
  containerOffset.value = bound
  const index = Math.round(-bound / props.itemWidth)
  if (index !== currentIndex.value) {
    currentIndex.value = index
    props.onIndexChange?.(index)
    const remaining = props.slides.length - index - 1
    if (remaining <= props.distanceToEnd && index > lastReachEndIndex.value) {
      lastReachEndIndex.value = index
      props.onReachEnd?.()
    }
  }
}

function animateTo(target: number) {
  cancelAnimate()
  if (typeof requestAnimationFrame !== 'function') {
    updateOffset(target)
    return
  }
  const from = containerOffset.value
  const duration = 300
  const start = Date.now()
  function tick() {
    const t = Math.min((Date.now() - start) / duration, 1)
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    updateOffset(from + (target - from) * eased)
    if (t < 1) {
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = null
    }
  }
  rafId = requestAnimationFrame(tick)
}

// ─── 后台线程触摸处理（px） ───
function handleTouchStart(e: { touches: Array<{ clientX: number }> }) {
  cancelAnimate()
  touchStartX.value = e.touches[0]?.clientX ?? 0
  touchStartOffset.value = containerOffset.value
  lastMoveX = touchStartX.value
  lastMoveAt = Date.now()
  gestureStartAt = lastMoveAt
  moveCount = 0
  lastVelocityPxPerMs = 0
}
function handleTouchMove(e: { touches: Array<{ clientX: number }> }) {
  const x = e.touches[0]?.clientX ?? lastMoveX
  const startX = touchStartX.value
  const dx = x - startX
  updateOffset(touchStartOffset.value + dx)
  // 瞬时速度 = 最后一段移动（位移/间隔，px/ms）；间隔 0 时保持上一段值
  const now = Date.now()
  const dt = now - lastMoveAt
  if (dt > 0) {
    lastVelocityPxPerMs = (x - lastMoveX) / dt
    lastMoveX = x
    lastMoveAt = now
  }
  moveCount++
}
function handleTouchEnd() {
  // 速度：>=2 次 move 用瞬时（最后一段）；仅 1 次（或没有）用全程平均（分母 0 → 0 速度）
  let velocity = lastVelocityPxPerMs
  if (moveCount <= 1) {
    const dt = Date.now() - gestureStartAt
    velocity = dt > 0 ? (lastMoveX - touchStartX.value) / dt : 0
  }
  lastVelocityPxPerMs = 0
  // ADR-0118：1/3 阈值 + fling 甩动；animateTo 内部 updateOffset 会 clamp 边界
  animateTo(calcSnapTarget(containerOffset.value, props.itemWidth, { velocityPxPerMs: velocity }))
}
</script>

<template>
  <view class="swiper-wrapper">
    <view
      class="swiper-container"
      :style="{ transform: `translateX(${containerOffset}px)` }"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <template v-for="(item, idx) in slides" :key="idx">
        <view class="swiper-slide" :style="{ width: `${itemWidth}px` }">
          <slot name="slide" :item="item" :index="idx" />
        </view>
      </template>
    </view>
  </view>
</template>

<style>
/* 教程布局：display: linear 是 Lynx 专用高性能水平布局（原生渲染优于 flex）；
   但本项目原生测试 linear 与 flex 均可渲染（空白根因是 main-thread 绑定，非布局）。
   此处用 flex（已真机验证可渲染），后续如需再评测 linear 的性能收益。 */
.swiper-wrapper {
  flex: 1;
  width: 100%;
}
.swiper-container {
  display: flex;
  flex-direction: row;
  height: 100%;
}
.swiper-slide {
  height: 100%;
  overflow: hidden;
  flex-shrink: 0;
}
</style>
