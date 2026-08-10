// ─── 错误页 UI 原型预览入口（仅 web 开发预览用） ───
// 访问：http://127.0.0.1:<port>/__web_preview?casename=error-preview.web.bundle
// 预填样例「会话失效」错误，渲染 3 个结构变体（A 居中极简 / B 详情卡片 / C 全屏色块），
// 底部浮动切换条点击切换。选定后把赢家变体 fold 进 pages/ErrorPage.vue。
// 生产（lynx 环境）不构建此入口——仅 environments.web 配置了该 entry。
import { createApp } from 'vue-lynx'
// [lynx:fix] 先副作用导入 router：router.ts 的 routes 表静态 import 了全部页面组件，
// 与页面组件（import router 的 navigate）构成循环依赖。主入口经 App.vue 先触达 router，
// 顺序恰好安全；独立预览入口以页面组件为起点会反转求值顺序 → TDZ 崩溃
// （Cannot access '__rspack_default_export' before initialization）。
// 显式先求值 router，使其 import 链内的页面组件先完成初始化。
import './router'
import PrototypeShell from './errorPrototype/PrototypeShell.vue'
import { fatalError } from './utils/errorPresentation'
import { ApiErrorType } from './api/types'

// 样例数据：模拟「登录已过期 (HTTP 401)」会话失效（与真实触发链 reportSessionError 写入的形态一致）。
fatalError.value = { type: ApiErrorType.UNAUTHORIZED, message: '登录已过期 (HTTP 401)', status: 401 }

createApp(PrototypeShell).mount()
