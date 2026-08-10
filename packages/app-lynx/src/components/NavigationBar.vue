<script setup lang="ts">
// ─── M3 底部导航（NavigationBar，Material Design 3） ───
// 形态：80dp 高 + surface-container 背景；active 项图标置于 64×32dp
// secondary-container 胶囊指示器内（on-secondary-container 色），非 active
// 用 on-surface-variant；label 12sp。图标用 unicode 文本符号（Lynx 无 icon 库）。
// 顶层页（推荐/关注/小说/我的）接入；点击 navigate 到对应路由。
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

export interface NavTab {
  /** 路由名（router.ts routes[].name） */
  name: string
  /** 路由 path（navigate 目标） */
  path: string
  /** 图标 unicode 符号 */
  icon: string
  /** label 文本 */
  label: string
  /** accessibility-label（各页注册表传入，供 Appium 定位） */
  a11yLabel: string
}

const props = defineProps<{
  tabs: NavTab[]
  /** 当前激活的路由名 */
  activeName: string
}>()

const emit = defineEmits<{
  select: [tab: NavTab]
}>()
</script>

<template>
  <!-- M3 NavigationBar：高度 80dp=21.333vw，pt 容纳 64×32dp 指示器胶囊 -->
  <view class="w-full h-[21.333vw] bg-surface-container flex flex-row items-start justify-around pt-1.5 flex-shrink-0">
    <view
      v-for="tab in tabs"
      :key="tab.name"
      class="flex-1 flex flex-col items-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="tab.a11yLabel"
      @tap="emit('select', tab)"
    >
      <!-- 指示器胶囊：active 为 secondary-container 圆角胶囊（64×32dp） -->
      <view
        class="w-[17.067vw] h-[8.533vw] rounded-full flex items-center justify-center"
        :class="activeName === tab.name ? 'bg-secondary-container' : ''"
      >
        <text
          class="text-[6.4vw] leading-none"
          :class="activeName === tab.name ? 'text-secondary-on-container' : 'text-surface-on-variant'"
        >{{ tab.icon }}</text>
      </view>
      <!-- label：12sp≈24rpx，active on-surface / 非 active on-surface-variant -->
      <text
        class="text-label-medium font-medium mt-1"
        :class="activeName === tab.name ? 'text-surface-on' : 'text-surface-on-variant'"
      >{{ tab.label }}</text>
    </view>
  </view>
</template>
