// ─── PROTOTYPE（throwaway，勿入生产）───
// 探针导航包装 + 全局守卫（Q3 实证）：
// 1) beforeEach 全局守卫鉴权拦截（meta.requiresAuth）是否可行（用户 Q3）
// 2) 守卫 await 网络对首帧时序的影响（先渲染后加载硬约束的边界）
// 3) 会话 epoch：登出后（resetSession）业务页不可达（守卫拦截 forward + 返回判定拦截 back）
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'
import RouteProbeHome from './RouteProbeHome.vue'
import RouteProbeDetail from './RouteProbeDetail.vue'
import RouteProbeLogin from './RouteProbeLogin.vue'
import RouteProbeProtected from './RouteProbeProtected.vue'

export const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    // 首页等同生产首路由（/recommended）：守卫鉴权目标（首帧内容化的对象）
    { path: '/', name: 'probe-home', component: RouteProbeHome, meta: { requiresAuth: true } },
    { path: '/login', name: 'probe-login', component: RouteProbeLogin },
    { path: '/detail/:id', name: 'probe-detail', component: RouteProbeDetail },
    // meta.requiresAuth：守卫鉴权拦截目标
    { path: '/protected', name: 'probe-protected', component: RouteProbeProtected, meta: { requiresAuth: true } },
  ],
})

// ─── 模拟会话状态（生产= authStore） ───
const _authed = ref(false)
const _cleared = ref(false) // 登出后：业务页不可达（等价「清栈」语义拦截）
const _epoch = ref(1)
/** bootstrap 中（生产= restoreToken 尚未完成）：守卫放行，首帧先渲染后再补鉴权 */
const _bootstraping = ref(true)
/** 守卫内 await 时长（0=同步守卫；>0 模拟 restoreToken 网络，观首帧时序） */
let _guardAwaitMs = 800

export function setBootstrapDone(): void {
  _bootstraping.value = false
  console.warn('[routeProbe] bootstrap 完成（恢复鉴权状态为定局后，initRouter 收敛点）')
}

export function setAuthed(v: boolean): void {
  _authed.value = v
  if (v) {
    _cleared.value = false
    _epoch.value++
    console.warn('[routeProbe] 登录成功（beginSession 语义）：cleared=false, epoch=', _epoch.value)
  }
}
/** 登出（生产 authStore 登出/会话失效 → resetHistory 等价点） */
export function resetSession(): void {
  _authed.value = false
  _cleared.value = true
  _epoch.value++
  console.warn('[routeProbe] 登出（resetSession 语义）：cleared=true, epoch=', _epoch.value)
}
export function authed(): boolean {
  return _authed.value
}
export function isCleared(): boolean {
  return _cleared.value
}
export function setGuardAwaitMs(ms: number): void {
  _guardAwaitMs = ms
}
export function epoch(): number {
  return _epoch.value
}

// ─── 全局守卫（用户 Q3：vue-router 全局守卫鉴权拦截） ───
router.beforeEach(async (to, from) => {
  const t0 = Date.now()
  console.warn(
    `[routeProbe] guard enter: to=${to.fullPath} from=${from.fullPath} authed=${_authed.value} cleared=${_cleared.value} bootstrap=${_bootstraping.value}`,
  )
  if (to.meta.requiresAuth as boolean) {
    if (_bootstraping.value) {
      // 首帧内容化 + 先渲染后加载：bootstrap 期（restoreToken 未完成）守卫放行，
      // 鉴权由页面 401 兜底 + initRouter 收敛（生产现有语义）；守卫绝不 await 网络阻塞渲染
      console.warn('[routeProbe] guard: bootstrap 放行（首帧先渲染，await 网络会空白首帧）')
      return true
    }
    if (_guardAwaitMs > 0) {
      // 模拟 restoreToken 网络等待——实证「守卫 await」的代价（覆盖在明确未登录的受保护导航上）
      await new Promise((r) => setTimeout(r, _guardAwaitMs))
    }
    if (_cleared.value) {
      console.warn('[routeProbe] guard: 会话已清除（登出），业务页不可达 → 重定向 /login (replace)')
      return { path: '/login', replace: true }
    }
    if (!_authed.value) {
      console.warn('[routeProbe] guard: 未登录访问受保护页 → 重定向 /login (replace)')
      return { path: '/login', replace: true }
    }
  }
  console.warn(`[routeProbe] guard pass: to=${to.fullPath}（${Date.now() - t0}ms）`)
  return true
})

// memory history 初始位置是 nowhere：必须手动 push 定起点
//（官方示例在 app.mount() 前执行）——复刻生产「首帧内容化」初始即推荐页语义。
void router.push('/')

/** 自跟踪栈（镜像 vue-router 的 push/replace/back 语义；页面全部经此函数导航） */
const _stack: string[] = []

export function probeNavigate(path: string, opts?: { replace?: boolean }): Promise<unknown> {
  const cur = router.currentRoute.value.fullPath
  if (!opts?.replace && cur !== path) _stack.push(cur)
  return router.push(path)
}

/** 返回：栈空或目标无效时回退首页（生产语义：栈空回退 /recommended） */
export function probeBack(): void {
  const prev = _stack.pop()
  if (prev) {
    void router.back()
    return
  }
  void router.replace('/')
}

export function probeHasHistory(): boolean {
  return _stack.length > 0
}

/** 取证用（logcat 打印栈深） */
export function probeStackLength(): number {
  return _stack.length
}
