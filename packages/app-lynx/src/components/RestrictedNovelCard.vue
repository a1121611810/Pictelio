<script setup lang="ts">
// 受限小说卡（ADR-0105）：小说列表中受限条目的等高占位卡。
// 接口只收 item（level 派生内部化：x_restrict===2 → R-18G，否则 R-18，调用方不再重复三元表达式）；
// 显式固定高度（全站统一常量）——真机 Lynx 下 auto-height 在 list-item 测量中塌陷、
// 「受浏览限制，不予显示」文案被裁，必须显式高度。无交互（不跳详情、点击不穿透）。
import type { PixivNovel } from '../api/types'
import RestrictOverlay from './RestrictOverlay.vue'

// 全站统一高度（≈普通小说卡常见高度中间值；真机截图校准后微调，只改这一处）
const CARD_HEIGHT = '40vw'

const props = defineProps<{ item: PixivNovel }>()
const level = props.item.x_restrict === 2 ? 2 : 1
</script>

<template>
  <view
    @tap.stop
    class="flex flex-row items-center justify-center m-1.5 mx-3 bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
    :style="{ height: CARD_HEIGHT }"
  >
    <RestrictOverlay :overlay="false" :level="level" />
  </view>
</template>
