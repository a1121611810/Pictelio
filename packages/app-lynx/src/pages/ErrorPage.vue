<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；错误页不在 include 白名单，每次进入全新
defineOptions({ name: 'error' })
import { navigate, resetHistory } from '../router'
import { useAuthStore } from '../stores/authStore'
import { fatalError, presentError } from '../utils/errorPresentation'
import { ERROR_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()


// 会话失效（UNAUTHORIZED）全屏错误页 —— 定稿方案 C（全屏品牌色块，UI 原型选定）：
// - 进入语义：router 装配的 handler resetHistory + navigate('/error', { replace }) → 历史栈为空，返回键
//   backBehavior: 'exit' 直接退出应用（ADR-0066，与强制更新页一致），不可回退到已失效的会话页面。
// - 按钮回登录：logout + 清历史栈 + replace（登录页不应被"返回"，ADR-0049）+ 清理 fatalError 残留
function backToLogin() {
  useAuthStore().logout()
  resetHistory()
  fatalError.value = null
  void navigate('/login', { replace: true })
}
</script>

<template>
  <view class="w-full h-full flex flex-col items-center justify-center bg-primary px-10">
    <!-- 品牌色满屏氛围 + 白色大标题（强终态：会话已死，请重来） -->
    <!-- T07 档位清理：原为 700 字重。本行是 i18n **消息文案**（非字标），headline-small
         官方字重 regular(400)、emphasized 变体 500；「强终态」由满屏 bg-primary 反色容器承担，
         容器已在喊，无需文字再压 700。全站同档位标题（Watchlist / DownloadManager /
         WatchlistPromptDialog / Me 的对话框标题）一律 500，此处对齐。 -->
    <text
      class="text-headline-small font-medium text-primary-on text-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.pageTitle"
    >
      {{ ERROR_A11Y_LABELS.pageTitle }}
    </text>
    <!-- 副文案：半透明白（presentError 分档文案，含 HTTP 状态码与 hint） -->
    <text class="text-body-medium text-primary-on mt-4 text-center" style="opacity: 0.8">
      {{ presentError(fatalError, t('error.fallback.sessionExpired')) }}
    </text>
    <!-- M3 反色 filled 按钮：on-primary 底 + primary 字（全圆角 pill） -->
    <view
      class="mt-12 px-12 h-[10.667vw] rounded-[var(--md-shape-full)] bg-primary-on active:bg-layer-pressed-on-surface flex items-center justify-center"
      :class="pressColor.className"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="ERROR_A11Y_LABELS.backToLogin"
      @tap="backToLogin"
    >
      <text class="text-label-large text-primary font-medium">{{ t('errorPage.backToLogin') }}</text>
    </view>
  </view>
</template>
