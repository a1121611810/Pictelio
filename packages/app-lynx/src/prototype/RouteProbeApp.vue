<script setup lang="ts">
// PROTOTYPE（throwaway，勿入生产）：vue-router RouterView + KeepAlive 可行性探针根组件。
// 问题：vue-router（createMemoryHistory）在 vue-lynx 0.5.1 + web-core 0.23.1 下
// RouterView 是否渲染（router.ts 注释声称渲染为空）；以及【本轮新增】系统返回桥
// （LynxActivity → pictelioBack 事件）在 vue-router 历史语义下是否正常。
// 结论见本目录 PROTOTYPE-VERDICT.md（docs/research/vue-router-migration-feasibility.md）。
import { ref, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { probeHasHistory, probeBack, probeStackLength } from './probeNav'

// ─── 系统返回桥（复刻生产 handleSystemBack 语义） ───
// 生产：evaluateSystemBack(historyLength>0 → return; lastBackAt 2s 窗口 → exit; else hint)
// vue-router 映射：memory history 无公开栈查询 API（history.state 恒 {}，4.6.4 源码实证），
// 「能否返回」由 probeNav 自跟踪栈提供（生产迁移 shim 沿用本仓自研 _history 形态）。
const exitHint = ref(false)
let lastBackAt = 0
let hintTimer: ReturnType<typeof setTimeout> | undefined
const EXIT_WINDOW_MS = 2000

function finishApp(): void {
  const nm =
    (typeof NativeModules !== 'undefined' ? NativeModules : undefined) ??
    (globalThis as { NativeModules?: unknown }).NativeModules as never
  const app = nm?.PictelioApp as { exitApp?: (cb: (err: string | null) => void) => void } | undefined
  console.warn('[routeProbe] exitApp()，PictelioApp 存在:', Boolean(app))
  // lynx NativeModule 约定 Callback 必传（模拟器实测），否则报参数数量错误
  app?.exitApp?.(() => {})
}

function handleSystemBack(): void {
  console.warn('[routeProbe] pictelioBack 到达，stackLen =', probeStackLength())
  if (probeHasHistory()) {
    probeBack()
    return
  }
  const now = Date.now()
  if (lastBackAt > 0 && now - lastBackAt < EXIT_WINDOW_MS) {
    finishApp()
    return
  }
  lastBackAt = now
  exitHint.value = true
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => {
    exitHint.value = false
  }, EXIT_WINDOW_MS)
}

onMounted(() => {
  const lynxGlobal =
    typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter') as
    | { addListener?: (event: string, cb: () => void) => void }
    | undefined
  if (!emitter || typeof emitter.addListener !== 'function') {
    console.warn('[routeProbe] GlobalEventEmitter 不可用（web-core 预览属预期），系统返回桥未注册')
    return
  }
  emitter.addListener('pictelioBack', handleSystemBack)
})
</script>

<template>
  <page class="Root">
    <!-- 与生产 App.vue 同款形态：RouterView + KeepAlive include 白名单（官方文档迁移模式）
         [lynx:fix 实证] kebab-case <router-view> 会被 vue-lynx 编译器当作 native 标签
         （v-slot 时编译报错 VueCompilerError；无 slot 时静默渲染为空——已复现白屏）。
         必须用 PascalCase <RouterView>（官方示例同）。 -->
    <RouterView v-slot="{ Component }">
      <KeepAlive :include="['probe-home']">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
    <view v-if="exitHint" class="hint">
      <text class="hint-text">再按一次退出应用</text>
    </view>
  </page>
</template>

<style>
.Root {
  width: 100%;
  height: 100%;
}
.hint {
  position: absolute;
  left: 50%;
  bottom: 50px;
  transform: translate(-50%, 0);
  padding: 10px 24px;
  background-color: #888888;
  border-radius: 8px;
}
.hint-text {
  font-size: 16px;
  color: #ffffff;
}
</style>
