<script setup lang="ts">
// ─── PROTOTYPE（throwaway）：变体 C —— 页内区块 ───
// 形态假设：评论作为作品详情页 scroll-view 内的普通区块，与作品内容同页滚动
// （类似小红书 / 网易云 / Pixiv 官方 App）。
// 本变体验证「评论与作品内容共用一个滚动容器」的形态：整页只有一个 scroll-view，
// 评论不做独立滚动容器；输入栏非固定，随内容滚动到页面底部。
import { ref } from 'vue'
import { mockIllust, mockComments, mockReplies } from './mockData'
import type { MockComment } from './mockData'
import { detailImageHeightVw } from '../utils/imageLayout'
import CommentItem from './CommentItem.vue'
import CommentInputBar from './CommentInputBar.vue'

// 大图容器高度：按 mockIllust 原图宽高比换算的显式 vw（1200×800 = 3:2 → 66.667vw），
// 复用详情页实际实现 utils/imageLayout（原生 LynxView 不支持动态 aspect-ratio）。
const illustHeight = detailImageHeightVw(mockIllust.width, mockIllust.height)

// 楼层回复展开态：仅 mockReplies 里有数据的评论（id 1 / 3）可展开
const expanded = ref(new Set<number>())

function repliesOf(id: number): MockComment[] {
  return mockReplies[id] ?? []
}

function canExpand(c: MockComment): boolean {
  return c.has_replies && repliesOf(c.id).length > 0
}

function toggleExpand(id: number) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id)
  } else {
    expanded.value.add(id)
  }
}
</script>

<template>
  <!-- [lynx:fix] 顶栏 + scroll-view 同 IllustDetail 模式：外层 flex-col，scroll-view flex-1 min-h-0
       约束在顶栏下方（issue #139：避免 w-full h-full 溢出覆盖顶栏触摸层） -->
  <view class="w-full h-full flex flex-col bg-background-2">
    <!-- 顶栏：‹ 返回占位 + 页面标题（prototype 不接路由） -->
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <text class="text-lg text-brand-foreground pr-4">‹ 返回</text>
      <text class="flex-1 text-2xl font-semibold text-foreground">作品详情</text>
    </view>

    <!-- 唯一滚动容器：作品内容 + 评论区 + 输入栏全部同页滚动（变体 C 的核心形态） -->
    <scroll-view class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <!-- 作品大图：纯色块占位，高度按原图宽高比换算的显式 vw -->
      <view class="w-full bg-background-3" :style="{ height: illustHeight }" />

      <!-- 标题 + 作者行 -->
      <view class="p-4 bg-background">
        <text class="text-3xl font-bold text-foreground">{{ mockIllust.title }}</text>
        <view class="flex flex-row items-center mt-2">
          <!-- 作者头像：色块 + 首字（prototype 不加载网络图） -->
          <view
            class="w-[9vw] h-[9vw] rounded-[var(--borderRadiusLarge)] bg-background-3 border border-stroke-2 flex items-center justify-center flex-shrink-0"
          >
            <text class="text-base font-semibold text-brand-foreground">{{ mockIllust.userName.charAt(0) }}</text>
          </view>
          <text class="text-lg text-brand-foreground ml-2 flex-1">by {{ mockIllust.userName }}</text>
          <text class="text-sm text-foreground-3">{{ mockIllust.width }} × {{ mockIllust.height }}</text>
        </view>
      </view>

      <!-- 分隔线 + 「评论 (128)」区块标题：作为页内区块随内容滚动 -->
      <view class="flex flex-row items-center justify-between px-4 py-3 bg-background border-t border-t-stroke-2">
        <text class="text-lg font-semibold text-foreground">评论 ({{ mockIllust.totalComments }})</text>
      </view>

      <!-- 评论列表：与作品内容同一 scroll-view 滚动，无独立滚动容器 -->
      <view v-for="c in mockComments" :key="c.id" class="bg-background">
        <CommentItem :comment="c" />

        <!-- 楼层回复展开（mockReplies[1] / mockReplies[3]）：点展开行在条目下方渲染回复 -->
        <view
          v-if="canExpand(c)"
          class="flex flex-row items-center pl-[15vw] pr-4 py-2"
          @tap="toggleExpand(c.id)"
        >
          <text class="text-xs font-medium text-brand-foreground">
            {{ expanded.has(c.id) ? '收起回复 ↑' : `展开 ${repliesOf(c.id).length} 条回复 ↓` }}
          </text>
        </view>

        <!-- 楼层回复：缩进 + 浅色底区分，回复条目复用共享 CommentItem -->
        <view v-if="expanded.has(c.id)" class="bg-background-3 pl-[15vw] pt-1 mb-1">
          <CommentItem v-for="r in repliesOf(c.id)" :key="r.id" :comment="r" />
        </view>
      </view>

      <!-- 区块末尾输入栏：非固定，随内容滚动到页面底部（同页滚动形态的关键验证点） -->
      <CommentInputBar />
    </scroll-view>
  </view>
</template>
