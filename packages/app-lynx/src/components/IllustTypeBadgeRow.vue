<script setup lang="ts">
// 类型徽章行（ADR-0113 / spec: docs/specs/work-type-badges.md）。
// 流内徽章行：图片下方、标题上方，仅在有徽章时渲染（普通单图零占位）。
// M3 assist-chip 形态：unicode 图标 + 文字（沿用 NavigationBar 的 unicode 图标约定），
// secondary-container 底 / label-medium / md-shape-small 圆角，全 Tailwind utility 无 scoped CSS。
// 判定收敛在 ./illustTypeBadges 纯函数，本组件只做渲染。
// [lynx:fix] 严禁 absolute 定位——list-item 内 absolute 子元素会被真机高度测量
// 算进内容高度（CONTEXT.md「遮罩」词条，2026-08-11 实测）。
import { computed } from 'vue'
import { resolveIllustTypeBadges, type IllustTypeBadgeSource } from './illustTypeBadges'

const props = defineProps<{
  /** 判定所需最小字段集（PixivIllust 结构兼容） */
  illust: IllustTypeBadgeSource
}>()

// ▶ = U+25B6 + U+FE0E 变体选择器（强制 text presentation，防 Lynx 原生把 emoji-able
// 字符解析为彩色 emoji 字形导致 CSS color 失效，ADR-0112 平台事实，♥ 同案）；
// ⧉ = U+29C9 非 emoji 字符，无需 VS15
const UGOIRA_LABEL = '\u25B6\uFE0E 动图'

const badges = computed(() =>
  resolveIllustTypeBadges(props.illust).map((b) => ({
    key: b.kind,
    label: b.kind === 'ugoira' ? UGOIRA_LABEL : `\u29C9 ${b.pageCount} 图`,
  })),
)
</script>

<template>
  <view v-if="badges.length > 0" class="flex flex-row gap-1 mt-2 mx-2.5">
    <text
      v-for="b in badges"
      :key="b.key"
      class="text-label-medium font-medium text-secondary-on-container bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
      >{{ b.label }}</text
    >
  </view>
</template>
