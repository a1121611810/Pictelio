// ─── 路由 shim：官方 vue-router（createMemoryHistory）+ 页面调用面不变 ───
// ADR-0138（spec #329 / tickets #330-）：自研内存路由迁移到官方 vue-router。
// 模板注意事项（实证）：vue-lynx 模板编译器把带连字符的标签当作原生元素——
// kebab-case <router-view> 会空渲染（无 slot）或编译报错（v-slot）；模板必须用
// PascalCase <RouterView />。历史根因「RouterView 渲染为空（已实测）」即此陷阱
// 所致，非兼容性问题（证据：prototype/lynx-vue-router 五轮双端实证）。
// code-review 修正（2026-09-03）：「能否返回」决策 = 会话镜像栈（可物理清空）∧
// 队列探测 hasBackEntryIn（看门狗）——纯官方 API 探测在「登出→重登录」后无法
// 识别旧会话残留条目，镜像栈承载物理清栈语义（ADR-0138 决策 5 修订，P1-2）。
import { ref, computed } from 'vue'
import {
  createRouter,
  createMemoryHistory,
  type RouteRecordRaw,
  type Router,
} from 'vue-router'
import { evaluateBackRoute, createBackGuardRegistry, runBackGuards, hasBackEntryIn, decideRequiresAuth, type BackGuard } from './routerCore'
import { isNativeMode, getNativeModules } from './api/client'
import { isLoggedIn, restoreToken, registerUnauthorizedHandler, currentUser } from './stores/authStore'
import { loadSettings } from './stores/settingsStore'
import { hasOpenModal, closeTopModal } from './stores/modalStack'
import { registerSessionErrorHandler } from './utils/errorPresentation'

/** 首帧/栈空回退目标（ADR-0049）：初始路由 = 推荐页（首帧内容化） */
export const RECOMMENDED_PATH = '/recommended'

// route meta 类型（vue-router RouteMeta 增强）：requiresAuth（守卫鉴权）、
// backBehavior（返回键行为，原路由声明的 backBehavior 迁入 meta——ADR-0138 决策 6）
declare module 'vue-router' {
  interface RouteMeta {
    /** 业务页标记：全局守卫鉴权拦截（ADR-0138 决策 4） */
    requiresAuth?: boolean
    /** 'exit' = 返回键直接退出应用（/update、/error） */
    backBehavior?: 'exit'
  }
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

/**
 * 路由表（vue-router 1:1 迁移，ADR-0138 决策 3）：
 * path/name/component 与迁移前一致；backBehavior:'exit' 迁入 meta；业务页标 requiresAuth。
 * /update、/error 为「无会话/强制态」系统页：**不标 requiresAuth**（code-review P0-1——
 * 两者恰在会话清除后经 cleared 路径进入，标了会被守卫自身重定向回 /login，
 * 强制更新/会话错误页不可达）；不可回退由 backBehavior:'exit' 保证（ADR-0066 扩展）。
 * 登录页同样不标（未登录态入口）。
 */
export const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: Login },
  { path: RECOMMENDED_PATH, name: 'recommended', component: Recommended, meta: { requiresAuth: true } },
  { path: '/illusts', name: 'illusts', component: IllustList, meta: { requiresAuth: true } },
  { path: '/illust/:id', name: 'illust-detail', component: IllustDetail, meta: { requiresAuth: true } },
  { path: '/novels', name: 'novels', component: NovelList, meta: { requiresAuth: true } },
  { path: '/novel/:id', name: 'novel-detail', component: NovelDetail, meta: { requiresAuth: true } },
  { path: '/user/:id', name: 'user-home', component: UserHome, meta: { requiresAuth: true } },
  { path: '/user/:id/following', name: 'user-following', component: FollowList, meta: { requiresAuth: true } },
  { path: '/user/:id/followers', name: 'user-followers', component: FollowList, meta: { requiresAuth: true } },
  { path: '/following', name: 'following', component: Following, meta: { requiresAuth: true } },
  { path: '/bookmarks', name: 'bookmarks', component: Bookmarks, meta: { requiresAuth: true } },
  { path: '/me', name: 'me', component: Me, meta: { requiresAuth: true } },
  { path: '/watchlist', name: 'watchlist', component: Watchlist, meta: { requiresAuth: true } },
  { path: '/update', name: 'update', component: UpdatePage, meta: { backBehavior: 'exit' } },
  { path: '/error', name: 'error', component: ErrorPage, meta: { backBehavior: 'exit' } },
]

export const router: Router = createRouter({
  history: createMemoryHistory(),
  routes,
})

// ─── 会话状态（ADR-0138 决策 4/5；code-review 修订版） ───
// 已提前置顶：全局守卫需在首次导航前就位。
// cleared：登出/会话失效后业务页不可达（forward 守卫拦截）。
// _sessionStack：会话镜像栈——真实「能否返回」的决策主源（物理可清空；
//   memory history 队列不可清空，登出→重登录后旧会话条目仍在其中——
//   纯官方 API 探测无法识别，P1-2 因此引入镜像栈承载原「清历史栈」语义）。
// 置位点：resetHistory（登出/会话失效调用点）；清除点：markSessionEstablished（登录成功）。
let _sessionCleared = false
const _sessionStack: string[] = []

