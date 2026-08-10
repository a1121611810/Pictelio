<script setup lang="ts">
// 错误页变体 A —— 居中极简（改良现状：加品牌徽标 + 全宽主按钮）
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
defineProps<{ detail: string }>()
</script>

<template>
  <view class="w-full h-full flex flex-col items-center justify-center bg-background-2 px-10">
    <!-- 品牌色徽标：会话失效语义 -->
    <view class="w-[16vw] h-[16vw] rounded-full bg-brand flex items-center justify-center">
      <text class="text-[7vw] text-onBrand font-bold">!</text>
    </view>
    <text
      class="text-2xl font-bold text-foreground mt-8 text-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <text class="text-base text-foreground-2 mt-3 text-center leading-relaxed">{{ detail }}</text>
    <view
      class="mt-12 w-full h-[12vw] rounded-[var(--borderRadiusXLarge)] bg-brand flex items-center justify-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
    >
      <text class="text-base text-onBrand">返回登录</text>
    </view>
  </view>
</template>
