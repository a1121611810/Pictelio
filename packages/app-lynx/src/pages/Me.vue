<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'me' })
import { ref, onMounted } from 'vue'
import { navigate, goBack, ensureAuth, resetHistory } from '../router'
import { currentUser, logout, isLoggedIn } from '../stores/authStore'
import { selectedClient, switchClient, availableKinds, supportsClientSwitch, type ClientKind } from '../stores/clientSwitchStore'
import { showR18, showR18G, setShowR18, setShowR18G, ugoiraMode, setUgoiraMode, detailQuality, setDetailQuality } from '../stores/settingsStore'
import type { ImageQuality } from '../utils/imageQuality'
import { proxyImageUrl } from '../utils/imageUrl'
import { ME_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import GlassCard from '../components/GlassCard.vue'

const switching = ref(false)

// 未登录守卫：跳登录页
onMounted(async () => {
  await ensureAuth()
})

function onLogout() {
  logout()
  // [lynx:fix] 登出 = 会话结束：清历史栈 + replace 导航，登录页不应被"返回"（ADR-0049）
  resetHistory()
  void navigate('/login', { replace: true })
}

function openBookmarks() {
  void navigate('/bookmarks')
}

function pickClient(kind: ClientKind) {
  if (selectedClient.value === kind || switching.value) return
  switching.value = true
  switchClient(kind)
  // switchClient 内部触发重启（原生桥或 reload），此处仅兜底
}

// ADR-0051：R18/R18G 开关（对齐主项目 settingsStore，默认隐藏，持久化 IndexedDB）
// T6：动图播放方案——Range 需二次确认
const ugoiraConfirm = ref(false)

function pickUgoiraMode(m: 'fflate' | 'range') {
  if (m === 'fflate') {
    ugoiraConfirm.value = false
    setUgoiraMode('fflate')
  } else {
    ugoiraConfirm.value = true // 显示二次确认（告知原生端限制）
  }
}

function confirmUgoiraRange() {
  setUgoiraMode('range')
  ugoiraConfirm.value = false
}

// issue #148 T2：详情画质档位（medium=标准 / large=高清 / original=原图）
function pickDetailQuality(q: ImageQuality) {
  setDetailQuality(q)
}

function toggleR18() {
  setShowR18(!showR18.value)
}
function toggleR18G() {
  setShowR18G(!showR18G.value)
}
</script>

<!--
  accessibility 标注约定（issue #103 / ADR-0061）：
  关键交互元素（@tap 容器）与页面标识文本必须标注
  accessibility-element（绑定 A11Y_ELEMENT_ENABLED 常量）+ accessibility-label
  （label 取自 src/utils/accessibility.ts 的 ME_A11Y_LABELS 注册表），否则不进入
  Android accessibility 树，Appium/UiAutomator 无法定位。新增关键交互元素前必须先
  在注册表登记 label（单测会断言注册表全部被模板消费）。纯增量标注，不改变视觉与
  交互行为。
-->
<template>
  <!-- [lynx:fix] 设置页滚动（issue #90）：header 固定在滚动容器外（与 Bookmarks/Recommended 同模式），
       内容由 scroll-view 承接溢出，web-core 与 native LynxView 行为一致 -->
  <view class="w-full h-full flex flex-col bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ME_A11Y_LABELS.back"
        @tap="goBack"
      >
        <text class="text-lg text-brand-foreground pr-4">‹ 返回</text>
      </view>
      <text
        class="flex-1 text-2xl font-semibold text-foreground"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ME_A11Y_LABELS.pageTitle"
        >我的</text
      >
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1">
      <!-- 账户组：用户信息 + 收藏入口（GlassCard：伪玻璃首个消费方，issue #97） -->
      <GlassCard class="mt-3 mx-3 p-4">
        <view v-if="currentUser" class="flex flex-row items-center pb-4 border-b-[1px] border-b-stroke-3">
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
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.bookmarks"
          @tap="openBookmarks"
        >
          <text class="text-lg text-foreground">我的收藏</text>
          <text class="text-lg text-foreground-3">›</text>
        </view>
      </GlassCard>

      <!-- 客户端组（ADR-0062：仅 full 包同时含 webview+lynx 时渲染；独立包隐藏） -->
      <view v-if="supportsClientSwitch(availableKinds)" class="bg-background mt-3 p-4">
        <text
          class="text-lg font-semibold text-foreground"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.clientGroupTitle"
          >客户端</text
        >
        <text class="text-xs text-foreground-3 mt-1 mb-3">选择渲染引擎后保存并重启生效</text>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-stroke-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.switchToWebview"
          @tap="pickClient('webview')"
        >
          <view class="flex flex-col">
            <text
              class="text-lg text-foreground"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webviewOptionTitle"
              >WebView（现有）</text
            >
            <text class="text-xs text-foreground-3 mt-0.5">SolidJS + Capacitor</text>
          </view>
          <view
            class="w-[4.8vw] h-[4.8vw] rounded-[2.4vw] border-2"
            :class="selectedClient === 'webview' ? 'border-brand-stroke bg-brand' : 'border-stroke'"
          />
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-stroke-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.switchToLynx"
          @tap="pickClient('lynx')"
        >
          <view class="flex flex-col">
            <text
              class="text-lg text-foreground"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.lynxOptionTitle"
              >Lynx（当前）</text
            >
            <text class="text-xs text-foreground-3 mt-0.5">vue-lynx 原生渲染</text>
          </view>
          <view
            class="w-[4.8vw] h-[4.8vw] rounded-[2.4vw] border-2"
            :class="selectedClient === 'lynx' ? 'border-brand-stroke bg-brand' : 'border-stroke'"
          />
        </view>
        <text v-if="switching" class="text-sm text-brand-foreground mt-3">正在重启切换…</text>
      </view>

      <!-- 内容组（ADR-0051：R18/R18G 开关） -->
      <view class="bg-background mt-3 p-4">
        <text class="text-lg font-semibold text-foreground">内容</text>
        <text class="text-xs text-foreground-3 mt-1 mb-3">默认隐藏 R-18 / R-18G 内容</text>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-stroke-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18Toggle"
          @tap="toggleR18"
        >
          <text class="text-lg text-foreground">显示 R-18 内容</text>
          <view
            class="w-[9.6vw] h-[5.33vw] rounded-full p-[0.53vw] flex flex-row transition-colors"
            :class="showR18 ? 'bg-brand justify-end' : 'bg-background-3 justify-start'"
          >
            <view class="w-[4.27vw] h-[4.27vw] rounded-full bg-white shadow-[var(--elevation2)]" />
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-stroke-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18gToggle"
          @tap="toggleR18G"
        >
          <text class="text-lg text-foreground">显示 R-18G 内容</text>
          <view
            class="w-[9.6vw] h-[5.33vw] rounded-full p-[0.53vw] flex flex-row transition-colors"
            :class="showR18G ? 'bg-brand justify-end' : 'bg-background-3 justify-start'"
          >
            <view class="w-[4.27vw] h-[4.27vw] rounded-full bg-white shadow-[var(--elevation2)]" />
          </view>
        </view>
      </view>

      <!-- T6：动图播放组 -->
      <view class="bg-background mt-3 p-4">
        <text class="text-lg font-semibold text-foreground">动图播放</text>
        <text class="text-xs text-foreground-3 mt-1 mb-3">Ugoira 动图取帧方式</text>
        <view class="flex flex-row gap-2">
          <view
            class="flex-1 py-3 rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
            :class="ugoiraMode === 'fflate' ? 'bg-brand' : 'bg-background-3'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraFflate"
            @tap="pickUgoiraMode('fflate')"
          >
            <text class="text-base" :class="ugoiraMode === 'fflate' ? 'text-onBrand' : 'text-foreground'">fflate（默认）</text>
          </view>
          <view
            class="flex-1 py-3 rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
            :class="ugoiraMode === 'range' ? 'bg-brand' : 'bg-background-3'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraRange"
            @tap="pickUgoiraMode('range')"
          >
            <text class="text-base" :class="ugoiraMode === 'range' ? 'text-onBrand' : 'text-foreground'">Range 流式</text>
          </view>
        </view>
        <text class="text-xs text-foreground-3 mt-2 leading-snug">
          Range 流式按需取帧、内存更低；原生端依赖 Range 支持，个别网络环境可能更慢。
        </text>
        <!-- 二次确认（选择 Range 时） -->
        <view v-if="ugoiraConfirm" class="mt-3 p-3 bg-background-3 rounded-[var(--borderRadiusLarge)]">
          <text class="text-sm text-foreground">确认切换到 Range 流式？</text>
          <view class="flex flex-row mt-2 gap-2">
            <view
              class="flex-1 py-2 bg-brand rounded-[var(--borderRadiusMedium)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.ugoiraConfirm"
              @tap="confirmUgoiraRange"
            >
              <text class="text-base text-onBrand">确认</text>
            </view>
            <view
              class="flex-1 py-2 bg-background rounded-[var(--borderRadiusMedium)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.ugoiraCancel"
              @tap="ugoiraConfirm = false"
            >
              <text class="text-base text-foreground">取消</text>
            </view>
          </view>
        </view>
      </view>

      <!-- issue #148 T2：详情画质档位组（medium=标准 / large=高清 / original=原图） -->
      <view class="bg-background mt-3 p-4">
        <text class="text-lg font-semibold text-foreground">详情画质</text>
        <text class="text-xs text-foreground-3 mt-1 mb-3">列表缩略图 / 详情大图清晰度</text>
        <view class="flex flex-row gap-2">
          <view
            class="flex-1 py-3 rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
            :class="detailQuality === 'medium' ? 'bg-brand' : 'bg-background-3'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityMedium"
            @tap="pickDetailQuality('medium')"
          >
            <text class="text-base" :class="detailQuality === 'medium' ? 'text-onBrand' : 'text-foreground'">标准</text>
          </view>
          <view
            class="flex-1 py-3 rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
            :class="detailQuality === 'large' ? 'bg-brand' : 'bg-background-3'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityLarge"
            @tap="pickDetailQuality('large')"
          >
            <text class="text-base" :class="detailQuality === 'large' ? 'text-onBrand' : 'text-foreground'">高清</text>
          </view>
          <view
            class="flex-1 py-3 rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
            :class="detailQuality === 'original' ? 'bg-brand' : 'bg-background-3'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityOriginal"
            @tap="pickDetailQuality('original')"
          >
            <text class="text-base" :class="detailQuality === 'original' ? 'text-onBrand' : 'text-foreground'">原图</text>
          </view>
        </view>
      </view>

      <!-- 退出登录（危险操作独立沉底） -->
      <view class="bg-background mt-3 p-4">
        <view
          class="py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.logout"
          @tap="onLogout"
        >
          <text class="text-lg text-danger">退出登录</text>
        </view>
      </view>
      <!-- 底部留白：让滚动到底时最后一张卡片不贴底 -->
      <view class="h-[8vw]" />
    </scroll-view>
  </view>
</template>
