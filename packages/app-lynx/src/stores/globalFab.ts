// ─── 放射导航单例接线（ADR-0120 + ADR-0140）───
// Pinia 化：原 `let _fab` 闭包单例 + `getGlobalFab()` getter 改为
// `defineStore('globalFab', () => { ... })` setup store——wiring 与 instance 解耦。
// `createGlobalFab` primitive（`src/primitives/createGlobalFab.ts`）保持不动。
// Pinia store id 'globalFab' 保证 active pinia 范围内单例——factory body 仅在首次
// `useGlobalFabStore()` 时执行一次（每个 `setActivePinia` 周期内），无需模块级
// `_fabCache` 缓存（spike 期间为防御性冗余留下，全量迁移时清理：保留会破坏测试
// 隔离，跨用例复用旧 `createGlobalFab` 实例 + 旧 `routeState` ref）。
// 跨 store 引用以箭头函数闭包形式持有（openSearch / hasOpenModal），不立即调用——
// pinia 在 `app.use(pinia)` 时就绪后这些箭头才被实际触发。
// 关联：ADR-0120（FAB 设计）、ADR-0132（全局搜索/FAB search 模式）、
//       ADR-0123（LynxView hit-testing）、ADR-0139（前序 Pinia 全量引入）。
import { defineStore } from "pinia"
import { routeState, navigate } from '../router'
import { NAV_TABS } from '../components/navTabs'
import { createGlobalFab } from '../primitives/createGlobalFab'
import { useSearchSheetStore } from './searchSheetStore'
import { useModalStack } from './modalStack'

export const useGlobalFabStore = defineStore('globalFab', () => {
  const fab = createGlobalFab({
    routeState,
    navigate,
    navTabs: NAV_TABS,
    openSearch: () => useSearchSheetStore().openSearch(),
    hasOpenModal: () => useModalStack().hasOpenModal(),
  })
  return {
    view: fab.view,
    dispatch: fab.dispatch,
    usePage: fab.usePage,
  }
})
