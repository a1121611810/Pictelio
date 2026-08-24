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

/** Recommended 页 accessibility 标注（Lynx E2E：导航到 Me 页入口） */
export const RECOMMENDED_A11Y_LABELS = {
  openMe: '我的',
} as const

/** 会话失效错误页 accessibility 标注（候选 #2：全屏错误页 /error） */
export const ERROR_A11Y_LABELS = {
  pageTitle: '登录已过期',
  backToLogin: '返回登录',
} as const

/** RefreshableList 刷新 FAB（ADR-0107：双端同构，原生/web-core 同一实现） */
export const REFRESH_A11Y_LABELS = {
  refreshList: '刷新列表',
} as const

/** RefreshableList 回顶按钮（ADR-0109：M3 small FAB，超阈值显示） */
export const BACK_TO_TOP_A11Y_LABELS = {
  backToTop: '回到顶部',
} as const

// Lynx 元素属性不支持 Vue 插值表达式，模板中用 :accessibility-element 绑定此常量
export const A11Y_ELEMENT_ENABLED = true
