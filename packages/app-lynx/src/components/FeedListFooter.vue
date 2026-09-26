<script setup lang="ts">
// FeedListFooter —— 列表尾三态（公共层六组件之一，ADR-0194 / T1 #748；术语表「FeedListFooter
// （列表尾）」）。
//
// **加载中 / 分页错误 / 到底**三态互斥、props 驱动；作 list-item full-span **子内容**使用——
// 外层 <list-item v-if="loading || error || end" … full-span> 保留在各页（原生 <list> 只认
// list-item 子节点，组件自身不能替代它，spec D5）。
//
// 接口（调用方需要知道的全部）：
//   :loading       加载中态：true 渲染 loading-text
//   :error         分页错误文案（presentError 结果；非空 = 错误态，优先级低于 loading）
//   :end           到底态：loading / error 均不成立时渲染 end-text
//   :loading-text  加载中文案（调用方 i18n 注入；组件零文案，noDeadKeys 面不变）
//   :end-text      到底文案
//   :retry-text    可选：提供即渲染**可点重试**错误形态（Ranking 先例：错误文案 + 重试提示
//                  并排、整体可点）→ @retry 上抛；缺省 = 纯文本错误不可点
//                  （与绝大多数页面存量一致，不给存量页面凭空加点击热区）
//   @retry         重试形态错误段 tap → 上抛（loadMore 决策留调用方）
defineProps<{
  /** 加载中态 */
  loading?: boolean
  /** 分页错误文案（非空 = 错误态） */
  error?: string
  /** 到底态 */
  end?: boolean
  /** 加载中文案（调用方 i18n 注入，组件零文案） */
  loadingText?: string
  /** 到底文案 */
  endText?: string
  /** 重试形态提示文案；提供 = 错误段整体可点并上抛 @retry（Ranking 形态） */
  retryText?: string
}>()

const emit = defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <text v-if="loading" class="text-body-medium text-outline">{{ loadingText }}</text>
  <!-- 重试形态（Ranking 先例，spec §5.3）：错误 + 重试提示并排，整体可点 -->
  <view v-else-if="error && retryText" class="flex flex-row items-center" @tap="emit('retry')">
    <text class="text-body-medium text-error">{{ error }}</text>
    <text class="text-body-medium text-primary ml-2">{{ retryText }}</text>
  </view>
  <!-- 纯文本错误（缺省形态）：不可点，与存量多数页逐字一致 -->
  <text v-else-if="error" class="text-body-medium text-error">{{ error }}</text>
  <text v-else-if="end" class="text-body-medium text-outline">{{ endText }}</text>
</template>
