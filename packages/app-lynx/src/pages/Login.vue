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
  <view class="Login">
    <view class="Brand">
      <text class="BrandTitle">Pictelio</text>
      <text class="BrandSub">Lynx Client MVP</text>
    </view>

    <view class="Card">
      <input
        v-model="tokenInput"
        class="Input"
        placeholder="粘贴 Pixiv refresh_token"
        placeholder-color="#a19f9d"
      />

      <text v-if="errorMsg" class="Error">{{ errorMsg }}</text>

      <view class="Submit" @tap="submit">
        <text class="SubmitText">{{ submitting ? '登录中…' : '登录' }}</text>
      </view>
    </view>

    <text class="Hint">登录后进入推荐插画 / 小说 / 个人中心</text>
  </view>
</template>

<style scoped>
.Login {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: var(--colorNeutralBackground2);
  padding-top: 32.000vw;
}

.Brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 10.667vw;
}

.BrandTitle {
  font-size: 56rpx;
  font-weight: 700;
  color: var(--colorBrandForeground1);
}

.BrandSub {
  font-size: 24rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 2.133vw;
}

.Card {
  width: 85%;
  background-color: var(--colorNeutralBackground1);
  border-radius: var(--borderRadius2XLarge);
  padding: 6.400vw;
  box-shadow: var(--elevation4);
}

.Input {
  width: 100%;
  height: 9.600vw;
  background-color: var(--colorNeutralBackground3);
  border-radius: var(--borderRadiusLarge);
  font-size: 24rpx;
  color: var(--colorNeutralForeground1);
  padding: 0 4.267vw;
  margin-bottom: 3.200vw;
}

.Error {
  font-size: 22rpx;
  color: var(--colorPaletteRedBackground3);
  margin-bottom: 2.133vw;
}

.Submit {
  height: 9.600vw;
  background-color: var(--colorBrandBackground);
  border-radius: var(--borderRadiusLarge);
  display: flex;
  align-items: center;
  justify-content: center;
}

.SubmitText {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--colorNeutralForegroundOnBrand);
}

.Hint {
  font-size: 20rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 6.400vw;
}
</style>