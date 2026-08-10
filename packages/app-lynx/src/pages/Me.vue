<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'me' })
import { ref, onMounted } from 'vue'
import { navigate, ensureAuth } from '../router'
import { currentUser, logout, isLoggedIn } from '../stores/authStore'
import { selectedClient, switchClient, availableKinds, supportsClientSwitch, type ClientKind } from '../stores/clientSwitchStore'
import { showR18, showR18G, setShowR18, setShowR18G, ugoiraMode, setUgoiraMode, detailQuality, setDetailQuality } from '../stores/settingsStore'
import type { ImageQuality } from '../utils/imageQuality'
import { proxyImageUrl } from '../utils/imageUrl'
import { ME_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import GlassCard from '../components/GlassCard.vue'
import NavigationBar, { type NavTab } from '../components/NavigationBar.vue'

// 底部导航 tabs：推荐/关注/小说/我的（本页）。M3 顶层页无返回箭头。
// me tab 的 a11yLabel 用静态文本（顶栏标题已标注 ME_A11Y_LABELS.pageTitle，
// 避免 Appium description 重复；NavigationBar 内部对每个 tab 渲染 element+label）。
const navTabs: NavTab[] = [
  { name: 'recommended', path: '/recommended', icon: '⌂', label: '推荐', a11yLabel: '推荐' },
  { name: 'following', path: '/following', icon: '♥', label: '关注', a11yLabel: '关注' },
  { name: 'novels', path: '/novels', icon: '✎', label: '小说', a11yLabel: '小说' },
  { name: 'me', path: '/me', icon: '◎', label: '我的', a11yLabel: '我的' },
]

function onNavSelect(tab: NavTab) {
  if (tab.name === 'me') return
  void navigate(tab.path, { replace: true })
}

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
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头；pageTitle 标注保留（E2E 锚点） -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text
        class="text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ME_A11Y_LABELS.pageTitle"
        >我的</text
      >
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1">
      <!-- 账户组：用户信息 + 收藏入口（GlassCard = M3 elevated card） -->
      <GlassCard class="mt-3 mx-3 p-4">
        <view v-if="currentUser" class="flex flex-row items-center pb-4 border-b-[1px] border-b-outline-variant">
          <image
            class="w-[14.933vw] h-[14.933vw] rounded-full bg-surface-container-high"
            :src="
              proxyImageUrl(
                currentUser.profile_image_urls?.px_170x170 ||
                  currentUser.profile_image_urls?.medium ||
                  '',
              )
            "
          />
          <view class="ml-4 flex flex-col">
            <text class="text-headline-small font-bold text-surface-on">{{ currentUser.name }}</text>
            <text class="text-body-small text-surface-on-variant mt-1">@{{ currentUser.account }}</text>
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.bookmarks"
          @tap="openBookmarks"
        >
          <text class="text-title-medium text-surface-on">我的收藏</text>
          <text class="text-title-medium text-surface-on-variant">›</text>
        </view>
      </GlassCard>

      <!-- 客户端组（ADR-0062：仅 full 包同时含 webview+lynx 时渲染；独立包隐藏） -->
      <view v-if="supportsClientSwitch(availableKinds)" class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]">
        <text
          class="text-title-small font-medium text-surface-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.clientGroupTitle"
          >客户端</text
        >
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">选择渲染引擎后保存并重启生效</text>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.switchToWebview"
          @tap="pickClient('webview')"
        >
          <view class="flex flex-col">
            <text
              class="text-title-medium text-surface-on"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webviewOptionTitle"
              >WebView（现有）</text
            >
            <text class="text-label-medium text-surface-on-variant mt-0.5">SolidJS + Capacitor</text>
          </view>
          <!-- M3 radio button：选中 primary 实心 + on-primary 圆点，未选 outline 空心 -->
          <view
            class="w-[5.333vw] h-[5.333vw] rounded-full flex items-center justify-center"
            :class="selectedClient === 'webview' ? 'bg-primary' : 'border-2 border-outline'"
          >
            <view v-if="selectedClient === 'webview'" class="w-[2.667vw] h-[2.667vw] rounded-full bg-primary-on" />
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.switchToLynx"
          @tap="pickClient('lynx')"
        >
          <view class="flex flex-col">
            <text
              class="text-title-medium text-surface-on"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.lynxOptionTitle"
              >Lynx（当前）</text
            >
            <text class="text-label-medium text-surface-on-variant mt-0.5">vue-lynx 原生渲染</text>
          </view>
          <view
            class="w-[5.333vw] h-[5.333vw] rounded-full flex items-center justify-center"
            :class="selectedClient === 'lynx' ? 'bg-primary' : 'border-2 border-outline'"
          >
            <view v-if="selectedClient === 'lynx'" class="w-[2.667vw] h-[2.667vw] rounded-full bg-primary-on" />
          </view>
        </view>
        <text v-if="switching" class="text-body-small text-primary mt-3">正在重启切换…</text>
      </view>

      <!-- 内容组（ADR-0051：R18/R18G 开关） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]">
        <text class="text-title-small font-medium text-surface-on">内容</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">默认隐藏 R-18 / R-18G 内容</text>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18Toggle"
          @tap="toggleR18"
        >
          <text class="text-title-medium text-surface-on">显示 R-18 内容</text>
          <!-- M3 switch（官方 token v0.192）：轨道 52×32dp、选中 thumb 24dp / 未选中 16dp、
               未选中轨道 2dp outline 边框、按压 28dp（active: 变体，web-core 生效） -->
          <view
            class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
            :class="showR18 ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
          >
            <view class="rounded-full shadow-[var(--md-elevation-1)] active:w-[7.467vw] active:h-[7.467vw]" :class="showR18 ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18gToggle"
          @tap="toggleR18G"
        >
          <text class="text-title-medium text-surface-on">显示 R-18G 内容</text>
          <view
            class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
            :class="showR18G ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
          >
            <view class="rounded-full shadow-[var(--md-elevation-1)] active:w-[7.467vw] active:h-[7.467vw]" :class="showR18G ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
          </view>
        </view>
      </view>

      <!-- T6：动图播放组 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]">
        <text class="text-title-small font-medium text-surface-on">动图播放</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">Ugoira 动图取帧方式</text>
        <!-- M3 segmented button：容器 outline-variant 边框 + 全圆角，选中段 secondary-container -->
        <view class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline-variant overflow-hidden">
          <view
            class="flex-1 py-2.5 flex items-center justify-center"
            :class="ugoiraMode === 'fflate' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraFflate"
            @tap="pickUgoiraMode('fflate')"
          >
            <text class="text-label-large" :class="ugoiraMode === 'fflate' ? 'text-secondary-on-container' : 'text-surface-on-variant'">fflate（默认）</text>
          </view>
          <view
            class="flex-1 py-2.5 flex items-center justify-center"
            :class="ugoiraMode === 'range' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraRange"
            @tap="pickUgoiraMode('range')"
          >
            <text class="text-label-large" :class="ugoiraMode === 'range' ? 'text-secondary-on-container' : 'text-surface-on-variant'">Range 流式</text>
          </view>
        </view>
        <text class="text-label-medium text-surface-on-variant mt-2 leading-snug">
          Range 流式按需取帧、内存更低；原生端依赖 Range 支持，个别网络环境可能更慢。
        </text>
      </view>

      <!-- issue #148 T2：详情画质档位组（medium=标准 / large=高清 / original=原图） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]">
        <text class="text-title-small font-medium text-surface-on">详情画质</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">列表缩略图 / 详情大图清晰度</text>
        <!-- M3 segmented button（三档）：容器 outline-variant 边框 + 全圆角，选中段 secondary-container -->
        <view class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline-variant overflow-hidden">
          <view
            class="flex-1 py-2.5 flex items-center justify-center"
            :class="detailQuality === 'medium' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityMedium"
            @tap="pickDetailQuality('medium')"
          >
            <text class="text-label-large" :class="detailQuality === 'medium' ? 'text-secondary-on-container' : 'text-surface-on-variant'">标准</text>
          </view>
          <view
            class="flex-1 py-2.5 flex items-center justify-center"
            :class="detailQuality === 'large' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityLarge"
            @tap="pickDetailQuality('large')"
          >
            <text class="text-label-large" :class="detailQuality === 'large' ? 'text-secondary-on-container' : 'text-surface-on-variant'">高清</text>
          </view>
          <view
            class="flex-1 py-2.5 flex items-center justify-center"
            :class="detailQuality === 'original' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityOriginal"
            @tap="pickDetailQuality('original')"
          >
            <text class="text-label-large" :class="detailQuality === 'original' ? 'text-secondary-on-container' : 'text-surface-on-variant'">原图</text>
          </view>
        </view>
      </view>

      <!-- 退出登录（危险操作独立沉底） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]">
        <view
          class="py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.logout"
          @tap="onLogout"
        >
          <text class="text-title-medium text-error">退出登录</text>
        </view>
      </view>
      <!-- 底部留白：让滚动到底时最后一张卡片不贴底 -->
      <view class="h-[8vw]" />
    </scroll-view>

    <!-- M3 Dialog（二次确认，选择 Range 时）：fixed 全屏 scrim 遮罩 + 居中卡片 + 标题/内容/操作区 -->
    <view v-if="ugoiraConfirm" class="fixed inset-0 bg-scrim z-50 flex items-center justify-center">
      <view class="w-[74.667vw] max-w-[74.667vw] bg-surface-container-lowest rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]">
        <text class="text-headline-small font-medium text-surface-on">切换到 Range 流式？</text>
        <text class="text-body-medium text-surface-on-variant mt-2 leading-snug">
          Range 流式按需取帧、内存更低；原生端依赖 Range 支持，个别网络环境可能更慢。
        </text>
        <view class="flex flex-row justify-end mt-3 gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraCancel"
            @tap="ugoiraConfirm = false"
          >
            <text class="text-label-large font-medium text-primary">取消</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraConfirm"
            @tap="confirmUgoiraRange"
          >
            <text class="text-label-large font-medium text-primary">确认</text>
          </view>
        </view>
      </view>
    </view>

    <!-- M3 NavigationBar：底部四 tab -->
    <NavigationBar :tabs="navTabs" :active-name="'me'" @select="onNavSelect" />
  </view>
</template>
