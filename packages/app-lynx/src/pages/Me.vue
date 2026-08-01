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
  height: 11.733vw;
  padding: 0 4.267vw;
  background-color: var(--colorNeutralBackground1);
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke2);
}

.Back {
  font-size: 26rpx;
  color: var(--colorBrandForeground1);
  padding-right: 4.267vw;
}

.AppBarTitle {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
}

.Profile {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 5.333vw 4.267vw;
  background-color: var(--colorNeutralBackground1);
}

.Avatar {
  width: 12.800vw;
  height: 12.800vw;
  border-radius: 6.400vw;
  background-color: var(--colorNeutralBackground3);
}

.ProfileInfo {
  margin-left: 4.267vw;
  display: flex;
  flex-direction: column;
}

.Name {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--colorNeutralForeground1);
}

.Account {
  font-size: 22rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 1.067vw;
}

.Section {
  background-color: var(--colorNeutralBackground1);
  margin-top: 3.200vw;
  padding: 4.267vw;
}

.SectionTitle {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
}

.SectionDesc {
  font-size: 20rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 1.067vw;
  margin-bottom: 3.200vw;
}

.OptionRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 3.733vw 0;
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke3);
}

.OptionText {
  display: flex;
  flex-direction: column;
}

.OptionLabel {
  font-size: 26rpx;
  color: var(--colorNeutralForeground1);
}

.OptionSub {
  font-size: 20rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 0.533vw;
}

.Radio {
  width: 4.800vw;
  height: 4.800vw;
  border-radius: 2.400vw;
  border-width: 2px;
  border-color: var(--colorNeutralStroke1);
}

.Radio.Checked {
  border-color: var(--colorBrandStroke1);
  background-color: var(--colorBrandBackground);
}

.Switching {
  font-size: 22rpx;
  color: var(--colorBrandForeground1);
  margin-top: 3.200vw;
}

.DangerRow {
  padding: 3.733vw 0;
}

.Danger {
  font-size: 26rpx;
  color: var(--colorPaletteRedBackground3);
}
</style>