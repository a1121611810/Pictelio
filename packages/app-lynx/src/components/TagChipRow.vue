<script setup lang="ts">
// 标签胶囊行（Ticket T3 / ADR-0118 决策 4 / spec: docs/specs/app-lynx-recommended-carousel-polish-r2.md §2.4/§3.4）。
// 滑页 scrim 区标签行（类型徽章行下方、标题上方，位置由父组件布局），插画 + 小说统一。
// M3 assist-chip 形态（同 IllustTypeBadgeRow）：secondary-container 底 / label-medium /
// md-shape-small 圆角；最多 max 个，超出折叠为「+N」；单行不换行；纯展示不可点
// （app-lynx 无搜索路由）。
// 折叠/`#` 前缀逻辑收敛在 ../utils/tagChips 纯函数（node 可测），本组件只做渲染；
// chips 为空时不渲染任何东西（v-if），普通卡片零占位。
import { computed } from 'vue'
import { resolveTagChips, type TagChipSource } from '../utils/tagChips'

const props = withDefaults(
  defineProps<{
    /** 标签最小字段集（PixivIllustTag / PixivNovel.tags 结构兼容） */
    tags: TagChipSource[]
    /** 最多展示的标签数（超出折叠为 +N），默认 3 */
    max?: number
  }>(),
  { max: 3 },
)

// 单一 computed 承载折叠结果，模板按需读取（chips / overflow）
const result = computed(() => resolveTagChips(props.tags, props.max))
</script>

<template>
  <view v-if="result.chips.length > 0" class="flex flex-row gap-1">
    <!-- 索引做 key：两个标签可能折叠出相同文本（如相同 translated_name），文本 key 会冲突 -->
    <text
      v-for="(chip, i) in result.chips"
      :key="i"
      class="text-label-medium font-medium text-secondary-on-container bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
      >{{ chip }}</text
    >
    <text
      v-if="result.overflow > 0"
      class="text-label-medium font-medium text-secondary-on-container bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
      >+{{ result.overflow }}</text
    >
  </view>
</template>
