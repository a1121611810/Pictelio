<script setup lang="ts">
// 小说详情骨架屏（issue #91 方案二）：标题条 + 作者条 + 元信息条 + 错落正文条。
// 布局与 NovelDetail 真实内容区对齐（py-5 px-4 头卡 + p-4 正文、44rpx 行高、mb-4 段距），
// 避免骨架 → 内容切换时 reflow。复用全局 shimmer 类（App.vue）。
</script>

<template>
  <scroll-view class="w-full h-full" scroll-orientation="vertical">
    <!-- 头部信息卡骨架：对齐真实卡 py-5 px-4 bg-background mb-3 -->
    <view class="py-5 px-4 bg-background mb-3">
      <view class="shimmer h-[52rpx] rounded-[var(--borderRadiusSmall)] w-[70%]" />
      <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-2 w-[40%]" />
      <view class="shimmer h-[20rpx] rounded-[var(--borderRadiusSmall)] mt-1.5 w-[30%]" />
    </view>
    <!-- 正文条骨架：对齐真实正文 p-4 + leading-[44rpx] + mb-4 -->
    <view class="p-4">
      <view class="shimmer h-[44rpx] rounded-[var(--borderRadiusSmall)] mb-4 w-full" />
      <view class="shimmer h-[44rpx] rounded-[var(--borderRadiusSmall)] mb-4 w-full" />
      <view class="shimmer h-[44rpx] rounded-[var(--borderRadiusSmall)] mb-4 w-[85%]" />
      <view class="shimmer h-[44rpx] rounded-[var(--borderRadiusSmall)] mb-4 w-full" />
      <view class="shimmer h-[44rpx] rounded-[var(--borderRadiusSmall)] mb-4 w-[60%]" />
    </view>
  </scroll-view>
</template>
