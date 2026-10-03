// ─── 全局导航 tabs（放射 FAB 外环，ADR-0120/0121） ───
// 全局四个 tab 的唯一事实源。四个顶层目的地的**单点定义**。
// [维度重构 2026-10-03] 切分维度由「媒介」改为「用户要回答的问题」：
//   发现（有什么新的）· 更新（我关注的更新了吗）· 书架（我存的、没看完的）· 我的（账号与设置）
// 插画/小说**不再是顶层目的地**——两者是同一目录下的两个视角，按 M3 归为页内 Tabs
// （"Tabs share a common subject, whereas bottom navigation destinations are top-level
// and disconnected from each other"），现由「发现」页内的 SubTabBar 承载。
// 依据与证据：docs/specs/app-lynx-navigation-dimension-restructure.md
//
// ⚠️ 数量约束：外环 R=35vw / 扫角 80° / 环项 56dp，4 项中心距 60.5px 恰好排开；
//    **第 5 项中心距掉到 45.6px < 56dp 圆直径必然重叠**（需 R≥46vw，另立 ADR）。
//    ⇒ 本数组是封闭 4 项集合，加第 5 项不是轻量改动。
//    📐 46vw 的来历（供未来 ADR 作者复算，别再各算各的）：4→5 项只是步距变密
//    （80°/3=26.67° → 80°/4=20°），**重叠与否只取决于步距，与当前 R 无关**。
//    - 字面最小半径（恰好相切、间隙 0）：56px / (2·sin(10°)) = 161.2px = 43.0vw
//    - 本仓取 46vw = 保持与 4 项时同等的 ~4px 间隙：60px / (2·sin(10°)) = 172.8px = 46.1vw
//    复算得 43.0vw 而与本文的 46vw 对不上，是因为取了不同的间隙目标，不是矛盾。
import type { I18nKey } from '../i18n'
import type { IconName } from '../utils/iconMap'

/** 导航 tab 定义（外环项契约，name/path/icon/labelKey/a11yLabel）。 */
export interface NavTab {
  /** 路由名（router.ts routes[].name） */
  name: string
  /** 路由 path（navigate 目标） */
  path: string
  /** 图标名（utils/iconMap.ts ICON_CODEPOINTS 的键，ADR-0208 决策 3；
   *   模板经 <AppIcon :name> 渲染，图标字形不在本层出现） */
  icon: IconName
  /** label 文案的 i18n key（渲染处 t(tab.labelKey)，语言切换即时生效） */
  labelKey: I18nKey
  /** accessibility-label（Appium 定位契约，E2E 断言钉住中文，暂不抽取） */
  a11yLabel: string
}

export const NAV_TABS: NavTab[] = [
  { name: 'discover', path: '/discover', icon: 'home', labelKey: 'navTabs.discover', a11yLabel: '发现' },
  { name: 'updates', path: '/updates', icon: 'notifications', labelKey: 'navTabs.updates', a11yLabel: '更新' },
  { name: 'shelf', path: '/shelf', icon: 'favorite_border', labelKey: 'navTabs.shelf', a11yLabel: '书架' },
  { name: 'me', path: '/me', icon: 'person', labelKey: 'navTabs.me', a11yLabel: '我的' },
]

/**
 * 路由落定的 path → 顶层 tab；非顶层目的地（含首屏占位值）返回 null。
 *
 * 【为什么存在】spec §4 P0.5「顶层触达率」需要一个 path→键的映射，而顶层目的地
 * 的**单点事实源**是上面的 NAV_TABS。本函数只做匹配，不另持一份 path 数组 ——
 * 另写一份就会在「顶层加了第 5 项」时悄悄漂移。
 *
 * 【口径】取 `?`/`#` 之前的部分再比对：vue-router 落定的 `to.path` 通常已剥离
 * query，但 `routeState` 也可能被外部以带参串的 path 写入，比对前先归一更稳。
 * 纯**整段相等**，不做前缀匹配 —— 前缀匹配会把 `/shelf-x` 吃成 `/shelf`。
 */
export function topLevelTabForPath(path: string): NavTab | null {
  const bare = path.split(/[?#]/)[0]
  return NAV_TABS.find((t) => t.path === bare) ?? null
}
