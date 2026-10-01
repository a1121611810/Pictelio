<script setup lang="ts">
// SheetShell —— 底部弹层壳（ADR-0211 决策 4；动效契约见 composables/useSheetDismiss.ts）
//
// 本组件是 BottomSheet 既有壳（scrim + 贴底面板 + 插槽）里**几何那部分**的可复用形态，
// 与 BottomSheet 的分工：
//   · BottomSheet = 「壳 + 标题栏 + × / 把手」的自绘弹层（4 个调用方共用，含未纳入本票的 NovelExportSheet）；
//   · SheetShell  = 只有「scrim + 面板 + 插槽」的几何壳，供自绘弹层复用（当前消费方 PagePickerSheet），
//     并**是全仓 sheet-*/dialog-* keyframes 的唯一定义方**（同类名跨组件复用的既有先例：
//     `scrim-in` 定义在 RefreshableList.vue、被 GlobalFab 消费）。
//
// 命中测试语义与 BottomSheet 逐条同款（ADR-0123 / ADR-0147，**禁止改动**）：
//   ① 根 absolute inset-0 只作定位上下文，自身不挂 @tap（scrim 全覆盖即交互面）；
//   ② scrim @tap 关闭（全屏层必须自身是交互面，原生 hit-testing 不识别 pointer-events）；
//   ③ 面板根 @tap.stop 防面板内点击穿透；
//   ④ z 序靠 DOM 顺序（scrim 在前、面板在后），不依赖 z-index。
//
// 时序（ADR-0211 决策 3 的两段式协议）：**本组件不自管挂载**，相位由 `phase` prop 接收
// （挂载由宿主页 v-if 控制，ADR-0123 卸载式显隐）；退场计时器在调用方的
// `useSheetDismiss()` 里，时长取与退场动画同源的 `holdMs`。
import { computed } from 'vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { SHEET_ANIMATION, useSheetMotion, type SheetMotionStyle } from '../composables/useSheetDismiss'
// 类型导入是本组件对外的注入口类型（reduced motion 偏好注入，见 useReducedMotion 头注的
// 「注入口」约定）；**不是**绕过统一能力——动效档位经 useSheetMotion → useMotion → useReducedMotion。
import type { UseReducedMotionOptions } from '../composables/useReducedMotion'

const props = withDefaults(
  defineProps<{
    /** 时序相位：enter 挂入场动画、exit 挂退场动画（由调用方的 useSheetDismiss 驱动） */
    phase?: 'enter' | 'exit'
    /** 面板类串（缺省 = 与 BottomSheet 同款：贴底 + 80vh + 大圆角 + 纵向 flex） */
    panelClass?: string
    /** scrim a11y 文案（缺省不渲染 a11y 属性——与 BottomSheet 的可选分支同款） */
    scrimAccessibilityLabel?: string
    /** 减弱动效偏好的注入口（单测 / 预览用；生产调用方不传） */
    motion?: UseReducedMotionOptions
  }>(),
  {
    phase: 'enter',
    panelClass:
      'absolute left-0 right-0 bottom-0 h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col',
  },
)

const emit = defineEmits<{
  /** 关闭请求（仅 scrim 点击；× / 把手 / 返回键由调用方或 BottomSheet 持有） */
  close: []
}>()

// ⚠️ 展开写法是必须的：`useReducedMotion` 用 hasOwnProperty 区分「显式注入 undefined」
// （声明本环境确定无 matchMedia）与「不传 → 自动探测宿主」。写成
// `{ names, matchMedia: props.motion?.matchMedia }` 会恒为「显式注入 undefined」，
// 真机上的 matchMedia 永远读不到 ⇒ 偏好形同虚设（且每次挂载都多一条 warn）。
const motion = useSheetMotion({ names: SHEET_ANIMATION, ...(props.motion ?? {}) })

/** 面板动画（一次性播放，inline 通道；R2 降级时值为 none） */
const panelStyle = computed<SheetMotionStyle>(() => motion.panelStyle(props.phase))
/** 遮罩动画（与面板分名：遮罩只淡入淡出，不跟随位移） */
const scrimStyle = computed<SheetMotionStyle>(() => motion.scrimStyle(props.phase))
</script>

<template>
  <!-- 根层：定位上下文（与 BottomSheet 同款形态），自身不挂 @tap -->
  <view class="absolute inset-0">
    <!-- scrim：@tap 关闭；a11y 可选（缺省 = 无 a11y 属性，与 BottomSheet 现状差分同款） -->
    <view
      v-if="scrimAccessibilityLabel"
      class="absolute inset-0 bg-scrim"
      :style="scrimStyle"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="scrimAccessibilityLabel"
      @tap="emit('close')"
    />
    <view v-else class="absolute inset-0 bg-scrim" :style="scrimStyle" @tap="emit('close')" />

    <!-- 面板：@tap.stop 防穿透；几何由 panelClass 决定（顶部锚定 / 定高等变体各自传入） -->
    <view :class="panelClass" :style="panelStyle" @tap.stop>
      <slot />
    </view>
  </view>
</template>

<!-- keyframes 全局生效（与 App.vue shimmer / RefreshableList 的 fab-spin 同机制：
     规避 scoped keyframes 在 Lynx 的未验证面）。类名全仓唯一，定义方即本文件。
     ⚠️ 帧体里**只写 transform / opacity**，不写 animation 简写：时长与曲线一律由
     composables/motion.ts 的预设拼装后经 inline :style 下发（唯一入口纪律）。
     ⚠️ 面板位移的「持续跟手」形态必须走 inline :style（transform 族 Tailwind 工具类是死类名，
     ADR-0210 路径 E）；一次性播放的入场/退场动画则可以在帧体里手写 transform（已实证）。 -->
<style>
/* Bottom sheet panel: slide up from below on enter, slide back down on exit. */
@keyframes sheet-enter {
  from {
    opacity: 0;
    transform: translateY(100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes sheet-exit {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(100%);
  }
}
/* Scrim: opacity only. Kept separate from the panel pair so the scrim never translates. */
@keyframes sheet-scrim-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes sheet-scrim-exit {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
/* Centered dialog: scale + fade (not a slide) because its geometry is not bottom-anchored. */
@keyframes dialog-enter {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes dialog-exit {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.92);
  }
}
</style>