// 全局守卫鉴权（ADR-0138 决策 4；Q3 探针实证：web-core + 原生双端）。
// bootstrap 期（restoreToken 未完成）同步放行——守卫不 await 网络（await 期间
// RouterView 空白，违「先渲染后加载」；鉴权失败由页面 401 兜底 + initRouter 收敛）
let _bootstrapping = true

/** bootstrap 完成（initRouter 在登录态恢复定局后调用）：守卫开始执行鉴权拦截 */
export function markBootstrapDone(): void {
  _bootstrapping = false
}

router.beforeEach((to) => {
  const decision = decideRequiresAuth(Boolean(to.meta.requiresAuth), _bootstrapping, _sessionCleared, isLoggedIn.value)
  if (decision === true) return true
  return decision
})

// [首帧内容化]（#61/#63）：初始路由为推荐页——首帧直接渲染推荐页骨架屏，
// 消除已登录用户启动时的登录页闪屏；未登录用户由 initRouter 登录守卫
// replace 到 /login（不入栈，ADR-0049 语义不变）。
// memory history 初始位置是 "nowhere"（官方 API 文档确认），必须显式定起点
//（官方示例在 app.mount() 前 push）；此处用 replace——与 initRouter 收敛语义一致
// 且不入历史栈。若该导航失败（守卫/依赖错误）→ RouterView 无匹配渲染空白，
// 属于「先渲染后加载」的显式前提（code-review P3）。
void router.replace(RECOMMENDED_PATH)

export interface RouteState {
  name: string
  path: string
  params: Record<string, string>
}

/** 路由状态（兼容导出，原 _state ref）：以 router.currentRoute 为准 */
export const routeState = ref<RouteState>({
  name: 'recommended',
  path: RECOMMENDED_PATH,
  params: {},
})

// currentRoute → routeState 同步（页面取 currentParams / FAB 取 name 均经此）
router.afterEach((to) => {
  routeState.value = {
    name: typeof to.name === 'string' ? to.name : '',
    path: to.path,
    params: to.params as Record<string, string>,
  }
})

/** 当前路由参数（兼容导出；页面取参方式不变） */
export const currentParams = computed(() => routeState.value.params)

export interface NavigateOptions {
  /** replace 语义：不入历史栈（登录/登出/首路由） */
  replace?: boolean
}

export async function navigate(path: string, opts?: NavigateOptions): Promise<void> {
  // [行为等价，P2-1] 旧实现无匹配路径强制落 /login：vue-router resolve 无匹配 →
  // matched 为空 → RouterView 渲染空白；显式兜底保持旧语义。
  // 统一 replace（P3-2）：登录页不被返回（ADR-0049），与 opts.replace 无关
  if (router.resolve(path, router.currentRoute.value).matched.length === 0) {
    await router.replace('/login')
    return
  }
  if (opts?.replace) {
    await router.replace(path)
    return
  }
  const cur = router.currentRoute.value.fullPath
  // 镜像在导航确认后入栈（P3-1）：守卫重定向/被取消的 push 不入栈
  //（重定向后 currentRoute 已是 /login ≠ path，以最终落点为准防垃圾镜像条目）
  await router.push(path)
  if (router.currentRoute.value.fullPath === path && cur !== path) {
    _sessionStack.push(cur)
  }
}

/** 清空历史栈（登录/登出后调用，会话新起点）：置位会话清除标记 + 物理清镜像栈（ADR-0138 决策 5 修订） */
export function resetHistory(): void {
  _sessionCleared = true
  _sessionStack.length = 0
}

/** 登录成功（beginSession 语义）：清除会话标记 + 清空旧会话镜像（P1-2：防重登录后返回旧会话条目） */
export function markSessionEstablished(): void {
  _sessionCleared = false
  _sessionStack.length = 0
}

/** 未登录守卫：保证进入受保护页面前完成 token 恢复（页面自理登录态，守卫兜底收敛） */
export async function ensureAuth(): Promise<boolean> {
  if (isLoggedIn.value) return true
  if (isNativeMode()) registerBenchNavHandler()
  const ok = await restoreToken()
  if (!ok) navigate('/login', { replace: true })
  return ok
}

/**
 * 「能否返回」= 会话镜像栈非空（会话主源，物理清空承载清栈语义）
 *   ∧ hasBackEntryIn（队列探测看门狗：防镜像漂移——若有导航路径绕过 mirror，
 *   镜像与真实队列不一致时返回 false 保底）
 * （code-review P1-2 修正：纯官方 API 探测在重登录后无法识别旧会话残留条目）
 */
export function hasBackEntry(): boolean {
  return _sessionStack.length > 0 && hasBackEntryIn(router.options.history)
}

