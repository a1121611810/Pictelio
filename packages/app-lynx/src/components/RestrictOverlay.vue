<script setup lang="ts">
// R18/R18G 受限条目遮罩（issue #91：过滤 → 遮罩；M3 化改造）。
// 绝对定位铺满父容器（调用方需给父容器加 relative）；无任何交互——
// 不跳设置、无按钮、无提示，点击遮罩不响应也不应穿透到下层卡片的 tap。
// M3 形态：scrim 半透明黑遮罩 + 中央徽章（R-18=error-container / R-18G=error）。
const props = defineProps<{
  level: 1 | 2
}>()

const badge = props.level === 2 ? 'R-18G' : 'R-18'

// 空处理器：阻止 tap 穿透触发下层卡片的 openDetail（web-core 实测若仍穿透，改 .stop）
function swallow() {}
</script>

<template>
  <view class="restrict-overlay" @tap="swallow">
    <view class="flex flex-col items-center">
      <text
        class="text-label-medium font-semibold px-2 py-0.5 rounded-[var(--md-shape-extra-small)]"
        :class="level === 2 ? 'bg-error text-error-on' : 'bg-error-container text-error-on-container'"
      >{{ badge }}</text>
      <text class="text-label-medium text-white mt-2" style="opacity: 0.8">受浏览限制，不予显示</text>
    </view>
  </view>
</template>

<style scoped>
.restrict-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* M3 scrim：半透明黑遮罩（Lynx 确认支持纯色 + 透明度），替代原伪玻璃 */
  background-color: var(--md-scrim);
  border-radius: var(--md-shape-medium);
}
</style>
