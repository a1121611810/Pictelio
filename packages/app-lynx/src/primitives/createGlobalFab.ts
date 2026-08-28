import type { Ref } from 'vue'
import { computed, readonly, ref, shallowRef, watch } from 'vue'
import type { NavTab } from '../components/navTabs'
import type { FabMenuExtraItem, FabMenuState } from './createFabMenu'
import { createFabMenuState } from './createFabMenu'
import { FAB_MENU_A11Y_LABELS } from '../utils/accessibility'
import type { RouteState } from '../router'

// ─── 放射导航深模块（ADR-0120）───
// 把「页面→FAB 桥 + open/busy 状态机 + 派生读模型」大行为藏在小接口后：
//   view（只读响应式读模型）+ dispatch（单一命令通道）+ usePage（页面注册)。
// 纯逻辑、Vue 响应式、node 可单测（注入 routeState/navigate/navTabs，不 import 路由/页面）。
// 几何/动效不在本模块职责（属 GlobalFab.vue 薄适配器）。
// 术语见 docs/adr/glossary-app-lynx-radial-nav-fab.md。

/** 页面注册的动作组（字段存在=该页有对应内环项；Me 传空对象=内环空）。 */
export interface PageFabActions {
  /** 幂等刷新（返回 Promise 时模块接管 busy 维度）；缺省=无「刷新」内环项 */
  refresh?: () => Promise<void> | void
  /** 回顶（同步、无网络、带 1s 防重入）；Recommended 映射为重建回第一张 */
  backToTop?: () => void
  /** 扩展内环项（上一页/下一页等）；缺省=无 */
  extras?: FabMenuExtraItem[]
}

/** 内环渲染描述子（组件绑定用）；visible() 在渲染时求值以保持页面响应式显隐。 */
export interface FabInnerItem {
  key: string
  kind: 'refresh' | 'back-to-top' | 'extra'
  icon: string
  label: string
  a11yLabel: string
  visible: () => boolean
}

/** 组件读取的单一读模型。 */
export interface FabView {
  /** ⟺ 当前路由为 4 个顶层 tab 页之一（放射 FAB 整体显隐） */
  visible: boolean
  /** 当前 tab 名；非 tab 路由为 null */
  active: string | null
  isOpen: boolean
  isBusy: boolean
  /** 外环：4 个导航 tab（NAV_TABS 事实源） */
  outer: readonly NavTab[]
  /** 内环：由激活页注册动作装配 */
  inner: readonly FabInnerItem[]
}

/** 单一命令通道：组件点按的全部语义入口。 */
export type FabCommand =
  | { type: 'toggle' } // 主 FAB tap：开↔关；busy 时忽略
  | { type: 'close' } // 遮罩 / close button
  | { type: 'select'; name: string } // 外环 tab → navigate(replace)；当前 tab no-op
  | { type: 'refresh' } // 内环刷新
  | { type: 'back-to-top' } // 内环回顶
  | { type: 'extra'; key: string } // 内环扩展项

export interface GlobalFab {
  readonly view: Readonly<Ref<FabView>>
  dispatch(cmd: FabCommand): Promise<void>
  usePage(routeName: string, actions: PageFabActions): () => void
}

export interface CreateGlobalFabDeps {
  /** 路由源（router.ts 的 routeState ref）；local-substitutable，测试注入假 ref */
  routeState: Ref<RouteState>
  /** 导航（router.ts navigate）；测试注入 spy */
  navigate: (path: string, opts?: { replace?: boolean }) => void
  /** 导航 tab 事实源（=NAV_TABS；测试可注入 stub） */
  navTabs: NavTab[]
  /** 内部接缝：open/busy 状态机工厂（默认 createFabMenuState）；仅模块自身测试用 */
  menuState?: () => FabMenuState
}

const BACK_TO_TOP_DEBOUNCE_MS = 1000

