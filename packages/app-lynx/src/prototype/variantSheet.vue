<script setup lang="ts">
// ─── PROTOTYPE（throwaway）：变体 A —— 评论区底部弹层 ───
// 验证问题：「absolute 覆盖层挂在页面根 view 上」在 lynx 的定位/遮罩/独立滚动行为。
// 结构：弹层（遮罩 + 底部面板）与宿主 scroll-view 平级（兄弟节点），absolute 相对根 view 定位；
//       DOM 顺序在宿主内容之后 → 天然覆盖在上层（不依赖 z-index，规避 lynx z-index 坑）。
// 面板内容自带 scroll-view 独立滚动，与宿主 scroll-view 互不干扰。
import { ref } from 'vue'
import type { MockComment } from './mockData'
import { mockIllust, mockComments, mockReplies } from './mockData'
import CommentItem from './CommentItem.vue'
import CommentInputBar from './CommentInputBar.vue'

// 弹层开关：点「查看评论」打开，点遮罩 / 关闭按钮关闭
const sheetOpen = ref(false)

// 楼层回复展开态：key = 根评论 id，value = 是否已展开
// （演示数据只有 mockReplies[1] 与 mockReplies[3] 两组，即前 3 条内的 id 1 / 3）
const expandedReplies = ref<Record<number, boolean>>({})

function toggleReplies(commentId: number) {
  // 展开 / 收起根评论下方的楼层回复
  expandedReplies.value = {
    ...expandedReplies.value,
    [commentId]: !expandedReplies.value[commentId],
  }
}

function closeSheet() {
  sheetOpen.value = false
  // 关闭时重置展开态，下次打开回到默认收起
  expandedReplies.value = {}
}
</script>

<template>
  <!-- 宿主根 view：w-full h-full + relative 提供 absolute 弹层的定位上下文 -->
  <view class="w-full h-full relative flex flex-col bg-background-2">
    <!-- 顶栏（‹ 返回为占位，prototype 无真实路由） -->
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2">
        <text class="text-lg text-brand-foreground pr-4">‹ 返回</text>
      </view>
      <text class="flex-1 text-2xl font-semibold text-foreground">作品详情</text>
    </view>

    <!-- 宿主内容：作品详情页观感（纯 mock：色块图 + 文案，不加载网络图） -->
    <scroll-view class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <!-- mock 大图：纯色块占位；高度按 mockIllust 宽高比换算的显式 vw
           （width/height = 1200/800 = 1.5 → h-[133.33vw]） -->
      <view class="w-full h-[133.33vw] bg-background-3 flex items-center justify-center">
        <text class="text-base text-foreground-3">mock 大图 {{ mockIllust.width }} × {{ mockIllust.height }}</text>
      </view>

      <view class="p-4 bg-background">
        <text class="text-3xl font-bold text-foreground">{{ mockIllust.title }}</text>

        <!-- 作者行：色块头像占位 + 作者名 -->
        <view
          class="w-[9vw] h-[9vw] rounded-[var(--borderRadiusLarge)] bg-background-3 border border-stroke-2 flex items-center justify-center flex-shrink-0"
        >
          <text class="text-base font-semibold text-brand-foreground">{{ mockIllust.userName.charAt(0) }}</text>
        </view>
        <text class="text-lg text-brand-foreground ml-2">by {{ mockIllust.userName }}</text>

        <text class="text-sm text-foreground-3 mt-1.5">{{ mockIllust.width }} × {{ mockIllust.height }}</text>

        <!-- 评论入口按钮：点击打开底部弹层 -->
        <view
          class="mt-4 h-[10vw] bg-brand rounded-[var(--borderRadiusLarge)] flex items-center justify-center"
          @tap="sheetOpen = true"
        >
          <text class="text-base font-semibold text-onBrand">💬 查看评论 ({{ mockIllust.totalComments }})</text>
        </view>
      </view>
    </scroll-view>

    <!-- 遮罩：absolute inset-0 覆盖全屏，@tap 关闭弹层 -->
    <view v-if="sheetOpen" class="absolute inset-0 bg-overlay" @tap="closeSheet" />

    <!-- 底部面板：与遮罩同级、写在遮罩之后 → 覆盖在遮罩之上；@tap.stop 防止面板内点击穿透到遮罩 -->
    <view
      v-if="sheetOpen"
      class="absolute bottom-0 left-0 right-0 h-[80vh] bg-background rounded-t-[var(--borderRadiusXLarge)] flex flex-col"
      @tap.stop
    >
      <!-- 面板 header：标题 + 关闭按钮 -->
      <view class="flex flex-row items-center h-[11.733vw] px-4 border-b-[1px] border-b-stroke-2 flex-shrink-0">
        <view class="w-[8vw]" />
        <text class="flex-1 text-center text-2xl font-semibold text-foreground">
          评论 ({{ mockIllust.totalComments }})
        </text>
        <view class="w-[8vw] h-[8vw] flex items-center justify-center" @tap="closeSheet">
          <text class="text-3xl text-foreground-2">×</text>
        </view>
      </view>

      <!-- 评论列表：flex-1 min-h-0 约束在面板内，独立垂直滚动（与宿主 scroll-view 分离） -->
      <scroll-view class="w-full flex-1 min-h-0" scroll-orientation="vertical">
        <view v-for="comment in mockComments" :key="comment.id">
          <CommentItem :comment="comment" />

          <!-- 楼层回复演示：mockReplies 只有 id 1 / 3 有数据（前 3 条内），
               按数据存在渲染可点击的展开控制 -->
          <view v-if="mockReplies[comment.id]" class="px-4 pt-1.5 pb-2.5">
            <view @tap="toggleReplies(comment.id)">
              <text class="text-sm text-brand-foreground underline">
                {{ expandedReplies[comment.id] ? '收起回复' : `展开 ${comment.reply_count ?? 0} 条回复` }}
              </text>
            </view>
          </view>
          <!-- 展开后：缩进渲染楼层回复（CommentItem 内部自会显示「回复 XXX」引用块） -->
          <view v-if="expandedReplies[comment.id]" class="pl-[12vw]">
            <CommentItem v-for="reply in mockReplies[comment.id] ?? []" :key="reply.id" :comment="reply" />
          </view>
        </view>
      </scroll-view>

      <!-- 底部输入栏（共享组件，无 props）；外层包 flex-shrink-0 防止面板空间不足时被压缩 -->
      <view class="w-full flex-shrink-0">
        <CommentInputBar />
      </view>
    </view>
  </view>
</template>
