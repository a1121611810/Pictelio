// ─── 配色原型独立预览入口（仅 web 开发预览用，throwaway） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=color-preview.web.bundle&variant=A
// 目的：回答「app-lynx 配色换成哪套蓝色系才搭 logo」。5 套候选（0=当前紫对照 + A/B/C/D 蓝色系）。
// 切换：底部浮动条 / 键盘 ←→ / URL ?variant=0|A|B|C|D。
// 生产（lynx 环境）不构建此入口——仅 environments.web 且 _isDev 时注册该 entry。
import { createApp } from 'vue-lynx'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { router } from './router'
import { pinia } from './stores/pinia'
import { queryClient } from './api/queryClient'
// [lynx:fix] 加载全局样式（tokens 变量 + .shimmer 全局类 + Tailwind utility）
import App from './App.vue'
import './styles/tailwind.css'
import ColorPreview from './colorPrototype/ColorPreview.vue'

const app = createApp(ColorPreview)
app.use(pinia)
app.use(VueQueryPlugin, { queryClient })
app.use(router)
app.mount()
