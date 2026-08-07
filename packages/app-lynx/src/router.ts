// ─── 极简内存路由（app-lynx MVP） ───
// vue-router 的 RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空
// （Pre-Alpha 兼容问题，已实测）。MVP 用手写内存路由 + <component :is>，
// 路由语义与 vue-router 一致（path/name/params），导航守卫由页面自行处理登录态。
import { ref, computed, markRaw, type Component } from 'vue'
import { matchRoute, evaluateBackWithBehavior, type RouteDefCore } from './routerCore'
import { isNativeMode, getNativeModules } from './api/client'
import { isLoggedIn, restoreToken, registerUnauthorizedHandler } from './stores/authStore'
import { loadSettings } from './stores/settingsStore'
import { hasOpenModal, closeTopModal } from './stores/modalStack'

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
import UserHome from './pages/UserHome.vue'
import Following from './pages/Following.vue'
import Bookmarks from './pages/Bookmarks.vue'
import FollowList from './pages/FollowList.vue'
import UpdatePage from './pages/UpdatePage.vue'

export const routes: RouteDef[] = [
  { path: '/login', name: 'login', component: Login },
  { path: '/recommended', name: 'recommended', component: Recommended },
  { path: '/illust/:id', name: 'illust-detail', component: IllustDetail },
  { path: '/novels', name: 'novels', component: NovelList },
  { path: '/novel/:id', name: 'novel-detail', component: NovelDetail },
  { path: '/user/:id', name: 'user-home', component: UserHome },
  { path: '/user/:id/following', name: 'user-following', component: FollowList },
  { path: '/user/:id/followers', name: 'user-followers', component: FollowList },
  { path: '/following', name: 'following', component: Following },
  { path: '/bookmarks', name: 'bookmarks', component: Bookmarks },
  { path: '/me', name: 'me', component: Me },
  // 强制更新页（检查更新命中后 replace + 清历史栈进入）：
  // backBehavior: 'exit' —— 返回键直接退出应用，无返回路径
  { path: '/update', name: 'update', component: UpdatePage, backBehavior: 'exit' },
]

// [首帧内容化]（#61/#63）：初始路由为推荐页——首帧直接渲染推荐页骨架屏，
// 消除已登录用户启动时的登录页闪屏；未登录用户由 initRouter 登录守卫
// replace 到 /login（不入栈，ADR-0049 语义不变）。
// 登录态就绪前推荐页可能已挂载（首帧 fetch 会 401 失败），补拉机制见
// Recommended.vue 的 watch(isLoggedIn) + onActivated。
// 勿在未评估前开启 IFR（enableIFR）——app-lynx 真机 32 组实测否决，
// 见 docs/research/vue-lynx-benchmark-ifr.md §6 与 issue #61。
const _state = ref<RouteState>({ name: 'recommended', path: '/recommended', params: {} })

// [lynx:fix] 极简历史栈（ADR-0049）：navigate 默认入栈，goBack 出栈回上一页；
// 登录相关导航用 replace 语义（不入栈）——登录页不应被"返回"。
const _history: string[] = []

export const routeState = _state

export const currentComponent = computed<Component | null>(() => {
  const m = matchRoute(routes, _state.value.path)
  return m ? markRaw(m.route.component) : null
})

export const currentParams = computed(() => _state.value.params)

export interface NavigateOptions {
  /** replace 语义：不入历史栈（登录/登出/首路由） */
  replace?: boolean
}

export async function navigate(path: string, opts?: NavigateOptions): Promise<void> {
  const m = matchRoute(routes, path)
  if (!m) {
    _state.value = { name: '', path: '/login', params: {} }
    return
  }
  if (!opts?.replace && _state.value.path !== path) {
    _history.push(_state.value.path)
  }
  _state.value = { name: m.route.name, path, params: m.params }
}

/** 清空历史栈（登录/登出后调用，会话新起点） */
export function resetHistory(): void {
  _history.length = 0
}

/** 未登录守卫：保证进入受保护页面前完成 token 恢复 */
export async function ensureAuth(): Promise<boolean> {
  if (isLoggedIn.value) return true
  const ok = await restoreToken()
  if (!ok) navigate('/login', { replace: true })
  return ok
}

export function goBack(): void {
  // [lynx:fix] 历史栈 pop 回上一页（ADR-0049）；栈空或目标无效时回退推荐页
  const prev = _history.pop()
  if (prev && prev !== _state.value.path) {
    const m = matchRoute(routes, prev)
    if (m) {
      _state.value = { name: m.route.name, path: prev, params: m.params }
      return
    }
  }
  _state.value = { name: 'recommended', path: '/recommended', params: {} }
}

// ─── 系统返回桥（ADR-0066） ───
// 原生 LynxActivity 拦截系统返回（手势/按键）后通过全局事件 pictelioBack 转发，
// 返回行为由 JS 决策：有历史 → 返回上一页；根路由（推荐/登录）→ 提示 + 2s 双击退出。
let backHandlerRegistered = false
let lastBackAt = 0
/** 根路由「再按一次退出应用」提示显隐（App.vue 消费） */
export const exitHint = ref(false)
let exitHintTimer: ReturnType<typeof setTimeout> | undefined
/** 提示条显示时长（ms），与 webview client EXIT_HINT_DURATION_MS 对齐 */
const EXIT_HINT_DURATION_MS = 2000

function showExitHint(): void {
  exitHint.value = true
  if (exitHintTimer) clearTimeout(exitHintTimer)
  exitHintTimer = setTimeout(() => {
    exitHint.value = false
  }, EXIT_HINT_DURATION_MS)
}

function handleSystemBack(): void {
  // ADR-0066 扩展（issue #163）：有打开的 modal（如评论区弹层）时返回键优先
  // 关闭最上层弹层，不触发页面返回 / 退出提示
  if (hasOpenModal()) {
    closeTopModal()
    return
  }
  // 强制更新页等路由声明 backBehavior: 'exit'（不可返回场景）：
  // 返回键直接退出应用，跳过历史栈与双击窗口
  const m = matchRoute(routes, _state.value.path)
  const decision = evaluateBackWithBehavior(m?.route.backBehavior, _history.length, lastBackAt, Date.now())
  if (decision === 'navigate') {
    goBack()
    return
  }
  if (decision === 'exit') {
    const app = getNativeModules()?.PictelioApp as
      | { exitApp?: (callback: (err: string | null) => void) => void }
      | undefined
    // lynx NativeModule 约定 Callback 必传（模拟器实测），否则报参数数量错误
    app?.exitApp?.(() => {})
    return
  }
  lastBackAt = Date.now()
  showExitHint()
}

/** 注册系统返回监听（仅原生模式、仅一次；web-core 预览无 GlobalEventEmitter 则静默跳过） */
function registerSystemBackHandler(): void {
  if (backHandlerRegistered) return
  backHandlerRegistered = true
  const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
  if (!emitter || typeof emitter.addListener !== 'function') {
    console.warn('[router] GlobalEventEmitter 不可用，系统返回桥未注册（web-core 预览属预期）')
    return
  }
  emitter.addListener('pictelioBack', handleSystemBack)
}

/** 初始化（App 挂载时调用）：注册 401 刷新 + 恢复设置 + 首路由（replace 不入栈） */
export async function initRouter(): Promise<void> {
  registerUnauthorizedHandler()
  void loadSettings()
  if (isNativeMode()) registerSystemBackHandler()
  const ok = await restoreToken()
  void navigate(ok ? '/recommended' : '/login', { replace: true })
}
