<script setup lang="ts">
// 错误页变体 C —— 全屏品牌色块（强终态：品牌色氛围 + 反色按钮，明确「会话已死」）
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
defineProps<{ detail: string }>()
</script>

<template>
  <view class="w-full h-full flex flex-col items-center justify-center bg-brand px-10">
    <text
      class="text-3xl font-bold text-onBrand text-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <text class="text-base text-onBrand mt-4 text-center leading-relaxed" style="opacity: 0.8">{{ detail }}</text>
    <view
      class="mt-12 px-12 h-[12vw] rounded-[var(--borderRadiusXLarge)] bg-onBrand flex items-center justify-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
    >
      <text class="text-base text-brand font-semibold">返回登录</text>
    </view>
  </view>
</template>