export function createGlobalFab(deps: CreateGlobalFabDeps): GlobalFab {
  const menu = (deps.menuState ?? createFabMenuState)()
  // 页面动作注册表：按路由名作键（KeepAlive 下并存的激活页不串扰）。
  // 用 ref + 整体重赋值，确保新增/删除 key 都触发 computed 失效。
  const registry = shallowRef<Record<string, PageFabActions>>({})

  const activeTab = computed(() => {
    const name = deps.routeState.value?.name
    return deps.navTabs.find((t) => t.name === name) ?? null
  })

  const activePage = computed(() => {
    const tab = activeTab.value
    return tab ? registry.value[tab.name] : undefined
  })

  /** 内环：由激活页动作装配（刷新/回顶内置 + extras）。 */
  const inner = computed<FabInnerItem[]>(() => {
    const page = activePage.value
    if (!page) return []
    const items: FabInnerItem[] = []
    if (page.refresh) {
      items.push({
        key: 'refresh',
        kind: 'refresh',
        icon: '↻',
        label: '刷新',
        a11yLabel: FAB_MENU_A11Y_LABELS.refreshList,
        visible: () => true,
      })
    }
    if (page.backToTop) {
      items.push({
        key: 'back-to-top',
        kind: 'back-to-top',
        icon: '↑',
        label: '回顶',
        a11yLabel: FAB_MENU_A11Y_LABELS.backToTop,
        visible: () => true,
      })
    }
    if (page.extras) {
      for (const extra of page.extras) {
        items.push({
          key: extra.key,
          kind: 'extra',
          icon: extra.icon,
          label: extra.label,
          a11yLabel: extra.accessibilityLabel,
          visible: extra.visible,
        })
      }
    }
    return items
  })

  const view = computed<FabView>(() => {
    const tab = activeTab.value
    return {
      visible: tab !== null,
      active: tab?.name ?? null,
      // 可见性门：非 tab 路由强制 isOpen=false（即使菜单被误开也报告关闭）
      isOpen: tab !== null && menu.isOpen,
      isBusy: menu.isBusy,
      outer: deps.navTabs,
      inner: inner.value,
    }
  })

  // 路由变化 → 收起菜单（防止 KeepAlive 页面切换时残留打开的内环）。
  watch(() => deps.routeState.value?.name, () => menu.close())

  // ── 回顶 1s 防重入 ──
  const backToTopPending = ref(false)
  let backToTopTimer: ReturnType<typeof setTimeout> | undefined
  function clearBackToTopTimer(): void {
    if (backToTopTimer !== undefined) {
      clearTimeout(backToTopTimer)
      backToTopTimer = undefined
    }
  }
  function runBackToTop(): void {
    if (backToTopPending.value) return
    backToTopPending.value = true
    clearBackToTopTimer()
    backToTopTimer = setTimeout(() => {
      backToTopTimer = undefined
      backToTopPending.value = false
    }, BACK_TO_TOP_DEBOUNCE_MS)
    activePage.value?.backToTop?.()
  }

  async function runRefresh(): Promise<void> {
    if (menu.isBusy) return
    const page = activePage.value
    if (!page?.refresh) return
    menu.startRefresh() // 收起 + busy=true
    try {
      await page.refresh()
    } catch (err) {
      // 页面函数约定内部消化失败（createMixFeed 错误槽语义）；此处兜底防未处理 rejection
      console.warn('[globalFab] 刷新执行异常', err)
    } finally {
      menu.endRefresh()
    }
  }

  async function runExtra(key: string): Promise<void> {
    if (menu.isBusy) return
    const page = activePage.value
    const extra = page?.extras?.find((e) => e.key === key)
    if (!extra?.onTap) return
    menu.close()
    const result = extra.onTap()
    if (result && typeof result.then === 'function') {
      menu.startRefresh() // 复用 busy 维度：异步操作期间 FAB 禁用、其他项不可点
      try {
        await result
      } catch (err) {
        console.warn('[globalFab] 扩展项执行异常', err)
      } finally {
        menu.endRefresh()
      }
    }
  }

  async function dispatch(cmd: FabCommand): Promise<void> {
    switch (cmd.type) {
      case 'toggle':
        menu.toggle()
        return
      case 'close':
        menu.close()
        return
      case 'select': {
        menu.close()
        const tab = deps.navTabs.find((t) => t.name === cmd.name)
        if (!tab) {
          console.warn('[globalFab] 未知 tab', cmd.name)
          return
        }
        if (tab.name === deps.routeState.value?.name) return // 当前 tab：只收起不重导航
        deps.navigate(tab.path, { replace: true })
        return
      }
      case 'refresh':
        await runRefresh()
        return
      case 'back-to-top':
        if (menu.isBusy) return
        menu.close()
        runBackToTop()
        return
      case 'extra':
        await runExtra(cmd.key)
        return
    }
  }

  /** 页面注册动作；返回注销函数（只移除本次注册，KeepAlive 反复挂载安全）。 */
  function usePage(routeName: string, actions: PageFabActions): () => void {
    registry.value = { ...registry.value, [routeName]: actions }
    return () => {
      if (registry.value[routeName] === actions) {
        const next = { ...registry.value }
        delete next[routeName]
        registry.value = next
      }
    }
  }

  return { view: readonly(view), dispatch, usePage }
}
