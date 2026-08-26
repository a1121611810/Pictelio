<script setup lang="ts">
// ─── 追更询问弹窗（app-lynx，issue #224 / spec app-lynx-novel-series-watchlist §US5） ───
// M3 Dialog：fixed scrim + surface-container-high 居中卡片 + md-shape-extra-large
// （结构对齐 Me.vue ugoiraConfirm Dialog 与 Watchlist.vue 取消追更确认）。
//
// 语义边界（与 createWatchlistPrompt 一一对应）：
//   decline（「暂不」按钮）→ dismiss + 关弹窗，页面层**继续原返回动作**
//   cancel （返回键关弹窗）→ dismiss + 关弹窗，页面层**留在详情页**
//   两者是不同事件，页面层据此区分后续动作；dismiss 语义在 primitive 内完成。
//
// 返回键拦截：open 期间 registerModal 注册关闭回调（= cancel），
// router.handleSystemBack 的 modalStack 优先于页面返回（ADR-0066 扩展）；
// 关闭/卸载时注销。closeTopModal pop 后调用 → 本组件 emit('cancel')。
import { watch, onBeforeUnmount } from 'vue'
import { registerModal } from '../stores/modalStack'
import { WATCHLIST_PROMPT_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const props = defineProps<{
  /** 弹窗显隐（createWatchlistPrompt.dialogOpen） */
  open: boolean
  /** 系列标题（当前小说 novel.series.title） */
  seriesTitle: string
  /** 作者名（当前小说 novel.user.name） */
  authorName: string
  /** 追更请求在飞（dialogBusy）：禁用「追更」防连点 */
  busy: boolean
  /** 追更失败错误信息（dialogError）：非空显示错误条，「追更」保留可重试 */
  errorMsg: string
}>()

const emit = defineEmits<{
  /** 「追更」：primitive.confirm() */
  confirm: []
  /** 「暂不」：primitive.decline()（页面层继续返回） */
  decline: []
  /** 返回键关弹窗：primitive.cancel()（页面层留在详情页） */
  cancel: []
}>()

function onConfirm(): void {
  if (props.busy) return
  emit('confirm')
}

// 返回键拦截：open 翻转时注册/注销关闭回调（modalStack 后进先出）
let unregisterModal: (() => void) | null = null

watch(
  () => props.open,
  (open) => {
    if (open && !unregisterModal) {
      unregisterModal = registerModal(() => emit('cancel'))
    } else if (!open && unregisterModal) {
      unregisterModal()
      unregisterModal = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
})
</script>

<template>
  <!-- M3 Dialog：fixed 全屏 scrim 遮罩 + 居中卡片（对齐 Me.vue ugoiraConfirm / Watchlist.vue 确认弹窗） -->
  <view
    v-if="open"
    class="fixed inset-0 bg-scrim z-50 flex items-center justify-center"
    :accessibility-element="A11Y_ELEMENT_ENABLED"
    :accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.dialog"
  >
    <view class="w-[74.667vw] max-w-[74.667vw] bg-surface-container-high rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]">
      <text class="text-headline-small font-medium text-surface-on">追更这个系列？</text>
      <text class="text-body-medium text-surface-on-variant mt-4 leading-snug">
        《{{ seriesTitle }}》· {{ authorName }}
      </text>
      <text class="text-body-small text-surface-on-variant mt-1.5 leading-snug">
        追更后可在「我的 → 追更列表」查看最新更新
      </text>

      <!-- 追更失败错误条（M3 error token）：保留「追更」可重试 -->
      <view v-if="errorMsg" class="mt-3 px-3 py-2 bg-error-container rounded-[var(--md-shape-small)]">
        <text class="text-label-medium text-error-on-container">{{ errorMsg }}</text>
      </view>

      <view class="flex flex-row justify-end mt-6 gap-2">
        <view
          class="h-[10.667vw] px-4 flex items-center justify-center active:bg-layer-pressed-primary"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.decline"
          @tap="emit('decline')"
        >
          <text class="text-label-large font-medium text-primary">暂不</text>
        </view>
        <!-- busy 禁用态：opacity-40 + tap 守卫（防连点，对齐 createBookmarkToggle busy 语义） -->
        <view
          class="h-[10.667vw] px-4 flex items-center justify-center"
          :class="busy ? 'opacity-40' : 'active:bg-layer-pressed-primary'"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.confirm"
          @tap="onConfirm"
        >
          <text class="text-label-large font-medium" :class="busy ? 'text-surface-on-variant' : 'text-primary'">追更</text>
        </view>
      </view>
    </view>
  </view>
</template>
