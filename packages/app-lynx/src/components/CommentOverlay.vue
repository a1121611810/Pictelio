<script setup lang="ts">
// ─── 评论区底部弹层（app-lynx，issue #163 / spec #161） ───
// 弹层主体：遮罩 + 底部 80vh 面板。UI 形态蓝本 = prototype/variantSheet.vue 变体 A：
//   遮罩 @tap 关闭、面板 @tap.stop 防穿透、DOM 顺序靠后覆盖（不依赖 z-index）。
// 数据走 useComments（issue #162）：state 是 computed 聚合的只读快照，模板直接读
// state.comments / state.status 等；本组件负责生命周期（onMounted open、
// onBeforeUnmount dispose）与返回键拦截注册（modalStack，ADR-0066 扩展）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { CommentContentType } from '../api/comment'
import type { PixivComment } from '../api/types'
import type { CommentsState } from '../primitives/useComments'
import { useComments } from '../primitives/useComments'
import { registerModal } from '../stores/modalStack'
import CommentItem from './CommentItem.vue'
import CommentInputBar from './CommentInputBar.vue'

const props = defineProps<{
  type: CommentContentType
  targetId: number
}>()

const emit = defineEmits<{
  /** 请求关闭（遮罩 / × / 返回键）→ 外部 v-if 卸载本组件 */
  close: []
}>()

const controller = useComments({ type: props.type, targetId: props.targetId })
// state 是 getter 返回的只读快照 → 用 computed 包裹保持响应式（模板自动解包）
const state = computed<CommentsState>(() => controller.state)

// 回复态：点条目「回复」设置；提交成功清除
const replyingTo = ref<PixivComment | null>(null)

// 提交：post(text, replyingTo?.id)，成功清空回复态（输入栏自身已清空文本）
async function handleSubmit(text: string): Promise<void> {
  const ok = await controller.post(text, replyingTo.value?.id)
  if (ok) replyingTo.value = null
}

// 统一关闭路径：遮罩 / × / 返回键（modalStack 注册的回调）都走这里
function onClose(): void {
  emit('close')
}

// 删除 / 楼层展开：数据操作经 controller（useComments 是唯一写者）
function handleDelete(commentId: number): void {
  void controller.remove(commentId)
}
function handleToggleReplies(commentId: number): void {
  void controller.toggleReplies(commentId)
}

// 首屏错误重试
function retry(): void {
  void controller.open()
}

// 返回键拦截：挂载期间注册关闭回调（modalStack 后进先出），卸载时注销
let unregisterModal: (() => void) | null = null

onMounted(() => {
  void controller.open()
  unregisterModal = registerModal(onClose)
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
  controller.dispose()
})
</script>

