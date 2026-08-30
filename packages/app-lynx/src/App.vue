<script setup lang="ts">
import { onMounted } from 'vue'
import { currentComponent, initRouter, exitHint } from './router'
import GlobalFab from './components/GlobalFab.vue'
import { initClientSetting } from './stores/clientSwitchStore'
import { runStartupUpdateCheck } from './stores/updateStore'

onMounted(() => {
  // ADR-0062：启动时查询当前包支持的 client 引擎列表（full/webview/lynx 各有不同）
  initClientSetting()
  void initRouter()
  // 检查更新（仅自动检查，无手动入口）：启动延迟执行，发现新版本
  // 直接打开强制更新页（无中间提示层）
  runStartupUpdateCheck()
})
</script>

<template>
  <page class="Root">
    <!-- [lynx:fix] KeepAlive 缓存列表/静态页实例（ADR-0049）：详情返回列表不重载。
         详情页不在 include 白名单——按 :id 加载，缓存旧 id 实例会显示错误内容 -->
    <KeepAlive :include="['recommended', 'illusts', 'novels', 'me']">
      <component :is="currentComponent" />
    </KeepAlive>
    <!-- 放射导航悬浮 FAB（ADR-0120）：全局单 FAB，外层=4 tab、内层=页动作；替换各页 NavigationBar 与自身 FAB -->
    <GlobalFab />
    <!-- 系统返回根路由提示（ADR-0066）：与 webview client 的 exitHint toast 语义一致。
         M3 snackbar 形态：inverse-surface 底 + inverse-on-surface 文字 + 4dp 圆角。
         [lynx:fix] 无全宽盒（ADR-0123）：原生 LynxView hit-testing 不识别 pointer-events，
         全宽 `left-0 right-0` 容器会吞底部整条点击（含 FAB 区域）；改为胶囊居中定位，
         命中面只剩提示条自身，双端行为一致、不依赖 pointer-events。 -->
    <view v-if="exitHint" class="absolute z-50" style="left: 50vw; bottom: 12vw; transform: translate(-50%, 0)">
      <view class="h-[12.8vw] bg-inverse-surface rounded-[var(--md-shape-extra-small)] px-5 flex items-center shadow-[var(--md-elevation-3)]">
        <text class="text-base text-inverse-on-surface">再按一次退出应用</text>
      </view>
    </view>
  </page>
</template>

<style>
@import './styles/tokens.css';

.Root {
  width: 100%;
  height: 100%;
  background-color: var(--md-surface);
}

/* ─── shimmer 骨架屏（数据加载前的占位动画） ───
 * web-core 实测支持 linear-gradient + @keyframes（浏览器渲染）；
 * 原生 LynxView：keyframes 动画已实证支持（ADR-0108：LynxKeyframeAnimator + TransformProps，
 * FAB 旋转动画模拟器验证通过 2026-08-24）；linear-gradient 背景静态渲染已见（骨架屏原生显示），
 * background-position 动画行为未单独实证。
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
    var(--md-surface-container-high) 25%,
    var(--md-surface-container-lowest) 50%,
    var(--md-surface-container-high) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
</style>
