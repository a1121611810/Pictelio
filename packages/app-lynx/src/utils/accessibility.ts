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
  downloads: '下载管理',
  // 动图下载格式（spec download-manager §5）：全局统一，六格式各一标注
  downloadFormatGif: '动图下载格式GIF',
  downloadFormatMp4: '动图下载格式MP4',
  downloadFormatWebp: '动图下载格式WebP',
  downloadFormatApng: '动图下载格式APNG',
  downloadFormatZip: '动图下载格式ZIP',
  downloadFormatTar: '动图下载格式TAR',
  // 小说导出（spec docs/specs/novel-export.md §6/§7.2）：默认格式 9 项 + 三项内容开关
  novelExportFormatTxt: '小说导出格式TXT',
  novelExportFormatHtml: '小说导出格式HTML',
  novelExportFormatMd: '小说导出格式Markdown',
  novelExportFormatDocx: '小说导出格式Word',
  novelExportFormatPdf: '小说导出格式PDF',
  novelExportFormatEpub: '小说导出格式EPUB',
  novelExportFormatRtf: '小说导出格式RTF',
  novelExportFormatJson: '小说导出格式JSON',
  novelExportFormatFb2: '小说导出格式FB2',
  novelExportIncludeMetadata: '小说导出包含元数据',
  novelExportIncludeCover: '小说导出包含封面',
  novelExportIncludeImages: '小说导出包含正文插图',
  r18Toggle: '显示R18内容',
  r18gToggle: '显示R18G内容',
  ugoiraFflate: '动图播放选择fflate取帧',
  ugoiraRange: '动图播放选择Range流式取帧',
  ugoiraConfirm: '确认切换到Range流式',
  ugoiraCancel: '取消切换到Range流式',
  detailQualityMedium: '详情画质选择标准',
  detailQualityLarge: '详情画质选择高清',
  detailQualityOriginal: '详情画质选择原图',
  // 主题色（外观）：每个可选色板一个标注（Me.vue 显式渲染各色块）
  themeColorSky: '主题色天蓝',
  themeColorViolet: '主题色紫罗兰',
  themeColorPink: '主题色樱花粉',
  themeColorGreen: '主题色松柏绿',
  themeColorOrange: '主题色落日橙',
  themeColorTeal: '主题色深青',
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
  // 全局搜索入口标注（ADR-0132）：内环「搜索」项 + search 模式主 FAB 共用
  search: '搜索',
} as const

/** 全局搜索弹层 accessibility 标注（issue #295 / ADR-0132 / spec D5）：
 * 弹层全局单例挂载于 App.vue（搜索入口唯一），Appium/模拟器 E2E 需
 * 定位输入框（聚焦 + 注入关键词）与关闭按钮。 */
export const SEARCH_A11Y_LABELS = {
  input: '搜索输入框',
  close: '关闭搜索',
  clear: '清空搜索输入',
  clearHistory: '清空搜索历史',
  retry: '重试搜索',
  scopeAll: '搜索范围全部',
  scopeIllust: '搜索范围插画',
  scopeNovel: '搜索范围小说',
  sortNewest: '排序最新',
  sortOldest: '排序最早',
  sortPopular: '排序热门',
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

/** 下载管理页 accessibility 标注（spec docs/specs/download-manager.md §7.2） */
export const DOWNLOAD_A11Y_LABELS = {
  pageTitle: '下载管理',
  back: '返回',
  toggleAll: '全选或取消全选',
  start: '开始下载',
  pause: '暂停下载',
  stop: '停止下载',
  share: '分享已下载',
  remove: '删除下载',
  confirmDeleteFiles: '删除文件与记录',
  confirmDeleteRecords: '仅清空记录',
  cancelDelete: '取消删除',
} as const

// Lynx 元素属性不支持 Vue 插值表达式，模板中用 :accessibility-element 绑定此常量
export const A11Y_ELEMENT_ENABLED = true
