<script setup lang="ts">
// ─── 评论条目（app-lynx，issue #163 / spec #161） ───
// 根评论与楼层回复共用；纯渲染组件——数据来自 props，操作（回复 / 展开楼层 / 删除）
// 通过 emit 上报给 CommentOverlay（数据写操作只经 useComments，本组件不 import 数据层）。
// 删除权限在渲染层判定：currentUser.id === comment.user.id 时显示删除（删除中置灰 + 「删除中…」）。
import { computed } from 'vue'
import type { PixivComment, PixivCommentParent } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { proxyImageUrl } from '../utils/imageUrl'
import SkeletonImage from './SkeletonImage.vue'

const props = defineProps<{
  comment: PixivComment
  /** 正在删除的置灰态（Overlay 按 state.deletingId 判定传入） */
  deleting?: boolean
  /** 楼层是否已展开：控制「展开/收起回复」文案 */
  expanded?: boolean
  /** 楼层回复内嵌时不显示「展开楼层」操作（避免回复的回复无限嵌套） */
  hideThreadToggle?: boolean
}>()

const emit = defineEmits<{
  reply: []
  delete: []
  toggleReplies: []
}>()

// 相对时间（参考 webview CommentList formatDate）：刚刚 / N分钟前 / N小时前 / N天前，30 天后落日期
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay}天前`
  return d.toLocaleDateString('zh-CN')
}

// 楼层引用：parent_comment 可能是空对象（Record<string, never>），运行时判定后归一
const parent = computed<PixivCommentParent | null>(() => {
  const p = props.comment.parent_comment
  if (p && 'id' in p && p.id) return p as PixivCommentParent
  return null
})

// 头像 URL：medium 经本地代理；无图时走色块 + 首字兜底
const avatarUrl = computed(() => proxyImageUrl(props.comment.user.profile_image_urls?.medium || ''))

// 删除权限：仅本人可见（渲染层判定；currentUser 可能为 null）
const isMine = computed(() => useAuthStore().currentUser?.id === props.comment.user.id)
</script>

<template>
  <view
    class="w-full px-4 py-3 flex flex-row items-start border-b border-b-outline-variant"
    :class="{ 'opacity-50': deleting }"
  >
    <!-- 头像：有图用 SkeletonImage（代理 URL + 懒加载），无图色块 + 首字兜底 -->
    <view class="w-[10.667vw] h-[10.667vw] flex-shrink-0 overflow-hidden">
      <SkeletonImage
        v-if="avatarUrl"
        :src="avatarUrl"
        aspect-ratio="1 / 1"
        min-h="8vw"
        class="w-[10.667vw] h-[10.667vw] rounded-full"
        lazy-load
      />
      <view
        v-else
        class="w-full h-full bg-surface-container-highest border border-outline-variant rounded-full flex items-center justify-center"
      >
        <text class="text-title-medium font-medium text-primary">{{ comment.user.name.charAt(0) }}</text>
      </view>
    </view>

    <view class="flex-1 ml-3 min-w-0">
      <!-- 用户名 + 相对时间 -->
      <view class="flex flex-row items-center gap-2">
        <text class="text-title-small font-medium text-surface-on">{{ comment.user.name }}</text>
        <text class="text-label-medium text-outline">{{ formatDate(comment.date) }}</text>
      </view>

      <!-- 楼层引用块：回复 xxx：… -->
      <view v-if="parent" class="mt-1.5 px-2.5 py-1.5 bg-surface-container-highest rounded-[var(--md-shape-extra-small)]">
        <text class="text-label-medium text-surface-on-variant line-clamp-1">
          回复 {{ parent.user.name }}：{{ parent.comment }}
        </text>
      </view>

      <!-- 评论正文 -->
      <text class="text-body-medium text-surface-on mt-1.5 leading-[1.4]">{{ comment.comment }}</text>

      <!-- 操作行：回复 / 展开楼层（has_replies 时）/ 删除（本人时，删除中置灰） -->
      <view class="flex flex-row items-center gap-5 mt-2">
        <text class="text-label-medium text-outline" @tap="emit('reply')">回复</text>
        <text
          v-if="comment.has_replies && !hideThreadToggle"
          class="text-label-medium text-primary underline"
          @tap="emit('toggleReplies')"
        >
          {{ expanded ? '收起回复' : `展开 ${comment.reply_count ?? 0} 条回复` }}
        </text>
        <text v-if="isMine && !deleting" class="text-label-medium text-outline" @tap="emit('delete')">删除</text>
        <text v-if="isMine && deleting" class="text-label-medium text-error">删除中…</text>
      </view>
    </view>
  </view>
</template>
