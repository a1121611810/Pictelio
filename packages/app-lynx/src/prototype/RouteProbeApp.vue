<script setup lang="ts">
// PROTOTYPE（throwaway，勿入生产）：vue-router RouterView + KeepAlive 可行性探针根组件。
// 问题：vue-router（createMemoryHistory）在 vue-lynx 0.5.1 + web-core 0.23.1 下
// RouterView 是否渲染（router.ts 注释声称渲染为空）。结论见本目录 PROTOTYPE-VERDICT.md。
// 与官方示例（vue.lynxjs.org/examples/vue-router/src/App.vue）逐项一致：PascalCase RouterView。
import { RouterView } from 'vue-router'
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
  </page>
</template>

<style>
.Root {
  width: 100%;
  height: 100%;
}
</style>
