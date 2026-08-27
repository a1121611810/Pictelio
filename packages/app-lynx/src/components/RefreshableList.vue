<script setup lang="ts">
// RefreshableList —— 列表滚动操作容器（ADR-0107 刷新 FAB + ADR-0108 旋转动画 +
// ADR-0110 重建回顶 + ADR-0111 M3 FAB menu）。
//
// 接口（调用方需要知道的全部）：
//   :refresh      页面传入的幂等刷新函数（feed.refresh()+sync 或 fetchFirstPage）
//   :items        可选扩展菜单项（如「上一页/下一页」）：label/图标/visible 条件/回调，
//                 组件只渲染与维护菜单状态机（busy 互斥），不感知业务（T4）
//   @back-to-top  回顶项点击 → 页面应 bump 列表 :key 强制重建（重建即回顶，ADR-0110）
//   默认 slot     恰好一个可滚动子元素（<list>）
//
// 页面用法（列表操作全部内收组件）：
//   <RefreshableList
//     :refresh="refreshFeed"
//     :items="[{ key: 'prev', icon: '‹', label: '上一页', accessibilityLabel: '上一页',
//                visible: () => feed.hasPrev(), onTap: () => feed.prev() }]"
//     @back-to-top="listKey++"
//   >
//     <list :key="listKey" …>…</list>
//   </RefreshableList>
//
// 内部隐藏（页面零感知，禁止在页面重写）：
//   - 刷新：refreshing 内部态 + 防重入 guard + try/finally 复位 + FAB 旋转动画（ADR-0108）
//   - 回顶（ADR-0110）：点击「回顶」菜单项 → emit('back-to-top') → 页面 list :key 重建
//   - FAB menu（ADR-0111）：常态一个刷新 FAB；点击展开 scrim + 两项（刷新/回顶）；
//     主 FAB 变身为 close button；busy 时禁止展开。
//
// 平台事实（模拟器实测 2026-08-24，禁止回退）：
//   ① SelectorQuery 对 XElement 节点静默不命中（ADR-0107）；
//   ② <list> 不派发 per-frame scroll——@scroll/@scrollend/@scrollstatechange/
//      scroll-event-throttle 四路全零（ADR-0110）；
//   ③ <list> 无 JS 可触发的滚动属性 → 回顶 = 重建回顶。
//   ④ Lynx 无 transitionend → FAB menu 退出动画 v1 瞬撤（ADR-0111）。
import { ref, onUnmounted } from 'vue'
import { createFabMenuState, type FabMenuExtraItem } from '../primitives/createFabMenu'
import { FAB_MENU_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const props = defineProps<{
  /** 幂等刷新函数（createMixFeed 的 refresh() 内置 generation 竞态防护 + 15s TIMEOUT 保证 settle） */
  refresh: () => Promise<void> | void
  /** 可选扩展菜单项（T4）：组件只渲染 + busy 互斥，业务回调/显隐由页面提供 */
  items?: FabMenuExtraItem[]
}>()

const emit = defineEmits<{ (e: 'back-to-top'): void }>()

// ─── FAB menu 状态机（ADR-0111）：open + busy 互斥，纯逻辑 seam
const menu = createFabMenuState()

/** 刷新中：主 FAB 禁用态/旋转 + 防重入；与 menu.busy 同步 */
const refreshing = ref(false)

async function onRefreshItemTap() {
  if (refreshing.value || menu.isBusy) return
  menu.startRefresh()
  refreshing.value = true
  try {
    await props.refresh()
  } catch (err) {
    // 页面函数约定内部消化失败（createMixFeed 错误槽语义）；此处兜底防未处理 rejection
    console.warn('[RefreshableList] refresh 执行异常', err)
  } finally {
    refreshing.value = false
    menu.endRefresh()
  }
}

/** 主 FAB tap：展开/收起菜单（状态机内部处理 busy 互斥） */
function onFabTap() {
  menu.toggle()
}

/** 点 scrim 或点 close button 时收起 */
function onCloseMenu() {
  menu.close()
}

// ─── 回顶（ADR-0110）：防重入窗口内连点只重建一次
const BACK_TO_TOP_RESET_MS = 1000
const backToTopPending = ref(false)
let backToTopResetTimer: ReturnType<typeof setTimeout> | null = null
function clearBackToTopReset() {
  if (backToTopResetTimer !== null) {
    clearTimeout(backToTopResetTimer)
    backToTopResetTimer = null
  }
}
function onBackToTopItemTap() {
  if (backToTopPending.value) return
  menu.close()
  backToTopPending.value = true
  clearBackToTopReset()
  backToTopResetTimer = setTimeout(() => {
    backToTopResetTimer = null
    backToTopPending.value = false
  }, BACK_TO_TOP_RESET_MS)
  emit('back-to-top')
}

// ─── 扩展菜单项（T4）：点击后收起；返回 Promise 时复用 busy 维度（操作中禁展开/禁其他项，
//      与「刷新中」同一互斥规则——menu.busy=true 时 toggle()/open() no-op）
async function onExtraItemTap(item: FabMenuExtraItem) {
  if (refreshing.value || menu.isBusy) return
  menu.close()
  const result = item.onTap()
  if (result && typeof result.then === 'function') {
    menu.startRefresh() // 复用 busy 维度：异步操作期间 FAB 禁用、其他项不可点
    try {
      await result
    } catch (err) {
      // 页面函数约定内部消化失败（feed 错误槽语义）；此处兜底防未处理 rejection
      console.warn('[RefreshableList] 扩展菜单项执行异常', err)
    } finally {
      menu.endRefresh()
    }
  }
}
onUnmounted(() => {
  clearBackToTopReset()
  menu.reset()
})
</script>

<template>
  <!-- 容器 = 列表布局参与者（flex-1 min-h-0）+ FAB 定位上下文（relative）
       布局契约：slot 内 list 用 w-full h-full（相对本容器解析，V4 模拟器已验证） -->
  <view class="w-full flex-1 min-h-0 relative">
    <slot />

    <!-- scrim：展开时覆盖列表，点空白收起 -->
    <view
      v-if="menu.isOpen"
      class="absolute inset-0 z-10 bg-[var(--md-scrim)] scrim-in"
      @tap="onCloseMenu"
    />

    <!-- FAB menu 面板：两项 pill 形 medium button（M3 官方规格） -->
    <view
      v-if="menu.isOpen"
      class="absolute z-20 right-4 bottom-[20.267vw] flex flex-col items-end gap-[1.067vw]"
    >
      <!-- 刷新项：图标 ↻ + label -->
      <view
        class="menu-item item-rise-1 flex items-center gap-[2.133vw] h-[10.667vw] pl-[4.267vw] pr-[6.4vw] rounded-full bg-surface-container-high shadow-[var(--md-elevation-2)] active:shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="FAB_MENU_A11Y_LABELS.refreshList"
        @tap="onRefreshItemTap"
      >
        <text class="text-[4.8vw] leading-none text-on-surface-variant">↻</text>
        <text class="text-[3.733vw] leading-none text-on-surface">刷新</text>
      </view>

      <!-- 回顶项：图标 ↑ + label -->
      <view
        class="menu-item item-rise-2 flex items-center gap-[2.133vw] h-[10.667vw] pl-[4.267vw] pr-[6.4vw] rounded-full bg-surface-container-high shadow-[var(--md-elevation-2)] active:shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="FAB_MENU_A11Y_LABELS.backToTop"
        @tap="onBackToTopItemTap"
      >
        <text class="text-[4.8vw] leading-none text-on-surface-variant">↑</text>
        <text class="text-[3.733vw] leading-none text-on-surface">回顶</text>
      </view>

      <!-- 扩展项（T4）：页面按需配置（上一页/下一页等），visible 控制显隐；
           item-rise-extra 共用浮出动画（120ms 延迟，排在刷新/回顶之后）。
           用 template v-for 包裹（v-if 与 v-for 同元素是 Vue 3 反模式） -->
      <template v-for="item in props.items" :key="item.key">
        <view
          v-if="item.visible()"
          class="menu-item item-rise-extra flex items-center gap-[2.133vw] h-[10.667vw] pl-[4.267vw] pr-[6.4vw] rounded-full bg-surface-container-high shadow-[var(--md-elevation-2)] active:shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="item.accessibilityLabel"
          @tap="onExtraItemTap(item)"
        >
          <text class="text-[4.8vw] leading-none text-on-surface-variant">{{ item.icon }}</text>
          <text class="text-[3.733vw] leading-none text-on-surface">{{ item.label }}</text>
        </view>
      </template>
    </view>

    <!-- 主 FAB / close button（ADR-0111）：常态刷新 FAB，展开时变身为 close button
         56dp、primary-container、原位不动；busy 时禁用态 opacity 0.6 -->
    <view
      class="absolute z-30 bottom-4 right-4 w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container active:bg-layer-pressed-primary flex items-center justify-center shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
      :style="(refreshing || menu.isBusy) ? { opacity: 0.6 } : {}"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="FAB_MENU_A11Y_LABELS.toggleMenu"
      @tap="onFabTap"
    >
      <!-- 旋转承载元素 = 包裹 view（text 元素 transform 支持性弱，ADR-0108 决策 2）
           仅在非展开态且刷新中时旋转；展开态图标为 ✕，不旋转 -->
      <view :class="refreshing && !menu.isOpen ? 'fab-spin' : ''">
        <text class="text-[6.4vw] leading-none text-primary-on-container">
          {{ menu.isOpen ? '✕' : '↻' }}
        </text>
      </view>
    </view>
  </view>
</template>

<!-- 全局样式（与 App.vue shimmer 同机制，规避 scoped keyframes 在 Lynx 的未验证面）；
     类名 fab-spin / scrim-in / item-rise-* 全仓唯一。原生/web-core keyframes 已实证（ADR-0108） -->
<style>
@keyframes fab-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.fab-spin {
  animation: fab-spin 1s linear infinite;
}

/* scrim 淡入（ADR-0111）：展开动画 200ms */
@keyframes scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.scrim-in {
  animation: scrim-in 200ms var(--motion-emphasized-decelerate) both;
}

/* menu item 从 FAB top-trailing edge 浮出（ADR-0111） */
@keyframes item-rise {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.menu-item {
  transform-origin: right bottom;
}
.item-rise-1 {
  animation: item-rise 250ms var(--motion-emphasized-decelerate) 0ms both;
}
.item-rise-2 {
  animation: item-rise 250ms var(--motion-emphasized-decelerate) 60ms both;
}
/* 扩展菜单项浮出动画（T4）：排在刷新/回顶之后，延迟 120ms */
.item-rise-extra {
  animation: item-rise 250ms var(--motion-emphasized-decelerate) 120ms both;
}
</style>
