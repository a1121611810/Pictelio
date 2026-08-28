<script setup lang="ts">
// ─── 自研单卡 swipe 轮播（ADR-0115 / spec: app-lynx-recommended-carousel §3.1）───
// 非原生 <swiper> 元素：按 vue-lynx 教程《商品详情页图片轮播》手写——
//   display: linear + linear-orientation: horizontal 水平排布滑页
//   + 主线程触摸处理（'main thread' 指令 + useMainThreadRef）→ 零跨线程延迟拖拽
//   + 主线程 requestAnimationFrame → 松手吸附最近页（缓动）
//   + runOnBackground / runOnMainThread 桥接当前索引与动态数据长度
// 组件保持薄：每张滑页内容由父组件经 #slide 插槽渲染（封面/标题/作者/收藏等）。
// [lynx:fix] 主线程脚本是 Lynx 特性，原生支持度需真机验证（spec §4 验证闭环）。
// [build-fix] <script setup> 中禁止 ES module export（vue-lynx SFC 编译器不识别，
//   rspeedy build 报 rspack-vue-loader resolveScript null）。tap 判定仅父组件用，
//   直接导入 swiperMath 即可，不再经组件 re-export（见 ADR-0116）。
import { watch } from 'vue'
import { useMainThreadRef, runOnMainThread, runOnBackground } from 'vue-lynx'
import { calcNearestPage, clampOffset } from '../primitives/swiperMath'

const props = withDefaults(
  defineProps<{
    /** 滑页条目数组（父组件喂渲染流；长度增长时自动扩展滑动边界） */
    slides: unknown[]
    /** 每个滑页宽度（vw 数值） */
    itemWidth: number
    /** 当前页索引变化回调（BG 侧，经 runOnBackground 桥接） */
    onIndexChange?: (index: number) => void
    /** 滑近末尾回调（供父组件 fetchMore，BG 侧） */
    onReachEnd?: () => void
    /** 距末尾多少条触发 onReachEnd，默认 3 */
    distanceToEnd?: number
  }>(),
  { onIndexChange: undefined, onReachEnd: undefined, distanceToEnd: 3 },
)

// ─── 捕获稳定引用（供主线程闭包使用）：MT 函数不能直接引用反应式 props/对象，只捕获可序列化值/函数 ───
// onIndexChange/onReachEnd 为配置期稳定的 BG 函数（父组件定义一次），可经 runOnBackground 桥接；
// distanceToEnd 为不可变配置数值；itemWidth 用 ref 保障滑动时实时读取。
const onIndexChangeCb = props.onIndexChange
const onReachEndCb = props.onReachEnd
const distanceToEnd = props.distanceToEnd

// ─── 元素/共享状态（主线程侧） ───
// setStyleProperties（对象形式）为教程实测用法，但未纳入 Lynx 类型定义，故用局部接口 + cast。
interface SwiperContainerElement {
  setStyleProperties?: (props: Record<string, string | number>) => void
}
const containerRef = useMainThreadRef<SwiperContainerElement | null>(null)
const currentOffsetRef = useMainThreadRef<number>(0)
const touchStartXRef = useMainThreadRef<number>(0)
const touchStartOffsetRef = useMainThreadRef<number>(0)
const slideCountRef = useMainThreadRef<number>(props.slides.length)
const itemWidthRef = useMainThreadRef<number>(props.itemWidth)
const currentIndexRef = useMainThreadRef<number>(0)
const lastReachEndIndexRef = useMainThreadRef<number>(0)

// ─── 动态数据长度/宽度同步（BG → MT）：slides 增长后边界必须随之扩展 ───
// useMainThreadRef 的 .current 在 BG 不可写（仅 MT 可读写），故用 runOnMainThread 驱动 setter。
function setSlideCount(n: number) {
  'main thread'
  slideCountRef.current = n
}
function setItemWidth(w: number) {
  'main thread'
  itemWidthRef.current = w > 0 ? w : 1
}
watch(
  () => props.slides.length,
  (n) => {
    void runOnMainThread(setSlideCount)(n)
  },
)
watch(
  () => props.itemWidth,
  (w) => {
    void runOnMainThread(setItemWidth)(w)
  },
)

