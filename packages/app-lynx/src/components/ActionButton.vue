<!-- 小说介绍页次级动作按钮基础组件（spec docs/specs/app-lynx-novel-intro-action-row §5.1）。
     - 视觉族：图标 + 短文字 chip，等宽四列，遮罩黑色背景上够清晰
     - 三态：default（white/85）、active（text-tertiary，M3 tertiary 实色）、disabled（opacity-50 + pointer-events-none）
     - i18n 不在此处处理：label 由父组件传入已翻译文本（spec 设计：组件本身无 i18n 依赖，纯展示）
     - ADR-0123 合规：pointer-events-none 仅用于真正的 disabled 态，不用于「全屏遮罩期望下层穿透」的反模式
     - ADR-0086：图标 / 间距一律 vw（具体值取自 spec §5.1），不写 rem -->
<script setup lang="ts">
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const props = defineProps<{
  /** 图标字符（unicode emoji 或文本符号，沿用项目 NavigationBar 同款 unicode 约定） */
  icon: string
  /** 标签文字（如「收藏」「追更」「下载」「目录」，已翻译文本由父组件传入） */
  label: string
  /** 已激活态（如已追更 / 已下载）—— 文字切 text-tertiary */
  active: boolean
  /** 禁用态（如 masked R-18/R-18G/AI 屏蔽态）—— opacity-50 + 不响应 tap */
  disabled: boolean
}>()

const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <view
    class="flex-1 min-w-0 flex flex-col items-center justify-center py-2 rounded-[var(--md-shape-medium)]"
    :class="[
      disabled ? 'opacity-50 pointer-events-none' : 'active:bg-white/10',
      active ? 'text-tertiary' : 'text-white/85',
    ]"
    :accessibility-element="A11Y_ELEMENT_ENABLED"
    :accessibility-label="props.label"
    @tap="props.disabled ? null : emit('tap')"
  >
    <text class="text-[6.4vw] leading-none">{{ props.icon }}</text>
    <text class="text-label-small mt-1">{{ props.label }}</text>
  </view>
</template>
