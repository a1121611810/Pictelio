// ─── 登录页独立预览入口（仅 web 开发预览用） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=login-preview.web.bundle
// 直接渲染 Login 页（含 token 输入与错误文案展示；提交走真实 OAuth dev 代理）。
// 生产（lynx 环境）不构建此入口——仅 environments.web 配置了该 entry。
import { createApp } from 'vue-lynx'
import { defineComponent, h } from 'vue'
// [lynx:fix] 先副作用导入 router（同 errorPreview：循环依赖求值顺序，见该文件注释）
import './router'
import Login from './pages/Login.vue'

const PreviewApp = defineComponent({
  render: () => h(Login),
})

createApp(PreviewApp).mount()
