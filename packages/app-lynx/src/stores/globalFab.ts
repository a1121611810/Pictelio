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
import { useNotificationStore } from './notificationStore'

export const useGlobalFabStore = defineStore('globalFab', () => {
  const fab = createGlobalFab({
    routeState,
    navigate,
    navTabs: NAV_TABS,
    openSearch: () => useSearchSheetStore().openSearch(),
    hasOpenModal: () => useModalStack().hasOpenModal(),
    // 外环「更新」未读角标（spec §2.2 / §3.2 承诺；P0-7 撤掉首页顶栏铃铛后，
    // 这是通知唯一的全局级可发现性兜底）。**读点在此** —— 承诺若无此读点即
    // silent misconfiguration（见 docs/research/review-data-flow-blindspot.md §1）。
    // 只给「更新」挂角标：其余 tab 无未读概念，由本层（而非深模块）决定。
    navBadge: (name) => (name === 'updates' ? useNotificationStore().unreadCount : 0),
  })
  // ─── 本地度量读点（spec §4 P0.5「顶层触达率」）────────────────────────
  // ⚠️ 记录点**刻意不在这里**。初版记在 dispatch 的 select 分支上，模拟器实测抓到漏记：
  //   冷启动直接落在「发现」、登录成功后也直接 navigate 到 /discover，两条路径都不过
  //   FAB dispatch ⇒ `tabHits.discover` 恒为 0，面板显示「发现 0% / 我的 100%」，
  //   而用户每次启动都看的是「发现」—— 数字会让人判反。
  // ⇒ 记录点上移到**路由落定侧**（App.vue 里监听 `routeState.value` 的那个 watch），
  //   冷启动 / 登录后 / 切 tab 三条路径同源，也不会与本层的 dispatch 双计。
  //   ⚠️ 那边监听的是**对象**不是 `.value.path`：占位初值与首落点同为 `/discover`，
  //   监听 `.path` 会让 watcher 因「值没变」而不触发（同样只有真机能抓到）。
  // 键匹配见 components/navTabs.ts 的 topLevelTabForPath。
  return {
    view: fab.view,
    dispatch: fab.dispatch,
    usePage: fab.usePage,
  }
})
