// ─── PROTOTYPE（throwaway，勿入生产）───
// vue-router（createMemoryHistory）在 vue-lynx 0.5.1 + web-core 0.23.1 下的可行性探针入口。
// 背景：src/router.ts 注释声称「RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空（已实测）」，
// 但 git history 中没有任何真实尝试记录；本探针按官方文档形态原样复测。
// 第二轮：系统返回桥（pictelioBack）接入——导航统一走 probeNav（自跟踪栈）包装。
// 访问：http://127.0.0.1:<port>/__web_preview?casename=route-probe.web.bundle
// 生产（lynx 环境）不构建此入口——仅 environments.web 的 _isDev 分支配置。
import { createApp } from 'vue-lynx'
import RouteProbeApp from './prototype/RouteProbeApp.vue'
import { router } from './prototype/probeNav'

const app = createApp(RouteProbeApp)
app.use(router)
app.mount()
