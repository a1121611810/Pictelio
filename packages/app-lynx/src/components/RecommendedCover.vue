<script setup lang="ts">
// ─── 推荐轮播沉浸封面 = 深模块 CoverImage 的全 bleed 调用方（layout="full" + retry）───
// spec: app-lynx-cover-image-deep-module / ADR-0117。
// 三态（骨架/图片/失败+重试）+ aspectFill 等比 + 空src→failed 等全部行为由 CoverImage 承载，
// 本组件只做「全 bleed + 重试」的语义化快捷调用，不再自写状态机。
// T2 扩展（ADR-0118 决策 1 / spec §3.2）：新增可选 fit/ratio 透传——比例显示模式下 CoverImage 以
// width-fill 渲染（贴顶宽满按原图比例），接线由 Recommended.vue 在 T5 完成；本轮其余调用方不动。
import CoverImage from './CoverImage.vue'

withDefaults(
  defineProps<{
    /** 封面 URL（已过 proxyImageUrl）；空串视为失败 */
    src: string
    /** 显示方式：'cover' 全 bleed aspectFill 裁切（默认=现状）；'width-fill' 贴顶宽满按比例 */
    fit?: 'cover' | 'width-fill'
    /** width-fill 用：宽:高最简整数比字符串（如 "4 / 5"） */
    ratio?: string
  }>(),
  { fit: 'cover' },
)
</script>

<template>
  <CoverImage :src="src" :layout="'full'" :retry="true" :fit="fit" :ratio="ratio" />
</template>
