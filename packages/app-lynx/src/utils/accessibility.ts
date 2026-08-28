// ─── accessibility 标注注册表（issue #103） ───
// 属性名与类型以 Lynx 官方文档为准（/api/elements/built-in/view）：
//   - accessibility-element?: boolean —— 节点是否暴露到 Android accessibility 树
//     （text/image 节点默认 true，view 等容器默认 false，故可点容器需显式标注）；
//   - accessibility-label?: string —— 节点播报文本，Appium/UiAutomator 用 description 定位。
// 用途：LynxAccessibilityDelegate 只暴露标注节点，Appium 模拟器 E2E（切换渲染引擎链路）
// 依赖这些标注定位 Lynx 侧元素（ADR-0061）。
// 约定：Me 页（及其他页面）新增关键交互元素时，必须先在此登记 label 再标注；
// 单测（tests/unit.test.ts）会对本表做完整性断言。

/** Me 页全部 accessibility 标注（key = 标注位置的可读标识，value = accessibility-label 文本） */
export const ME_A11Y_LABELS = {
  // ── 页面标识（E2E 断言「Me 页完整渲染」的锚点文本） ──
  pageTitle: '我的',
  clientGroupTitle: '客户端',
  webviewOptionTitle: 'WebView（现有）',
  lynxOptionTitle: 'Lynx（当前）',
  // ── 关键交互（@tap 容器：view 默认不进 accessibility 树，必须显式标注） ──
  // （M3 改造后 Me 为底部导航顶层页，无返回箭头；back 标注已移除）
  switchToWebview: '切换客户端到WebView', // 「切回 WebView」入口
  switchToLynx: '切换客户端到Lynx',
  bookmarks: '我的收藏',
  watchlist: '追更列表',
  r18Toggle: '显示R18内容',
  r18gToggle: '显示R18G内容',
  ugoiraFflate: '动图播放选择fflate取帧',
  ugoiraRange: '动图播放选择Range流式取帧',
  ugoiraConfirm: '确认切换到Range流式',
  ugoiraCancel: '取消切换到Range流式',
  detailQualityMedium: '详情画质选择标准',
  detailQualityLarge: '详情画质选择高清',
  detailQualityOriginal: '详情画质选择原图',
  logout: '退出登录',
} as const

/** Login 页 accessibility 标注（Lynx E2E：登录页注入 token 后提交） */
export const LOGIN_A11Y_LABELS = {
  tokenInput: '输入refresh_token',
  submit: '登录',
} as const

/** 更新页 accessibility 标注（检查更新：Lynx E2E / Appium 定位用） */
export const UPDATE_A11Y_LABELS = {
  pageTitle: '更新',
  exit: '退出应用',
  download: '下载新版本',
} as const

/** 会话失效错误页 accessibility 标注（候选 #2：全屏错误页 /error） */
export const ERROR_A11Y_LABELS = {
  pageTitle: '登录已过期',
  backToLogin: '返回登录',
} as const

/** RefreshableList 列表操作 FAB menu 标注（ADR-0111）
 *  - toggleMenu：主 FAB / close button，描述将打开的菜单
 *  - refreshList / backToTop：菜单项 label，与 UI 文本一致
 */
export const FAB_MENU_A11Y_LABELS = {
  toggleMenu: '列表操作菜单',
  refreshList: '刷新列表',
  backToTop: '回到顶部',
  // 按钮分页扩展项（ADR-0114）：由页面经 RefreshableList :items 传入，label 与 UI 文本一致
  prevPage: '上一页',
  nextPage: '下一页',
} as const

/** 放射导航悬浮 FAB 标注（ADR-0120）：全局导航中枢的开/关语义。
 *  - open / close：主 FAB 描述（展开/收起菜单）
 *  内环「刷新/回顶/扩展」复用 FAB_MENU_A11Y_LABELS（refreshList/backToTop/prevPage/nextPage）。
 */
export const GLOBAL_FAB_A11Y_LABELS = {
  open: '打开菜单',
  close: '关闭菜单',
} as const

/** 追更列表页 accessibility 标注（issue #225：/watchlist 页 + 取消追更二次确认 Dialog） */
export const WATCHLIST_A11Y_LABELS = {
  pageTitle: '追更列表',
  back: '返回',
  openLatest: '打开系列最新一话',
  unwatch: '取消追更该系列',
  unwatchConfirm: '确认取消追更',
  unwatchCancel: '保留追更',
} as const

/** 追更询问弹窗 accessibility 标注（issue #224：NovelDetail 返回拦截询问 Dialog） */
export const WATCHLIST_PROMPT_A11Y_LABELS = {
  dialog: '追更询问弹窗',
  decline: '暂不追更',
  confirm: '追更该系列',
} as const

// Lynx 元素属性不支持 Vue 插值表达式，模板中用 :accessibility-element 绑定此常量
export const A11Y_ELEMENT_ENABLED = true
