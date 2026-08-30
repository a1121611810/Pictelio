<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getGlobalFab } from '../stores/globalFab'
import { A11Y_ELEMENT_ENABLED, GLOBAL_FAB_A11Y_LABELS } from '../utils/accessibility'

// ─── 放射导航薄渲染适配器（ADR-0120）───
// 读 globalFab.view、调 globalFab.dispatch；双层环几何与动效在此适配器，
// 不含业务逻辑。挂载于 App.vue（KeepAlive 之外），view.visible 决定显隐。
// 术语见 glossary-app-lynx-radial-nav-fab.md。

const fab = getGlobalFab()
const view = fab.view

/** reduced-motion：禁止飞出/stagger/旋转动画（Lynx 的 matchMedia 不可用时默认 false）。 */
const reducedMotion = ref(false)
let reducedMq: MediaQueryList | undefined
function updateReducedMotion(): void {
  reducedMotion.value = reducedMq?.matches ?? false
}
onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)')
    updateReducedMotion()
    reducedMq.addEventListener?.('change', updateReducedMotion)
  }
})
onUnmounted(() => reducedMq?.removeEventListener?.('change', updateReducedMotion))

/** 内环/外环图标（Lynx 无图标库，unicode 约定）。 */
const fabIcon = computed(() => {
  const active = view.value.outer.find((t) => t.name === view.value.active)
  return active ? active.icon : '⌂'
})

// ── 几何（vw）：FAB 固定 right-4/bottom-4(4.267vw)，外/内环半径随屏宽缩放 ──
const FAB_RIGHT_VW = 4.267
const FAB_SIZE_VW = 14.933
const R_OUTER_VW = 35 // 外环半径（vw；56dp 大圆需更大半径防重叠，ADR-0121）
const R_INNER_VW = 20 // 内环半径（vw；动作圆与 FAB/外环拉开，避免重叠）

declare const SystemInfo: { pixelWidth: number; pixelHeight?: number; pixelRatio: number }

/** 逻辑屏高（vw 单位：100vw 为屏宽；屏高以 vw 折算）。web-core 兜底按 390×844 估。 */
function screenHeightVw(): number {
  if (typeof SystemInfo === 'undefined') return 216.4
  const w = SystemInfo.pixelWidth / SystemInfo.pixelRatio
  const h = SystemInfo.pixelHeight ? SystemInfo.pixelHeight / SystemInfo.pixelRatio : (w * 844) / 390
  return (h / w) * 100
}

const fabCx = 100 - FAB_RIGHT_VW - FAB_SIZE_VW / 2
const fabCy = screenHeightVw() - FAB_RIGHT_VW - FAB_SIZE_VW / 2

// ── 定位（ADR-0123）：子元素一律 left/top vw（vw=视口基准），锚点=外层 (0,0) 零尺寸盒 ──
// [lynx:fix] 原生 LynxView 把「最近的 view 祖先」当作 absolute 子元素的定位锚点
//（即使该祖先未设 position，与 Web 回退到视口的语义不同，实测偏离）。若用 right/bottom
// 且父盒非全屏，元素会按父盒边缘解析而跑出屏幕（FAB 消失，模拟器实测）。故：
// 外层 absolute 钉在 (0,0) + 零尺寸盒（只作锚点、不参与命中），子元素全部 vw 定位。

/** 遮罩：显式 vw 全屏尺寸（铺满屏幕的交互面，点空白收起）。 */
const scrimStyle: Record<string, string> = {
  left: '0',
  top: '0',
  width: '100vw',
  height: `${screenHeightVw()}vw`,
}

/** 主 FAB：left/top vw + translate 居中（相对 (0,0) 锚点 = 视口坐标，恒在右下角）。 */
const fabStyle: Record<string, string> = {
  left: `${fabCx}vw`,
  top: `${fabCy}vw`,
  width: `${FAB_SIZE_VW}vw`,
  height: `${FAB_SIZE_VW}vw`,
  transform: 'translate(-50%,-50%)',
}

/** 极角→直角坐标（vw；0°=正上方，顺时针为负往左）。 */
function polar(angleDeg: number, r: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180
  return { x: fabCx + Math.sin(a) * r, y: fabCy - Math.cos(a) * r }
}

function spread(start: number, end: number, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [start + (end - start) / 2]
  return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1))
}

const OUTER_START = -8
const OUTER_END = -88 // 不过 FAB 水平线，末端项不探出屏幕底边（ADR-0121）
const INNER_START = -14
const INNER_END = -80

const outerPair = computed(() => {
  const angles = spread(OUTER_START, OUTER_END, view.value.outer.length)
  return view.value.outer.map((tab, i) => ({ tab, i, ...polar(angles[i], R_OUTER_VW) }))
})

const innerPair = computed(() => {
  const angles = spread(INNER_START, INNER_END, view.value.inner.length)
  return view.value.inner.map((item, i) => ({ item, i, ...polar(angles[i], R_INNER_VW) }))
})

/** 环项样式：绝对定位 + 居中；弹出动画用 keyframes（v-if 挂载态 transition 不触发，ADR-0123），带 stagger。 */
function ringStyle(x: number, y: number, i: number): Record<string, string> {
  const delay = reducedMotion.value ? 0 : i * 30
  return {
    left: `${x}vw`,
    top: `${y}vw`,
    transform: 'translate(-50%,-50%)',
    animation: reducedMotion.value
      ? 'none'
      : `fab-ring-in 300ms cubic-bezier(.05,.7,.1,1) ${delay}ms both`,
  }
}

