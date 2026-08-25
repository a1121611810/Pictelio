// ─── 收藏动效原型预览入口（仅 web 开发预览用，[PROTOTYPE 用完即弃]） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=bookmark-anim-preview.web.bundle
// 渲染 PrototypeBookmarkAnim 舞台页（4 变体切换，纯视觉无 API）。
// 生产（lynx 环境）不构建此入口——仅 environments.web 配置了该 entry。
// 选型确认后删除本文件 + pages/PrototypeBookmarkAnim.vue + components/prototype/ 全部文件。
import { createApp } from 'vue-lynx'
import { defineComponent, h } from 'vue'
// [lynx:fix] 加载全局样式（tokens 变量 + Tailwind utility）：预览入口绕过 App.vue，需显式加载
// （同 loginPreview.ts 模式）
import App from './App.vue'
import './styles/tailwind.css'
import PrototypeBookmarkAnim from './pages/PrototypeBookmarkAnim.vue'

const PreviewApp = defineComponent({
  render: () => h(PrototypeBookmarkAnim),
})

createApp(PreviewApp).mount()
