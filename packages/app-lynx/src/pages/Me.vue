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
  <view class="Page">
    <view class="AppBar">
      <text class="Back" @tap="goBack">‹ 返回</text>
      <text class="AppBarTitle">我的</text>
    </view>

    <view v-if="currentUser" class="Profile">
      <image
        class="Avatar"
        :src="
          proxyImageUrl(
            currentUser.profile_image_urls?.px_170x170 ||
              currentUser.profile_image_urls?.medium ||
              '',
          )
        "
      />
      <view class="ProfileInfo">
        <text class="Name">{{ currentUser.name }}</text>
        <text class="Account">@{{ currentUser.account }}</text>
      </view>
    </view>

    <view class="Section">
      <text class="SectionTitle">Client 切换</text>
      <text class="SectionDesc">选择渲染引擎后保存并重启生效</text>
      <view class="OptionRow" @tap="pickClient('webview')">
        <view class="OptionText">
          <text class="OptionLabel">WebView（现有）</text>
          <text class="OptionSub">SolidJS + Capacitor</text>
        </view>
        <view class="Radio" :class="{ Checked: selectedClient === 'webview' }" />
      </view>
      <view class="OptionRow" @tap="pickClient('lynx')">
        <view class="OptionText">
          <text class="OptionLabel">Lynx（当前）</text>
          <text class="OptionSub">vue-lynx 原生渲染</text>
        </view>
        <view class="Radio" :class="{ Checked: selectedClient === 'lynx' }" />
      </view>
      <text v-if="switching" class="Switching">正在重启切换…</text>
    </view>

    <view class="Section">
      <view class="DangerRow" @tap="onLogout">
        <text class="Danger">退出登录</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.Page {
  width: 100%;
  height: 100%;
  background-color: var(--colorNeutralBackground2);
}

.AppBar {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 88px;
  padding: 0 16px;
  background-color: var(--colorNeutralBackground1);
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke2);
}

.Back {
  font-size: 26px;
  color: var(--colorBrandForeground1);
  padding-right: 16px;
}

.AppBarTitle {
  flex: 1;
  font-size: 30px;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
}

.Profile {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 20px 16px;
  background-color: var(--colorNeutralBackground1);
}

.Avatar {
  width: 96px;
  height: 96px;
  border-radius: 48px;
  background-color: var(--colorNeutralBackground3);
}

.ProfileInfo {
  margin-left: 16px;
  display: flex;
  flex-direction: column;
}

.Name {
  font-size: 32px;
  font-weight: 700;
  color: var(--colorNeutralForeground1);
}

.Account {
  font-size: 22px;
  color: var(--colorNeutralForeground3);
  margin-top: 4px;
}

.Section {
  background-color: var(--colorNeutralBackground1);
  margin-top: 12px;
  padding: 16px;
}

.SectionTitle {
  font-size: 26px;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
}

.SectionDesc {
  font-size: 20px;
  color: var(--colorNeutralForeground3);
  margin-top: 4px;
  margin-bottom: 12px;
}

.OptionRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke3);
}

.OptionText {
  display: flex;
  flex-direction: column;
}

.OptionLabel {
  font-size: 26px;
  color: var(--colorNeutralForeground1);
}

.OptionSub {
  font-size: 20px;
  color: var(--colorNeutralForeground3);
  margin-top: 2px;
}

.Radio {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  border-width: 2px;
  border-color: var(--colorNeutralStroke1);
}

.Radio.Checked {
  border-color: var(--colorBrandStroke1);
  background-color: var(--colorBrandBackground);
}

.Switching {
  font-size: 22px;
  color: var(--colorBrandForeground1);
  margin-top: 12px;
}

.DangerRow {
  padding: 14px 0;
}

.Danger {
  font-size: 26px;
  color: var(--colorPaletteRedBackground3);
}
</style>
