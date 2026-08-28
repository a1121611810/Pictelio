<script setup lang="ts">
// 推荐轮播页级首载沉浸骨架（ADR-0118「沉浸骨架」/ spec §2.3、§3.3）：
// 按滑页布局占位——上部全宽 shimmer 图区（100vw 方图比例，对应典型 1:1 封面）
// + 底部 scrim 区域文字条（标题 / 作者 / 徽章位），取代「加载中…」文字。
// 纯展示组件（无 props、无逻辑）：触发由 T5 在 Recommended.vue 接入（渲染流为空即显，不依赖 loading）。
// 几何与滑页 scrim 对齐（Recommended.vue：absolute bottom-0 + px-6 + pb-[10vw]），
// 骨架 → 内容切换时标题/作者/徽章落在相近屏幕区域，减少视觉位移。
// 复用全局 shimmer 类（App.vue）+ M3 令牌，不新增 scoped CSS / 令牌。
</script>

<template>
  <view class="w-full h-full flex flex-col relative bg-surface">
    <!-- 上部全宽 shimmer 图区：方图比例占位（h-[100vw] = 1:1 封面，小说/插画通用） -->
    <view class="shimmer w-full h-[100vw]" />
    <!-- 底部 scrim 区域文字条（absolute bottom-0，与滑页 scrim 同几何；图短时上方露出 surface 背景） -->
    <view class="absolute bottom-0 left-0 right-0 px-6 pb-[10vw]">
      <!-- 标题条（约 title-large 高） -->
      <view class="shimmer h-[7vw] w-[70%] rounded-[var(--md-shape-extra-small)]" />
      <!-- 作者条 -->
      <view class="shimmer h-[4.5vw] w-[40%] mt-3 rounded-[var(--md-shape-extra-small)]" />
      <!-- 徽章条（约类型徽章/标签行区域） -->
      <view class="shimmer h-[6vw] w-[24vw] mt-2 rounded-[var(--md-shape-small)]" />
    </view>
  </view>
</template>
