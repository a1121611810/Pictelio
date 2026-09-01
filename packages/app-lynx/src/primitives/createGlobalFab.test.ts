import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createGlobalFab, type PageFabActions } from './createGlobalFab'
import { NAV_TABS } from '../components/navTabs'
import type { FabMenuExtraItem } from './createFabMenu'
import type { RouteState } from '../router'

// ─── 测试接缝：createGlobalFab 接口（ADR-0120 / ADR-0132 / spec #290 T4）───
// 注入 fake routeState ref + navigate spy + NAV_TABS（+ openSearch），node 驱动
// usePage/dispatch/view，断言可观测结果：mode 三态/visible/active/inner、navigate 调用、
// 动作触发、busy 互斥、openSearch 回调——不测内部状态，不经 DOM。
// 期望值来源（oracle 溯源）：
//   - mode 派生表：ADR-0132 决策 2 + router.ts routes[]（4 tab / 内容页 / 登录·更新·错误页），
//     非从实现反推；
//   - 内环搜索项（kind 'search'、icon 🔍、label 搜索、固定首位）：ADR-0132 决策 2。

/** 内容页路由名 = router.ts routes[] 排除 4 tab 与 login/update/error（ADR-0132 决策 2 边界） */
const CONTENT_ROUTE_NAMES = [
  'illust-detail', 'novel-detail', 'user-home',
  'user-following', 'user-followers', 'following',
  'bookmarks', 'watchlist',
]

