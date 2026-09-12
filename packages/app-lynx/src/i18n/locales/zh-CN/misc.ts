// lynx 组件/工具域（components/stores/utils/composables 用户可见文案，B9 批次工单 #508）。
// zh 值 = 存量文案逐字快照，迁移期禁改写。
// #511 第 2 类补抽：SearchSheet 标题/占位/历史/scope-sort chips/五态、NovelExportSheet
// 内容摘要与设置页指引、Me.vue WebDAV 区块、FollowList 操作失败、NovelDetail 已追更/系列行
// 原被源级测试钉住跳过，本批同步改测试为「t(key) 调用形态 + zh 字典值逐字节不变」双断言。
// 仍未抽取：utils/accessibility.ts 全部 A11Y 注册表、navTabs a11yLabel、backupCore WEBDAV_ERROR_MESSAGES。
const zhMisc = {
  // ─── navTabs.ts（底部导航 tab label；a11yLabel 属 E2E 契约不抽取） ───
  "navTabs.recommended": "推荐",
  "navTabs.illusts": "插画",
  "navTabs.novels": "小说",
  "navTabs.me": "我的",

  // ─── CoverImage.vue（封面三态失败占位） ───
  "coverImage.loadFailed": "图片加载失败",
  "coverImage.retry": "重试",

  // ─── RestrictOverlay.vue（R18/R18G 遮罩文案） ───
  "restrictOverlay.blocked": "受浏览限制，不予显示",

  // ─── CommentItem.vue（评论条目） ───
  "commentItem.reply": "回复",
  "commentItem.replyTo": "回复 {{name}}：",
  "commentItem.collapseReplies": "收起回复",
  "commentItem.expandReplies": "展开 {{count}} 条回复",
  "commentItem.delete": "删除",
  "commentItem.deleting": "删除中…",

  // ─── WatchlistPromptDialog.vue（追更询问弹窗；a11y 标注走注册表不抽取） ───
  "watchlistPrompt.title": "追更这个系列？",
  "watchlistPrompt.hint": "追更后可在「我的 → 追更列表」查看最新更新",
  "watchlistPrompt.decline": "暂不",
  "watchlistPrompt.confirm": "追更",

  // ─── RefreshableList.vue（FAB menu 两项 label） ───
  "refreshableList.refresh": "刷新",
  "refreshableList.backToTop": "回顶",

  // ─── AiOverlay.vue（AI 遮罩） ───
  "aiOverlay.pure": "AI",
  "aiOverlay.assisted": "AI辅助",
  "aiOverlay.maskHint": "AI 作品，已在设置中遮罩",

  // ─── IllustTypeBadgeRow.vue（类型徽章；\u25B6\uFE0E/\u29C9 为图标 unicode） ───
  "illustTypeBadgeRow.ugoira": "▶︎ 动图",
  "illustTypeBadgeRow.multiPages": "⧉ {{count}} 图",

  // ─── UgoiraViewer.vue（播放器错误） ───
  "ugoiraViewer.noFrames": "动图无帧数据",
  "ugoiraViewer.loadFailed": "动图加载失败",

  // ─── CommentInputBar.vue（评论输入栏） ───
  "commentInputBar.replyingTo": "回复 {{name}}",
  "commentInputBar.cancel": "取消",
  "commentInputBar.placeholder": "写下评论…",
  "commentInputBar.posting": "发送中…",
  "commentInputBar.send": "发送",

  // ─── CommentOverlay.vue（评论区弹层） ───
  "commentOverlay.title": "评论 ({{count}})",
  "commentOverlay.loadFailedRetry": "加载失败，请重试",
  "commentOverlay.retry": "重试",
  "commentOverlay.empty": "还没有评论",
  "commentOverlay.noMore": "没有更多了",

  // ─── PagePickerSheet.vue（多图选页面板） ───
  "pagePicker.title": "选择要保存的页",
  "pagePicker.selectAll": "全选",
  "pagePicker.clearAll": "清除全选",
  "pagePicker.selectedCount": "已选 {{selected}} / {{total}} 页",
  "pagePicker.saving": "保存中…",
  "pagePicker.save": "保存（{{count}}）",

  // ─── SearchSheet.vue（全局搜索弹层；#511 补抽标题/占位/历史/scope-sort chips/五态文案，
  //     SearchSheet.test.ts 同步改为 t(key) 调用形态 + zh 字典值双断言） ───
  "searchSheet.title": "搜索",
  "searchSheet.placeholder": "输入标签 / 关键词",
  "searchSheet.history": "搜索历史",
  "searchSheet.historyEmptyHint": "输入关键词开始搜索",
  "searchSheet.scope.all": "全部",
  "searchSheet.scope.illust": "插画",
  "searchSheet.scope.novel": "小说",
  "searchSheet.sort.newest": "最新",
  "searchSheet.sort.oldest": "最早",
  "searchSheet.sort.popular": "热门",
  "searchSheet.bookmarkDimmedHint": "热门榜不支持按收藏数筛（切回最新/最早恢复）",
  "searchSheet.ratioDimmedHint": "切到「插画」范围后可用（已设的值会保留）",
  "searchSheet.searchFailed": "搜索失败，请重试",
  "searchSheet.searching": "搜索中…",
  "searchSheet.emptyHint": "没有找到相关内容，试试换一个关键词",
  "searchSheet.rowAction": "查看 ›",
  "searchSheet.loadMoreFailed": "加载更多失败",
  "searchSheet.noMore": "没有更多了",
  "searchSheet.retry": "重试",
  "searchSheet.clear": "清空",
  "searchSheet.filter": "筛选",
  "searchSheet.clearAll": "清除全部",
  "searchSheet.periodTitle": "期间",
  "searchSheet.all": "全部",
  "searchSheet.period.1d": "24 小时内",
  "searchSheet.period.1w": "一周内",
  "searchSheet.period.1m": "一个月内",
  "searchSheet.period.6m": "半年内",
  "searchSheet.period.1y": "一年内",
  "searchSheet.bookmarkTitle": "收藏数",
  "searchSheet.unlimited": "不限",
  "searchSheet.ratioTitle": "比例 · 仅插画",
  "searchSheet.ratio.landscape": "横图",
  "searchSheet.ratio.portrait": "竖图",
  "searchSheet.ratio.square": "方图",
  "searchSheet.resolutionTitle": "分辨率 · 仅插画",
  "searchSheet.aiTitle": "AI 作品",
  "searchSheet.aiHint": "只影响本次搜索，不改动设置里的 AI 偏好",
  "searchSheet.ai.follow": "跟随设置",
  "searchSheet.ai.all": "全部显示",
  "searchSheet.ai.hide": "隐藏 AI",
  "searchSheet.charCount": "{{count}} 字",
  "searchSheet.type.manga": "漫画",
  "searchSheet.type.ugoira": "动图",
  "searchSheet.type.illust": "插画",

  // ─── NovelExportSheet.vue（小说导出面板；#511 补抽内容摘要行与设置页指引，
  //     NovelExportSheet.template.test.ts 同步改为 t(key) 调用形态 + zh 字典值双断言） ───
  "novelExportSheet.title": "导出小说",
  "novelExportSheet.closeA11y": "关闭导出面板",
  "novelExportSheet.formatTitle": "导出格式",
  "novelExportSheet.formatA11y": "选择导出格式{{label}}",
  "novelExportSheet.formatHint": "默认使用设置页选择的格式；此处修改仅作用于本次导出。",
  "novelExportSheet.contentTitle": "导出内容",
  "novelExportSheet.contentSummary":
    "正文（必含） · 元数据 {{metadata}} · 封面 {{cover}} · 正文插图 {{inlineImages}}",
  "novelExportSheet.stateOn": "开",
  "novelExportSheet.stateOff": "关",
  "novelExportSheet.contentHint": "内容开关在设置页「导出」中修改",
  "novelExportSheet.export": "导出",

  // ─── pages/Me.vue WebDAV 区块（#511 补抽；连接测试/立即备份复用 me.webdav.action.*） ───
  "me.webdav.title": "WebDAV 备份",
  "me.webdav.httpsWarning": "非 HTTPS 连接存在泄露风险",
  "me.webdav.usernamePlaceholder": "用户名",
  "me.webdav.passwordPlaceholder": "密码（加密存储）",
  "me.webdav.dirPlaceholder": "目录（默认 Pictelio/backup）",
  "me.webdav.backupPasswordPlaceholder": "备份密码（可选，加密备份文件）",
  "me.webdav.sensitiveExclusionHint": "敏感项排除（勾选后不进入备份文件）",
  "me.webdav.autoBackup": "启动时自动备份",
  "me.webdav.lastBackup": "上次备份：{{value}}",
  "me.webdav.undoLastRestore": "撤销上次恢复",
  "me.webdav.chooseBackup": "选择要恢复的备份",
  "me.webdav.overwriteWarning": "恢复会覆盖本机对应设置（仅覆盖备份中存在的键），恢复前自动保存应急快照。",
  "me.webdav.confirmRestore": "确认恢复",

  // ─── pages/FollowList.vue（#511 补抽关注/取关动作失败内联错误） ───
  "followList.actionFailed": "操作失败",

  // ─── pages/NovelDetail.vue（#511 补抽系列行与已追更 chip；novelDetail 其余 key 在 pages.ts） ───
  "novelDetail.watchAdded": "已追更",
  "novelDetail.seriesTitle": "《{{title}}》",

  // ─── stores/authStore.ts（登录错误，赋值时快照） ───
  "authStore.nativeAuthUnavailable": "原生认证模块不可用",
  "authStore.responseParseFailed": "登录响应解析失败",
  "authStore.emptyToken": "请输入 refresh_token",

  // ─── stores/downloadStore.ts（下载队列 store 错误，message 快照流经状态文本） ───
  "downloadStore.executorNotReady": "下载执行器未接入",
  "downloadStore.nothingToShare": "没有可分享的已下载文件",
  "downloadStore.shareUnavailable": "分享功能未接入",

  // ─── utils/downloadsViewModel.ts（下载页视图模型） ───
  "downloadsViewModel.kind.ugoira": "动图",
  "downloadsViewModel.kind.novel": "小说",
  "downloadsViewModel.kind.images": "{{count}} 张",
  "downloadsViewModel.status.queued": "排队中",
  "downloadsViewModel.status.downloading": "下载中",
  "downloadsViewModel.status.paused": "已暂停",
  "downloadsViewModel.status.stopped": "已停止",
  "downloadsViewModel.status.completed": "已完成",
  "downloadsViewModel.status.failed": "失败",
  "downloadsViewModel.failedWithReason": "失败：{{error}}",

  // ─── utils/backupCore.ts（BackupFormatError 拒绝边界，抛出时快照） ───
  "backupCore.notBackupJson": "不是有效的 Pictelio 备份（JSON 解析失败）",
  "backupCore.notBackupFormat": "不是 Pictelio 备份（format 标识不符）",
  "backupCore.schemaMissing": "备份 schemaVersion 缺失或非法",
  "backupCore.schemaTooNew": "备份来自更新版本的应用（schemaVersion {{version}} > {{supported}}），请升级后恢复",
  "backupCore.fieldsInvalid": "备份字段缺失或类型不符",

  // ─── utils/backupService.ts（恢复前置校验，抛出时快照） ───
  "backupService.encryptedNeedsPassword": "该备份已加密，请先输入备份密码",

  // ─── utils/withTimeout.ts（默认超时 message，经 feed 错误槽展示） ───
  "withTimeout.timeout": "请求超时",

  // ─── utils/fetchWrapper.ts（无 fetch 环境错误，经 API 错误链路展示） ───
  "fetchWrapper.unavailable": "fetch 不可用（当前环境无网络能力）",

  // ─── composables/useBookmarkMutation.ts（收藏失败回滚提示） ───
  "useBookmarkMutation.actionFailed": "操作失败",
} as const;

export default zhMisc;
export type ZhMiscKey = keyof typeof zhMisc;
