<script setup lang="ts">
// R18/R18G 受限条目遮罩（issue #91：过滤 → 遮罩）。
// 绝对定位铺满父容器（调用方需给父容器加 relative）；无任何交互——
// 不跳设置、无按钮、无提示，点击遮罩不响应也不应穿透到下层卡片的 tap。
// 玻璃样式单源：web-core 完整玻璃；原生 LynxView 静默忽略 backdrop-filter，
// --glassBg 的高不透明度自动退化为磨砂实色盖，功能无损。
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
        class="text-xs font-semibold text-onBrand px-2 py-0.5 rounded-[var(--borderRadiusSmall)]"
        :class="level === 2 ? 'bg-danger' : 'bg-warning'"
      >{{ badge }}</text>
      <text class="text-xs text-foreground-2 mt-2">该内容已在设置中隐藏</text>
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
  background-color: var(--glassBg);
  backdrop-filter: blur(var(--glassBlur)) saturate(var(--glassSaturate));
  border: 1px solid var(--glassBorder);
  border-radius: var(--borderRadiusXLarge);
}
</style>
