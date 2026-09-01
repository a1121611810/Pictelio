<script setup lang="ts">
// 标签胶囊行（Ticket T3 / ADR-0118 决策 4 / spec: docs/specs/app-lynx-recommended-carousel-polish-r2.md §2.4/§3.4；
// 可点化 = ADR-0133 决策 1/6：点击 chip → 页面层 openSearch(标签，全局搜索弹层)）。
// 滑页 scrim 区标签行（类型徽章行下方、标题上方，位置由父组件布局），插画 + 小说统一。
// M3 assist-chip 形态（同 IllustTypeBadgeRow）：secondary-container 底 / label-medium /
// md-shape-small 圆角；最多 max 个，超出折叠为「+N」；单行不换行。
// 组件保持纯展示性质（不发 do、不 import store）：点击 → emit('tag-tap', 原始 name)，
// 由页面层决定行为（openSearch），本组件可独立渲染/测试。+N 折叠芯片**不可点**
// （是计数不是标签，无搜索语义）。
// [lynx:fix] 命中区：chip 视觉高度 8.5vw < M3 最小触控目标 40dp——用 -m-1 p-1 负 margin
// 扩命中面（视觉不变）；tap 事件挂在 view 上（原生 LynxView hit-testing 不接受
// pointer-events CSS，ADR-0123 教训）。@tap.stop 防冒泡：轮播卡片父级 @tap = 进详情。
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

const emit = defineEmits<{
  /** 点击标签 chip（携带原始 tag.name，搜索关键词）；+N 折叠芯片不触发 */
  (e: 'tag-tap', name: string): void
}>()

// 单一 computed 承载折叠结果，模板按需读取（chips / overflow）
const result = computed(() => resolveTagChips(props.tags, props.max))
</script>

<template>
  <view v-if="result.chips.length > 0" class="flex flex-row gap-1">
    <!-- key 用原始 name（text 可能因翻译名折叠出相同文本，文本 key 会冲突）。
         点击 → emit('tag-tap', 原始 name)（ADR-0133 决策 1/6）；
         @tap.stop 防冒泡：轮播卡片父级 @tap = 进详情（ADR-0133 风险表验证点，模拟器确认）。
         命中区 = 视觉尺寸（~32px 高，M3 40dp 为目标：Lynx 原生布局对负 margin 未实证 + flex
         数学会把视觉位置外移 → 不做 -m/p 扩展，与 CommentInputBar「取消」/SearchSheet ×
         同规格「视觉即命中」，40dp 列为后续增强）。跳步不改视觉布局。 -->
    <text
      v-for="chip in result.chips"
      :key="chip.name"
      class="text-label-medium font-medium text-secondary-on-container bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
      @tap.stop="emit('tag-tap', chip.name)"
      >{{ chip.text }}</text
    >
    <text
      v-if="result.overflow > 0"
      class="text-label-medium font-medium text-secondary-on-container bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
      >+{{ result.overflow }}</text
    >
  </view>
</template>