// ─── 主线程样式/位移更新 ───
function applyOffset(offset: number) {
  'main thread'
  currentOffsetRef.current = offset
  containerRef.current?.setStyleProperties?.({ transform: `translateX(${offset}px)` })
}

// 更新 offset（含 clamp + 索引 + 到末尾检测 + 回调）
function updateOffset(rawOffset: number) {
  'main thread'
  const bound = clampOffset(rawOffset, slideCountRef.current, itemWidthRef.current)
  applyOffset(bound)
  const index = Math.round(-bound / itemWidthRef.current)
  if (index !== currentIndexRef.current) {
    currentIndexRef.current = index
    if (onIndexChangeCb) {
      void runOnBackground(onIndexChangeCb)(index)
    }
    // 到末尾检测：剩余可滑数量 <= distanceToEnd 且索引前进时触发（供父组件 fetchMore）
    const remaining = slideCountRef.current - index - 1
    if (remaining <= distanceToEnd && index > lastReachEndIndexRef.current) {
      lastReachEndIndexRef.current = index
      if (onReachEndCb) {
        void runOnBackground(onReachEndCb)()
      }
    }
  }
}

// ─── 主线程触摸处理 ───
function handleTouchStart(e: { touches: Array<{ clientX: number }> }) {
  'main thread'
  cancelAnimate()
  touchStartXRef.current = e.touches[0]?.clientX ?? 0
  touchStartOffsetRef.current = currentOffsetRef.current
}
function handleTouchMove(e: { touches: Array<{ clientX: number }> }) {
  'main thread'
  const startX = touchStartXRef.current
  const dx = (e.touches[0]?.clientX ?? startX) - startX
  updateOffset(touchStartOffsetRef.current + dx)
}
function handleTouchEnd() {
  'main thread'
  const target = calcNearestPage(currentOffsetRef.current, itemWidthRef.current)
  animateTo(target)
}

// ─── 松手吸附动画（主线程 RAF，easeInOutQuad 内联以免跨线程函数调用） ───
const rafIdRef = useMainThreadRef<number | null>(null)
function cancelAnimate() {
  'main thread'
  if (rafIdRef.current != null) {
    cancelAnimationFrame(rafIdRef.current)
  }
  rafIdRef.current = null
}
function animateTo(target: number) {
  'main thread'
  cancelAnimate()
  const from = currentOffsetRef.current
  const duration = 300
  const startTs = Date.now()
  function tick() {
    const t = Math.min((Date.now() - startTs) / duration, 1)
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    updateOffset(from + (target - from) * eased)
    if (t < 1) {
      rafIdRef.current = requestAnimationFrame(tick)
    } else {
      rafIdRef.current = null
    }
  }
  rafIdRef.current = requestAnimationFrame(tick)
}
</script>

<template>
  <view class="swiper-wrapper">
    <view
      :main-thread-ref="containerRef"
      :main-thread-bindtouchstart="handleTouchStart"
      :main-thread-bindtouchmove="handleTouchMove"
      :main-thread-bindtouchend="handleTouchEnd"
      class="swiper-container"
    >
      <template v-for="(item, idx) in slides" :key="idx">
        <view class="swiper-slide" :style="{ width: `${itemWidth}vw` }">
          <slot name="slide" :item="item" :index="idx" />
        </view>
      </template>
    </view>
  </view>
</template>

<style>
/* 教程布局：display: linear 是 Lynx 专用高性能水平布局（原生渲染优于 flex）。
   .swiper-slide 宽度由 vw 内联控制（itemWidth），保证「一滑页 = 一个全宽卡」。 */
.swiper-wrapper {
  flex: 1;
  width: 100%;
}
.swiper-container {
  display: linear;
  linear-orientation: horizontal;
  height: 100%;
}
.swiper-slide {
  height: 100%;
  overflow: hidden;
  flex-shrink: 0;
}
</style>
