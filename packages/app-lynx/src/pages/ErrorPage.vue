<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；错误页不在 include 白名单，每次进入全新
defineOptions({ name: 'error' })
import { navigate, resetHistory } from '../router'
import { logout } from '../stores/authStore'
import { fatalError, presentError } from '../utils/errorPresentation'
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

// 会话失效（UNAUTHORIZED）全屏错误页 —— 定稿方案 C（全屏品牌色块，UI 原型选定）：
// - 进入语义：router 装配的 handler resetHistory + navigate('/error', { replace }) → 历史栈为空，返回键
//   backBehavior: 'exit' 直接退出应用（ADR-0066，与强制更新页一致），不可回退到已失效的会话页面。
// - 按钮回登录：logout + 清历史栈 + replace（登录页不应被"返回"，ADR-0049）+ 清理 fatalError 残留
function backToLogin() {
  logout()
  resetHistory()
  fatalError.value = null
  void navigate('/login', { replace: true })
}
</script>

<template>
  <view class="w-full h-full flex flex-col items-center justify-center bg-brand px-10">
    <!-- 品牌色满屏氛围 + 白色大标题（强终态：会话已死，请重来） -->
    <text
      class="text-3xl font-bold text-onBrand text-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <!-- 副文案：半透明白（presentError 分档文案，含 HTTP 状态码与 hint） -->
    <text class="text-base text-onBrand mt-4 text-center leading-relaxed" style="opacity: 0.8">
      {{ presentError(fatalError, '登录已过期') }}
    </text>
    <!-- 反色主按钮：白底品牌字 -->
    <view
      class="mt-12 px-12 h-[12vw] rounded-[var(--borderRadiusXLarge)] bg-onBrand flex items-center justify-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
      @tap="backToLogin"
    >
      <text class="text-base text-brand font-semibold">返回登录</text>
    </view>
  </view>
</template>
