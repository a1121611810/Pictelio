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
// 稍后看 store（ADR-0191 / #751 T3）：initRouter 在 loadSettings 后 hydrate——
// 本套件无 active pinia，与 authStore/settingsStore 同款 mock 隔离（真实行为在
// watchLaterStore.test.ts 覆盖）
vi.mock('../src/stores/watchLaterStore', () => ({
  useWatchLaterStore: () => ({
    hydrate: async () => {},
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
vi.mock('../src/pages/NovelIntro.vue', () => ({ default: {} }))
vi.mock('../src/pages/Me.vue', () => ({ default: {} }))
// [维度重构 2026-10-03] 三个新顶层/次级页：占位组件，同款理由（路由只需 component 引用）。
// ⚠️ 本测试的 vitest 配置**没装 vue 插件**，任何漏桩的 .vue 都会在 import 期
//    抛 "Failed to parse source for import analysis" —— 新增页面时**必须**同步补桩。
vi.mock('../src/pages/Updates.vue', () => ({ default: {} }))
vi.mock('../src/pages/Shelf.vue', () => ({ default: {} }))
vi.mock('../src/pages/AdvancedSettings.vue', () => ({ default: {} }))
vi.mock('../src/pages/UserHome.vue', () => ({ default: {} }))
vi.mock('../src/pages/Following.vue', () => ({ default: {} }))
vi.mock('../src/pages/Bookmarks.vue', () => ({ default: {} }))
vi.mock('../src/pages/FollowList.vue', () => ({ default: {} }))
vi.mock('../src/pages/UpdatePage.vue', () => ({ default: {} }))
vi.mock('../src/pages/ErrorPage.vue', () => ({ default: {} }))
vi.mock('../src/pages/Watchlist.vue', () => ({ default: {} }))
// 稍后看列表页（ADR-0191 / #753 T4）：占位组件（路由只需 component 引用，不渲染）
vi.mock('../src/pages/WatchLater.vue', () => ({ default: {} }))
vi.mock('../src/pages/Notifications.vue', () => ({ default: {} }))
// 好P友列表页（ADR-0193 / #754 T7）：占位组件（路由只需 component 引用，不渲染）
vi.mock('../src/pages/MyPixiv.vue', () => ({ default: {} }))
vi.mock('../src/pages/MuteTags.vue', () => ({ default: {} }))
// 标签近邻结果页（ADR-0197 D14 / #767 T2）：无 .vue transform，故需占位 mock
vi.mock('../src/pages/TagNeighbors.vue', () => ({ default: {} }))
vi.mock('../src/pages/DownloadManager.vue', () => ({ default: {} }))
vi.mock('../src/pages/NetworkCheck.vue', () => ({ default: {} }))
vi.mock('../src/pages/Ranking.vue', () => ({ default: {} }))
vi.mock('../src/pages/PlatformCheck.vue', () => ({ default: {} }))

type RouterModule = typeof import('../src/router')

/** 每测重建模块（router 单例 + 会话状态 + 守卫实例全部清零） */
async function loadRouter(): Promise<RouterModule> {
  vi.resetModules()
  env.auth.restoreToken.mockResolvedValue(env.auth.restoreOk)
  const mod = await import('../src/router')
  return mod
}

describe('路由表完整性（spec D3）', () => {
  it('28 条路由：path/name 齐全；/update、/error 无 requiresAuth 且带 backBehavior exit（P0-1）', async () => {
    const mod = await loadRouter()
    expect(mod.routes).toHaveLength(28)
    const nameOf = (p: string) => mod.routes.find((r) => r.path === p)?.name
    expect(nameOf('/login')).toBe('login')
    expect(nameOf('/discover')).toBe('discover')
    expect(nameOf('/illust/:id')).toBe('illust-detail')
    expect(nameOf('/novel/:id')).toBe('novel-detail')
    // 通知中心（ADR-0188 D7 / #728）：业务次级页，requiresAuth 守卫鉴权
    expect(nameOf('/notifications')).toBe('notifications')
    expect(mod.routes.find((r) => r.path === '/notifications')?.meta?.requiresAuth).toBe(true)
    // 静音标签管理页（ADR-0187 D5 / #732）：业务次级页，requiresAuth 守卫鉴权
    expect(nameOf('/mute-tags')).toBe('mute-tags')
    expect(mod.routes.find((r) => r.path === '/mute-tags')?.meta?.requiresAuth).toBe(true)
    // 稍后看列表页（ADR-0191 D5 / #753 T4）：业务次级页，requiresAuth（先例 = /watchlist）；
    // 术语红线：路由名 watchLater，与追更 watchlist 物理隔离
    expect(nameOf('/later')).toBe('watchLater')
    expect(mod.routes.find((r) => r.path === '/later')?.meta?.requiresAuth).toBe(true)
    // 好P友列表页（ADR-0193 D2 / #754 T7）：业务次级页，requiresAuth 守卫鉴权；
    // 好P友是双向关系（/v1/user/mypixiv），与 following/follower 单向关系不同族
    expect(nameOf('/mypixiv')).toBe('mypixiv')
    expect(mod.routes.find((r) => r.path === '/mypixiv')?.meta?.requiresAuth).toBe(true)
    // 小说介绍页（spec #585 / 票 #586）：与 /novel/:id 平级共存，同标 requiresAuth
    expect(nameOf('/novel/:id/intro')).toBe('novel-intro')
    expect(mod.routes.find((r) => r.path === '/novel/:id/intro')?.meta?.requiresAuth).toBe(true)
    // 标签近邻结果页（ADR-0197 D14 / #767 T2）：作品级能力故挂 /illust/:id 之下；
    // 作品详情页动作行进入的次级业务页，requiresAuth
    expect(nameOf('/illust/:id/tag-neighbors')).toBe('tag-neighbors')
    expect(mod.routes.find((r) => r.path === '/illust/:id/tag-neighbors')?.meta?.requiresAuth).toBe(true)
    expect(nameOf('/downloads')).toBe('downloads')
    expect(nameOf('/network-check')).toBe('network-check')
    expect(nameOf('/ranking')).toBe('ranking')
    expect(nameOf('/user/:id/following')).toBe('user-following')
    // 平台一致性自检页（spec qa-defense-lines §3.T4 / #550）：debug 路由，无登录耦合
    expect(nameOf('/platform-check')).toBe('platform-check')
    expect(mod.routes.find((r) => r.path === '/platform-check')?.meta?.requiresAuth).toBeUndefined()
    // P0-1：系统页是 cleared 语义下的目的页，不可被守卫自身拦截
    //
    // ⚠️ 这里刻意**不断言整个 meta 对象**（原为 toEqual({ backBehavior: 'exit' })）：
    // meta 是持续增长的契约面（#900 T1 加了 topInset），深相等等于把「meta 恰好只有这一个字段」
    // 写进契约 —— 下一个人加任何新字段都会在这里炸一条与本用例意图（P0-1 不可被拦截）
    // 毫无关系的红灯。改为逐字段断言意图本身：带 exit、且**没有** requiresAuth。
    for (const p of ['/update', '/error']) {
      const meta = mod.routes.find((r) => r.path === p)?.meta
      expect(meta?.backBehavior, `${p} 应声明 backBehavior exit`).toBe('exit')
      expect(meta?.requiresAuth, `${p} 不得标 requiresAuth（P0-1）`).toBeUndefined()
    }
    // 业务页 requiresAuth 标注
    expect(mod.routes.find((r) => r.path === '/discover')?.meta?.requiresAuth).toBe(true)
    expect(mod.routes.find((r) => r.path === '/downloads')?.meta?.requiresAuth).toBe(true)
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
    expect(mod.router.currentRoute.value.path).toBe('/discover')
  })

  it('bootstrap 完成后未登录访问业务页 → 守卫重定向 /login（replace）', async () => {
    const mod = await loadRouter()
    await mod.initRouter() // restoreOk=false → /login，bootstrap 完成
    expect(mod.router.currentRoute.value.path).toBe('/login')
    await mod.navigate('/bookmarks')
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })

  it('未登录访问 /later → 守卫拦截（requiresAuth 生效，ADR-0191 D5）', async () => {
    const mod = await loadRouter()
    await mod.initRouter()
    await mod.navigate('/later')
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })

  it('未登录访问 /mypixiv → 守卫拦截（requiresAuth 生效，ADR-0193 D2）', async () => {
    const mod = await loadRouter()
    await mod.initRouter()
    await mod.navigate('/mypixiv')
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })

  it('会话清除后 /error、/update 仍可达（P0-1：cleared 语义下它们是目的页）', async () => {
    env.auth.restoreOk = true
    env.auth.loggedIn.value = true
    const mod = await loadRouter()
    await mod.initRouter()
    expect(mod.router.currentRoute.value.path).toBe('/discover')
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
    await mod.navigate('/discover', { replace: true })
    // 新会话根路由：无可返回页（旧 /illust/42、/me 不可经 back 进入）
    expect(mod.hasBackEntry()).toBe(false)
    mod.goBack()
    await vi.waitFor(() => {
      expect(mod.router.currentRoute.value.path).toBe('/discover')
    })
    // 新会话内正常 push/back 不受影响
    await mod.navigate('/illusts')
    expect(mod.hasBackEntry()).toBe(true)
    mod.goBack()
    await vi.waitFor(() => {
      expect(mod.router.currentRoute.value.path).toBe('/discover')
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
    await mod.navigate('/discover', { replace: true })
    expect(mod.hasBackEntry()).toBe(false)
  })

  it('无匹配路径 → 兜底 /login（P2-1：保持旧实现语义）', async () => {
    const mod = await loadRouter()
    await mod.navigate('/nonexistent-route')
    expect(mod.router.currentRoute.value.path).toBe('/login')
  })
})
