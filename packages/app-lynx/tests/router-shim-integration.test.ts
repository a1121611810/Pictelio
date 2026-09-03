// ─── 路由 shim 集成测试（ADR-0138 / spec #329 Seam 1；code-review P1-3 补齐） ───
// 期望值出处：spec D2-D5 + ADR-0138 决策原文（行为等价迁移契约）；非实现反推。
// 用真实 createMemoryHistory 驱动 shim 状态机（router 单例经 vi.resetModules 每测重建），
// 重型依赖（api/client、authStore、settingsStore、modalStack、errorPresentation、页面）以 mock 隔离。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = vi.hoisted(() => {
  const auth = {
    loggedIn: { value: false },
    restoreOk: false,
    restoreToken: vi.fn(async () => false),
  }
  const sessionErr = { cb: null as null | (() => void) }
  return { auth, sessionErr }
})

vi.mock('../src/api/client', () => ({
  isNativeMode: () => false,
  getNativeModules: () => undefined,
}))
vi.mock('../src/stores/authStore', () => ({
  useAuthStore: () => ({
    isLoggedIn: env.auth.loggedIn.value,
    restoreToken: env.auth.restoreToken,
    registerUnauthorizedHandler: () => {},
    currentUser: null,
    logout: () => {},
  }),
}))
vi.mock('../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    loadSettings: async () => {},
  }),
}))
vi.mock('../src/stores/modalStack', () => ({
  useModalStack: () => ({
    hasOpenModal: () => false,
    closeTopModal: () => {},
    registerModal: () => () => {},
  }),
}))
vi.mock('../src/utils/errorPresentation', () => ({
  registerSessionErrorHandler: (cb: () => void) => {
    env.sessionErr.cb = cb
  },
}))
// 页面组件均为占位（路由只需 component 引用，不渲染）；vi.mock 会被提升，
// 路径必须为字面量（勿用变量拼接）
vi.mock('../src/pages/Login.vue', () => ({ default: {} }))
vi.mock('../src/pages/Recommended.vue', () => ({ default: {} }))
vi.mock('../src/pages/IllustList.vue', () => ({ default: {} }))
vi.mock('../src/pages/IllustDetail.vue', () => ({ default: {} }))
vi.mock('../src/pages/NovelList.vue', () => ({ default: {} }))
vi.mock('../src/pages/NovelDetail.vue', () => ({ default: {} }))
vi.mock('../src/pages/Me.vue', () => ({ default: {} }))
vi.mock('../src/pages/UserHome.vue', () => ({ default: {} }))
vi.mock('../src/pages/Following.vue', () => ({ default: {} }))
vi.mock('../src/pages/Bookmarks.vue', () => ({ default: {} }))
vi.mock('../src/pages/FollowList.vue', () => ({ default: {} }))
vi.mock('../src/pages/UpdatePage.vue', () => ({ default: {} }))
vi.mock('../src/pages/ErrorPage.vue', () => ({ default: {} }))
vi.mock('../src/pages/Watchlist.vue', () => ({ default: {} }))

type RouterModule = typeof import('../src/router')

/** 每测重建模块（router 单例 + 会话状态 + 守卫实例全部清零） */
async function loadRouter(): Promise<RouterModule> {
  vi.resetModules()
  env.auth.restoreToken.mockResolvedValue(env.auth.restoreOk)
  const mod = await import('../src/router')
  return mod
}

describe('路由表完整性（spec D3）', () => {
  it('15 条路由：path/name 齐全；/update、/error 无 requiresAuth 且带 backBehavior exit（P0-1）', async () => {
    const mod = await loadRouter()
    expect(mod.routes).toHaveLength(15)
    const nameOf = (p: string) => mod.routes.find((r) => r.path === p)?.name
    expect(nameOf('/login')).toBe('login')
    expect(nameOf('/recommended')).toBe('recommended')
    expect(nameOf('/illust/:id')).toBe('illust-detail')
    expect(nameOf('/novel/:id')).toBe('novel-detail')
    expect(nameOf('/user/:id/following')).toBe('user-following')
    // P0-1：系统页是 cleared 语义下的目的页，不可被守卫自身拦截
    expect(mod.routes.find((r) => r.path === '/update')?.meta).toEqual({ backBehavior: 'exit' })
    expect(mod.routes.find((r) => r.path === '/error')?.meta).toEqual({ backBehavior: 'exit' })
    // 业务页 requiresAuth 标注
    expect(mod.routes.find((r) => r.path === '/recommended')?.meta?.requiresAuth).toBe(true)
    expect(mod.routes.find((r) => r.path === '/login')?.meta?.requiresAuth).toBeUndefined()
  })
})

