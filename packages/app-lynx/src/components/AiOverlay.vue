<script setup lang="ts">
// AI 作品遮罩（ADR-0155）：AI 模式为「遮罩」时，列表卡/详情对 AI 条目盖 scrim 遮罩。
//
// 两种用法（与 RestrictOverlay 一致）：
// - overlay（默认 true）：绝对定位铺满父容器（详情页用，调用方需给父容器加 relative）。
// - overlay=false：纯流内徽章块（列表卡用，调用方自备 bg-scrim 背景与尺寸）——真机
//   LynxView 下 absolute 子元素会被 list item 高度测量算进内容高度，列表卡必须用此模式。
// 无任何交互——不跳设置、无按钮，点击不响应也不穿透到下层卡片。
// M3 形态：scrim 半透明黑遮罩 + 中央 AI 徽章（纯 AI=secondary-container / AI 辅助同款）+ 文案。
const props = defineProps<{
  /** Pixiv ai_type 原始值：0/undefined=非 AI，1=AI 辅助，2=纯 AI（徽章文案单点派生） */
  aiType: number;
  /** false = 纯流内徽章块（列表卡用，调用方自备 bg-scrim 背景与尺寸）；默认 true = 绝对定位覆盖 */
  overlay?: boolean;
}>();

const badge = props.aiType === 2 ? "AI" : "AI辅助";

// 空处理器：阻止 tap 穿透触发下层卡片的 openDetail
function swallow() {}
</script>

<template>
  <view
    class="ai-overlay"
    :class="overlay === false ? 'ai-overlay-inline' : ''"
    @tap="overlay === false ? undefined : swallow"
  >
    <view class="flex flex-col items-center">
      <text
        class="text-label-medium font-semibold px-2 py-0.5 rounded-[var(--md-shape-extra-small)] bg-secondary-container text-secondary-on-container"
        >{{ badge }}</text
      >
      <text class="text-label-medium text-[var(--colorOverlayForeground)] opacity-80 mt-2"
        >AI 作品，已在设置中遮罩</text
      >
    </view>
  </view>
</template>

<style scoped>
.ai-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* [lynx:fix] 显式 width/height 100%：真机 LynxView 下仅靠四边推算尺寸不可靠 */
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--md-scrim);
  border-radius: var(--md-shape-medium);
}

/* 列表卡流内模式：无定位、无背景——背景与尺寸由调用方 bg-scrim 卡提供 */
.ai-overlay-inline {
  position: static;
  width: auto;
  height: auto;
  background: none;
  border-radius: 0;
}
</style>
