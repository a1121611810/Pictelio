<script setup lang="ts">
// 列表卡片自适应标签行（ADR-0149 / spec docs/specs/app-lynx-adaptive-list-tags.md）。
// 行为：单行；按实测容器宽度「装多少算多少」；剩余宽 >= 16px 再放一个省略号截断 chip；其余折叠为 +N。
// 平台约束（ADR-0149 spike 双端实测）：
// - Lynx 无 offsetWidth / ResizeObserver / canvas.measureText；只能 createSelectorQuery + boundingClientRect；
// - selectAll().invoke() 双端不支持（code 5）→ 逐元素 select；
// - list-item 内禁止 absolute（真机高度测量会把 absolute 算进内容高度）→ 先渲染全部 chip（overflow-hidden 裁）再按结果重渲染。
// 不变量（测量宽度 = 渲染宽度）：measuring 与 ready 两阶段使用同一 CHIP_CLASS 与同一行宽（w-full），
// 因此实测 chip 宽度即为 ready 渲染时的宽度；一旦两阶段的 padding / 字型 / 行宽分叉，fit 会失真。
// 组件保持纯展示：不 import store；点击发 tag-tap / overflow-tap，由页面决定行为。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { computeAdaptiveTagFit, type AdaptiveTagFit } from '../utils/adaptiveTagFit'
import { measureRects, type SelectorQuery } from '../primitives/measureRects'
import { resolveTagChips, type TagChip, type TagChipSource } from '../utils/tagChips'

const props = defineProps<{ tags: TagChipSource[] }>()
const emit = defineEmits<{
  /** 点击某个标签 chip（携带原始标签名，供页面开搜索） */
  (e: 'tag-tap', name: string): void
  /** 点击 +N 或省略号截断 chip（页面决定，通常进作品详情） */
  (e: 'overflow-tap'): void
}>()

/** 实例唯一前缀：selector 用 #id，跨卡片不得重复（同 GlassCard 范式） */
const uid = 'atr-' + Math.random().toString(36).slice(2, 10)

/** chip 视觉（ready / measuring / fallback 三阶段复用同一常量，防类名漂移破坏「测量=渲染」不变量） */
const CHIP_CLASS =
  'flex-shrink-0 flex items-center justify-center bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5'
/** +N 徽标视觉（primary 底以区分「计数」而非标签） */
const PLUS_CLASS =
  'flex-shrink-0 flex items-center justify-center bg-primary rounded-[var(--md-shape-small)] px-2 py-0.5'
/** 测量不可用时的降级上限（ADR-0149 决策 4） */
const FALLBACK_VISIBLE = 3
/** 首帧布局未完成（container=0）的最大重试次数 */
const MAX_RETRIES = 3

const phase = ref<'measuring' | 'ready' | 'fallback'>('measuring')
const fit = ref<AdaptiveTagFit | null>(null)
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

/** 全部标签（复用 tagChips 纯函数：text = # + translated_name||name，name = 原始标签） */
const allChips = computed<TagChip[]>(() => resolveTagChips(props.tags, props.tags.length).chips)
const visibleChips = computed(() => (fit.value ? allChips.value.slice(0, fit.value.visible) : []))
const partialChip = computed(() =>
  fit.value && fit.value.partialWidth != null ? allChips.value[fit.value.visible] : undefined,
)
const fallbackChips = computed(() => allChips.value.slice(0, FALLBACK_VISIBLE))

function createQuery(): SelectorQuery | undefined {
  try {
    if (typeof lynx === 'undefined') return undefined
    return lynx?.createSelectorQuery?.() as unknown as SelectorQuery | undefined
  } catch {
    return undefined
  }
}

/**
 * 测量并按结果计算折叠。reset=true 表示一次全新的测量（mount / tags 变化）——重置重试预算；
 * 重试递归必须以 reset=false 调用，否则重试次数永远归零成死循环。
 */
