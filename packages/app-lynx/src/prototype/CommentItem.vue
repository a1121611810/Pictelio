<script setup lang="ts">
// ─── PROTOTYPE（throwaway）：评论条目共享组件 ───
// 三变体共用；假数据 + 假交互，验证形态为主，不做真实删除/回复。
import type { MockComment } from './mockData'

defineProps<{
  comment: MockComment
  /** 正在删除的置灰态（演示用，不真正调 API） */
  deleting?: boolean
}>()
</script>

<template>
  <view
    class="w-full px-4 py-3 flex flex-row items-start border-b border-b-stroke-2"
    :class="{ 'opacity-50': deleting }"
  >
    <!-- 头像：色块 + 首字（prototype 不加载网络图） -->
    <view
      class="w-[8vw] h-[8vw] rounded-[var(--borderRadiusCircular)] bg-background-3 border border-stroke-2 flex items-center justify-center flex-shrink-0"
    >
      <text class="text-base font-semibold text-brand-foreground">{{ comment.user.name.charAt(0) }}</text>
    </view>

    <view class="flex-1 ml-3 min-w-0">
      <!-- 用户名 + 时间 -->
      <view class="flex flex-row items-center gap-2">
        <text class="text-sm font-semibold text-foreground">{{ comment.user.name }}</text>
        <text class="text-xs text-foreground-3">{{ comment.created_at }}</text>
      </view>

      <!-- 楼层引用（回复别人的评论时显示被引用内容） -->
      <view
        v-if="comment.parent_comment"
        class="mt-1.5 px-2.5 py-1.5 bg-background-3 rounded-[var(--borderRadiusSmall)]"
      >
        <text class="text-xs text-foreground-2 line-clamp-1">
          回复 {{ comment.parent_comment.user.name }}：{{ comment.parent_comment.comment }}
        </text>
      </view>

      <!-- 评论正文 -->
      <text class="text-base text-foreground mt-1.5 leading-[1.4]">{{ comment.comment }}</text>

      <!-- 操作行：回复 / 展开楼层 / 删除（演示态） -->
      <view class="flex flex-row items-center gap-5 mt-2">
        <text class="text-xs text-foreground-3">回复</text>
        <text v-if="comment.has_replies" class="text-xs text-foreground-3">
          展开 {{ comment.reply_count }} 条回复
        </text>
        <text v-if="deleting" class="text-xs text-danger">删除中…</text>
      </view>
    </view>
  </view>
</template>
