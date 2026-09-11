<script setup lang="ts">
// AI 受限小说卡（ADR-0155）：AI 模式为「遮罩」时，小说列表中 AI 条目的等高占位卡。
// 接口只收 item（level 派生内部化：novel_ai_type===2 → 纯 AI，否则 AI 辅助）；
// 显式固定高度（全站统一常量，对齐 RestrictedNovelCard）——真机 Lynx 下 auto-height
// 在 list-item 测量中塌陷、文案被裁。无交互（不跳详情、点击不穿透）。
import type { PixivNovel } from "../api/types";
import AiOverlay from "./AiOverlay.vue";

// 全站统一高度（与 RestrictedNovelCard 一致）
const CARD_HEIGHT = "40vw";

const props = defineProps<{ item: PixivNovel }>();
</script>

<template>
  <view
    @tap.stop
    class="flex flex-row items-center justify-center m-1.5 mx-3 bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
    :style="{ height: CARD_HEIGHT }"
  >
    <AiOverlay :overlay="false" :ai-type="props.item.novel_ai_type ?? 0" />
  </view>
</template>
