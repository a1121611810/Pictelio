<script lang="ts">
// 模块级实例计数器（本 <script> 块每模块执行一次；<script setup> 顶层是 per-instance，
// 放那里会导致同页双列表（Bookmarks/UserHome）同 id，SelectorQuery 串台）
let refreshableListSeq = 0
</script>

<script setup lang="ts">
// RefreshableList —— 下拉刷新容器（ADR-0106，深模块）。
//
// 接口（调用方需要知道的全部）：
//   :refreshing  外部驱动的刷新态；true→false 时组件调 finishRefresh() 收起 header
//   @refresh     用户下拉过阈值（原生 startrefresh）或点击 web-only 刷新按钮
//   默认 slot    恰好一个可滚动子元素（<list>，<refresh> 的硬约束）
//
// 页面用法（try/finally 保证失败也收起 header）：
//   const refreshing = ref(false)
//   async function onRefresh() {
//     refreshing.value = true
//     try { await feed.refresh(); sync() } finally { refreshing.value = false }
//   }
//
// 内部隐藏（页面零感知，禁止在页面重写）：
//   isNativeMode 双端分支 / <refresh>+<refresh-header> 结构 / header 双态文案 /
//   SelectorQuery finishRefresh 调用 / 15s 卡死兜底 / web-only 刷新按钮。
// 红线：页面禁止直接写 <refresh> 标签——web-core 无 refresh→x-refresh-view 标签映射
// （web-core 0.20.3/0.23.1 client.js 实证），裸写会破坏预览布局。
import { ref, watch, onUnmounted } from 'vue'
import { isNativeMode } from '../api/client'
import { REFRESH_A11Y_LABELS } from '../utils/accessibility'

const props = defineProps<{ refreshing: boolean }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

// setup 期一次性判定（非响应式）：web-core 预览恒为 false（无 NativeModules）
const native = isNativeMode()

// 实例唯一 id：SelectorQuery 按 id 定位（Bookmarks/UserHome 双列表同页共存不串）
const refreshId = `ptr-${++refreshableListSeq}`

// refreshstatechange 的 state 值（oracle：xelement-refresh-4.0.1 字节码常量）：
// 0=IDLE / 1=DRAG_RELEASE / 2=REFRESHING
const REFRESH_STATE_REFRESHING = 2
/** header 双态：REFRESHING → spinner+「刷新中…」；其余 →「下拉刷新」 */
const headerRefreshing = ref(false)

function onRefreshStateChange(e: { state?: number }) {
  headerRefreshing.value = e?.state === REFRESH_STATE_REFRESHING
}

function onStartRefresh() {
  emit('refresh')
}

/** 原生方法调用（GlassCard.vue 已验证的 invoke 模式）；web 分支不调用 */
function finishRefresh() {
  if (!native) return
  const q = lynx?.createSelectorQuery?.()
  if (!q) return
  q.select(`#${refreshId}`).invoke({
    method: 'finishRefresh',
    params: {},
    fail: () => console.warn('[RefreshableList] finishRefresh invoke 失败'),
  })
  q.exec()
}

// 15s 卡死兜底（对齐 createMixFeed TIMEOUT_MS）：refreshing 长时间未归位 = 页面 finally
// 失效或 invoke 静默失败，强制收 header 防手势通道永久锁死。warn 可见（禁止静默降级）。
const WATCHDOG_MS = 15000
let watchdog: ReturnType<typeof setTimeout> | null = null

function clearWatchdog() {
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

watch(
  () => props.refreshing,
  (refreshing, was) => {
    if (!native) return
    if (refreshing) {
      clearWatchdog()
      watchdog = setTimeout(() => {
        watchdog = null
        if (props.refreshing) {
          console.warn('[RefreshableList] refreshing 超 15s 未归位，强制 finishRefresh（页面 finally 失效？）')
          finishRefresh()
        }
      }, WATCHDOG_MS)
    } else if (was) {
      clearWatchdog()
      finishRefresh()
    }
  },
)

onUnmounted(clearWatchdog)
</script>

<template>
  <!-- 原生分支：<refresh> 包裹唯一可滚动子元素（slot 的 <list>）+ 可自定义 header -->
  <refresh
    v-if="native"
    :id="refreshId"
    class="w-full flex-1 min-h-0"
    :enable-refresh="true"
    @startrefresh="onStartRefresh"
    @refreshstatechange="onRefreshStateChange"
  >
    <refresh-header class="w-full h-16 flex flex-row items-center justify-center">
      <view v-if="headerRefreshing" class="ptr-spinner" />
      <text class="text-body-medium text-outline">{{ headerRefreshing ? '刷新中…' : '下拉刷新' }}</text>
    </refresh-header>
    <slot />
  </refresh>

  <!-- web-core 分支：裸 slot 透传（无手势），内建 web-only 刷新按钮走同一 @refresh 通道。
       样式沿用已删除的 Fab.vue（ADR-0106 D4）：M3 FAB 56dp=14.933vw、shape-large、
       primary-container、elevation-3，位置统一 bottom-[24vw] right-4（避开底部导航） -->
  <template v-else>
    <slot />
    <view
      class="absolute bottom-[24vw] right-4 w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container active:bg-layer-pressed-primary flex items-center justify-center shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
      :style="props.refreshing ? { opacity: 0.6 } : {}"
      :accessibility-element="true"
      :accessibility-label="REFRESH_A11Y_LABELS.refreshList"
      @tap="onStartRefresh"
    >
      <text class="text-[6.4vw] leading-none text-primary-on-container">↻</text>
    </view>
  </template>
</template>

<style scoped>
/* spinner：CSS keyframes 旋转圆弧（与 shimmer 同机制，web-core 已实测支持；
   原生 LynxView 动画支持随本组件模拟器验收一并确认，ADR-0106 待验证项） */
@keyframes ptr-rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
.ptr-spinner {
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  border-width: 2px;
  border-style: solid;
  border-color: var(--md-outline);
  border-top-color: transparent;
  animation: ptr-rotate 1s linear infinite;
  margin-right: 8px;
}
</style>
