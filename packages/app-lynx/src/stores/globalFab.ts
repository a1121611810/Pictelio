import { routeState, navigate } from '../router'
import { NAV_TABS } from '../components/navTabs'
import { createGlobalFab, type GlobalFab } from '../primitives/createGlobalFab'
import { openSearch } from './searchSheetStore'
import { hasOpenModal } from './modalStack'

// ─── 放射导航单例接线（ADR-0120）───
// 用惰性初始化：router.ts 经页面（Recommended.vue 等）静态 import 反向依赖本模块
// （router → 页面 → globalFab → router），若在模块顶层立即 createGlobalFab 并读取
// routeState，会因 ES module 的 TDZ 报 "Cannot access 'routeState' before initialization"
// （web/dev 白屏）。改为「首次访问才创建」——此时 router 已完整求值，routeState 可用。
// 测试不引本文件，直接调 createGlobalFab（注入 fake routeState/navigate）。
// T5 接线（ADR-0132/issue #295）：
// - openSearch：搜索弹层入口回调（FAB search 命令 / 内环搜索项 → searchSheetStore.openSearch）；
// - hasOpenModal：FAB 与弹层互斥——任一弹层（评论/搜索等）打开时 FAB 隐藏（mode=hidden），
//   防 T4 遗留缺陷：modal 打开时 FAB（z-40）悬浮于弹层之上可点、误开搜索。
let _fab: GlobalFab | undefined

export function getGlobalFab(): GlobalFab {
  if (!_fab) {
    _fab = createGlobalFab({
      routeState,
      navigate,
      navTabs: NAV_TABS,
      openSearch: () => openSearch(),
      hasOpenModal: () => hasOpenModal(),
    })
  }
  return _fab
}
