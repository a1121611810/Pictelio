<script setup lang="ts">
// 推荐列表卡片骨架屏：方形图片占位 + 两行文字占位（shimmer 动画）。
// 布局与 ImageCard 对齐（图片方形、文字间距 mt-2/mx-2.5），避免骨架→真实内容切换时 reflow。
</script>

<template>
  <view class="w-[48.4vw] bg-background rounded-[var(--borderRadiusXLarge)] flex flex-col overflow-hidden">
    <view class="shimmer aspect-[1/1] w-full" />
    <view class="shimmer h-[28rpx] rounded-[var(--borderRadiusSmall)] mx-2.5 mt-2 w-[80%]" />
    <view class="shimmer h-[22rpx] rounded-[var(--borderRadiusSmall)] mx-2.5 mt-1 w-[55%] mb-2.5" />
  </view>
</template>