async function measure(reset = true) {
  if (reset) retries = 0
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  phase.value = 'measuring'
  fit.value = null
  await nextTick()

  const rows = allChips.value
  const ids = [uid + '-row']
  rows.forEach((_, i) => ids.push(uid + '-c' + i))
  ids.push(uid + '-plus')

  const res = await measureRects(ids, createQuery)
  const container = res.rects[uid + '-row']?.width ?? 0
  const plusWidth = res.rects[uid + '-plus']?.width ?? 0
  const chipRects = rows.map((_, i) => res.rects[uid + '-c' + i])
  const widths = chipRects.map((r) => r?.width ?? 0)

  const valid = container > 0 && plusWidth > 0 && widths.every((w) => w > 0)
  if (!valid) {
    if (retries < MAX_RETRIES) {
      // 首帧布局未完成（真机实测 container=0）→ 稍后重试，不立刻降级
      retries++
      retryTimer = setTimeout(() => void measure(false), 80)
      return
    }
    console.warn(
      '[AdaptiveTagRow] 测量无效（container=' + container + ' plus=' + plusWidth + '），降级为固定上限 ' + FALLBACK_VISIBLE,
    )
    phase.value = 'fallback'
    return
  }

  // gap 由相邻 chip 左边界差实测得出（避免依赖 vw 换算）
  const first = chipRects[0]
  const second = chipRects[1]
  if (!first || !second) {
    console.warn('[AdaptiveTagRow] 标签不足 2 个，gap 无法实测，回落 0（截断 chip 宽度可能偏大）')
  }
  const gap = first && second ? Math.max(0, second.left - first.left - first.width) : 0
  fit.value = computeAdaptiveTagFit(widths, plusWidth, container, gap)
  phase.value = 'ready'
}

onMounted(() => void measure())
onUnmounted(() => {
  if (retryTimer !== undefined) clearTimeout(retryTimer)
})
watch(
  () => props.tags,
  () => void measure(),
)
</script>

<template>
  <view
    v-if="allChips.length > 0"
    :id="uid + '-row'"
    class="w-full flex flex-row items-center gap-1 overflow-hidden"
  >
    <!-- ready：可见 chip +（可选）省略号截断 chip +（可选）+N -->
    <template v-if="phase === 'ready' && fit">
      <view
        v-for="chip in visibleChips"
        :key="chip.name"
        :class="CHIP_CLASS"
        @tap.stop="emit('tag-tap', chip.name)"
      >
        <text class="text-label-medium font-medium text-secondary-on-container">{{ chip.text }}</text>
      </view>
      <view
        v-if="partialChip"
        :class="[CHIP_CLASS, 'overflow-hidden']"
        :style="{ maxWidth: (fit.partialWidth || 0) + 'px' }"
        @tap.stop="emit('overflow-tap')"
      >
        <!-- [lynx:fix] 仅 max-line 不足以防换行（真机实测会竖排换行）；必须 white-space:nowrap + text-overflow:ellipsis 才出省略号 -->
        <text class="text-label-medium font-medium text-secondary-on-container [max-line:1] [white-space:nowrap] [text-overflow:ellipsis]">{{ partialChip.text }}</text>
      </view>
      <view v-if="fit.remaining > 0" :class="PLUS_CLASS" @tap.stop="emit('overflow-tap')">
        <text class="text-label-medium font-medium text-primary-on">+{{ fit.remaining }}</text>
      </view>
    </template>

    <!-- measuring：先渲染全部 chip 供测量（overflow-hidden 裁切，单行不换行） -->
    <template v-else-if="phase === 'measuring'">
      <view v-for="(chip, i) in allChips" :key="chip.name" :id="uid + '-c' + i" :class="CHIP_CLASS">
        <text class="text-label-medium font-medium text-secondary-on-container">{{ chip.text }}</text>
      </view>
      <view :id="uid + '-plus'" :class="PLUS_CLASS">
        <text class="text-label-medium font-medium text-primary-on">+{{ allChips.length }}</text>
      </view>
    </template>

    <!-- fallback：测量不可用 → 固定上限（不显示 +N，避免误导） -->
    <template v-else>
      <view
        v-for="chip in fallbackChips"
        :key="chip.name"
        :class="CHIP_CLASS"
        @tap.stop="emit('tag-tap', chip.name)"
      >
        <text class="text-label-medium font-medium text-secondary-on-container">{{ chip.text }}</text>
      </view>
    </template>
  </view>
</template>
