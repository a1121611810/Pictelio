<script setup lang="ts">
// ─── UI 原型切换条（仅 web 预览入口使用，生产 bundle 不包含） ───
// 浮动底部居中：左箭头 / 当前变体标签 / 右箭头，点击循环切换。
// lynx web-core 环境限制：worker 内读不到 URL query、收不到窗口键盘事件 → 内存 ref + 点击切换。
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
  <!-- 高对比 pill（深底 + 反色文字），明显区别于被评审的页面设计 -->
  <view
    style="position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: row; align-items: center; gap: 8px; background-color: rgba(0, 0, 0, 0.75); border-radius: 999px; padding: 8px 16px; z-index: 50;"
  >
    <text
      style="color: #ffffff; font-size: 18px; padding: 0 8px;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      accessibility-label="上一个变体"
      @tap="cycle(-1)"
    >
      ‹
    </text>
    <text style="color: #ffffff; font-size: 12px;">
      {{ current }} — {{ variants.find((v) => v.key === current)?.name }}
    </text>
    <text
      style="color: #ffffff; font-size: 18px; padding: 0 8px;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      accessibility-label="下一个变体"
      @tap="cycle(1)"
    >
      ›
    </text>
  </view>
</template>
