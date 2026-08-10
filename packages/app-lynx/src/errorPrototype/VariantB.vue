<script setup lang="ts">
// 错误页变体 B —— 详情卡片 + 双操作（内联 style：web-core 预览下 Tailwind 类不生效）
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
defineProps<{ detail: string }>()
</script>

<template>
  <view
    style="display: flex; flex-direction: column; background-color: #faf9f8; padding: 64px 32px 24px; width: 100%; height: 100%;"
  >
    <!-- 状态徽标行 -->
    <view style="display: flex; flex-direction: row; align-items: center; gap: 16px;">
      <view
        style="width: 52px; height: 52px; border-radius: 26px; background-color: #c50f1f; display: flex; align-items: center; justify-content: center;"
      >
        <text style="font-size: 20px; color: #ffffff; font-weight: 700;">401</text>
      </view>
      <view>
        <text style="font-size: 20px; font-weight: 700; color: #1b1a19;">会话已失效</text>
        <text style="font-size: 14px; color: #605e5c; margin-top: 4px;">登录状态已过期，请重新登录</text>
      </view>
    </view>
    <!-- 错误详情卡片 -->
    <view
      style="margin-top: 40px; background-color: #ffffff; border-radius: 16px; border-width: 1px; border-style: solid; border-color: #e1dfdd; padding: 24px;"
    >
      <text
        style="font-size: 16px; font-weight: 600; color: #1b1a19;"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
      >
        {{ ERROR_A11Y_LABELS.pageTitle }}
      </text>
      <text style="font-size: 14px; color: #605e5c; margin-top: 8px; line-height: 22px;">{{ detail }}</text>
      <view
        style="margin-top: 16px; padding-top: 16px; border-top-width: 1px; border-top-style: solid; border-top-color: #e1dfdd; display: flex; flex-direction: row; align-items: center; justify-content: space-between;"
      >
        <text style="font-size: 12px; color: #a19f9d;">当前会话</text>
        <text style="font-size: 12px; color: #605e5c;">已失效 · 需要重新登录</text>
      </view>
    </view>
    <!-- 底部双操作 -->
    <view style="margin-top: auto; display: flex; flex-direction: column; gap: 12px;">
      <view
        style="width: 100%; height: 48px; border-radius: 16px; background-color: #0f6cbd; display: flex; align-items: center; justify-content: center;"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
      >
        <text style="font-size: 16px; color: #ffffff;">返回登录</text>
      </view>
      <view
        style="width: 100%; height: 48px; border-radius: 16px; border-width: 1px; border-style: solid; border-color: #e1dfdd; background-color: #ffffff; display: flex; align-items: center; justify-content: center;"
      >
        <text style="font-size: 16px; color: #1b1a19;">退出应用</text>
      </view>
    </view>
  </view>
</template>
