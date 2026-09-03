// ─── PROTOTYPE（throwaway，勿入生产）───
// vue-router（createMemoryHistory）在 vue-lynx 0.5.1 + web-core 0.23.1 下的可行性探针入口。
// 背景：src/router.ts 注释声称「RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空（已实测）」，
// 但 git history 中没有任何真实尝试记录；本探针按官方文档形态原样复测。
// 访问：http://127.0.0.1:<port>/__web_preview?casename=route-probe.web.bundle
// 生产（lynx 环境）不构建此入口——仅 environments.web 的 _isDev 分支配置。
import { createApp } from 'vue-lynx'
import { createRouter, createMemoryHistory } from 'vue-router'
import RouteProbeApp from './prototype/RouteProbeApp.vue'
import RouteProbeHome from './prototype/RouteProbeHome.vue'
import RouteProbeDetail from './prototype/RouteProbeDetail.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'probe-home', component: RouteProbeHome },
    { path: '/detail/:id', name: 'probe-detail', component: RouteProbeDetail },
  ],
})

// memory history 初始位置是 nowhere（createMemoryHistory 无 URL 概念）：
// 必须手动 push 定起点（官方示例在 app.mount() 前执行）——这也复刻了生产
// router.ts 的「首帧内容化」（初始即推荐页）语义。
void router.push('/')

const app = createApp(RouteProbeApp)
app.use(router)
app.mount()
