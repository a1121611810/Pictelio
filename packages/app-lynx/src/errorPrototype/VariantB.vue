<script setup lang="ts">
// 错误页变体 B —— 详情卡片 + 双操作（状态徽标 + 结构化错误信息 + 主/次按钮）
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
defineProps<{ detail: string }>()
</script>

<template>
  <view class="w-full h-full flex flex-col bg-background-2 px-8 pt-[16vw]">
    <!-- 状态徽标行 -->
    <view class="flex items-center gap-4">
      <view class="w-[13vw] h-[13vw] rounded-full bg-danger flex items-center justify-center">
        <text class="text-[5.5vw] text-onBrand font-bold">401</text>
      </view>
      <view>
        <text class="text-xl font-bold text-foreground">会话已失效</text>
        <text class="text-sm text-foreground-2 mt-1 block">登录状态已过期，请重新登录</text>
      </view>
    </view>
    <!-- 错误详情卡片 -->
    <view class="mt-10 bg-background rounded-2xl border border-stroke-2 p-6">
      <text
        class="text-base font-semibold text-foreground"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
      >
        {{ ERROR_A11Y_LABELS.pageTitle }}
      </text>
      <text class="text-sm text-foreground-2 mt-2 leading-relaxed">{{ detail }}</text>
      <view class="mt-4 pt-4 border-t border-stroke-2 flex items-center justify-between">
        <text class="text-xs text-foreground-3">当前会话</text>
        <text class="text-xs text-foreground-2">已失效 · 需要重新登录</text>
      </view>
    </view>
    <!-- 底部双操作 -->
    <view class="mt-auto mb-[6vw] flex flex-col gap-3">
      <view
        class="w-full h-[12vw] rounded-[var(--borderRadiusXLarge)] bg-brand flex items-center justify-center"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
      >
        <text class="text-base text-onBrand">返回登录</text>
      </view>
      <view class="w-full h-[12vw] rounded-[var(--borderRadiusXLarge)] border border-stroke-2 bg-background flex items-center justify-center">
        <text class="text-base text-foreground">退出应用</text>
      </view>
    </view>
  </view>
</template>