export function goBack(): void {
  // 镜像弹栈先行：镜像有上一页 → 队列探测确认（看门狗防漂移）→ 官方 API 回退（ADR-0049）；
  // 镜像与队列不一致（有导航绕过镜像漂移）→ 清镜像降级为回推荐页
  if (_sessionStack.length > 0 && hasBackEntryIn(router.options.history)) {
    _sessionStack.pop()
    void router.back()
    return
  }
  _sessionStack.length = 0
  void router.replace(RECOMMENDED_PATH)
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
  const action = evaluateBackRoute({
    hasOpenModal: hasOpenModal(),
    runGuards: () => runBackGuards(backGuardRegistry.guards()),
    behavior: router.currentRoute.value.meta.backBehavior,
    // 「能否返回」= 镜像栈 ∧ 队列探测（见 hasBackEntry；登出后=提示/双击退出）
    // !_sessionCleared 为冗余防御（resetHistory 同步清镜像，hasBackEntry 已 false；
    // 保留防未来镜像清空逻辑被误改——P3-4）
    historyLength: hasBackEntry() && !_sessionCleared ? 1 : 0,
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

/** bench 导航钩子（wayfinder #306，ADR-0136）：原生 `am start --es benchNav <scenario>` 直达目标页。
 *  真机 input tap 对放射 FAB 环项 hit-test 失效（Oppo R11s 实测），经 GlobalEventEmitter 绕过。
 *  __BENCH_NAV__ 门禁（lynx.config.ts 按 BENCH_NAV=1 注入，生产为 false 整块消除）——
 *  不用 __DEV__（NODE_ENV=production 恒 false，debug APK 也被误杀）；与原生
 *  BuildConfig.DEBUG 双保险：原生不发广播时 JS 监听悬空零影响。 */
let benchNavRegistered = false
function registerBenchNavHandler(): void {
  if (!__BENCH_NAV__) return // 未显式 BENCH_NAV=1 构建：整块消除
  if (benchNavRegistered) return
  benchNavRegistered = true
  const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
  const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
  if (!emitter || typeof emitter.addListener !== 'function') return
  const TARGETS: Record<string, string> = {
    pictelioBenchNavCarousel: RECOMMENDED_PATH,
    pictelioBenchNavIllust: '/illusts',
    pictelioBenchNavNovel: '/novels',
    pictelioBenchNavFollowing: '/following',
    // T3（#328）扩展：收藏/追更/用户页直达（含用户系页面需真实 id——自账 id 运行时解析）
    pictelioBenchNavBookmarks: '/bookmarks',
    pictelioBenchNavWatchlist: '/watchlist',
  }
  for (const [eventName, target] of Object.entries(TARGETS)) {
    // 原生发送两次（1.5s/3s）防 JS 挂载竞态；replace 幂等，重复到达无副作用
    emitter.addListener(eventName, () => {
      void navigate(target, { replace: true })
    })
  }
  // 用户系页面（UserHome / FollowList）：需真实 user id，自账 id 从 authStore 运行时解析；
  // 未登录时显式 warn（非静默降级，测试钩子可快速定位）
  const DYNAMIC_TARGETS: Record<string, () => string | null> = {
    pictelioBenchNavUser: () => (currentUser.value?.id != null ? `/user/${currentUser.value.id}` : null),
    pictelioBenchNavUserfollowing: () =>
      currentUser.value?.id != null ? `/user/${currentUser.value.id}/following` : null,
  }
  for (const [eventName, resolve] of Object.entries(DYNAMIC_TARGETS)) {
    emitter.addListener(eventName, () => {
      const target = resolve()
      if (target === null) {
        console.warn('[router] benchNav 用户页直达失败：未登录（currentUser 为空）')
        return
      }
      void navigate(target, { replace: true })
    })
  }
}
// 模块加载即注册（先于 initRouter 的网络恢复；initRouter 中重复调用幂等）——
// 否则广播窗口（onLoadSuccess+1.5/3s）落在 restoreToken 之后时事件被丢弃。
if (isNativeMode()) registerBenchNavHandler()



/** 初始化（App 挂载时调用）：注册 401 刷新 + 恢复设置 + 首路由（replace 不入栈） */
export async function initRouter(): Promise<void> {
  registerUnauthorizedHandler()
  // 会话失效（401 刷新失败）→ 全屏错误页：清历史栈 + replace 进入（不可回退，meta.backBehavior: 'exit'）
  registerSessionErrorHandler(() => {
    resetHistory()
    void navigate('/error', { replace: true })
  })
  if (isNativeMode()) registerSystemBackHandler()
  const ok = await restoreToken()
  // ADR-0103：账号级设置需 uid 已知（restoreToken 之后）再加载
  await loadSettings()
  await navigate(ok ? RECOMMENDED_PATH : '/login', { replace: true })
  // 登录态恢复已定局：守卫开始执行鉴权拦截（bootstrap 期放行至此结束）
  markBootstrapDone()
}
