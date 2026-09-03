// ─── PROTOTYPE（throwaway，勿入生产）───
// vue-router（createMemoryHistory）在 vue-lynx 0.5.1 + web-core 0.23.1 下的可行性探针入口。
// 第五轮（Q3 守卫）：全局守卫鉴权拦截 + 首帧时序 + 会话 epoch（结论见 docs/research/vue-router-migration-feasibility.md）。
// 访问：http://127.0.0.1:<port>/__web_preview?casename=route-probe.web.bundle
// 生产（lynx 环境）不构建此入口——仅 environments.web 的 _isDev 分支配置。
import { createApp } from 'vue-lynx'
import RouteProbeApp from './prototype/RouteProbeApp.vue'
import { router } from './prototype/probeNav'

const t0 = Date.now()
console.warn(`[routeProbe] boot: module init @${t0}`)

const app = createApp(RouteProbeApp)
app.use(router)
app.mount()
console.warn(`[routeProbe] boot: app mounted @${Date.now()}（+${Date.now() - t0}ms）`)
