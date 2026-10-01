<script setup lang="ts">
// M3 通用卡片（原 Fluent 伪玻璃卡 → Material Design 3 elevated card）。
// 视觉：surface-container-lowest 底 + elevation-1 阴影 + shape-medium(12dp) 圆角，
// 符合 M3「elevated card」规范（组件层级上浮的卡片）。
// 弹性交互（elastic=true）保留：触摸滑近时方向性拉伸 + 弹性位移，松手 200ms 回弹。
// 算法收敛在 primitives/createLiquidElastic（纯函数，唯一测试接缝）；本组件只做事件接线。
import { computed, ref } from 'vue'
import { createLiquidElastic, type ElasticRect, type ElasticPoint } from '../primitives/createLiquidElastic'
import { useReducedMotion } from '../composables/useReducedMotion'

const props = withDefaults(
  defineProps<{
    /** 液态弹性开关；false 时零监听零开销 */
    elastic?: boolean
    /** 弹性系数（对齐 liquid-glass-react 默认 0.15） */
    elasticity?: number
    /** 圆角 token 覆盖（默认 M3 shape-large = 16px） */
    radius?: string
  }>(),
  { elastic: true, elasticity: 0.15, radius: 'var(--md-shape-medium)' },
)

// 卡片选择器 id（createSelectorQuery 布局查询用）
const cardId = `glass-card-${Math.random().toString(36).slice(2, 10)}`

// 减弱动效偏好（T03 #851）：R1 过渡整条置 none + R3 弹性动效本身不发生。
// 液态弹性是「跟手位移 + 方向性拉伸 + 松手回弹」，纯位移类前庭反应，降时长无效 → 直接关停，
// 卡片仍响应触摸（无任何形变），布局查询等其余行为不变。
const { reducedMotion, transitionStyle } = useReducedMotion()

/** 弹性总闸：prop 关闭或偏好开启时都为零监听零几何改动 */
const elasticOn = computed(() => props.elastic && !reducedMotion.value)

const elastic = computed(() => createLiquidElastic({ elasticity: props.elasticity }))

// 元素矩形缓存：touchstart 时查询一次，touchmove 期间不重复查询（性能约束）
let cachedRect: ElasticRect | null = null

const scaleTransform = ref('')
const translateTransform = ref({ x: 0, y: 0 })
const touching = ref(false)

const cardStyle = computed(() => ({
  borderRadius: props.radius,
  transform: `translate(${translateTransform.value.x}px, ${translateTransform.value.y}px) ${scaleTransform.value || 'scale(1)'}`,
  // 触摸中直跟手指（无过渡）；松手经 transition 回弹；
  // 减弱动效下整条置 none（R1）——此时 elasticOn 恒 false，transform 也不再变化
  // ⚠️ 曲线走令牌：原为 Fluent 遗留的 cubic-bezier(0.33,0,0.67,1)（MD3 四条曲线内没有它），
  // 按 ADR-0207 §决策与 issue #854 验收改为 --motion-emphasized-decelerate
  // （0.05,0.7,0.1,1）。写死字面量会让「缓动已整改」变成不可判的声明。
  transition:
    touching.value || transitionStyle.value
      ? 'none'
      : 'transform var(--durationNormal) var(--motion-emphasized-decelerate)',
}))

interface BoundingRect {
  left: number
  top: number
  width: number
  height: number
}

function queryRect(): void {
  // ── 布局矩形查询（Lynx 标准 API；修复 web-core 0.23.1 缺链式 boundingClientRect） ──
  // 注意：vue-lynx 的 JS 运行在 web-core worker 里（无 document），
  // 且 NodesRef 上不存在 .boundingClientRect() 链式方法（web-core 0.23.1 实测缺失）。
  // 正确用法是 invoke({ method: 'boundingClientRect' })——web-core 主线程
  // createInvokeUIMethod.js 显式处理该 method，原生 LynxView 同为标准 API。
  const q = lynx?.createSelectorQuery?.()
  if (!q) return
  // [fix] exec 必须挂在 select().invoke() 的返回值上：SelectorQuery 队列式，invoke 返回携带 task 的新 query；
  // 对原 q 调 exec() 执行的是空队列 → success 永不回调（ADR-0149 spike 双端实测）。
  const query = q.select(`#${cardId}`).invoke({
    method: 'boundingClientRect',
    params: {},
    success: (data) => {
      const r = data as Partial<BoundingRect> | null
      if (!r) return
      cachedRect = { left: r.left ?? 0, top: r.top ?? 0, width: r.width ?? 0, height: r.height ?? 0 }
      // 矩形就绪：补上 touchstart 时被跳过的首个触点
      if (pendingFirstPoint && touching.value) {
        applyElastic(pendingFirstPoint)
        pendingFirstPoint = null
      }
    },
  })
  query.exec()
}

interface LynxTouch {
  clientX: number
  clientY: number
}
interface LynxTouchEvent {
  touches: LynxTouch[]
  changedTouches: LynxTouch[]
}

function pointOf(e: LynxTouchEvent): ElasticPoint | null {
  const t = e.touches[0] ?? e.changedTouches[0]
  return t ? { x: t.clientX, y: t.clientY } : null
}

// rAF 节流：touchmove 高频触发，帧对齐更新 transform
let rafPending = false
let pendingPoint: ElasticPoint | null = null
// touchstart 的矩形查询是异步的，首个触点可能在查询回调返回前就到了——
// 缓存下来，查询完成时补一次（修复：按下瞬间无弹性反馈）
let pendingFirstPoint: ElasticPoint | null = null

function applyElastic(p: ElasticPoint): void {
  if (!cachedRect) return
  scaleTransform.value = elastic.value.transform(p, cachedRect)
  translateTransform.value = elastic.value.translate(p, cachedRect)
}

function onTouchStart(e: LynxTouchEvent): void {
  if (!elasticOn.value) return
  touching.value = true
  const p = pointOf(e)
  if (cachedRect) {
    if (p) applyElastic(p)
  } else {
    pendingFirstPoint = p
    queryRect()
  }
}

function onTouchMove(e: LynxTouchEvent): void {
  if (!elasticOn.value || !touching.value) return
  const p = pointOf(e)
  if (!p) return
  pendingPoint = p
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    // 松手后丢弃排队帧（防鬼影：touch end 已复位，过期帧不应再应用）
    if (touching.value && pendingPoint) applyElastic(pendingPoint)
  })
}

function onTouchEnd(): void {
  if (!elasticOn.value || !touching.value) return
  touching.value = false
  pendingPoint = null
  pendingFirstPoint = null
  // 矩形缓存按手势过期：卡片在 scroll-view 内，滚动后缓存失效，下次手势重新查询
  cachedRect = null
  scaleTransform.value = ''
  translateTransform.value = { x: 0, y: 0 }
}
</script>

<template>
  <view
    :id="cardId"
    class="glass-card"
    :style="cardStyle"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <slot />
  </view>
</template>

<style scoped>
.glass-card {
  background-color: var(--md-surface-container-lowest);
  box-shadow: var(--md-elevation-1);
}
</style>
