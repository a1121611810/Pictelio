<script setup lang="ts">
// ─── 评论输入栏（app-lynx，issue #163 / spec #161） ───
// 原生 input（Login.vue 同款：显式 box-border + 去 UA 边框 + placeholder-color）。
// 发送约束：空输入 / 超 2000 字 / 发送中 均禁用；emit('submit', text) 后清空自身输入，
// 回复态由父层（CommentOverlay）在提交成功后清除。
import { ref, computed } from 'vue'
import type { PixivComment } from '../api/types'
import { MAX_COMMENT_LENGTH } from '../api/comment'

const props = defineProps<{
  /** 发表中：发送按钮禁用并显示「发送中…」 */
  posting: boolean
  /** 操作类错误（发送/删除/楼层失败），展示在输入栏区域 */
  error: string | null
  /** 回复态：非空时显示「回复 xxx」提示条 + 取消 */
  replyingTo: PixivComment | null
}>()

const emit = defineEmits<{
  submit: [text: string]
  cancelReply: []
}>()

const text = ref('')

// 可发送：非空、未超 2000 字、未发送中
const canSend = computed(() => {
  const t = text.value.trim()
  return t.length > 0 && t.length <= MAX_COMMENT_LENGTH && !props.posting
})

function send() {
  if (!canSend.value) return
  emit('submit', text.value)
  // 发送后清空输入（prototype 同款）；回复态由父层按 post 结果清除
  text.value = ''
}
</script>

<template>
  <view class="w-full bg-background border-t border-t-stroke-2 px-3 py-2">
    <!-- 回复态提示条：回复 xxx + 取消 -->
    <view v-if="replyingTo" class="flex flex-row items-center justify-between mb-2">
      <text class="text-xs text-brand-foreground [max-line:1] flex-1">回复 {{ replyingTo.user.name }}</text>
      <text class="text-xs text-foreground-3 underline ml-2" @tap="emit('cancelReply')">取消</text>
    </view>

    <!-- 操作类错误（发表失败等）：输入栏区域展示 -->
    <text v-if="error" class="text-xs text-danger mb-2">{{ error }}</text>

    <view class="flex flex-row items-center gap-2">
      <!-- [lynx:fix] input 显式 border-box + 去 UA 边框（Login.vue 同款，ADR-0055） -->
      <input
        v-model="text"
        class="flex-1 h-[8.5vw] box-border border-0 bg-background-3 rounded-[var(--borderRadiusLarge)] text-base text-foreground px-3"
        placeholder="写下评论…"
        placeholder-color="#a19f9d"
      />
      <!-- 发送按钮：空输入 / 超长 / 发送中禁用 -->
      <view
        class="h-[8.5vw] px-5 flex items-center justify-center rounded-[var(--borderRadiusLarge)] flex-shrink-0"
        :class="canSend ? 'bg-brand' : 'bg-background-3'"
        @tap="send"
      >
        <text class="text-base font-semibold" :class="canSend ? 'text-onBrand' : 'text-foreground-3'">
          {{ posting ? '发送中…' : '发送' }}
        </text>
      </view>
    </view>
  </view>
</template>
