// ─── 极简内存路由（app-lynx MVP） ───
// vue-router 的 RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空
// （Pre-Alpha 兼容问题，已实测）。MVP 用手写内存路由 + <component :is>，
// 路由语义与 vue-router 一致（path/name/params），导航守卫由页面自行处理登录态。
import { ref, computed, markRaw, type Component } from 'vue'
import { matchRoute, type RouteDefCore } from './routerCore'
import { isLoggedIn, restoreToken, registerUnauthorizedHandler } from './stores/authStore'

export interface RouteDef extends RouteDefCore {
  component: Component
}

export interface RouteState {
  name: string
  path: string
  params: Record<string, string>
}

// 静态 import（非 lazy）——vue-lynx 的 defineAsyncComponent 需要 lazy-bundle runtime，
// MVP 用静态加载降低复杂度，bundle 体积可接受（实测 ~160KB）
import Login from './pages/Login.vue'
import Recommended from './pages/Recommended.vue'
import IllustDetail from './pages/IllustDetail.vue'
import NovelList from './pages/NovelList.vue'
import NovelDetail from './pages/NovelDetail.vue'
import Me from './pages/Me.vue'

export const routes: RouteDef[] = [
  { path: '/login', name: 'login', component: Login },
  { path: '/recommended', name: 'recommended', component: Recommended },
  { path: '/illust/:id', name: 'illust-detail', component: IllustDetail },
  { path: '/novels', name: 'novels', component: NovelList },
  { path: '/novel/:id', name: 'novel-detail', component: NovelDetail },
  { path: '/me', name: 'me', component: Me },
]

const _state = ref<RouteState>({ name: '', path: '/login', params: {} })

export const routeState = _state

export const currentComponent = computed<Component | null>(() => {
  const m = matchRoute(routes, _state.value.path)
  return m ? markRaw(m.route.component) : null
})

export const currentParams = computed(() => _state.value.params)

export async function navigate(path: string): Promise<void> {
  const m = matchRoute(routes, path)
  if (!m) {
    _state.value = { name: '', path: '/login', params: {} }
    return
  }
  _state.value = { name: m.route.name, path, params: m.params }
}

/** 未登录守卫：保证进入受保护页面前完成 token 恢复 */
export async function ensureAuth(): Promise<boolean> {
  if (isLoggedIn.value) return true
  const ok = await restoreToken()
  if (!ok) navigate('/login')
  return ok
}

export function goBack(): void {
  // MVP：无历史栈，受保护页回退到推荐页
  if (_state.value.path !== '/login') {
    _state.value = { name: 'recommended', path: '/recommended', params: {} }
  }
}

/** 初始化（App 挂载时调用）：注册 401 刷新 + 首路由 */
export async function initRouter(): Promise<void> {
  registerUnauthorizedHandler()
  const ok = await restoreToken()
  void navigate(ok ? '/recommended' : '/login')
}
