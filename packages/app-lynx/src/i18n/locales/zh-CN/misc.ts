// lynx 组件/工具域（components/stores/utils/composables 用户可见文案，B9 批次工单 #508）。
// zh 值 = 存量文案逐字快照，迁移期禁改写。
// 未抽取清单（源级测试钉住字面量，与 B8 处理一致）：utils/accessibility.ts 全部 A11Y 注册表、
// navTabs a11yLabel、SearchSheet 标题/占位/scope-sort chips/五态文案等（SearchSheet.test.ts 钉住）、
// NovelExportSheet 内容摘要与设置页提示（template.test.ts 钉住）、backupCore WEBDAV_ERROR_MESSAGES。
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

  // ─── SearchSheet.vue（全局搜索弹层；标题/占位/scope-sort chips/五态文案被
  //     SearchSheet.test.ts 源级钉住，未抽取） ───
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

  // ─── NovelExportSheet.vue（小说导出面板；内容摘要行与设置页提示被
  //     NovelExportSheet.template.test.ts 钉住，未抽取） ───
  "novelExportSheet.title": "导出小说",
  "novelExportSheet.closeA11y": "关闭导出面板",
  "novelExportSheet.formatTitle": "导出格式",
  "novelExportSheet.formatA11y": "选择导出格式{{label}}",
  "novelExportSheet.formatHint": "默认使用设置页选择的格式；此处修改仅作用于本次导出。",
  "novelExportSheet.contentTitle": "导出内容",
  "novelExportSheet.export": "导出",

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
