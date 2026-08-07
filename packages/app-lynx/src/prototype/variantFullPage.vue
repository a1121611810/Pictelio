<script setup lang="ts">
// ─── PROTOTYPE（throwaway）：评论区 UI 形态验证 · 变体 B：独立全屏路由页 ───
// 结构：顶栏返回 + 薄作者条 + 评论列表 + 页内贴底输入栏（flex-col 末位子节点）。
// 与变体 A（底部弹层）、变体 C（页内区块）结构完全不同：本页评论是主任务，无作品详情内容。
// 验证问题：全屏形态的观感，以及「页内贴底」输入栏与弹层贴底的差异。
import { ref } from 'vue'
import CommentItem from './CommentItem.vue'
import CommentInputBar from './CommentInputBar.vue'
import { mockIllust, mockComments, mockReplies } from './mockData'
import type { MockComment } from './mockData'

/** 已展开楼中楼的根评论 id（演示交互，不做真实请求） */
const expandedIds = ref<number[]>([])

/** 展开/收起某根评论的楼中楼回复 */
function toggleReplies(id: number) {
  expandedIds.value = expandedIds.value.includes(id)
    ? expandedIds.value.filter((v) => v !== id)
    : [...expandedIds.value, id]
}

/** 取某根评论的 mock 回复；mockReplies 是 Record，key 未必存在，缺失返回空数组 */
function repliesOf(id: number): MockComment[] {
  return mockReplies[id] ?? []
}
</script>

<template>
  <!-- 全屏路由页根：flex-col 占满全屏，从上到下 = 顶栏 / 作者条 / 列表 / 输入栏 -->
  <view class="w-full h-full flex flex-col bg-background">
    <!-- 顶栏：左侧「‹ 返回」占位 + 中间「评论 (128)」 -->
    <view
      class="w-full flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2 flex-shrink-0"
    >
      <!-- 返回为占位：prototype 无真实路由，仅保留全屏路由页的形态 -->
      <view class="py-1 pr-2">
        <text class="text-lg text-brand-foreground pr-4">‹ 返回</text>
      </view>
      <text class="flex-1 text-center text-2xl font-semibold text-foreground">
        评论 ({{ mockIllust.totalComments }})
      </text>
    </view>

    <!-- 薄作者条：作者 + 标题一行，提示本页评论属于哪张作品 -->
    <view
      class="w-full flex flex-row items-center gap-2 px-4 py-2 bg-background-2 border-b border-b-stroke-2 flex-shrink-0"
    >
      <text class="text-sm font-semibold text-foreground">{{ mockIllust.userName }}</text>
      <text class="flex-1 min-w-0 text-sm text-foreground-2 line-clamp-1">{{ mockIllust.title }}</text>
    </view>

    <!-- 评论列表：scroll-view 承接滚动；flex-1 min-h-0 把剩余高度让给列表、逼底部输入栏贴底 -->
    <scroll-view class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <view v-for="c in mockComments" :key="c.id">
        <CommentItem :comment="c" />

        <!-- 楼中楼展开演示：仅 mockReplies[1] / mockReplies[3] 有回复数据 -->
        <view v-if="c.id === 1 || c.id === 3" class="bg-background-2 border-b border-b-stroke-2">
          <!-- 未展开：可点击的展开触发器（品牌色，与 CommentItem 内的静态演示文本区分） -->
          <view v-if="!expandedIds.includes(c.id)" class="py-2 pl-[8vw] pr-4" @tap="toggleReplies(c.id)">
            <text class="text-sm font-medium text-brand-foreground">
              展开 {{ c.reply_count ?? 0 }} 条回复
            </text>
          </view>
          <!-- 已展开：缩进 + 左边框呈现楼中楼，末尾跟「收起回复」 -->
          <view v-else>
            <view class="ml-[8vw] border-l border-l-stroke-2">
              <CommentItem v-for="r in repliesOf(c.id)" :key="r.id" :comment="r" />
            </view>
            <view class="py-2 pl-[8vw] pr-4" @tap="toggleReplies(c.id)">
              <text class="text-sm font-medium text-brand-foreground">收起回复</text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 底部输入栏：flex-col 布局的最后一个子节点（非 absolute 定位）——
         验证「页内贴底」随滚动高度自然落位，与变体 A 弹层贴底的视觉差异 -->
    <CommentInputBar />
  </view>
</template>
