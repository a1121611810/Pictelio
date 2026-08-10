// ─── 错误页独立预览入口（仅 web 开发预览用） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=error-preview.web.bundle
// 预填一条样例「会话失效」错误，直接查看 ErrorPage 完整效果（无需登录态、无需真实触发）。
// 生产（lynx 环境）不构建此入口——仅 environments.web 配置了该 entry。
import { createApp } from 'vue-lynx'
import { defineComponent, h } from 'vue'
import ErrorPage from './pages/ErrorPage.vue'
import { fatalError } from './utils/errorPresentation'
import { ApiErrorType } from './api/types'

// 样例数据：模拟「登录已过期 (HTTP 401)」会话失效（与真实触发链 reportSessionError 写入的形态一致）。
// 直接赋值不触发导航 handler（避免未注册 warn；预览页本就不需要真实跳转）。
fatalError.value = { type: ApiErrorType.UNAUTHORIZED, message: '登录已过期 (HTTP 401)', status: 401 }

const PreviewApp = defineComponent({
  render: () => h(ErrorPage),
})

createApp(PreviewApp).mount()
