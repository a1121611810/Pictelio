<script setup lang="ts">
// EmptyState —— 页级空态（公共层六组件之一，ADR-0194 / T1 #748；术语表「EmptyState（空态）」）。
//
// 图标 + 标题 + 提示的**三段式空态**（text-outline-variant 巨字 + body-large 标题 +
// body-medium 提示）。文案与图标名全部由调用方注入——组件自身**零文案、零 CJK 字符**
// （hardcode-gate 面不变，spec D4）；noDeadKeys 面不因抽取稀释（ADR-0190 排除面同款）。
//
// 边界（零行为变化抽取）：页面级布局包裹**留在调用方**——三态链的 v-if/v-else-if、
// flex 居中容器（w-full flex-1 min-h-0 等，各页存量有差异）都在页面模板上；
// 本组件只收口三段结构本体（sheet 内空态变体不在本票范围）。
//
// 接口（调用方需要知道的全部）：
//   :icon   图标名（IconName）——**不是字形串**。ADR-0208 收口：传 Material Symbols
//           私用区码点给默认字体会静默渲染成空白（无 tofu、无报错），那是禁静默降级
//           明确禁止的形态。改用 IconName 后传错名字编译期即报错。
//   :title  已解析标题文案（调用方 i18n 传入）
//   :hint   已解析提示文案
import AppIcon from './AppIcon.vue'
import type { IconName } from '../utils/iconMap'

defineProps<{
  /** 图标名（IconName；utils/iconMap.ts ICON_CODEPOINTS 的键） */
  icon: IconName
  /** 已解析标题文案（调用方经 i18n 传入，组件零文案） */
  title: string
  /** 已解析提示文案 */
  hint: string
}>()
</script>

<template>
  <view class="flex flex-col items-center">
    <AppIcon :name="icon" :size="10.667" class="text-outline-variant" />
    <text class="text-body-large text-surface-on mt-3">{{ title }}</text>
    <text class="text-body-medium text-surface-on-variant mt-1.5">{{ hint }}</text>
  </view>
</template>
