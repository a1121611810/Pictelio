<script setup lang="ts">
// ─── 错误页预览（定稿方案 C 的内联样式版，仅 web 预览入口使用） ───
// web-core 预览下 Tailwind 类 / tokens 变量 / rpx 不生效（全局 CSS 未注入 shadowRoot），
// 故预览用内联 style + 具体 Fluent 色值，与生产 ErrorPage.vue（Tailwind 类版）同一设计。
// 色值取自 tokens.css：brand=#0f6cbd、onBrand=#ffffff。
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import type { ApiError } from '../api/types'

defineProps<{ error: ApiError | null }>()
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
    <text style="font-size: 16px; color: rgba(255, 255, 255, 0.8); margin-top: 16px; text-align: center; line-height: 24px;">
      {{ error ? `${error.message}。请重新登录` : '登录已过期，请重新登录' }}
    </text>
    <view
      style="margin-top: 48px; padding: 0 48px; height: 48px; border-radius: 16px; background-color: #ffffff; display: flex; align-items: center; justify-content: center;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
    >
      <text style="font-size: 16px; color: #0f6cbd; font-weight: 600;">返回登录</text>
    </view>
  </view>
</template>
