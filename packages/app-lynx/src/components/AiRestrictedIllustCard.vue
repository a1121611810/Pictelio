<script setup lang="ts">
// AI 受限插画卡（ADR-0155）：AI 模式为「遮罩」时，插画列表中 AI 条目的方形占位图区。
// 接口只收 item（ai_type 原值直接透传给 AiOverlay，徽章派生单点化）；
// 显式 h-[48.4vw]（= 卡片宽，保持方形，对齐插画列表既有受限图区）——真机 Lynx 下
// aspect-ratio 在 list-item 测量中不可靠。无交互（不跳详情、点击不穿透）。
import type { PixivIllust } from "../api/types";
import AiOverlay from "./AiOverlay.vue";

const props = defineProps<{ item: PixivIllust }>();
</script>

<template>
  <view
    @tap.stop
    class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
  >
    <AiOverlay :overlay="false" :ai-type="props.item.illust_ai_type ?? 0" />
  </view>
</template>
