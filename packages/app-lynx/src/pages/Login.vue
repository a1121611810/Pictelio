<script setup lang="ts">
import { ref } from 'vue'
import { navigate } from '../router'
import { loginWithToken, loginWithCredentials, isLoggedIn } from '../stores/authStore'
import { authError } from '../stores/authStore'

const tokenInput = ref('')
const submitting = ref(false)
const errorMsg = ref('')
const mode = ref<'token' | 'password'>('token')
const username = ref('')
const password = ref('')

async function submit() {
  if (submitting.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    if (mode.value === 'token') {
      await loginWithToken(tokenInput.value)
    } else {
      await loginWithCredentials(username.value, password.value)
    }
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
      <view class="Tabs">
        <text class="Tab" :class="{ Active: mode === 'token' }" @tap="mode = 'token'">
          refresh_token
        </text>
        <text class="Tab" :class="{ Active: mode === 'password' }" @tap="mode = 'password'">
          用户名密码
        </text>
      </view>

      <input
        v-if="mode === 'token'"
        v-model="tokenInput"
        class="Input"
        placeholder="粘贴 Pixiv refresh_token"
        placeholder-color="#a19f9d"
      />
      <view v-else class="PwdFields">
        <input v-model="username" class="Input" placeholder="用户名" placeholder-color="#a19f9d" />
        <input
          v-model="password"
          class="Input"
          placeholder="密码"
          placeholder-color="#a19f9d"
          type="password"
        />
      </view>

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
  padding-top: 120px;
}

.Brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 40px;
}

.BrandTitle {
  font-size: 56px;
  font-weight: 700;
  color: var(--colorBrandForeground1);
}

.BrandSub {
  font-size: 24px;
  color: var(--colorNeutralForeground3);
  margin-top: 8px;
}

.Card {
  width: 85%;
  background-color: var(--colorNeutralBackground1);
  border-radius: var(--borderRadius2XLarge);
  padding: 24px;
  box-shadow: var(--elevation4);
}

.Tabs {
  display: flex;
  flex-direction: row;
  margin-bottom: 16px;
}

.Tab {
  font-size: 24px;
  color: var(--colorNeutralForeground2);
  padding: 8px 16px;
  border-radius: var(--borderRadiusMedium);
}

.Tab.Active {
  color: var(--colorBrandForeground1);
  font-weight: 600;
  background-color: var(--colorNeutralBackground3);
}

.Input {
  width: 100%;
  height: 72px;
  background-color: var(--colorNeutralBackground3);
  border-radius: var(--borderRadiusLarge);
  font-size: 24px;
  color: var(--colorNeutralForeground1);
  padding: 0 16px;
  margin-bottom: 12px;
}

.PwdFields {
  display: flex;
  flex-direction: column;
}

.Error {
  font-size: 22px;
  color: var(--colorPaletteRedBackground3);
  margin-bottom: 8px;
}

.Submit {
  height: 72px;
  background-color: var(--colorBrandBackground);
  border-radius: var(--borderRadiusLarge);
  display: flex;
  align-items: center;
  justify-content: center;
}

.SubmitText {
  font-size: 28px;
  font-weight: 600;
  color: var(--colorNeutralForegroundOnBrand);
}

.Hint {
  font-size: 20px;
  color: var(--colorNeutralForeground3);
  margin-top: 24px;
}
</style>
