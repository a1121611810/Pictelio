<script setup lang="ts">
// ─── 图片级骨架屏 = 深模块 CoverImage 的 layout="box" 薄盒适配器 ───
// spec: app-lynx-cover-image-deep-module / ADR-0117。
// 各列表/详情页的盒图（方形/详情比例/显式高度）仍用 SkeletonImage 接口，内部经 CoverImage（layout="box"）
// 承载三态，避免重复状态机/模板。10 处调用实例接口不变（ADR-0129 复核）。
import CoverImage from './CoverImage.vue'

defineProps<{
  src: string
  /** 容器宽高比：列表方形 "1 / 1"，详情页用 API 的 `${width} / ${height}`；传 height 时可不传（issue #138） */
  aspectRatio?: string
  /** 可选 min-height 兜底（vw 字符串，如 "40vw"），防 aspect-ratio 不生效时高度塌陷（ADR-0045） */
  minH?: string
  /** 显式容器高度（vw 字符串，如 "48.4vw"）：原生 LynxView 下 aspect-ratio 容器内 <image> 的百分比高度解析为 0，显式 height 可规避（issue #138） */
  height?: string
  /** 懒加载（默认开启）：列表卡片传 true，详情大图（首屏即需）可不传 */
  lazyLoad?: boolean
  /** 盒图 @load 后按图片实际比例修正容器高度（占位 height → 实际比例，ADR-0129 多图详情列表）。默认 false=现状 */
  correctHeightOnLoad?: boolean
}>()
</script>

<template>
  <CoverImage
    :src="src"
    :layout="'box'"
    :aspect-ratio="aspectRatio"
    :min-h="minH"
    :height="height"
    :lazy-load="lazyLoad"
    :correct-height-on-load="correctHeightOnLoad"
  />
</template>
