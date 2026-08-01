<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { navigate, goBack, ensureAuth } from '../router'
import { currentUser, logout, isLoggedIn } from '../stores/authStore'
import { selectedClient, switchClient, type ClientKind } from '../stores/clientSwitchStore'
import { proxyImageUrl } from '../utils/imageUrl'

const switching = ref(false)

// 未登录守卫：跳登录页
onMounted(async () => {
  await ensureAuth()
})

function onLogout() {
  logout()
  void navigate('/login')
}

function pickClient(kind: ClientKind) {
  if (selectedClient.value === kind || switching.value) return
  switching.value = true
  switchClient(kind)
  // switchClient 内部触发重启（原生桥或 reload），此处仅兜底
}
</script>

<template>
  <view class="w-full h-full bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <text class="text-lg text-brand-foreground pr-4" @tap="goBack">‹ 返回</text>
      <text class="flex-1 text-2xl font-semibold text-foreground">我的</text>
    </view>

    <view v-if="currentUser" class="flex flex-row items-center py-5 px-4 bg-background">
      <image
        class="w-12 h-12 rounded-[6.4vw] bg-background-3"
        :src="
          proxyImageUrl(
            currentUser.profile_image_urls?.px_170x170 ||
              currentUser.profile_image_urls?.medium ||
              '',
          )
        "
      />
      <view class="ml-4 flex flex-col">
        <text class="text-3xl font-bold text-foreground">{{ currentUser.name }}</text>
        <text class="text-sm text-foreground-3 mt-1">@{{ currentUser.account }}</text>
      </view>
    </view>

    <view class="bg-background mt-3 p-4">
      <text class="text-lg font-semibold text-foreground">Client 切换</text>
      <text class="text-xs text-foreground-3 mt-1 mb-3">选择渲染引擎后保存并重启生效</text>
      <view
        class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-stroke-3"
        @tap="pickClient('webview')"
      >
        <view class="flex flex-col">
          <text class="text-lg text-foreground">WebView（现有）</text>
          <text class="text-xs text-foreground-3 mt-0.5">SolidJS + Capacitor</text>
        </view>
        <view
          class="w-[4.8vw] h-[4.8vw] rounded-[2.4vw] border-2"
          :class="selectedClient === 'webview' ? 'border-brand-stroke bg-brand' : 'border-stroke'"
        />
      </view>
      <view
        class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-stroke-3"
        @tap="pickClient('lynx')"
      >
        <view class="flex flex-col">
          <text class="text-lg text-foreground">Lynx（当前）</text>
          <text class="text-xs text-foreground-3 mt-0.5">vue-lynx 原生渲染</text>
        </view>
        <view
          class="w-[4.8vw] h-[4.8vw] rounded-[2.4vw] border-2"
          :class="selectedClient === 'lynx' ? 'border-brand-stroke bg-brand' : 'border-stroke'"
        />
      </view>
      <text v-if="switching" class="text-sm text-brand-foreground mt-3">正在重启切换…</text>
    </view>

    <view class="bg-background mt-3 p-4">
      <view class="py-3.5" @tap="onLogout">
        <text class="text-lg text-danger">退出登录</text>
      </view>
    </view>
  </view>
</template>
