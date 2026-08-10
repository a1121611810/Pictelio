<script setup lang="ts">
// 错误页变体 A —— 居中极简（内联 style：web-core 预览下 Tailwind 类不生效，见 PrototypeShell 注释）
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
defineProps<{ detail: string }>()
</script>

<template>
  <view
    style="display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #faf9f8; padding: 40px; width: 100%; height: 100%;"
  >
    <!-- 品牌色徽标 -->
    <view
      style="width: 64px; height: 64px; border-radius: 32px; background-color: #0f6cbd; display: flex; align-items: center; justify-content: center;"
    >
      <text style="font-size: 28px; color: #ffffff; font-weight: 700;">!</text>
    </view>
    <text
      style="font-size: 24px; font-weight: 700; color: #1b1a19; margin-top: 32px; text-align: center;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <text style="font-size: 16px; color: #605e5c; margin-top: 12px; text-align: center; line-height: 24px;">{{ detail }}</text>
    <view
      style="margin-top: 48px; width: 100%; height: 48px; border-radius: 16px; background-color: #0f6cbd; display: flex; align-items: center; justify-content: center;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
    >
      <text style="font-size: 16px; color: #ffffff;">返回登录</text>
    </view>
  </view>
</template>
