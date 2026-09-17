<script setup lang="ts">
// ─── 简介全文面板（spec #585 / 票 #587；#584 决策：D 案 scrim 仅容 2 行截断，全文走弹层）───
// 挂载契约同 CommentOverlay/NovelExportSheet：父页 v-if 挂载 + absolute inset-0 宿主
// （脱离文档流，issue #139 布局流约束）；挂载时注册 modalStack（返回键优先关面板），
// 卸载时注销；面板 @tap.stop 防穿透，遮罩 @tap 关闭。无 IO——纯展示。
import { onBeforeUnmount, onMounted } from 'vue'
import { useModalStack } from '../stores/modalStack'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t } from '../i18n'

defineProps<{
  /** 简介全文（父页保证非空时才可打开；受限态入口置灰不会挂载） */
  caption: string
}>()

const emit = defineEmits<{
  /** 请求关闭（遮罩 / ✕ / 返回键）→ 外部 v-if 卸载本组件 */
  close: []
}>()

// 返回键拦截：挂载期间注册关闭回调（modalStack 后进先出），卸载时注销
let unregisterModal: (() => void) | null = null

onMounted(() => {
  unregisterModal = useModalStack().registerModal(() => emit('close'))
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
})
</script>

<template>
  <view class="absolute inset-0 flex flex-col justify-end" @tap="emit('close')">
    <view
      class="bg-surface-container-high rounded-t-[var(--md-shape-large)] px-5 pt-4 pb-[10vw]"
      @tap.stop
    >
      <view class="flex flex-row items-center justify-between mb-3">
        <text class="text-title-medium font-medium text-surface-on">{{ t('novelIntro.captionTitle') }}</text>
        <view
          class="min-h-12 min-w-12 flex items-center justify-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelIntro.closeA11y')"
          @tap="emit('close')"
        >
          <text class="text-title-medium text-surface-on">✕</text>
        </view>
      </view>
      <!-- 显式高度滚动区（真机 LynxView 下 scroll-view 需有界高度） -->
      <scroll-view class="h-[100vw]" scroll-orientation="vertical">
        <text class="text-body-medium text-surface-on-variant leading-[1.6]">{{ caption }}</text>
      </scroll-view>
    </view>
  </view>
</template>
