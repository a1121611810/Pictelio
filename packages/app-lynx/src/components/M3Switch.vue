<!-- ─── app-lynx M3 switch single source of truth ───
     spec: docs/specs/app-lynx-m3-switch.md §4
     ADR: docs/adr/ADR-0179-app-lynx-m3-switch-component.md
     Interface: { checked: boolean } prop only — no emit, no a11y bindings
     ─────────────────────────────────────────────────── -->
<script setup lang="ts">
import { useReducedMotion } from '../composables/useReducedMotion'

interface Props {
  /** 受控状态：调用方拥有 source of truth（来自 settingsStore / storeToRefs） */
  checked: boolean
}
defineProps<Props>()

/** 减弱动效偏好（T03 #851）：R1 —— 偏好开启时整组 transition 类不挂（时长归零 = 状态瞬切），
 *  颜色终态本身照常切换（颜色过渡不触发前庭反应）。降级规则见 composable 头注。 */
const { reducedMotion } = useReducedMotion()

/** 轨道动效类串：几何与配色常在，transition 组按偏好挂（防未来漏挂新类时静默失效） */
const TRACK_MOTION_CLASS =
  'transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]'

/** 内部私有纯函数——组件自测专用，不进公开接口（spec §4.3 / §5.2） */
function trackClass(checked: boolean): string {
  return checked
    ? 'bg-primary justify-end'
    : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'
}

/** 内部私有纯函数——组件自测专用，不进公开接口（spec §4.3 / §5.2） */
function thumbClass(checked: boolean): string {
  return checked
    ? 'w-[6.4vw] h-[6.4vw] bg-primary-on'
    : 'w-[4.267vw] h-[4.267vw] bg-outline'
}
</script>

<template>
  <view
    class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center flex-shrink-0"
    :class="[reducedMotion ? '' : TRACK_MOTION_CLASS, trackClass(checked)]"
  >
    <!-- handle-container：32×32 与轨道同高，thumb 居中 → 距边 8px/4px -->
    <view class="w-8 h-8 flex items-center justify-center">
      <view
        class="rounded-full active:w-[7.467vw] active:h-[7.467vw]"
        :class="thumbClass(checked)"
      />
    </view>
  </view>
</template>
