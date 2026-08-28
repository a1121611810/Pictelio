import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createGlobalFab, type PageFabActions } from './createGlobalFab'
import { NAV_TABS } from '../components/navTabs'
import type { FabMenuExtraItem } from './createFabMenu'
import type { RouteState } from '../router'

// ─── 测试接缝：createGlobalFab 接口（ADR-0120 / spec #228）───
// 注入 fake routeState ref + navigate spy + NAV_TABS，node 驱动 usePage/dispatch/view，
// 断言可观测结果（visible/active/inner、navigate 调用、动作触发、busy 切换），不测内部状态。

function setup(initialName = 'recommended') {
  const routeState = ref<RouteState>({ name: initialName, path: `/${initialName}`, params: {} })
  // 模拟真实 router：navigate 推进 routeState（这样选中其他 tab 后激活页随之切换）
  const navigate = vi.fn((path: string) => {
    const name = path.replace(/^\//, '')
    routeState.value = { name, path, params: {} }
  })
  const fab = createGlobalFab({ routeState, navigate, navTabs: NAV_TABS })
  return { fab, routeState, navigate }
}

function actions(overrides: Partial<PageFabActions> = {}): PageFabActions {
  return { refresh: vi.fn(), backToTop: vi.fn(), ...overrides }
}

function flush(ms = 0): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

describe('createGlobalFab — view 读模型', () => {
  it('tab 路由 visible=true 且 active 为其名；非 tab 路由 visible=false & active=null', async () => {
    const { fab, routeState } = setup('illusts')
    expect(fab.view.value.visible).toBe(true)
    expect(fab.view.value.active).toBe('illusts')

    routeState.value = { name: 'illust-detail', path: '/illust/1', params: {} }
    await nextTick()
    expect(fab.view.value.visible).toBe(false)
    expect(fab.view.value.active).toBeNull()
    expect(fab.view.value.inner).toEqual([])
    // 非 tab 路由下 FAB 应被强制收起
    fab.dispatch({ type: 'toggle' })
    await nextTick()
    expect(fab.view.value.isOpen).toBe(false)
  })

  it('outer 恒为 NAV_TABS（4 项，顺序不变）', () => {
    const { fab } = setup()
    expect(fab.view.value.outer).toEqual(NAV_TABS)
  })

  it('未有页面注册时 inner 为空', () => {
    const { fab } = setup()
    expect(fab.view.value.inner).toEqual([])
  })

  it('内环按激活页动作装配：refresh/backToTop 存在即有对应项，缺省即无', async () => {
    const { fab } = setup()
    fab.usePage('recommended', { refresh: vi.fn(), backToTop: vi.fn() })
    expect(fab.view.value.inner.map((i) => i.kind)).toEqual(['refresh', 'back-to-top'])

    // 切到「我的」页（内环空）：navigate 会推进 routeState，激活页随之变为 me
    fab.usePage('me', {})
    await fab.dispatch({ type: 'select', name: 'me' })
    expect(fab.view.value.inner).toEqual([])
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

describe('createGlobalFab — usePage 生命周期', () => {
  it('usePage 返回注销函数，注销后该页动作不再进入内环', () => {
    const { fab } = setup()
    const un = fab.usePage('recommended', { refresh: vi.fn() })
    expect(fab.view.value.inner.some((i) => i.kind === 'refresh')).toBe(true)
    un()
    expect(fab.view.value.inner).toEqual([])
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
