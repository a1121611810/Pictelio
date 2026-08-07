<script setup lang="ts">
// ─── PROTOTYPE（throwaway）：评论输入栏共享组件 ───
// 假发送：清空输入 + 清回复态，不做真实 API 调用。
import { ref } from 'vue'

const text = ref('')
const replyingTo = ref<string | null>(null)

function send() {
  if (!text.value.trim()) return
  // PROTOTYPE：不真正发送，仅演示交互
  text.value = ''
  replyingTo.value = null
}
</script>

<template>
  <view class="w-full bg-background border-t border-t-stroke-2 px-3 py-2">
    <!-- 回复态提示条 -->
    <view v-if="replyingTo" class="flex flex-row items-center justify-between mb-2">
      <text class="text-xs text-brand-foreground">回复 {{ replyingTo }}</text>
      <text class="text-xs text-foreground-3 underline" @tap="replyingTo = null">取消</text>
    </view>

    <view class="flex flex-row items-center gap-2">
      <!-- [lynx:fix] input 显式 border-box + 去 UA 边框（Login.vue 同款，ADR-0055） -->
      <input
        v-model="text"
        class="flex-1 h-[8.5vw] box-border border-0 bg-background-3 rounded-[var(--borderRadiusLarge)] text-base text-foreground px-3"
        placeholder="写下评论…"
        placeholder-color="#a19f9d"
      />
      <view
        class="h-[8.5vw] px-5 flex items-center justify-center rounded-[var(--borderRadiusLarge)]"
        :class="text.trim() ? 'bg-brand' : 'bg-background-3'"
        @tap="send"
      >
        <text class="text-base font-semibold" :class="text.trim() ? 'text-onBrand' : 'text-foreground-3'">
          发送
        </text>
      </view>
    </view>
  </view>
</template>
