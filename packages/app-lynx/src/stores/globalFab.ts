import { routeState, navigate } from '../router'
import { NAV_TABS } from '../components/navTabs'
import { createGlobalFab } from '../primitives/createGlobalFab'

// ─── 放射导航单例接线（ADR-0120）───
// 把深模块 createGlobalFab 用真实 router 绑定成单例；页面/组件经它接入。
// 测试不引本文件，直接 createGlobalFab（注入 fake routeState/navigate）。
export const globalFab = createGlobalFab({
  routeState,
  navigate,
  navTabs: NAV_TABS,
})
