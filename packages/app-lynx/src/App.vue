<script setup lang="ts">
import { onMounted } from 'vue'
import { currentComponent, initRouter } from './router'
import { initClientSetting } from './stores/clientSwitchStore'

onMounted(() => {
  // ADR-0062：启动时查询当前包支持的 client 引擎列表（full/webview/lynx 各有不同）
  initClientSetting()
  void initRouter()
})
</script>

<template>
  <page class="Root">
    <!-- [lynx:fix] KeepAlive 缓存列表/静态页实例（ADR-0049）：详情返回列表不重载。
         详情页不在 include 白名单——按 :id 加载，缓存旧 id 实例会显示错误内容 -->
    <KeepAlive :include="['recommended', 'novels', 'me']">
      <component :is="currentComponent" />
    </KeepAlive>
  </page>
</template>

<style>
@import './styles/tokens.css';
@tailwind base;
@tailwind utilities;

.Root {
  width: 100%;
  height: 100%;
  background-color: var(--colorNeutralBackground2);
}

/* ─── shimmer 骨架屏（数据加载前的占位动画） ───
 * web-core 实测支持 linear-gradient + @keyframes（浏览器渲染）；
 * 原生 LynxView 的 gradient/animation 支持待 #41 集成后验证。
 * 用法：元素加 class="shimmer"（配合尺寸类如 aspect-[1/1]、h-[28rpx]）。 */
@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
.shimmer {
  background: linear-gradient(
    90deg,
    var(--colorNeutralBackground3) 25%,
    var(--colorNeutralBackground1) 50%,
    var(--colorNeutralBackground3) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
</style>
