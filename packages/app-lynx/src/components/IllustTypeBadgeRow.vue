<script setup lang="ts">
// 类型徽章行（ADR-0113 / spec: docs/specs/work-type-badges.md）。
// 流内徽章行：图片下方、标题上方，仅在有徽章时渲染（普通单图零占位）。
// M3 assist-chip 形态：图标 + 文字，secondary-container 底 / label-medium /
// md-shape-small 圆角，全 Tailwind utility 无 scoped CSS。
// 判定收敛在 ./illustTypeBadges 纯函数，本组件只做渲染。
// [lynx:fix] 严禁 absolute 定位——list-item 内 absolute 子元素会被真机高度测量
// 算进内容高度（CONTEXT.md「遮罩」词条，2026-08-11 实测）。
import { computed } from 'vue'
import { t } from '../i18n'
import AppIcon from './AppIcon.vue'
import type { IconName } from '../utils/iconMap'
import {
  resolveIllustTypeBadges,
  type IllustTypeBadgeItem,
  type IllustTypeBadgeSource,
} from './illustTypeBadges'

const props = defineProps<{
  /** 判定所需最小字段集（PixivIllust 结构兼容） */
  illust: IllustTypeBadgeSource
}>()

/**
 * 徽标种类 → 规范图标名（ADR-0208 决策 3：图标位必须经 <AppIcon>，不得在模板/字典里写字形）。
 *
 * 为什么不再把符号塞进 i18n 文案：符号随文案进来意味着「用哪个图标」的决定权散在字典里，
 * 既无法集中审计，也无法保证跨设备一致——原先的 U+25B6 是 emoji-able 码点，不同 ROM 会
 * 渲染成不同字形（甚至彩色 emoji），得靠 U+FE0E 强制 text presentation 兜底；这类坑是
 * 静默的（无报错、无崩溃）。字典现在只留文字，图标名集中在这里一处可查。
 *
 * 类型用 `satisfies Record<IllustTypeBadgeItem['kind'], IconName>` 收口：种类漏一个 ⇒ 编译期报错；
 * 图标名写错（不在 ICON_CODEPOINTS 里）⇒ 编译期报错，而不是运行时静默空白。不用 `as` 断言糊过去。
 */
const BADGE_ICONS = {
  ugoira: 'play_arrow',
  multi: 'photo_library',
} as const satisfies Record<IllustTypeBadgeItem['kind'], IconName>

const badges = computed(() =>
  resolveIllustTypeBadges(props.illust).map((b) => ({
    key: b.kind,
    icon: BADGE_ICONS[b.kind],
    label:
      b.kind === 'ugoira'
        ? t('illustTypeBadgeRow.ugoira')
        : t('illustTypeBadgeRow.multiPages', { count: b.pageCount }),
  })),
)
</script>

<template>
  <view v-if="badges.length > 0" class="flex flex-row gap-1 mt-2 mx-2.5">
    <view
      v-for="b in badges"
      :key="b.key"
      class="flex flex-row items-center gap-0.5 bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
    >
      <!-- 图标位：<AppIcon>，:size=3.2vw = 12sp，与同处 label-medium（24rpx=3.2vw）同号，
           等价于旧实现「符号随文案以正文同字号渲染」的视觉。 -->
      <AppIcon :name="b.icon" :size="3.2" class="text-secondary-on-container" />
      <text class="text-label-medium font-medium text-secondary-on-container">{{ b.label }}</text>
    </view>
  </view>
</template>
