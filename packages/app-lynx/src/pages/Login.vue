<script setup lang="ts">
import { ref } from 'vue'
import { navigate, resetHistory } from '../router'
import { loginWithToken, isLoggedIn } from '../stores/authStore'
import { authError } from '../stores/authStore'
import { loadSettings } from '../stores/settingsStore'
import { LOGIN_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { presentError } from '../utils/errorPresentation'

const tokenInput = ref('')
const submitting = ref(false)
const errorMsg = ref('')

async function submit() {
  if (submitting.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    await loginWithToken(tokenInput.value)
    if (isLoggedIn.value) {
      // ADR-0103：登录后 uid 已知 → 加载账号级 R18/R18G（跨 client 共享存储）
      await loadSettings()
      // [lynx:fix] 登录成功 = 会话新起点：清历史栈 + replace 导航（ADR-0049）
      resetHistory()
      await navigate('/recommended', { replace: true })
    } else {
      errorMsg.value = authError.value ?? '登录失败'
    }
  } catch (err) {
    errorMsg.value = presentError(err, '登录失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="w-full h-full flex flex-col items-center bg-surface pt-[32vw]">
    <view class="flex flex-col items-center mb-10">
      <text class="text-headline-large font-bold text-primary">Pictelio</text>
      <text class="text-body-medium text-surface-on-variant mt-2">Lynx Client MVP</text>
    </view>

    <!-- [lynx:fix] Card 用 flex column：子元素靠 stretch 拉伸填充父宽，
         规避 web-core 下 input 百分比宽度相对根容器（而非父）导致的右溢出 -->
    <view class="w-[85%] bg-surface-container-lowest rounded-[var(--md-shape-medium)] p-6 shadow-[var(--md-elevation-1)] flex flex-col">
      <!-- [lynx:fix] input 显式 border-box + 去 UA 边框：
           web-core 预览未复刻 Lynx 的 border-box 默认（UA 无 box-sizing 规则），
           content-box 下 width:100% + padding 会溢出；原生 LynxView 默认 border-box 无副作用 -->
      <!-- M3 filled text field：surface-container-highest 底 + extra-small(4dp) 圆角 -->
      <input
        v-model="tokenInput"
        class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-outline-variant text-body-large text-surface-on px-4 mb-3"
        placeholder="粘贴 Pixiv refresh_token"
        placeholder-color="#49454f"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="LOGIN_A11Y_LABELS.tokenInput"
      />

      <text v-if="errorMsg" class="text-body-small text-error mb-2">{{ errorMsg }}</text>

      <!-- M3 filled button：primary 底 + 全圆角（pill） -->
      <view
        class="h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        @tap="submit"
      >
        <text
          class="text-label-large font-medium text-primary-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="LOGIN_A11Y_LABELS.submit"
          >{{ submitting ? '登录中…' : '登录' }}</text
        >
      </view>
    </view>

    <text class="text-label-medium text-surface-on-variant mt-6">登录后进入推荐插画 / 小说 / 个人中心</text>
  </view>
</template>
