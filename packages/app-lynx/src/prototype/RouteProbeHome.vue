<script setup lang="ts">
// PROTOTYPE（throwaway，勿入生产）：探针首页——验证 RouterView 渲染 + 编程式导航 + RouterLink @tap + 参数。
// 计数器（count）用于验证 KeepAlive 缓存：导航到详情再返回时计数值应保留（组件实例未被销毁）。
// 第三轮：导航统一走 probeNav（自跟踪栈包装），保证系统返回桥（pictelioBack）的「能否返回」判定正确。
// 第五轮（Q3 守卫）：新增登录/登出/守卫目标页按钮与会话状态展示。
import { ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { probeNavigate, setAuthed, resetSession, authed, isCleared, epoch, setGuardAwaitMs, setBootstrapDone } from './probeNav'

// KeepAlive include 匹配组件 name（生产页面惯例：name 与路由 name 一致）
defineOptions({ name: 'probe-home' })

const route = useRoute()
const count = ref(0)

function toggleAuth(): void {
  setAuthed(!authed())
}
function doLogout(): void {
  resetSession()
  void probeNavigate('/login', { replace: true })
}
</script>

<template>
  <view class="Root">
    <view class="list">
      <text class="title">PROBE-HOME</text>
      <!-- 当前路由全量展示：RouterView 渲染即此文本可见；截图/console 双路取证 -->
      <text class="line">fullPath={{ route.fullPath }}</text>
      <text class="line">params={{ JSON.stringify(route.params) }}</text>
      <text class="line">count={{ count }}</text>
      <text class="line">authed={{ authed() }} cleared={{ isCleared() }} epoch={{ epoch() }}</text>
      <text class="btn" @tap="count++">inc-count</text>
      <!-- ① 编程式导航（官方推荐方式之二；经 probeNavigate 保持自跟踪栈一致） -->
      <text class="btn" @tap="probeNavigate('/detail/42')">push-detail-42</text>
      <!-- ② RouterLink custom 插槽（官方推荐方式之一，lynx 无 <a> 元素）；
           已单独实证过插槽 navigate 可用（前次迭代），本轮为保证栈一致改用包装函数 -->
      <RouterLink custom to="/detail/7" v-slot="{ navigate }">
        <text class="btn" @tap="probeNavigate('/detail/7')">link-detail-7</text>
      </RouterLink>
      <!-- ③ 守卫实证（Q3）：鉴权拦截 / 登出会话清理 -->
      <text class="btn" @tap="toggleAuth()">toggle-auth</text>
      <text class="btn" @tap="doLogout()">logout-reset</text>
      <text class="btn" @tap="probeNavigate('/protected')">goto-protected</text>
      <text class="btn" @tap="setGuardAwaitMs(800)">guard-await-800ms</text>
      <text class="btn" @tap="setBootstrapDone()">bootstrap-done</text>
    </view>
  </view>
</template>

<style>
.Root {
  width: 100%;
  height: 100%;
}
.list {
  padding: 20px;
}
.title {
  font-size: 24px;
  font-weight: bold;
}
.line {
  font-size: 16px;
  margin-top: 8px;
}
.btn {
  font-size: 16px;
  margin-top: 12px;
  padding: 8px;
  background-color: #eeeeee;
}
</style>
