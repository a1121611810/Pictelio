<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；错误页不在 include 白名单，每次进入全新
defineOptions({ name: 'error' })
import { navigate, resetHistory } from '../router'
import { logout } from '../stores/authStore'
import { fatalError, presentError } from '../utils/errorPresentation'
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

// 会话失效（UNAUTHORIZED）全屏错误页：
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
  <view class="w-full h-full flex flex-col items-center justify-center bg-background-2 px-10">
    <text
      class="text-2xl font-bold text-foreground text-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <!-- 错误详情：统一走 presentError 分档文案（含 hint），不直接渲染原始 message（防原生错误串细节展示） -->
    <text class="text-base text-foreground-2 mt-3 text-center leading-relaxed">
      {{ presentError(fatalError, '登录已过期') }}
    </text>
    <view
      class="mt-10 px-10 h-[11vw] flex items-center justify-center rounded-[var(--borderRadiusXLarge)] bg-brand"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
      @tap="backToLogin"
    >
      <text class="text-base text-onBrand">返回登录</text>
    </view>
  </view>
</template>
