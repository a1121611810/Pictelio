<script setup lang="ts">
// ─── UI 原型切换条（仅 web 预览入口使用，生产 bundle 不包含） ───
// 浮动底部居中：左箭头 / 当前变体标签 / 右箭头，点击循环切换。
// lynx web-core 环境限制：worker 内读不到 URL query（__web_preview 只认 casename），
// 也收不到 window 键盘事件 → 用内存 ref + 点击切换，URL 持久化与键盘 ←/→ 降级为注释说明。
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const props = defineProps<{
  variants: { key: string; name: string }[]
  current: string
}>()
const emit = defineEmits<{ change: [key: string] }>()

function cycle(dir: 1 | -1): void {
  const i = props.variants.findIndex((v) => v.key === props.current)
  const next = props.variants[(i + dir + props.variants.length) % props.variants.length]
  emit('change', next.key)
}
</script>

<template>
  <!-- 高对比 pill（overlay 深底 + 反色文字），明显区别于被评审的页面设计 -->
  <view
    class="absolute bottom-[6vw] left-1/2 -translate-x-1/2 z-50 flex flex-row items-center gap-2 rounded-full px-3 py-2"
    style="background-color: var(--colorOverlayDark)"
  >
    <text
      class="text-onBrand text-lg px-2 leading-none"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      accessibility-label="上一个变体"
      @tap="cycle(-1)"
    >
      ‹
    </text>
    <text class="text-onBrand text-xs whitespace-nowrap">
      {{ current }} — {{ variants.find((v) => v.key === current)?.name }}
    </text>
    <text
      class="text-onBrand text-lg px-2 leading-none"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      accessibility-label="下一个变体"
      @tap="cycle(1)"
    >
      ›
    </text>
  </view>
</template>
