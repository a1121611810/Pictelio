// components 域 II（novel/me/search 子组件 + components 顶层，工单 #504 B5 / #505 B6）。
// zh 值 = 抽取前源文案逐字节一致（含模板串拼接形态），测试断言依赖。
const zhComponents2 = {
  // ── novel/NovelTopBar ──
  "novel.topBar.backAria": "返回",
  "novel.topBar.searchAria": "搜索",
  "novel.topBar.novelLabel": "小说",
  "novel.topBar.titleWrapped": "《{{title}}》",

  // ── novel/NovelCoverCard ──
  "novel.coverCard.seriesAria": "打开系列目录：{{title}}",
  "novel.coverCard.seriesLabel": "系列：{{title}}",
  "novel.coverCard.expandAria": "展开封面",
  "novel.coverCard.collapseAria": "收起封面",
  "novel.coverCard.statsWords": "📖 {{count}}字",

  // ── search/SearchFilterSheet：头部 ──
  "search.filterSheet.title": "筛选",
  "search.filterSheet.clearAll": "清除全部",
  "search.filterSheet.clearAllAria": "清除全部筛选",
  "search.filterSheet.closeAria": "关闭",

  // ── search/SearchFilterSheet：期间 ──
  "search.filterSheet.periodGroupAria": "投稿期间",
  "search.filterSheet.periodLabel": "期间",
  "search.filterSheet.all": "全部",
  "search.filterSheet.custom": "自定义",
  "search.filterSheet.startDateAria": "开始日期",
  "search.filterSheet.endDateAria": "结束日期",
  "search.filterSheet.period24h": "24 小时内",
  "search.filterSheet.period1w": "一周内",
  "search.filterSheet.period1m": "一个月内",
  "search.filterSheet.period6m": "半年内",
  "search.filterSheet.period1y": "一年内",

  // ── search/SearchFilterSheet：收藏数 ──
  "search.filterSheet.bookmarkGroupAria": "收藏数",
  "search.filterSheet.bookmarkLabel": "收藏数",
  "search.filterSheet.any": "不限",
  "search.filterSheet.bookmarkDisabledHint": "热门榜不支持按收藏数筛（切回最新/最早恢复）",

  // ── search/SearchFilterSheet：比例 ──
  "search.filterSheet.ratioGroupAria": "比例",
  "search.filterSheet.ratioLabel": "比例",
  "search.filterSheet.illustOnly": "仅插画",
  "search.filterSheet.ratioLandscape": "横图",
  "search.filterSheet.ratioPortrait": "竖图",
  "search.filterSheet.ratioSquare": "方图",
  "search.filterSheet.ratioDisabledHint": "切到「插画」范围后可用（已设的值会保留）",

  // ── search/SearchFilterSheet：分辨率 ──
  "search.filterSheet.resolutionGroupAria": "分辨率",
  "search.filterSheet.resolutionLabel": "分辨率",

  // ── search/SearchFilterSheet：AI 作品 ──
  "search.filterSheet.aiGroupAria": "AI 作品",
  "search.filterSheet.aiLabel": "AI 作品",
  "search.filterSheet.aiFollow": "跟随设置",
  "search.filterSheet.aiShowAll": "全部显示",
  "search.filterSheet.aiHide": "隐藏 AI",
  "search.filterSheet.aiHint": "只影响本次搜索，不改动设置里的 AI 偏好",

  // ── BlocklistSheet（B6）──
  "blocklist.title": "屏蔽列表",
  "blocklist.closeAria": "关闭",
  "blocklist.empty": "暂无屏蔽用户",
  "blocklist.userId": "用户 ID: {{userId}}",
  "blocklist.unblockAria": "取消屏蔽用户 {{userId}}",
  "blocklist.unblock": "取消屏蔽",
  "blocklist.hint": "屏蔽用户后，其作品将不再出现在推荐和关注列表中",

  // ── CommentInput / CommentList / CommentOverlay（B6）──
  "comment.replyingTo": "回复 @{{name}}",
  "comment.cancelReply": "取消回复",
  "comment.replyPlaceholder": "回复 @{{name}}...",
  "comment.placeholder": "写下评论...",
  "comment.send": "发送",
  "comment.reply": "回复",
  "comment.delete": "删除",
  "comment.empty": "还没有评论",
  "comment.emptyHint": "来写第一条吧",
  "comment.title": "评论",
  "comment.closeAria": "关闭",
  "comment.retry": "重试",

  // ── ExportSheet（B6）──
  "export.title": "导出小说",
  "export.closeAria": "关闭导出面板",
  "export.formatLabel": "导出格式",
  "export.formatAria.txt": "导出格式 TXT",
  "export.formatAria.html": "导出格式 HTML",
  "export.formatAria.md": "导出格式 Markdown",
  "export.formatAria.docx": "导出格式 Word (.docx)",
  "export.formatAria.pdf": "导出格式 PDF",
  "export.formatAria.epub": "导出格式 EPUB",
  "export.formatAria.rtf": "导出格式 RTF",
  "export.formatAria.json": "导出格式 JSON",
  "export.formatAria.fb2": "导出格式 FB2",
  "export.formatHint": "默认使用设置页选择的格式；此处修改仅作用于本次导出。",
  "export.contentLabel": "导出内容",
  "export.contentSummary":
    "正文（必含） · 元数据 {{metadata}} · 封面 {{cover}} · 正文插图 {{inlineImages}}",
  "export.contentHint": "内容开关在设置页「导出」中修改。",
  "export.optionOn": "开",
  "export.optionOff": "关",
  "export.exportAria": "开始导出",
  "export.export": "导出",

  // ── GateOverlay（B6）──
  "gate.title": "需要更新后才能继续使用",
  "gate.updateRequiredBody": "当前版本低于最低可用版本{{floor}}，自动更新未成功{{error}}",
  "gate.floorSuffix": "（{{version}}）",
  "gate.errorSuffix": "：{{detail}}",
  "gate.period": "。",
  "gate.retryUpdate": "重试更新",
  "gate.downloadVersion": "前往下载 v{{version}}",
  "gate.updating": "正在更新…",
  "gate.updatingHint": "正在更新到新版本，完成后自动继续",

  // ── GridCard（B6）──
  "gridCard.aiAssisted": "AI辅",
  "gridCard.bookmarkAria": "收藏",
  "gridCard.unbookmarkAria": "取消收藏",
  "gridCard.privateBadge": "已私密",
  "gridCard.followAria": "关注",
  "gridCard.unfollowAria": "取消关注",
  "gridCard.follow": "关注",
  "gridCard.followed": "已关注",

  // ── IllustActionMenu（B6）──
  "illustMenu.report": "举报",
  "illustMenu.blockAuthor": "屏蔽作者",

  // ── IllustTags（B6）──
  "illustTags.listAria": "作品标签",

  // ── IllustTypeBadge（B6）──
  "illustBadge.ugoira": "动图",
  "illustBadge.ugoiraAria": "动图",
  "illustBadge.pageCountAria": "共 {{count}} 图",

  // ── ImageCard（B6）──
  "imageCard.aiAssisted": "AI辅助",
  "imageCard.bookmarkAria": "收藏",
  "imageCard.unbookmarkAria": "取消收藏",
  "imageCard.privateBadge": "已私密收藏",
  "imageCard.followAria": "关注",
  "imageCard.unfollowAria": "取消关注",
  "imageCard.follow": "关注",
  "imageCard.followed": "已关注",
  "imageCard.following": "关注中…",

  // ── ImageViewer（B6）──
  "imageViewer.loadingPage": "加载第 {{current}}/{{total}} 页",
  "imageViewer.savePageAria": "保存当前页到相册",

  // ── NovelCard / NovelCoverCard（B6）──
  "novelCard.aiAssisted": "AI辅助",
  "novelCard.seriesAria": "查看系列: {{title}}",
  "novelCard.statsWords": "{{count}}字",
  "novelCard.bookmarkAria": "收藏",
  "novelCard.unbookmarkAria": "取消收藏",
  "novelCard.privateBadge": "已私密收藏",

  // ── NovelFooterNav（B6）──
  "novelFooterNav.prev": "上一章",
  "novelFooterNav.next": "下一章",
  "novelFooterNav.seriesAria": "打开系列目录",
  "novelFooterNav.contents": "目录",
  "novelFooterNav.displaySettings": "显示设置",
  "novelFooterNav.original": "原文",
  "novelFooterNav.translation": "译文",
  "novelFooterNav.translate": "翻译",
  "novelFooterNav.switchOriginalAria": "切换到原文",
  "novelFooterNav.switchTranslationAria": "切换到译文",
  "novelFooterNav.openTranslateAria": "打开翻译面板",
  "novelFooterNav.exportAria": "导出小说",
  "novelFooterNav.export": "导出",

  // ── NovelSearchBar（B6）──
  "novelSearch.placeholder": "搜索小说内容",
  "novelSearch.searchAria": "搜索小说内容",
  "novelSearch.clear": "清除",
  "novelSearch.prevMatch": "上一处",
  "novelSearch.nextMatch": "下一处",
  "novelSearch.close": "关闭搜索",

  // ── NovelTextListCard（B6）──
  "novelTextCard.authorAria": "作者: {{name}}",
  "novelTextCard.statsWords": "{{count}}字",
  "novelTextCard.aiAssisted": "AI辅助",
  "novelTextCard.seriesAria": "查看系列: {{title}}",
  "novelTextCard.bookmarkAria": "收藏",
  "novelTextCard.unbookmarkAria": "取消收藏",

  // ── NovelVirtualFeed / VirtualFeed（B6）──
  "virtualFeed.loading": "加载中...",
  "virtualFeed.endReached": "已经到底了",
  "virtualFeed.empty": "暂无小说",
  "virtualFeed.emptyNew": "暂无新作品",
  "virtualFeed.loadMoreFailed": "加载更多失败",

  // ── OAuthWebView（B6）──
  "oauth.signInFailed": "OAuth 登录失败",
  "oauth.title": "Pixiv 登录",
  "oauth.cancel": "取消",

  // ── PixivImage（B6；失败态复用 error.fallback.loadFailed）──
  "pixivImage.loading": "加载中...",

  // ── PullIndicator（B6）──
  "pullIndicator.refreshing": "刷新中...",
  "pullIndicator.settingsReady": "⚙️ 松手进入设置",
  "pullIndicator.refreshReady": "✨ 松开刷新 · 继续下拉进入设置",
  "pullIndicator.pulling": "↓ 下拉刷新",
  "pullIndicator.releaseToRefresh": "✨ 松开刷新",

  // ── ReaderSettingsSheet（B6）──
  "readerSettings.title": "阅读设置",
  "readerSettings.closeAria": "关闭",
  "readerSettings.previewBody": "夜色如墨，灯火阑珊。她推开窗，风裹着雨气扑面而来。",
  "readerSettings.previewCaption": "阅读设置实时预览",
  "readerSettings.fontSize": "字号",
  "readerSettings.autoSize": "自动 · {{size}}px",
  "readerSettings.decreaseFontSize": "减小字号",
  "readerSettings.increaseFontSize": "增大字号",
  "readerSettings.autoAria": "自动字号",
  "readerSettings.auto": "自动",
  "readerSettings.fontWeight": "字重",
  "readerSettings.fontFamily": "字体",
  "readerSettings.lineHeight": "行距",
  "readerSettings.textColor": "文字颜色",
  "readerSettings.textColorValue": "文字颜色 {{color}}",
  "readerSettings.reset": "重置",
  "readerSettings.customTextColorAria": "自定义文字颜色",
  "readerSettings.bgColor": "背景色",
  "readerSettings.bgColorValue": "背景色 {{color}}",
  "readerSettings.bgColorDefault": "背景色 默认",
  "readerSettings.customBgColorAria": "自定义背景色",

  // ── ReportSheet（B6）──
  "report.title": "举报作品",
  "report.closeAria": "关闭",
  "report.selectReason": "请选择举报原因：",
  "report.reported": "已举报",
  "report.submitting": "提交中…",
  "report.submit": "提交举报",
  "report.emailHint": "提交后将打开邮件客户端发送举报详情",

  // ── SearchResults（B6）──
  "searchResults.loading": "加载中...",
  "searchResults.loadMoreFailed": "加载更多失败",
  "searchResults.endReached": "没有更多了",
  "searchResults.empty": "没有找到相关作品",
  "searchResults.emptyHint": "试试其他关键词或调整筛选条件",

  // ── SearchableTag（B6）──
  "searchableTag.searchAria": "搜索标签：{{name}}",
  "searchableTag.translatedLabel": "{{name}}（{{translated}}）",

  // ── SeriesSheet / SeriesSheetItem（B6）──
  "series.title": "系列作品",
  "series.closeAria": "关闭",
  "series.closeScrimAria": "关闭",
  "series.stats": "总字数: {{words}}字 · {{count}}部作品{{more}}",
  "series.loading": "加载中...",
  "series.loadFailed": "加载失败：{{detail}}",
  "series.retry": "重试",
  "series.empty": "暂无作品",
  "series.itemActiveAria": "当前章节：{{title}}",
  "series.itemWords": "📖 {{count}}字",
  "series.currentBadge": "当前",

  // ── StartupUpdateDialog（B6；bodyPublishedSuffix 首尾空格 = 原文案逐字节快照）──
  "startupUpdate.title": "发现新版本",
  "startupUpdate.bodyPublishedSuffix": "已发布，当前版本为 ",
  "startupUpdate.bodyEnd": "。",
  "startupUpdate.later": "稍后再说",
  "startupUpdate.download": "前往下载",

  // ── ThemeSelector（B6）──
  "theme.light": "浅色",
  "theme.system": "跟随系统",
  "theme.dark": "深色",
  "theme.groupAria": "明暗主题选择",

  // ── TranslateSheet（B6）──
  "translate.setUpKey": "前往设置填写 Key",
  "translate.translating": "翻译中…",
  "translate.retryFailedCount": "补翻失败块（{{count}} 段）",
  "translate.start": "开始翻译",
  "translate.dialogAria": "AI 翻译",
  "translate.title": "AI 翻译",
  "translate.closeAria": "关闭",
  "translate.noKeyHint":
    "尚未配置 DeepSeek API Key。请前往「设置 → 翻译设置」填写你自己的 API Key（BYOK，密钥仅存本机、直连服务商）。",
  "translate.privacyHint":
    "将小说正文翻译为简体中文。内容将发送至 DeepSeek（你选择的模型），按量计费。",
  "translate.tierLabel": "翻译质量（本页临时）",
  "translate.tierStandard": "标准",
  "translate.tierPro": "高质量",
  "translate.progress": "已翻译 {{done}} / {{total}} 块{{suffix}}",
  "translate.progressSuffix": "，首屏内容已出，其余后台续翻中…",
  "translate.failedHint":
    "{{count}} 段翻译失败（正文中已标记「未翻译」）。可补翻失败块，成功段落不会重复计费。",

  // ── UgoiraViewer（B6）──
  "ugoira.loadFailed": "加载动图失败",
  "ugoira.closeAria": "关闭",
  "ugoira.loading": "加载中...",
  "ugoira.paused": "已暂停",
  "ugoira.back": "返回",

  // ── NavBar（B6）──
  "navBar.mainAria": "主导航",
  "navBar.searchAria": "搜索",
  "navBar.tab.recommended": "推荐",
  "navBar.tab.follow": "关注",
  "navBar.tab.bookmarks": "收藏",
  "navBar.tab.history": "历史",
} as const;

export default zhComponents2;
export type ZhComponents2Key = keyof typeof zhComponents2;