function setup(initialName = 'recommended', opts: { openSearch?: () => void; hasOpenModal?: () => boolean } = {}) {
  const routeState = ref<RouteState>({ name: initialName, path: `/${initialName}`, params: {} })
  // 模拟真实 router：navigate 推进 routeState（这样选中其他 tab 后激活页随之切换）
  const navigate = vi.fn((path: string) => {
    const name = path.replace(/^\//, '')
    routeState.value = { name, path, params: {} }
  })
  const fab = createGlobalFab({ routeState, navigate, navTabs: NAV_TABS, ...opts })
  return { fab, routeState, navigate }
}

function actions(overrides: Partial<PageFabActions> = {}): PageFabActions {
  return { refresh: vi.fn(), backToTop: vi.fn(), ...overrides }
}

function flush(ms = 0): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

describe('createGlobalFab — mode 显示门三态（ADR-0132 决策 2）', () => {
  it(`4 顶层 tab 路由 → menu（visible=true，active=tab 名）`, async () => {
    const { fab, routeState } = setup()
    for (const tab of NAV_TABS) {
      routeState.value = { name: tab.name, path: tab.path, params: {} }
      await nextTick()
      expect(fab.view.value.mode).toBe('menu')
      expect(fab.view.value.visible).toBe(true)
      expect(fab.view.value.active).toBe(tab.name)
    }
  })

  it(`内容页（除 /login /update /error 外全部路由）→ search（visible=true，active=null）`, async () => {
    const { fab, routeState } = setup()
    for (const name of CONTENT_ROUTE_NAMES) {
      routeState.value = { name, path: `/${name}`, params: {} }
      await nextTick()
      expect(fab.view.value.mode).toBe('search')
      expect(fab.view.value.visible).toBe(true)
      expect(fab.view.value.active).toBeNull()
    }
  })

  it('非内容页（login/update/error）→ hidden（visible=false）', async () => {
    const { fab, routeState } = setup()
    for (const name of ['login', 'update', 'error']) {
      routeState.value = { name, path: `/${name}`, params: {} }
      await nextTick()
      expect(fab.view.value.mode).toBe('hidden')
      expect(fab.view.value.visible).toBe(false)
      expect(fab.view.value.active).toBeNull()
    }
  })

  it('未知/空路由名 → hidden（FAB 不渲染的兜底，不落入 search）', async () => {
    const { fab, routeState } = setup()
    routeState.value = { name: '', path: '', params: {} }
    await nextTick()
    expect(fab.view.value.mode).toBe('hidden')
    expect(fab.view.value.visible).toBe(false)
  })

  it('hasOpenModal=true → mode=hidden，覆盖 menu（tab 页）与 search（内容页，issue #295 互斥）', async () => {
    // 期望值来源：issue #295 验收「FAB 与弹层互斥」+ 实测场景（T4 遗留：modal 打开时
    // FAB z-40 悬浮于弹层之上、可点击并误开搜索）——任一弹层打开时 FAB 必须隐藏。
    const { fab, routeState } = setup('recommended', { hasOpenModal: () => true })
    // 覆盖 menu：4 tab 页
    for (const tab of NAV_TABS) {
      routeState.value = { name: tab.name, path: tab.path, params: {} }
      await nextTick()
      expect(fab.view.value.mode).toBe('hidden')
      expect(fab.view.value.visible).toBe(false)
    }
    // 覆盖 search：内容页（含搜索弹层自身打开后的场景，弹层打开后 FAB 无需在场）
    for (const name of CONTENT_ROUTE_NAMES) {
      routeState.value = { name, path: `/${name}`, params: {} }
      await nextTick()
      expect(fab.view.value.mode).toBe('hidden')
      expect(fab.view.value.visible).toBe(false)
    }
  })

  it('hasOpenModal 从 true 翻回 false → mode 恢复派生（menu/search 回归，弹层关闭后 FAB 回来）', async () => {
    // 桩用 ref（非普通变量）：模式派生实现在 computed 内读取 deps.hasOpenModal() 的返回值，
    // 响应式依赖 = 桩内 ref 的 .value 访问（真实接线 stores/globalFab.ts 的 () => hasOpenModal()
    // 是普通函数，穿透到 modalStack 内部 ref 的同一机制——computed 内 .value 读取即建立依赖）
    const modalOpen = ref(true)
    const { fab } = setup('recommended', { hasOpenModal: () => modalOpen.value })
    await nextTick()
    expect(fab.view.value.mode).toBe('hidden')
    modalOpen.value = false
    await nextTick()
    expect(fab.view.value.mode).toBe('menu')
  })

  it('非 tab 路由下 FAB 应被强制收起（search 模式 isOpen 恒 false → 关闭态无遮罩/环层）', async () => {
    const { fab, routeState } = setup()
    routeState.value = { name: 'illust-detail', path: '/illust/1', params: {} }
    await nextTick()
    expect(fab.view.value.mode).toBe('search')
    fab.dispatch({ type: 'toggle' })
    await nextTick()
    expect(fab.view.value.isOpen).toBe(false)
  })
})

describe('createGlobalFab — view 读模型', () => {
  it('outer 恒为 NAV_TABS（4 项，顺序不变）', () => {
    const { fab } = setup()
    expect(fab.view.value.outer).toEqual(NAV_TABS)
  })

  it('未有页面注册时 inner 仅含全局搜索项（首位）', () => {
    const { fab } = setup()
    expect(fab.view.value.inner.map((i) => i.kind)).toEqual(['search'])
  })

  it('内环按激活页动作装配：刷新/回顶顺延于全局搜索项；缺省即无', async () => {
    const { fab } = setup()
    fab.usePage('recommended', { refresh: vi.fn(), backToTop: vi.fn() })
    expect(fab.view.value.inner.map((i) => i.kind)).toEqual(['search', 'refresh', 'back-to-top'])

    // 切到「我的」页（内环为全局搜索项 + 空动作）：navigate 会推进 routeState，激活页随之变为 me
    fab.usePage('me', {})
    await fab.dispatch({ type: 'select', name: 'me' })
    expect(fab.view.value.inner.map((i) => i.kind)).toEqual(['search'])
  })
})

describe('createGlobalFab — 内环全局搜索项（ADR-0132 决策 2）', () => {
  it('搜索项固定内环首位：key/kind/icon/label/a11yLabel 契约 + visible 恒 true + 全环唯一', () => {
    const { fab } = setup()
    const searchItem = fab.view.value.inner[0]
    expect(searchItem).toMatchObject({
      key: 'search',
      kind: 'search',
      icon: '🔍',
      label: '搜索',
      a11yLabel: '搜索',
    })
    expect(searchItem.visible()).toBe(true)
    expect(fab.view.value.inner.filter((i) => i.kind === 'search')).toHaveLength(1)
    // 页面动作项顺延（刷新/回顶/extras 均排在搜索项之后）
    fab.usePage('recommended', actions({ extras: [{ key: 'prev', icon: '‹', label: '上一页', accessibilityLabel: '上一页', visible: () => true, onTap: vi.fn() }] }))
    expect(fab.view.value.inner[0].kind).toBe('search')
    expect(fab.view.value.inner.slice(1).map((i) => i.kind)).toEqual(['refresh', 'back-to-top', 'extra'])
  })
})

describe('createGlobalFab — dispatch 命令通道', () => {
  it('toggle 开/关菜单；busy 时 toggle 忽略', async () => {
    const { fab } = setup()
    await fab.dispatch({ type: 'toggle' })
    expect(fab.view.value.isOpen).toBe(true)
    await fab.dispatch({ type: 'toggle' })
    expect(fab.view.value.isOpen).toBe(false)
    await fab.dispatch({ type: 'toggle' })
    expect(fab.view.value.isOpen).toBe(true)
    // busy 时 toggle no-op
    fab.dispatch({ type: 'toggle' })
    // 手动制造 busy：注册一个挂起的 refresh 并触发
    let release!: () => void
    fab.usePage('recommended', { refresh: () => new Promise<void>((r) => { release = r }) })
    const p = fab.dispatch({ type: 'refresh' })
    await nextTick()
    expect(fab.view.value.isBusy).toBe(true)
    await fab.dispatch({ type: 'toggle' })
    expect(fab.view.value.isOpen).toBe(false)
    release()
    await p
    expect(fab.view.value.isBusy).toBe(false)
  })

  it('select 用 replace 导航；当前 tab no-op（不导航但收起）', async () => {
    const { fab, navigate } = setup('recommended')
    await fab.dispatch({ type: 'select', name: 'novels' })
    expect(navigate).toHaveBeenCalledWith('/novels', { replace: true })
    // navigate 已推进 routeState → 激活 tab 现为 novels
    navigate.mockClear()
    await fab.dispatch({ type: 'toggle' })
    expect(fab.view.value.isOpen).toBe(true)
    await fab.dispatch({ type: 'select', name: 'novels' }) // 当前 tab
    expect(navigate).not.toHaveBeenCalled()
    expect(fab.view.value.isOpen).toBe(false)
  })

  it('refresh：调用激活页 refresh，busy 期间为 true，after await 复位', async () => {
    let release!: () => void
    const refresh = vi.fn(() => new Promise<void>((r) => { release = r }))
    const { fab } = setup()
    fab.usePage('recommended', { refresh })
    const p = fab.dispatch({ type: 'refresh' })
    await nextTick()
    expect(fab.view.value.isBusy).toBe(true)
    expect(fab.view.value.isOpen).toBe(false)
    release()
    await p
    expect(fab.view.value.isBusy).toBe(false)
    expect(refresh).toHaveBeenCalled()
  })

  it('无 refresh 动作时 refresh 为 no-op（不置 busy）', async () => {
    const { fab } = setup('me')
    fab.usePage('me', {})
    await fab.dispatch({ type: 'refresh' })
    expect(fab.view.value.isBusy).toBe(false)
  })

  it('refresh 抛错：warn + busy 复位（无 rejection 逃逸）', async () => {
    const { fab } = setup()
    fab.usePage('recommended', { refresh: () => { throw new Error('boom') } })
    await expect(fab.dispatch({ type: 'refresh' })).resolves.toBeUndefined()
    expect(fab.view.value.isBusy).toBe(false)
  })

  it('back-to-top：调用激活页 backToTop 并收起；1s 连点只触发一次', async () => {
    const { fab } = setup()
    const backToTop = vi.fn()
    fab.usePage('recommended', { backToTop })
    await fab.dispatch({ type: 'toggle' })
    await fab.dispatch({ type: 'back-to-top' })
    expect(backToTop).toHaveBeenCalledTimes(1)
    expect(fab.view.value.isOpen).toBe(false)
    await fab.dispatch({ type: 'back-to-top' })
    await fab.dispatch({ type: 'back-to-top' })
    expect(backToTop).toHaveBeenCalledTimes(1) // 防重入窗口内仍 1 次
    await flush(1050)
    await fab.dispatch({ type: 'back-to-top' })
    expect(backToTop).toHaveBeenCalledTimes(2) // 窗口过后允许再次
  })

  it('extra：调用页面 extras 对应 onTap；异步接管 busy 维度', async () => {
    let release!: () => void
    const onTap = vi.fn(() => new Promise<void>((r) => { release = r }))
    const extras: FabMenuExtraItem[] = [{ key: 'prev', icon: '‹', label: '上一页', accessibilityLabel: '上一页', visible: () => true, onTap }]
    const { fab } = setup()
    fab.usePage('recommended', { extras })
    const p = fab.dispatch({ type: 'extra', key: 'prev' })
    await nextTick()
    expect(onTap).toHaveBeenCalled()
    expect(fab.view.value.isBusy).toBe(true)
    release()
    await p
    expect(fab.view.value.isBusy).toBe(false)
  })
})

describe('createGlobalFab — dispatch search 命令（ADR-0132 决策 2）', () => {
  it('dispatch({type:"search"})：收起菜单 + 调用注入的 openSearch；不设 busy', async () => {
    const openSearch = vi.fn()
    const { fab } = setup('recommended', { openSearch })
    fab.usePage('recommended', actions())
    await fab.dispatch({ type: 'toggle' })
    expect(fab.view.value.isOpen).toBe(true)
    await fab.dispatch({ type: 'search' })
    expect(openSearch).toHaveBeenCalledTimes(1)
    expect(fab.view.value.isOpen).toBe(false)
    // 搜索入口打开本身不设 busy（与 select/close 同属正交收合类，不触发 busy 互斥）
    expect(fab.view.value.isBusy).toBe(false)
  })

  it('search 模式（非 tab 内容页）下 dispatch("search") 同样触发 openSearch', async () => {
    const openSearch = vi.fn()
    const { fab, routeState } = setup('recommended', { openSearch })
    routeState.value = { name: 'illust-detail', path: '/illust/1', params: {} }
    await nextTick()
    expect(fab.view.value.mode).toBe('search')
    await fab.dispatch({ type: 'search' })
    expect(openSearch).toHaveBeenCalledTimes(1)
    expect(fab.view.value.isBusy).toBe(false)
  })

  it('openSearch 未注入：no-op + console.warn（T5 接线前缺省语义，fail-open）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { fab } = setup()
      await fab.dispatch({ type: 'search' })
      expect(warn).toHaveBeenCalledWith('[globalFab] openSearch 未注入')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('createGlobalFab — usePage 生命周期', () => {
  it('usePage 返回注销函数，注销后该页动作不再进入内环（全局搜索项常驻）', () => {
    const { fab } = setup()
    const un = fab.usePage('recommended', { refresh: vi.fn() })
    expect(fab.view.value.inner.some((i) => i.kind === 'refresh')).toBe(true)
    un()
    expect(fab.view.value.inner.some((i) => i.kind === 'refresh')).toBe(false)
    expect(fab.view.value.inner.map((i) => i.kind)).toEqual(['search'])
  })

  it('同 routeName 多次 usePage 为 upsert（后注册覆盖），旧注销不误删新注册', () => {
    const { fab } = setup()
    const r1 = vi.fn()
    const r2 = vi.fn()
    const un1 = fab.usePage('recommended', { refresh: r1 })
    fab.usePage('recommended', { refresh: r2 })
    un1() // 注销旧的，不应删掉新的
    expect(fab.view.value.inner.some((i) => i.kind === 'refresh')).toBe(true)
  })
})
