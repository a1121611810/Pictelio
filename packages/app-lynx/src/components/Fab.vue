<script setup lang="ts">
// ─── M3 浮动操作按钮（FAB，Material Design 3） ───
// 形态：56dp 圆形、primary-container 背景 + on-primary-container 图标、
// elevation-3 阴影。图标用 unicode 文本符号（Lynx 无 icon 库）。
// 放置：页面右下角（absolute 定位由调用方提供容器）。
const props = withDefaults(
  defineProps<{
    /** 图标 unicode 符号（默认 ↻ 刷新） */
    icon?: string
    /** accessibility-label（各页注册表传入） */
    a11yLabel?: string
  }>(),
  { icon: '↻', a11yLabel: '刷新' },
)
</script>

<template>
  <!-- 56dp=14.933vw 圆形 FAB；tap 走外层绑定（本组件不消费具体行为） -->
  <view
    class="w-[14.933vw] h-[14.933vw] rounded-full bg-primary-container flex items-center justify-center shadow-[var(--md-elevation-3)]"
    :accessibility-element="true"
    :accessibility-label="props.a11yLabel"
  >
    <text class="text-[6.4vw] leading-none text-primary-on-container">{{ props.icon }}</text>
  </view>
</template>
