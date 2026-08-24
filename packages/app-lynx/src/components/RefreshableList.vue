<script setup lang="ts">
// RefreshableList —— 列表滚动操作容器（ADR-0107 刷新 FAB + ADR-0108 旋转动画 +
// ADR-0110 回顶按钮，深模块）。
//
// 接口（调用方需要知道的全部）：
//   :refresh      页面传入的幂等刷新函数（feed.refresh()+sync 或 fetchFirstPage）
//   @back-to-top  回顶按钮点击 → 页面应 bump 列表 :key 强制重建（重建即回顶，ADR-0110）
//   默认 slot     恰好一个可滚动子元素（<list>）
//
// 页面用法（刷新状态机 + 回顶逻辑全部内收组件）：
//   <RefreshableList :refresh="refreshFeed" @back-to-top="listKey++">
//     <list :key="listKey" …>…</list>
//   </RefreshableList>
//
// 内部隐藏（页面零感知，禁止在页面重写）：
//   刷新：refreshing 内部态 + 防重入 guard + try/finally 复位 + FAB 旋转动画（ADR-0108）
//   回顶（ADR-0110）：常驻 small FAB + 挂载入场动画 + tap 触发重建回顶
//
// 平台事实（模拟器实测 2026-08-24，禁止回退）：
//   ① SelectorQuery 对 XElement 节点静默不命中（ADR-0107）；
//   ② <list> 不派发 per-frame scroll——@scroll/@scrollend/@scrollstatechange/
//      scroll-event-throttle 四路全零（ADR-0110）；
//   ③ <list> 无 JS 可触发的滚动属性（直绑滚动属性为 scroll-view 专有、initial-
//      scroll-index 仅初始化生效）→ 回顶按钮常驻 + 重建回顶（ADR-0110）。
import { ref, onUnmounted } from 'vue'
import { REFRESH_A11Y_LABELS, BACK_TO_TOP_A11Y_LABELS } from '../utils/accessibility'

const props = defineProps<{
  /** 幂等刷新函数（createMixFeed 的 refresh() 内置 generation 竞态防护 + 15s TIMEOUT 保证 settle） */
  refresh: () => Promise<void> | void
}>()

/** 刷新中：FAB 禁用态（opacity 0.6）+ 防重入；仅反映 FAB 发起的刷新（onMounted/watch 补拉不点亮） */
const refreshing = ref(false)

async function onTap() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await props.refresh()
  } catch (err) {
    // 页面函数约定内部消化失败（createMixFeed 错误槽语义）；此处兜底防未处理 rejection
    // 静默消失（测试硬约束 #3：降级/异常必须 warn 可见）
    console.warn('[RefreshableList] refresh 执行异常', err)
  } finally {
    refreshing.value = false
  }
}

// ─── 回顶（ADR-0110 常驻版） ───
// 平台事实（模拟器实证 2026-08-24）：<list> 无 per-frame scroll、无直绑滚动属性、
// initial-scroll-index 仅初始化生效——JS 无法平滑滚动 list。actuation = 页面 list
// :key 重建（emit('back-to-top') → 页面 @back-to-top="listKey++"，重建即回顶，
// 与刷新同机制已验证）。防重入窗口内连点只重建一次。
const emit = defineEmits<{ (e: 'back-to-top'): void }>()
const BACK_TO_TOP_RESET_MS = 1000
const backToTopPending = ref(false)
let backToTopResetTimer: ReturnType<typeof setTimeout> | null = null
function clearBackToTopReset() {
  if (backToTopResetTimer !== null) {
    clearTimeout(backToTopResetTimer)
    backToTopResetTimer = null
  }
}
function onBackToTopTap() {
  if (backToTopPending.value) return // 防重入窗口内忽略连点
  backToTopPending.value = true
  clearBackToTopReset()
  backToTopResetTimer = setTimeout(() => {
    backToTopResetTimer = null
    backToTopPending.value = false
  }, BACK_TO_TOP_RESET_MS)
  emit('back-to-top')
}
onUnmounted(clearBackToTopReset)
</script>

<template>
  <!-- 容器 = 列表布局参与者（flex-1 min-h-0）+ FAB 定位上下文（relative）；
       容器底边 = 内容区底边（底部导航顶边），FAB 不遮导航。
       布局契约：slot 内 list 用 w-full h-full（相对本容器解析，V4 模拟器已验证）；
       patch 错位 workaround（list 强制重建 :key）在页面侧与数据替换同 tick——
       组件内异步 bump 的 flush 排在 items 替换之后，仍会触发错误 patch（实测，ADR-0107 D4） -->
  <view class="w-full flex-1 min-h-0 relative">
    <slot />
    <!-- 刷新 FAB（ADR-0107/0108）：M3 FAB 56dp；刷新中图标旋转 + opacity 0.6 -->
    <view
      class="absolute bottom-6 right-4 w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container active:bg-layer-pressed-primary flex items-center justify-center shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
      :style="refreshing ? { opacity: 0.6 } : {}"
      :accessibility-element="true"
      :accessibility-label="REFRESH_A11Y_LABELS.refreshList"
      @tap="onTap"
    >
      <!-- 旋转承载元素 = 包裹 view（text 元素 transform 支持性弱，ADR-0108 决策 2）；
           动画类与 refreshing 同源，刷新结束移除复位 0° -->
      <view :class="refreshing ? 'fab-spin' : ''">
        <text class="text-[6.4vw] leading-none text-primary-on-container">↻</text>
      </view>
    </view>

    <!-- 回顶按钮（ADR-0110 常驻版）：M3 small FAB 40dp，叠于刷新 FAB 上方
         （bottom = FAB 底距 6.4vw + FAB 高 14.933vw + 间距 ~4.3vw）；常驻显示，
         挂载入场动画；点击触发重建回顶 -->
    <view
      class="back-to-top-in absolute right-4 bottom-[25.6vw] w-[10.667vw] h-[10.667vw] rounded-full bg-surface-container-high active:bg-layer-pressed-on-surface flex items-center justify-center shadow-[var(--md-elevation-2)] active:shadow-[var(--md-elevation-1)]"
      :accessibility-element="true"
      :accessibility-label="BACK_TO_TOP_A11Y_LABELS.backToTop"
      @tap="onBackToTopTap"
    >
      <text class="text-[5.33vw] leading-none text-on-surface">↑</text>
    </view>
  </view>
</template>

<!-- 全局样式（与 App.vue shimmer 同机制，规避 scoped keyframes 在 Lynx 的未验证面）；
     类名 fab-spin / back-to-top-in 全仓唯一。原生 keyframes 已实证（ADR-0108） -->
<style>
@keyframes fab-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.fab-spin {
  animation: fab-spin 1s linear infinite;
}

/* 回顶按钮入场动画（ADR-0110 决策 5）：fade + 上滑 + 微缩放，200ms M3 emphasized-decelerate。
   挂载即播一次（常驻无隐藏，无退场动画） */
@keyframes back-to-top-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.back-to-top-in {
  animation: back-to-top-in 200ms var(--motion-emphasized-decelerate) both;
}
</style>
