<script setup lang="ts">
// ─── 列表滚动指示条（纯展示，spec #319 / ticket #321 T2） ───
// 零逻辑零事件：几何（top/height）与可见性全部由父级用 useScrollIndicator 计算后 prop
// 传入（计算走 T1 calcScrollIndicator，组件不重复实现）。
// 显隐 = opacity（0/1），**禁止 v-if**（ADR-0135 教训：v-if 每帧 flip 重建视图）。
// 位置锚点 = 父容器 relative（RefreshableList 系），右缘竖条 width 2.4px / radius 2px
// 需内联 style（Lynx 渲染器对部分 Tailwind 类支持有限，颜色用 var(--md-scroll-indicator)
// ——M3 scrollbar thumb 通用语义：明暗自动跟随，spec docs/specs/lynx-night-mode-audit.md §3.2 P1-1）。
defineProps<{
  topPx: number
  heightPx: number
  visible: boolean
}>()
</script>

<template>
  <view
    class="absolute z-40 right-1"
    :style="{
      top: `${topPx}px`,
      height: `${heightPx}px`,
      width: '2.4px',
      borderRadius: '2px',
      backgroundColor: 'var(--md-scroll-indicator)',
      opacity: visible ? 1 : 0,
    }"
  />
</template>
