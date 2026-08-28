<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { globalFab } from '../stores/globalFab'
import { A11Y_ELEMENT_ENABLED, GLOBAL_FAB_A11Y_LABELS } from '../utils/accessibility'

// ─── 放射导航薄渲染适配器（ADR-0120）───
// 读 globalFab.view、调 globalFab.dispatch；双层环几何与动效在此适配器，
// 不含业务逻辑。挂载于 App.vue（KeepAlive 之外），view.visible 决定显隐。
// 术语见 glossary-app-lynx-radial-nav-fab.md。

const view = globalFab.view

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
const R_OUTER_VW = 25.6 // 96px @375
const R_INNER_VW = 13.87 // 52px @375

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

const OUTER_START = -12
const OUTER_END = -90
const INNER_START = -14
const INNER_END = -88

const outerPair = computed(() => {
  const angles = spread(OUTER_START, OUTER_END, view.value.outer.length)
  return view.value.outer.map((tab, i) => ({ tab, i, ...polar(angles[i], R_OUTER_VW) }))
})

const innerPair = computed(() => {
  const angles = spread(INNER_START, INNER_END, view.value.inner.length)
  return view.value.inner.map((item, i) => ({ item, i, ...polar(angles[i], R_INNER_VW) }))
})

/** 环项样式：绝对定位 + 居中；开时 scale(1)、关时 scale(0)（弹出/收起动画，带 stagger）。 */
function ringStyle(x: number, y: number, i: number): Record<string, string> {
  const s = view.value.isOpen ? 1 : 0
  const delay = view.value.isOpen ? i * 30 : 0
  const transition = reducedMotion.value ? 'none' : `transform 300ms cubic-bezier(.05,.7,.1,1), opacity 300ms cubic-bezier(.05,.7,.1,1)`
  return {
    left: `${x}vw`,
    top: `${y}vw`,
    transform: `translate(-50%,-50%) scale(${s})`,
    opacity: s ? '1' : '0',
    transition,
    'transition-delay': `${delay}ms`,
    'pointer-events': s ? 'auto' : 'none',
  }
}

/** FAB 展开旋转 90°（ADR-0108 已验证 transform）；reduced-motion 下不旋转。 */
const fabWrapStyle = computed<Record<string, string>>(() => ({
  transition: reducedMotion.value ? 'none' : 'transform 200ms cubic-bezier(.05,.7,.1,1)',
  transform: view.value.isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
}))

function dispatchToggle(): void { void globalFab.dispatch({ type: 'toggle' }) }
function dispatchClose(): void { void globalFab.dispatch({ type: 'close' }) }
function dispatchSelect(name: string): void { void globalFab.dispatch({ type: 'select', name }) }
function dispatchInner(item: { kind: 'refresh' | 'back-to-top' | 'extra'; key: string }): void {
  if (item.kind === 'refresh') void globalFab.dispatch({ type: 'refresh' })
  else if (item.kind === 'back-to-top') void globalFab.dispatch({ type: 'back-to-top' })
  else void globalFab.dispatch({ type: 'extra', key: item.key })
}
</script>

<template>
  <view v-if="view.visible" class="absolute inset-0 z-40 pointer-events-none">
    <!-- 遮罩：展开时覆盖，点空白收起 -->
    <view
      v-if="view.isOpen"
      class="absolute inset-0 z-10 bg-scrim pointer-events-auto"
      @tap="dispatchClose"
    />

    <!-- 外环：导航 tab（当前高亮 secondary-container） -->
    <view
      v-for="e in outerPair"
      :key="e.tab.name"
      class="absolute flex flex-col items-center justify-center rounded-full shadow-[var(--md-elevation-2)]"
      :class="e.tab.name === view.active ? 'bg-secondary-container' : 'bg-surface-container-high'"
      :style="ringStyle(e.x, e.y, e.i)"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="e.tab.a11yLabel"
      @tap="dispatchSelect(e.tab.name)"
    >
      <text
        class="leading-none"
        :class="e.tab.name === view.active ? 'text-secondary-on-container' : 'text-surface-on-variant'"
      >{{ e.tab.icon }}</text>
      <text
        class="leading-none mt-[2px]"
        :class="e.tab.name === view.active ? 'text-secondary-on-container' : 'text-surface-on-variant'"
        style="font-size: 9px"
      >{{ e.tab.label }}</text>
    </view>

    <!-- 内环：页面动作项（刷新/回顶/扩展） -->
    <view
      v-for="e in innerPair"
      :key="e.item.key"
      class="absolute flex items-center justify-center rounded-full bg-primary-container shadow-[var(--md-elevation-2)]"
      :style="ringStyle(e.x, e.y, e.i)"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="e.item.a11yLabel"
      @tap="dispatchInner(e.item)"
    >
      <text class="leading-none text-primary-on-container" style="font-size: 16px">{{ e.item.icon }}</text>
    </view>

    <!-- 主 FAB（M3 primary-container 56dp）：展开成 close，收起为当前 tab 图标；busy 时转圈/禁用 -->
    <view
      class="absolute z-30 pointer-events-auto flex items-center justify-center rounded-[var(--md-shape-large)] bg-primary-container shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
      :class="view.isBusy ? 'opacity-60' : ''"
      style="right: 4.267vw; bottom: 4.267vw; width: 14.933vw; height: 14.933vw"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="view.isOpen ? GLOBAL_FAB_A11Y_LABELS.close : GLOBAL_FAB_A11Y_LABELS.open"
      @tap="dispatchToggle"
    >
      <view :style="fabWrapStyle">
        <text
          class="leading-none text-primary-on-container"
          :class="{ 'fab-ring-spin': view.isBusy && !view.isOpen }"
          style="font-size: 22px"
        >{{ view.isOpen ? '✕' : fabIcon }}</text>
      </view>
    </view>
  </view>
</template>

<style>
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