describe('shim 生命周期状态机（真实 createMemoryHistory）', () => {
  beforeEach(() => {
    env.auth.loggedIn.value = false
    env.auth.restoreOk = false
  })

  it('启动未登录：initRouter 收敛到 /login（bootstrap 放行 → replace）', async () => {
    const mod = await loadRouter()
    await mod.initRouter()
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })

  it('启动已登录：initRouter 收敛到 /recommended', async () => {
    env.auth.restoreOk = true
    env.auth.loggedIn.value = true
    const mod = await loadRouter()
    await mod.initRouter()
    expect(mod.router.currentRoute.value.path).toBe('/recommended')
  })

  it('bootstrap 完成后未登录访问业务页 → 守卫重定向 /login（replace）', async () => {
    const mod = await loadRouter()
    await mod.initRouter() // restoreOk=false → /login，bootstrap 完成
    expect(mod.router.currentRoute.value.path).toBe('/login')
    await mod.navigate('/bookmarks')
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })

  it('会话清除后 /error、/update 仍可达（P0-1：cleared 语义下它们是目的页）', async () => {
    env.auth.restoreOk = true
    env.auth.loggedIn.value = true
    const mod = await loadRouter()
    await mod.initRouter()
    expect(mod.router.currentRoute.value.path).toBe('/recommended')
    // 强制更新链：updateStore.resetHistory() → navigate('/update')
    mod.resetHistory()
    await mod.navigate('/update', { replace: true })
    expect(mod.router.currentRoute.value.path).toBe('/update')
    // 会话失效链：registerSessionErrorHandler 回调 → resetHistory + navigate('/error', replace)
    env.sessionErr.cb?.()
    await vi.waitFor(() => {
      expect(mod.router.currentRoute.value.path).toBe('/error')
    })
  })

  it('登出后返回键不可回业务页（canBack=false → goBack 停留在登录页）', async () => {
    env.auth.restoreOk = true
    env.auth.loggedIn.value = true
    const mod = await loadRouter()
    await mod.initRouter()
    await mod.navigate('/illusts')
    expect(mod.hasBackEntry()).toBe(true)
    // 登出（Me.vue 链：resetHistory + replace /login）
    env.auth.loggedIn.value = false
    mod.resetHistory()
    await mod.navigate('/login', { replace: true })
    expect(mod.hasBackEntry()).toBe(false)
    mod.goBack()
    // goBack 为 fire-and-forget（void router.back/replace），导航完成后收敛断言
    await vi.waitFor(() => {
      expect(mod.router.currentRoute.value.path).toBe('/login')
    })
  })

  it('重登录后旧会话条目不可返回（P1-2：镜像栈物理清空）', async () => {
    env.auth.restoreOk = true
    env.auth.loggedIn.value = true
    const mod = await loadRouter()
    await mod.initRouter()
    await mod.navigate('/illust/42')
    await mod.navigate('/me')
    // 登出 → 重登录（会话新起点）
    env.auth.loggedIn.value = false
    mod.resetHistory()
    await mod.navigate('/login', { replace: true })
    env.auth.loggedIn.value = true
    mod.markSessionEstablished()
    await mod.navigate('/recommended', { replace: true })
    // 新会话根路由：无可返回页（旧 /illust/42、/me 不可经 back 进入）
    expect(mod.hasBackEntry()).toBe(false)
    mod.goBack()
    await vi.waitFor(() => {
      expect(mod.router.currentRoute.value.path).toBe('/recommended')
    })
    // 新会话内正常 push/back 不受影响
    await mod.navigate('/illusts')
    expect(mod.hasBackEntry()).toBe(true)
    mod.goBack()
    await vi.waitFor(() => {
      expect(mod.router.currentRoute.value.path).toBe('/recommended')
    })
    expect(mod.hasBackEntry()).toBe(false)
  })

  it('守卫重定向的 push 不入镜像栈（P3-1 不变式：hasBackEntry 仍 false）', async () => {
    const mod = await loadRouter()
    await mod.initRouter() // 未登录收敛 /login，bootstrap 完成
    expect(mod.router.currentRoute.value.path).toBe('/login')
    // 未登录 push 业务页 → 守卫重定向 /login；镜像不得留垃圾条目（重定向后仍无可返回）
    await mod.navigate('/following')
    expect(mod.router.currentRoute.value.path).toBe('/login')
    expect(mod.hasBackEntry()).toBe(false)
    // 重定向后正常路径（换到已登录会话）不受垃圾条目影响
    env.auth.loggedIn.value = true
    await mod.navigate('/recommended', { replace: true })
    expect(mod.hasBackEntry()).toBe(false)
  })

  it('无匹配路径 → 兜底 /login（P2-1：保持旧实现语义）', async () => {
    const mod = await loadRouter()
    await mod.navigate('/nonexistent-route')
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })
})
