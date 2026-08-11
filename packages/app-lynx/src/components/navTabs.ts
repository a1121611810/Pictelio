// ─── 共享底部导航 tabs（M3 NavigationBar） ───
// 全局四 tab 的唯一事实源：推荐（综合）/ 插画 / 小说 / 我的。
// 各顶层页（Recommended/IllustList/NovelList/Me）import NAV_TABS 接入 NavigationBar，
// 避免每个页面各自复制一份数组导致 drift（此前推荐/关注/小说/我的四处重复定义）。
// NavTab 接口在此定义（.ts 文件无法从 .vue 导入命名 type——shims-vue.d.ts 仅声明 default），
// NavigationBar.vue 与本包页面统一从这里导入。
// 注意：/following 已不在导航可达（其页面仍保留路由，active-name 无匹配 tab 时无高亮）。

/** 底部导航 tab 定义（M3 NavigationBar 契约，name/path/icon/label/a11yLabel）。 */
export interface NavTab {
  /** 路由名（router.ts routes[].name） */
  name: string
  /** 路由 path（navigate 目标） */
  path: string
  /** 图标 unicode 符号 */
  icon: string
  /** label 文本 */
  label: string
  /** accessibility-label（各页注册表传入，供 Appium 定位） */
  a11yLabel: string
}

export const NAV_TABS: NavTab[] = [
  { name: 'recommended', path: '/recommended', icon: '⌂', label: '推荐', a11yLabel: '推荐' },
  { name: 'illusts', path: '/illusts', icon: '✦', label: '插画', a11yLabel: '插画' },
  { name: 'novels', path: '/novels', icon: '✎', label: '小说', a11yLabel: '小说' },
  { name: 'me', path: '/me', icon: '◎', label: '我的', a11yLabel: '我的' },
]