<template>
  <!-- 根 view：relative 提供 absolute 弹层的定位上下文；与宿主内容平级、DOM 顺序靠后 → 天然覆盖上层 -->
  <view class="w-full h-full relative">
    <!-- 遮罩：absolute inset-0，@tap 关闭（调 onClose） -->
    <view class="absolute inset-0 bg-overlay" @tap="onClose" />

    <!-- 底部面板：@tap.stop 防面板内点击穿透到遮罩 -->
    <view
      class="absolute bottom-0 left-0 right-0 h-[80vh] bg-background rounded-t-[var(--borderRadiusXLarge)] flex flex-col"
      @tap.stop
    >
      <!-- header：居中「评论 (N)」+ 右侧关闭 × -->
      <view class="flex flex-row items-center h-[11.733vw] px-4 border-b-[1px] border-b-stroke-2 flex-shrink-0">
        <view class="w-[8vw]" />
        <text class="flex-1 text-center text-2xl font-semibold text-foreground">评论 ({{ state.comments.length }})</text>
        <view class="w-[8vw] h-[8vw] flex items-center justify-center" @tap="onClose">
          <text class="text-3xl text-foreground-2">×</text>
        </view>
      </view>

      <!-- 首屏加载：骨架（复用 App.vue 全局 shimmer） -->
      <view v-if="state.status === 'loading'" class="w-full flex-1 min-h-0 px-4 pt-4">
        <view v-for="n in 4" :key="n" class="flex flex-row items-start mb-5">
          <view class="shimmer w-[8vw] h-[8vw] rounded-[var(--borderRadiusCircular)] flex-shrink-0" />
          <view class="flex-1 ml-3">
            <view class="shimmer h-[4vw] w-[24vw] rounded-[var(--borderRadiusSmall)]" />
            <view class="shimmer h-[4vw] w-full mt-2 rounded-[var(--borderRadiusSmall)]" />
          </view>
        </view>
      </view>

      <!-- 首屏错误：全屏错误 + 重试按钮（open） -->
      <view
        v-else-if="state.status === 'error'"
        class="w-full flex-1 min-h-0 flex flex-col items-center justify-center"
      >
        <text class="text-sm text-danger px-8 text-center">{{ state.error ?? '加载失败，请重试' }}</text>
        <view
          class="mt-4 px-6 h-[9vw] bg-brand rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
          @tap="retry"
        >
          <text class="text-base font-semibold text-onBrand">重试</text>
        </view>
      </view>

      <!-- 就绪：分页失败 banner（保留列表）+ 评论列表 / 空态 -->
      <template v-else>
        <!-- state.error 且 status ready（分页失败 / post 后刷新失败）：列表上方 banner -->
        <view v-if="state.error" class="px-4 py-2 border-b border-b-stroke-2">
          <text class="text-xs text-danger">{{ state.error }}</text>
        </view>

        <!-- 空列表 -->
        <view
          v-if="state.comments.length === 0"
          class="w-full flex-1 min-h-0 flex flex-col items-center justify-center"
        >
          <text class="text-base text-foreground-3">还没有评论</text>
        </view>

        <!-- 评论列表：flex-1 min-h-0，独立垂直滚动；item-key 必须 String（ADR-0056） -->
        <list
          v-else
          class="w-full flex-1 min-h-0"
          list-type="single"
          scroll-orientation="vertical"
          :lower-threshold-item-count="5"
          @scrolltolower="controller.loadMore"
        >
          <list-item v-for="comment in state.comments" :key="comment.id" :item-key="String(comment.id)" class="w-full">
            <CommentItem
              :comment="comment"
              :deleting="state.deletingId === comment.id"
              :expanded="state.expandedIds.includes(comment.id)"
              @reply="replyingTo = comment"
              @delete="handleDelete(comment.id)"
              @toggle-replies="handleToggleReplies(comment.id)"
            />
            <!-- 楼层展开区：state.expandedIds 控制展开；内联渲染 replies[c.id]（缩进 + 左边框） -->
            <view v-if="state.expandedIds.includes(comment.id)" class="ml-[12vw] pl-4 border-l border-l-stroke-2">
              <CommentItem
                v-for="reply in state.replies[comment.id] ?? []"
                :key="reply.id"
                :comment="reply"
                :deleting="state.deletingId === reply.id"
                hide-thread-toggle
                @reply="replyingTo = reply"
                @delete="handleDelete(reply.id)"
              />
            </view>
          </list-item>
          <!-- state.hasMore 为 false：没有更多了 footer -->
          <list-item
            v-if="!state.hasMore"
            :key="'footer'"
            item-key="footer"
            full-span
            class="w-full h-10 flex items-center justify-center"
          >
            <text class="text-xs text-foreground-3">没有更多了</text>
          </list-item>
        </list>
      </template>

      <!-- 底部输入栏：actionError 在输入栏区域展示 -->
      <view class="w-full flex-shrink-0">
        <CommentInputBar
          :posting="state.posting"
          :error="state.actionError"
          :replying-to="replyingTo"
          @submit="handleSubmit"
          @cancel-reply="replyingTo = null"
        />
      </view>
    </view>
  </view>
</template>
