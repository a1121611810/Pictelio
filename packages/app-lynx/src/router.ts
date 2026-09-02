// ─── 极简内存路由（app-lynx MVP） ───
// vue-router 的 RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空
// （Pre-Alpha 兼容问题，已实测）。MVP 用手写内存路由 + <component :is>，
// 路由语义与 vue-router 一致（path/name/params），导航守卫由页面自行处理登录态。
import { ref, computed, markRaw, type Component } from 'vue'
import { matchRoute, evaluateBackRoute, createBackGuardRegistry, runBackGuards, type BackGuard, type RouteDefCore } from './routerCore'
import { isNativeMode, getNativeModules } from './api/client'
import { isLoggedIn, restoreToken, registerUnauthorizedHandler } from './stores/authStore'
import { loadSettings } from './stores/settingsStore'
import { hasOpenModal, closeTopModal } from './stores/modalStack'
import { registerSessionErrorHandler } from './utils/errorPresentation'

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
import IllustList from './pages/IllustList.vue'
import IllustDetail from './pages/IllustDetail.vue'
import NovelList from './pages/NovelList.vue'
import NovelDetail from './pages/NovelDetail.vue'
import Me from './pages/Me.vue'
import UserHome from './pages/UserHome.vue'
import Following from './pages/Following.vue'
import Bookmarks from './pages/Bookmarks.vue'
import FollowList from './pages/FollowList.vue'
import UpdatePage from './pages/UpdatePage.vue'
import ErrorPage from './pages/ErrorPage.vue'
import Watchlist from './pages/Watchlist.vue'

export const routes: RouteDef[] = [
  { path: '/login', name: 'login', component: Login },
  { path: '/recommended', name: 'recommended', component: Recommended },
  { path: '/illusts', name: 'illusts', component: IllustList },
  { path: '/illust/:id', name: 'illust-detail', component: IllustDetail },
  { path: '/novels', name: 'novels', component: NovelList },
  { path: '/novel/:id', name: 'novel-detail', component: NovelDetail },
  { path: '/user/:id', name: 'user-home', component: UserHome },
  { path: '/user/:id/following', name: 'user-following', component: FollowList },
  { path: '/user/:id/followers', name: 'user-followers', component: FollowList },
  { path: '/following', name: 'following', component: Following },
  { path: '/bookmarks', name: 'bookmarks', component: Bookmarks },
  { path: '/me', name: 'me', component: Me },
  { path: '/watchlist', name: 'watchlist', component: Watchlist },
  // 强制更新页（检查更新命中后 replace + 清历史栈进入）：
  // backBehavior: 'exit' —— 返回键直接退出应用，无返回路径
  { path: '/update', name: 'update', component: UpdatePage, backBehavior: 'exit' },
  // 会话失效错误页（候选 #2：401 刷新失败强制重定向）：
  // backBehavior: 'exit' —— 清历史栈后进入，返回键直接退出应用，不可回退到已失效会话
  { path: '/error', name: 'error', component: ErrorPage, backBehavior: 'exit' },
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

// ─── 返回守卫（spec app-lynx-novel-series-watchlist §US3，issue #222） ───
// 页面级返回拦截注册表：守卫（如小说详情页追更询问）返回 true = 本次返回已被消费，
// 路由层不再 pop 历史栈。注册表与裁决纯逻辑在 routerCore（node 可单测），此处仅薄接线。
const backGuardRegistry = createBackGuardRegistry()

/** 注册返回守卫；返回注销函数（页面 onUnmounted/onDeactivated 时调用） */
export function registerBackGuard(guard: BackGuard): () => void {
  return backGuardRegistry.register(guard)
}

/**
 * 页面内返回入口（如左上角返回按钮）：先跑守卫，未被拦截才 goBack()。
 * 与系统返回（handleSystemBack）共用同一守卫链，两条返回路径行为一致。
 */
export function requestBack(): void {
  const intercepted = runBackGuards(backGuardRegistry.guards())
  if (intercepted) return
  goBack()
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
  // 裁决顺序（纯函数 evaluateBackRoute，routerCore 单测覆盖）：
  // ① modalStack 有打开弹层（issue #163）→ close-modal（返回键优先关弹层）
  // ② back-guard 拦截（§US3）→ intercepted（守卫消费本次返回，不动历史栈）
  // ③ 既有 ADR-0066 逻辑：backBehavior 'exit' / 历史栈 pop / 根路由双击退出
  const m = matchRoute(routes, _state.value.path)
  const action = evaluateBackRoute({
    hasOpenModal: hasOpenModal(),
    runGuards: () => runBackGuards(backGuardRegistry.guards()),
    behavior: m?.route.backBehavior,
    historyLength: _history.length,
    lastBackAt,
    now: Date.now(),
  })
  if (action === 'close-modal') {
    closeTopModal()
    return
  }
  if (action === 'intercepted') {
    return
  }
  if (action === 'navigate') {
    goBack()
    return
  }
  if (action === 'exit') {
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

/** bench 导航钩子（wayfinder #306）：原生 `am start --es benchNav <scenario>` 直达目标页。
 *  真机 input tap 对放射 FAB 环项 hit-test 失效（Oppo R11s 实测），经 GlobalEventEmitter 绕过。
 *  生产无此 intent（LynxActivity 仅 bench extra 存在时发送事件），零影响。 */
let benchNavRegistered = false
function registerBenchNavHandler(): void {
  if (benchNavRegistered) return
  benchNavRegistered = true
  const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
  if (!emitter || typeof emitter.addListener !== 'function') return
  const TARGETS: Record<string, string> = {
    pictelioBenchNavCarousel: '/recommended',
    pictelioBenchNavIllust: '/illusts',
    pictelioBenchNavNovel: '/novels',
  }
  for (const [eventName, target] of Object.entries(TARGETS)) {
    // 原生发送两次（1.5s/3s）防 JS 挂载竞态；replace 幂等，重复到达无副作用
    emitter.addListener(eventName, () => {
      void navigate(target, { replace: true })
    })
  }
}

/** 初始化（App 挂载时调用）：注册 401 刷新 + 恢复设置 + 首路由（replace 不入栈） */
export async function initRouter(): Promise<void> {
  registerUnauthorizedHandler()
  // 会话失效（401 刷新失败）→ 全屏错误页：清历史栈 + replace 进入（不可回退，backBehavior: 'exit'）
  registerSessionErrorHandler(() => {
    resetHistory()
    void navigate('/error', { replace: true })
  })
  if (isNativeMode()) registerSystemBackHandler()
  if (isNativeMode()) registerBenchNavHandler()
  const ok = await restoreToken()
  // ADR-0103：账号级设置需 uid 已知（restoreToken 之后）再加载
  await loadSettings()
  void navigate(ok ? '/recommended' : '/login', { replace: true })
}