/** FAB 展开旋转 90°（ADR-0108 已验证 transform）；reduced-motion 下不旋转。 */
const fabWrapStyle = computed<Record<string, string>>(() => ({
  transition: reducedMotion.value ? 'none' : 'transform 200ms cubic-bezier(.05,.7,.1,1)',
  transform: view.value.isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
}))

function dispatchToggle(): void { void fab.dispatch({ type: 'toggle' }) }
function dispatchClose(): void { void fab.dispatch({ type: 'close' }) }
function dispatchSelect(name: string): void { void fab.dispatch({ type: 'select', name }) }
function dispatchInner(item: { kind: 'refresh' | 'back-to-top' | 'extra'; key: string }): void {
  if (item.kind === 'refresh') void fab.dispatch({ type: 'refresh' })
  else if (item.kind === 'back-to-top') void fab.dispatch({ type: 'back-to-top' })
  else void fab.dispatch({ type: 'extra', key: item.key })
}
</script>

<template>
  <!-- 外层：z-40 定位容器，钉在 (0,0) 零尺寸盒——既是子元素的定位锚点（left/top vw 从 (0,0) 起算），
       自身又不参与命中测试。
       [lynx:fix] 原生 LynxView hit-testing 不识别 pointer-events（ADR-0123）：
       全屏元素在关闭态必须从渲染树移除（v-if），否则吞掉页面全部点击。 -->
  <view v-if="view.visible" class="absolute z-40" style="top: 0; left: 0">
    <!-- 遮罩：展开时覆盖全屏（显式 vw 尺寸），点空白收起（全屏交互面，@tap 必须） -->
    <view
      v-if="view.isOpen"
      class="absolute z-10 bg-scrim scrim-in"
      :style="scrimStyle"
      @tap="dispatchClose"
    />

    <!-- 环层：外环 + 内环，仅菜单展开时渲染（零尺寸盒，只承载环项） -->
    <view v-if="view.isOpen" class="absolute z-20">
      <!-- 外环：导航 tab（当前高亮 secondary-container）——固定圆形尺寸（vw 缩放，≥40px 触控目标） -->
      <view
        v-for="e in outerPair"
        :key="e.tab.name"
        class="absolute z-20 flex flex-col items-center justify-center w-[14.93vw] h-[14.93vw] rounded-full shadow-[var(--md-elevation-2)]"
        :class="e.tab.name === view.active ? 'bg-secondary-container' : 'bg-surface-container-high'"
        :style="ringStyle(e.x, e.y, e.i)"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="e.tab.a11yLabel"
        @tap="dispatchSelect(e.tab.name)"
      >
        <text
          class="leading-none"
          :class="e.tab.name === view.active ? 'text-secondary-on-container' : 'text-surface-on-variant'"
          style="font-size: 6.4vw"
        >{{ e.tab.icon }}</text>
        <text
          class="leading-none mt-[1px]"
          :class="e.tab.name === view.active ? 'text-secondary-on-container' : 'text-surface-on-variant'"
          style="font-size: 3.2vw"
        >{{ e.tab.label }}</text>
      </view>

      <!-- 内环：页面动作项（刷新/回顶/扩展）——固定圆形尺寸（vw 缩放） -->
      <view
        v-for="e in innerPair"
        :key="e.item.key"
        class="absolute z-20 flex items-center justify-center w-[10.67vw] h-[10.67vw] rounded-full bg-primary-container shadow-[var(--md-elevation-2)]"
        :style="ringStyle(e.x, e.y, e.i)"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="e.item.a11yLabel"
        @tap="dispatchInner(e.item)"
      >
        <text class="leading-none text-primary-on-container" style="font-size: 6.4vw">{{ e.item.icon }}</text>
      </view>
    </view>

    <!-- 主 FAB：展开成 close，收起为当前 tab 图标；busy 时转圈/禁用 -->
    <view
      class="absolute z-30 flex items-center justify-center rounded-[var(--md-shape-large)] bg-primary-container shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
      :class="view.isBusy ? 'opacity-60' : ''"
      :style="fabStyle"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="view.isOpen ? GLOBAL_FAB_A11Y_LABELS.close : GLOBAL_FAB_A11Y_LABELS.open"
      @tap="dispatchToggle"
    >
      <view :style="fabWrapStyle">
        <text
          class="leading-none text-primary-on-container"
          :class="{ 'fab-ring-spin': view.isBusy && !view.isOpen }"
          style="font-size: 6.4vw"
        >{{ view.isOpen ? '✕' : fabIcon }}</text>
      </view>
    </view>
  </view>
</template>

<style>
/* 放射环项弹出动画（ADR-0123）：环项随展开层 v-if 挂载，transition 不触发（状态无变化），
   改用 keyframes + both fill + 逐项 stagger（对齐 ADR-0111 的 item-rise 弹出习语）。 */
@keyframes fab-ring-in {
  from { transform: translate(-50%,-50%) scale(0); opacity: 0; }
  to   { transform: translate(-50%,-50%) scale(1); opacity: 1; }
}
/* 放射 FAB 刷新旋转动画（ADR-0108：Lynx keyframe + TransformProps 已验证）。
   类名 fab-ring-spin 全仓唯一（RefreshableList 的 fab-spin 已被其占用，避免冲突）。 */
@keyframes fab-ring-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.fab-ring-spin {
  animation: fab-ring-spin 1s linear infinite;
}
</style>
