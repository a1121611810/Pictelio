<script setup lang="ts">
// 错误页变体 C —— 全屏品牌色块（内联 style：web-core 预览下 Tailwind 类不生效）
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
defineProps<{ detail: string }>()
</script>

<template>
  <view
    style="display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #0f6cbd; padding: 40px; width: 100%; height: 100%;"
  >
    <text
      style="font-size: 32px; font-weight: 700; color: #ffffff; text-align: center;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <text style="font-size: 16px; color: rgba(255, 255, 255, 0.8); margin-top: 16px; text-align: center; line-height: 24px;">{{ detail }}</text>
    <view
      style="margin-top: 48px; padding: 0 48px; height: 48px; border-radius: 16px; background-color: #ffffff; display: flex; align-items: center; justify-content: center;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
    >
      <text style="font-size: 16px; color: #0f6cbd; font-weight: 600;">返回登录</text>
    </view>
  </view>
</template>
