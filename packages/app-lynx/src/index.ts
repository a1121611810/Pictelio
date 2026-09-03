import { createApp } from 'vue-lynx'
import { router } from './router'
import { pinia } from './stores/pinia'

// Tailwind 指令必须从独立 CSS 入口加载（见 styles/tailwind.css 注释）：
// .vue <style> 内联 @tailwind 指令不经过 rsbuild CSS 链，utility 类不会生成。
import './styles/tailwind.css'
import App from './App.vue'

const app = createApp(App)
// Pinia 单例 seam（ADR-0139 决策 3）：与 router 守卫/测试共用同一实例——
// 双实例 = 双 store 空间，状态互不同步；必须用 stores/pinia.ts 的导出。
app.use(pinia)
// vue-router 插件安装（ADR-0138）：RouterView 依赖 app.use(router) 注入——
// 漏装会出现 "injection Symbol(router view location) not found"（App 挂载但路由区空白）
app.use(router)
app.mount()
