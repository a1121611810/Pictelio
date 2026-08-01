<script setup lang="ts">
import { ref } from 'vue'
import { navigate } from '../router'
import { loginWithToken, isLoggedIn } from '../stores/authStore'
import { authError } from '../stores/authStore'

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
      await navigate('/recommended')
    } else {
      errorMsg.value = authError.value ?? '登录失败'
    }
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '登录失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="w-full h-full flex flex-col items-center bg-background-2 pt-[32vw]">
    <view class="flex flex-col items-center mb-10">
      <text class="text-6xl font-bold text-brand-foreground">Pictelio</text>
      <text class="text-base text-foreground-3 mt-2">Lynx Client MVP</text>
    </view>

    <!-- [lynx:fix] Card 用 flex column：子元素靠 stretch 拉伸填充父宽，
         规避 web-core 下 input 百分比宽度相对根容器（而非父）导致的右溢出 -->
    <view class="w-[85%] bg-background rounded-[var(--borderRadius2XLarge)] p-6 shadow-[var(--elevation4)] flex flex-col">
      <!-- [lynx:fix] input 显式 border-box + 去 UA 边框：
           web-core 预览未复刻 Lynx 的 border-box 默认（UA 无 box-sizing 规则），
           content-box 下 width:100% + padding 会溢出；原生 LynxView 默认 border-box 无副作用 -->
      <input
        v-model="tokenInput"
        class="self-stretch h-[9.6vw] box-border border-0 bg-background-3 rounded-[var(--borderRadiusLarge)] text-base text-foreground px-4 mb-3"
        placeholder="粘贴 Pixiv refresh_token"
        placeholder-color="#a19f9d"
      />

      <text v-if="errorMsg" class="text-sm text-danger mb-2">{{ errorMsg }}</text>

      <view class="h-[9.6vw] bg-brand rounded-[var(--borderRadiusLarge)] flex items-center justify-center" @tap="submit">
        <text class="text-xl font-semibold text-onBrand">{{ submitting ? '登录中…' : '登录' }}</text>
      </view>
    </view>

    <text class="text-xs text-foreground-3 mt-6">登录后进入推荐插画 / 小说 / 个人中心</text>
  </view>
</template>
