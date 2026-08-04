<script setup lang="ts">
// R18/R18G 受限条目遮罩（issue #91：过滤 → 遮罩；issue #97：伪玻璃三件套）。
// 绝对定位铺满父容器（调用方需给父容器加 relative）；无任何交互——
// 不跳设置、无按钮、无提示，点击遮罩不响应也不应穿透到下层卡片的 tap。
// 伪玻璃（Frosted Card）：半透底 + 顶部高光 + inset 内发光，全部 Lynx 确认支持，
// web-core 与原生 LynxView 观感一致（放弃 backdrop-filter，见 liquid-glass 可行性报告）。
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
      <text class="text-xs text-foreground-2 mt-2">受浏览限制，不予显示</text>
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
  /* 伪玻璃三件套（issue #97 方案 A，全部 Lynx 确认支持，双端观感一致）：
     半透底 + 顶部高光渐变 + inset 内发光/外阴影 */
  background-color: var(--glassBgMuted);
  background-image: var(--glassHighlight);
  box-shadow: var(--glassEdge);
  border: 1px solid var(--glassBorder);
  border-radius: var(--borderRadiusXLarge);
}
</style>
