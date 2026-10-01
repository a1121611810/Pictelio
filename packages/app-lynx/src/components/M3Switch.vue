<!-- ─── app-lynx M3 switch single source of truth ───
     spec: docs/specs/app-lynx-m3-switch.md §4
     ADR: docs/adr/ADR-0179-app-lynx-m3-switch-component.md
     Interface: { checked: boolean } prop only — no emit, no a11y bindings
     ─────────────────────────────────────────────────── -->
<script setup lang="ts">
import { computed } from 'vue'
import { MOTION_CLASS, press, useMotion } from '../composables/motion'

interface Props {
  /** 受控状态：调用方拥有 source of truth（来自 settingsStore / storeToRefs） */
  checked: boolean
}
defineProps<Props>()

/** 动效与偏好统一入口（ADR-0211 决策 1 / 9）：R1 —— 偏好开启时过渡组整条不挂 / 置 `none`
 *  （时长归零 = 状态瞬切），颜色与几何终态本身照常切换。降级规则见 composable 头注。 */
const { reduced, pressSize } = useMotion()

/** 轨道动效类串：**取自 `motion.ts` 的字面量登记表**（ADR-0211 决策 1「动效唯一入口」）。
 * 组件内不得再写时长/曲线工具类——本行只是**引用**，档位与曲线的取定、登记与降级全在
 * `composables/motion.ts` 的 `MOTION_CLASS.switchTrack`（200ms + standard，出处见该条注释）。
 * 几何与配色常在，过渡组按偏好挂（防未来漏挂新类时静默失效）。 */
const TRACK_MOTION_CLASS = MOTION_CLASS.switchTrack

/** thumb 按压（16/24dp → 28dp）的过渡载体：**inline `:style`**，不挂工具类。
 *  依据 ADR-0211 决策 2 映射表末行——按压态改的是 w/h 两个尺寸属性，
 *  `.transition-colors` 的 transition-property 只含 background-color / border-color / color，
 *  **不含 width / height**，挂上去是静默失效（构建全绿、真机仍是 0ms 瞬变）。
 *  两条 transition 值分别取自 press() 的 width 档与 height 档（同为 fast + standard），
 *  此处只做逗号拼接，不引入任何时长/曲线字面量。 */
const thumbTransition = computed(() =>
  reduced.value ? 'none' : `${pressSize.value.transition}, ${press({ property: 'height' }).transition}`,
)


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
    :class="[reduced ? '' : TRACK_MOTION_CLASS, trackClass(checked)]"
  >
    <!-- handle-container：32×32 与轨道同高，thumb 居中 → 距边 8px/4px -->
    <view class="w-8 h-8 flex items-center justify-center">
      <view
        class="rounded-full active:w-[7.467vw] active:h-[7.467vw]"
        :class="thumbClass(checked)"
        :style="{ transition: thumbTransition }"
      />
    </view>
  </view>
</template>
