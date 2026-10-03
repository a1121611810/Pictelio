<script setup lang="ts" generic="T">
// ─── 自研单卡 swipe 轮播（ADR-0115 / spec: app-lynx-recommended-carousel §3.1；
// 吸附阈值 + fling = ADR-0118 / spec: app-lynx-recommended-carousel-polish-r2 §2.2）───
// 非原生 <swiper> 元素：按 vue-lynx 官方教程《商品详情页图片轮播》手写。
// [方案偏离 ADR-0115] 本页用**后台线程**方案：触摸 @touchstart/@touchmove/@touchend，
//   translateX 经 Vue 响应式 :style 绑定。代价：拖拽有非零跨线程延迟，但可正常渲染与滑动。
// ⚠️ **[票 #920 订正] 此前此处登记的因果链已被真机证伪，勿照旧引用**：
//   原文写「加回 main-thread-* 绑定 → 整块空白；**与 display 模式 / helper 无关**」，
//   并把它归因于「主线程方案在本项目不可用」。两处都不成立：
//     · `docs/research/vue-lynx-swiper-tutorial.md:23` §7 指出那次的根因是
//       **跨模块 import 了无 `'main thread'` 指令的模块**（helper 被 MT 打包器剥离），
//       并非「与 helper 无关」；
//     · 票 #920 期间复刻 #906 的 `MtsDemo.vue` 原型（git show 2a93c977），
//       **MTS 链路实测可用**（绿条 x=0~536→144~681 精确平移）。
//   ⇒ 「主线程不可用」与 ADR-0115:88 的冲突**尚未裁决**（issue #920），此处不断言该结论。
//     下方这套 BG 代码是**当前线上形态**，不是「因为 MTS 不可用才退而求其次」。
//   ⇒ 若改用 MTS：helper 必须内联进本模块（见 primitives/swiperMath.ts 头注）。
// [真机修复 2026-10-03] **平移方式：marginLeft，不是 transform**。
//   此前用 `transform: translateX(...)`，真机 LynxView 上**第 2 张起的整个 slide 都不渲染**
//   （不是「只有 <image> 不渲染」——连 slide 自身的背景色都不出现）。
//   对照实验（emulator-5554 / Android 14 / 1080×2160，逐层染色定位）：
//     · 注入 slide 底色（0=绿 / 1+=品红）→ 滑到第 2 页，图片区**纯黑**，品红也没出现
//       ⇒ 整个 `swiper-slide` 未渲染，而非仅 `<image>` 缺失。
//     · 唯一改动：`transform: translateX()` → `marginLeft: <px>`，其余完全不动
//       ⇒ 第 2 页图片**完整渲染**，连滑 4 页全部正常。
//   ⇒ 真因是**真机引擎对 `transform: translateX` 平移的容器内子元素不触发渲染**，
//     与「是否首子元素」无关（此前 ADR-0119 据 <text> 现象推出的「非首子元素」结论被本实验证伪）。
//   ⚠️ 语义等价性：`.swiper-container` 是 `display:flex; flex-direction:row`，占满 wrapper 宽；
//     负 `marginLeft` 把整行向左拽，滑动边界与吸附逻辑（swiperMath/clampOffset）**逐字不变**。
//     代价：margin 变化会触发**流内重排**（transform 只触发合成层位移），
//     但实测 4 页连滑无卡顿；相对「真机完全不渲染」这是可接受的交换。
//     若日后要回到 transform，必须先真机验证「被 transform 平移的容器内 <image>/<view> 是否渲染」，
//     不得凭 web-core 表现下结论（web-core 两写法都正常，掩盖了该 bug）。
// [未修复 → 本次已修] 首页轮播「第 2 张起无图」：见上方对照实验，根因为 transform 平移。
//   ADR-0119 记载的「内容移出平移容器」路径**未采用**——本实验证明换平移方式即可，
//   移动整个内容层的代价（scrim 需回到 slide 内、放弃页面级遮罩设计）大且无必要。
// [MTS 已裁决 2026-10-03] 「主线程方案真机不可用」判定**已被证伪**：复刻原型逐级加回，
//   完整 MTS（3×main-thread-bind* + main-thread-ref + setStyleProperty）渲染正常、
//   拖动蓝条精确跟随（详见 ADR-0115 的裁决块）。当年空白的真因是**跨模块 import
//   无 'main thread' 指令的模块**（helper 被 MT 打包器剥离），属用法问题非机制缺陷。
//   ⇒ 本页**仍用后台线程**，但理由是「MTS 收益仅为跟手增量、不消除 48ms 输入派发地板」
//     （性能优化决策），不再是「MTS 不可用」。
//   ⚠️ 若将来切 MTS：helper 必须内联进本模块，且**平移属性仍须 marginLeft**
//     （切回 transform 会重现上面的「第 2 张起无图」）。
// [ADR-0118] 松手吸附改用 calcSnapTarget（1/3 屏宽阈值 + fling 甩动）：touchend 前用最后一段
//   移动计算瞬时速度（px/ms），位移未过 1/3 时若速度超阈值也沿速度方向翻页（快甩短距离也翻页）。
// [单位] slide 宽度 / 吸附 / translateX 全程 px（SystemInfo.pixelWidth/pixelRatio，官方一致）。
import { ref } from 'vue'
import { calcSnapTarget, clampOffset } from '../primitives/swiperMath'

const props = withDefaults(
  defineProps<{
    /** 滑页条目数组（父组件喂渲染流；长度增长时自动扩展滑动边界）；元素类型透传给 #slide 插槽 */
    slides: T[]
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
      SystemInfo ? SystemInfo.pixelWidth / SystemInfo.pixelRatio : 375,
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
  // ADR-0118：1/3 阈值 + fling 甩动（**基于手势起点** touchStartOffset 判定，跨 50% 中点不误回弹）；
  // animateTo 内部 updateOffset 会 clamp 边界
  animateTo(
    calcSnapTarget(containerOffset.value, props.itemWidth, {
      velocityPxPerMs: velocity,
      startOffset: touchStartOffset.value,
    }),
  )
}
</script>

<template>
  <view class="swiper-wrapper">
    <view
      class="swiper-container"
      :style="{ marginLeft: `${containerOffset}px` }"
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
   此处用 flex（已真机验证可渲染）。[真机修复 H-linear 已否决] 改 linear 反而连首屏 <text> 也不渲染。 */
.swiper-wrapper {
  flex: 1;
  width: 100%;
  /* ⚠️ 显式裁切相邻 slide（负 marginLeft 改平移后必需，见头注）：
     margin 参与布局流，容器盒会真的向左溢出 wrapper 边界。
     transform 不改布局流（只做视觉位移）所以从前不需要这条；
     换 marginLeft 后必须由 wrapper 裁切，否则第 2 页会从左缘渗出。
     真机取证（emulator-5554 / Android 14 / 1080×2160）：右缘最外 3 列
     逐像素检查均为页面底色 (11,15,18) ⇒ 当前无渗出。
     但那依赖祖先 flex 容器的隐式裁切（脆弱），此处显式声明以免换宿主布局时破版。 */
  overflow: hidden;
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
