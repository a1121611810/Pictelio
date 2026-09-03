<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { initRouter, exitHint } from './router'
import GlobalFab from './components/GlobalFab.vue'
import SearchSheet from './components/SearchSheet.vue'
import { useClientSwitchStore } from './stores/clientSwitchStore'
import { useUpdateStore } from './stores/updateStore'
import { useSearchSheetStore } from './stores/searchSheetStore'
import { apiClient } from './api/client'
import { queryKeys } from './api/queryKeys'
import { useApiQuery } from './primitives/useApiQuery'

const searchSheet = useSearchSheetStore()

// T3 启动健康检查（ADR-0141 / T3 ticket）：
// - 替代 T1 spike 的裸 useQuery（用 T2 实施的 useApiQuery helper 包装）
// - 仅 dev 模式触发（__DEV__ 编译期门禁）
// - 验证 useApiQuery helper 在真实业务代码路径工作（generation-gate + signal 透传）
// - 失败不阻塞启动（query isLoading → isError 自动收尾，UI 无影响）
const health = useApiQuery<{ illusts: unknown[] }>({
  queryKey: queryKeys.illusts.recommended(),
  queryFn: ({ signal }) => apiClient.get<{ illusts: unknown[] }>(
    '/v2/illust/recommended',
    { limit: '1' },
    signal,
  ),
  enabled: __DEV__ && searchSheet.isOpen === false,
  staleTime: 60 * 1000,
  retry: false,
})
onMounted(() => {
  console.log(
    `[T3 useApiQuery] health: status=${health.status.value} isLoading=${health.isLoading.value} data=${health.data.value ? 'ok' : 'null'}`,
  )
})

onMounted(() => {
  // ADR-0062：启动时查询当前包支持的 client 引擎列表（full/webview/lynx 各有不同）
  useClientSwitchStore().initClientSetting()
  void initRouter()
  // 检查更新（仅自动检查，无手动入口）：启动延迟执行，发现新版本
  // 直接打开强制更新页（无中间提示层）
  useUpdateStore().runStartupUpdateCheck()
})
</script>

<template>
  <page class="Root">
    <!-- [lynx:fix] 模板必须 PascalCase <RouterView>（kebab-case <router-view> 被
         vue-lynx 编译器当原生标签 → 空渲染/编译报错；ADR-0138 决策 8）。
         KeepAlive 缓存列表/静态页实例（ADR-0049）：详情返回列表不重载。
         详情页不在 include 白名单——按 :id 加载，缓存旧 id 实例会显示错误内容 -->
    <RouterView v-slot="{ Component }">
      <KeepAlive :include="['recommended', 'illusts', 'novels', 'me']">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
    <!-- 放射导航悬浮 FAB（ADR-0120）：全局单 FAB，外层=4 tab、内层=页动作；替换各页 NavigationBar 与自身 FAB -->
    <GlobalFab />
    <!-- 全局搜索弹层（ADR-0132 / glossary「弹层全局单例」）：全 App 只挂一份——
         开合经 searchSheetStore 全局单例（openSearch/closeSearch），各入口（FAB / 内环搜索项）
         打开的都是同一弹层，各页不各自 v-if；DOM 顺序在 GlobalFab 之后（同层 z-40 后序胜出）
         + 弹层根 view z-40 盖过页面内 z-30 分页 FAB（RefreshableList，review P1-1）；
         v-if 卸载 = 关闭即重置（keyword/结果清空，历史保留）。
         返回键：openSearch 时 store 已 registerModal(closeSearch)（ADR-0066 后进先出）。 -->
    <SearchSheet v-if="searchSheet.isOpen" />
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
