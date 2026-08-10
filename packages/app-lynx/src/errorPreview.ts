// ─── 错误页独立预览入口（仅 web 开发预览用） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=error-preview.web.bundle
// 预填一条样例「会话失效」错误，直接查看 ErrorPage 完整效果（无需登录态、无需真实触发）。
// 生产（lynx 环境）不构建此入口——仅 environments.web 配置了该 entry。
import { createApp } from 'vue-lynx'
import { defineComponent, h } from 'vue'
// [lynx:fix] 先副作用导入 router：router.ts 的 routes 表静态 import 了全部页面组件，
// 与页面组件（import router 的 navigate）构成循环依赖。主入口经 App.vue 先触达 router，
// 顺序恰好安全；独立预览入口以页面组件为起点会反转求值顺序 → TDZ 崩溃
// （Cannot access '__rspack_default_export' before initialization）。
// 显式先求值 router，使其 import 链内的页面组件先完成初始化。
import './router'
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
