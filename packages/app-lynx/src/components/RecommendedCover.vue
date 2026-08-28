<script setup lang="ts">
// ─── 推荐轮播沉浸封面 = 深模块 CoverImage 的全 bleed 调用方（layout="full" + retry）───
// spec: app-lynx-cover-image-deep-module / ADR-0117。
// 三态（骨架/图片/失败+重试）+ aspectFill 等比 + 空src→failed 等全部行为由 CoverImage 承载，
// 本组件只做「全 bleed + 重试」的语义化快捷调用，不再自写状态机。
import CoverImage from './CoverImage.vue'

defineProps<{
  /** 封面 URL（已过 proxyImageUrl）；空串视为失败 */
  src: string
}>()
</script>

<template>
  <CoverImage :src="src" :layout="'full'" :retry="true" />
</template>
