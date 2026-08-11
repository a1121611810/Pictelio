<script setup lang="ts">
// ─── 错误页预览（方案 C 内联样式版，仅 web 预览入口使用） ───
// web-core 预览下 M3 令牌色（var(--md-*)）不解析（:root 变量未注入 shadowRoot，
// 全局限制，现有页面的品牌色在 web 预览同样缺失，仅白底设计不明显）。
// 错误页 C 为全屏品牌紫，缺失时退化为白底 → 预览用内联具体色值展示效果；
// 生产 ErrorPage.vue 用令牌版（真机 lynx 的 CSS 变量机制正常）。
// 色值取自 tokens.css：primary=#6750a4、on-primary=#ffffff。
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import type { ApiError } from '../api/types'

defineProps<{ error: ApiError | null }>()
</script>

<template>
  <view
    style="display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #6750a4; padding: 40px; width: 100%; height: 100%;"
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
      style="margin-top: 48px; padding: 0 48px; height: 48px; border-radius: 24px; background-color: #ffffff; display: flex; align-items: center; justify-content: center;"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
    >
      <text style="font-size: 16px; color: #6750a4; font-weight: 600;">返回登录</text>
    </view>
  </view>
</template>
