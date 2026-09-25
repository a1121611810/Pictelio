<script setup lang="ts">
// 可按压标签胶囊（ADR-0187 D5 / #732）：单击上抛 tap（宿主决定行为，如开搜索）、
// 长按 500ms 上抛 longPress（宿主静音该标签）——复刻 BookmarkButton 双轨手势形态：
// - useLongPress（@touchstart/@touchmove/@touchend 绑 view 层）：原生 LynxView 无 pointer
//   事件且 <text> 不收手势，手势必须绑在 view 容器（原生约束）；
// - 吞 tap 守卫：长按已触发时随后的 tap 被 consumeLongPress 吞掉（不额外走宿主 tap）；
// - @tap.stop：标签 chip 在轮播卡/列表卡内，防冒泡触发宿主卡片 tap（进详情，ADR-0133）。
// 组件纯展示：不 import store，不发请求；视觉（bg/圆角/边框/字号）由宿主经
// chipClass / textClass 注入——TagChipRow / AdaptiveTagRow / IllustDetail 三宿主
// 各有既有视觉，注入式保证「测量=渲染」等结构契约不被本组件改写。
import { onBeforeUnmount } from 'vue'
import { useLongPress, type TouchLikeEvent } from '../composables/useLongPress'

defineProps<{
  /** 展示文本（宿主拼接，如 '#标签名'） */
  text: string
  /** 容器类（宿主既有 chip 视觉，如 TagChipRow 的 secondary-container 胶囊类） */
  chipClass?: string
  /** 内层文本类（宿主既有字号/颜色，缺省 = TagChipRow 同款 label-medium） */
  textClass?: string
}>()

const emit = defineEmits<{
  /** 单击（宿主行为自定，如 openSearch） */
  (e: 'tap'): void
  /** 长按 500ms 成立（宿主静音该标签） */
  (e: 'longPress'): void
}>()

const longPress = useLongPress({ onTrigger: () => emit('longPress') })

function onTap(): void {
  // 长按已静音：吞掉同一次手势的 tap（双轨互斥，BookmarkButton 同款）
  if (longPress.consumeLongPress()) return
  emit('tap')
}

function onTouchStart(e: TouchLikeEvent): void {
  longPress.onTouchStart(e)
}
function onTouchMove(e: TouchLikeEvent): void {
  longPress.onTouchMove(e)
}
function onTouchEnd(): void {
  longPress.onTouchEnd()
}

onBeforeUnmount(() => {
  longPress.cancel()
})
</script>

<template>
  <!-- [lynx:fix] 布局（flex 居中/圆角/padding）由 view 承载、text 只放文本——lynx 的 text
       是纯文本节点，flex 对 text 无效；text 内层不得加 leading-none（TagChipRow 同款约束） -->
  <view :class="chipClass" @tap.stop="onTap" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
    <text :class="textClass ?? 'text-label-medium font-medium text-secondary-on-container'">{{ text }}</text>
  </view>
</template>
