// lynx 组件/工具域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// 译文按 docs/style-guides/ui-copy.md（Apple HIG 风格基线）执行：sentence case、
// 动词 CTA、按钮无句号、避免客套词、术语表（bookmark/follow/sign in）；图标 unicode
// （▶︎/⧉）非文案，随 zh 保留。
import type { ZhMiscKey } from "../zh-CN/misc";

const enMisc = {
  // ─── navTabs.ts ───
  "navTabs.recommended": "Recommended",
  "navTabs.illusts": "Illustrations",
  "navTabs.novels": "Novels",
  "navTabs.me": "Me",

  // ─── CoverImage.vue ───
  "coverImage.loadFailed": "Image failed to load",
  "coverImage.retry": "Retry",

  // ─── RestrictOverlay.vue ───
  "restrictOverlay.blocked": "Hidden by content restrictions",

  // ─── CommentItem.vue ───
  "commentItem.reply": "Reply",
  "commentItem.replyTo": "Replying to {{name}}: ",
  "commentItem.collapseReplies": "Hide replies",
  "commentItem.expandReplies": "Expand {{count}} replies",
  "commentItem.delete": "Delete",
  "commentItem.deleting": "Deleting…",

  // ─── WatchlistPromptDialog.vue ───
  "watchlistPrompt.title": "Follow this series?",
  "watchlistPrompt.hint": "New chapters will appear in Me → Watchlist",
  "watchlistPrompt.decline": "Not now",
  "watchlistPrompt.confirm": "Follow",

  // ─── RefreshableList.vue ───
  "refreshableList.refresh": "Refresh",
  "refreshableList.backToTop": "Back to top",

  // ─── AiOverlay.vue ───
  "aiOverlay.pure": "AI",
  "aiOverlay.assisted": "AI-assisted",
  "aiOverlay.maskHint": "AI-generated content, masked by your settings",

  // ─── IllustTypeBadgeRow.vue ───
  "illustTypeBadgeRow.ugoira": "▶︎ Ugoira",
  "illustTypeBadgeRow.multiPages": "⧉ {{count}} images",

  // ─── UgoiraViewer.vue ───
  "ugoiraViewer.noFrames": "No frames in this ugoira",
  "ugoiraViewer.loadFailed": "Could not load ugoira",

  // ─── CommentInputBar.vue ───
  "commentInputBar.replyingTo": "Replying to {{name}}",
  "commentInputBar.cancel": "Cancel",
  "commentInputBar.placeholder": "Write a comment…",
  "commentInputBar.posting": "Sending…",
  "commentInputBar.send": "Send",

  // ─── CommentOverlay.vue ───
  "commentOverlay.title": "Comments ({{count}})",
  "commentOverlay.loadFailedRetry": "Failed to load. Try again",
  "commentOverlay.retry": "Retry",
  "commentOverlay.empty": "No comments yet",
  "commentOverlay.noMore": "No more content",

  // ─── PagePickerSheet.vue ───
  "pagePicker.title": "Select pages to save",
  "pagePicker.selectAll": "Select all",
  "pagePicker.clearAll": "Clear selection",
  "pagePicker.selectedCount": "{{selected}} of {{total}} pages",
  "pagePicker.saving": "Saving…",
  "pagePicker.save": "Save ({{count}})",

  // ─── SearchSheet.vue ───
  "searchSheet.title": "Search",
  "searchSheet.placeholder": "Enter a tag or keyword",
  "searchSheet.history": "Search history",
  "searchSheet.historyEmptyHint": "Type a keyword to search",
  "searchSheet.scope.all": "All",
  "searchSheet.scope.illust": "Illustrations",
  "searchSheet.scope.novel": "Novels",
  "searchSheet.sort.newest": "Newest",
  "searchSheet.sort.oldest": "Oldest",
  "searchSheet.sort.popular": "Popular",
  "searchSheet.bookmarkDimmedHint":
    "Bookmark filters aren't available on Popular. Switch to Newest or Oldest to restore them",
  "searchSheet.ratioDimmedHint":
    "Available after switching to the Illustrations scope. Values you set are kept",
  "searchSheet.searchFailed": "Search failed. Try again",
  "searchSheet.searching": "Searching…",
  "searchSheet.emptyHint": "No results found. Try a different keyword",
  "searchSheet.rowAction": "View ›",
  "comments.loadFailedReload": "Failed to load comments. Try again.",
  "comments.loadMoreFailed": "Failed to load more",
  "comments.loadRepliesFailed": "Failed to load replies",
  "comments.sendFailed": "Failed to send. Try again.",
  "comments.deleteFailed": "Failed to delete. Try again.",
  "searchSheet.loadMoreFailed": "Failed to load more",
  "searchSheet.noMore": "No more content",
  "searchSheet.retry": "Retry",
  "searchSheet.clear": "Clear",
  "searchSheet.filter": "Filters",
  "searchSheet.clearAll": "Clear all",
  "searchSheet.periodTitle": "Period",
  "searchSheet.all": "All",
  "searchSheet.period.1d": "Last 24 hours",
  "searchSheet.period.1w": "Last week",
  "searchSheet.period.1m": "Last month",
  "searchSheet.period.6m": "Last 6 months",
  "searchSheet.period.1y": "Last year",
  "searchSheet.bookmarkTitle": "Bookmarks",
  "searchSheet.unlimited": "Any",
  "searchSheet.ratioTitle": "Ratio · illustrations only",
  "searchSheet.ratio.landscape": "Landscape",
  "searchSheet.ratio.portrait": "Portrait",
  "searchSheet.ratio.square": "Square",
  "searchSheet.resolutionTitle": "Resolution · illustrations only",
  "searchSheet.aiTitle": "AI content",
  "searchSheet.aiHint": "Applies to this search only. Your AI settings stay unchanged",
  "searchSheet.ai.follow": "Follow settings",
  "searchSheet.ai.all": "Show all",
  "searchSheet.ai.hide": "Hide AI",
  "searchSheet.charCount": "{{count}} characters",
  "searchSheet.type.manga": "Manga",
  "searchSheet.type.ugoira": "Ugoira",
  "searchSheet.type.illust": "Illustration",

  // ─── NovelExportSheet.vue ───
  "novelExportSheet.title": "Export novel",
  "novelExportSheet.closeA11y": "Close export panel",
  "novelExportSheet.formatTitle": "Format",
  "novelExportSheet.formatA11y": "Select export format {{label}}",
  "novelExportSheet.formatHint":
    "Defaults to the format chosen in Settings. Changes here apply to this export only.",
  "novelExportSheet.contentTitle": "Content",
  "novelExportSheet.contentSummary":
    "Body text (always included) · Metadata {{metadata}} · Cover {{cover}} · Inline images {{inlineImages}}",
  "novelExportSheet.stateOn": "On",
  "novelExportSheet.stateOff": "Off",
  "novelExportSheet.contentHint": "Change content options in Settings → Export",
  "novelExportSheet.export": "Export",

  // ─── pages/Me.vue WebDAV section ───
  "me.webdav.title": "WebDAV backup",
  "me.webdav.httpsWarning": "Non-HTTPS connections risk leaking your credentials",
  "me.webdav.usernamePlaceholder": "Username",
  "me.webdav.passwordPlaceholder": "Password (stored encrypted)",
  "me.webdav.dirPlaceholder": "Directory (default Pictelio/backup)",
  "me.webdav.backupPasswordPlaceholder": "Backup password (optional, encrypts the backup file)",
  "me.webdav.sensitiveExclusionHint": "Sensitive items (selected items are excluded from the backup)",
  "me.webdav.autoBackup": "Auto backup on launch",
  "me.webdav.lastBackup": "Last backup: {{value}}",
  "me.webdav.undoLastRestore": "Undo last restore",
  "me.webdav.chooseBackup": "Choose a backup to restore",
  "me.webdav.overwriteWarning":
    "Restoring overwrites matching settings on this device (only keys present in the backup). A safety snapshot is saved automatically first.",
  "me.webdav.confirmRestore": "Confirm restore",

  // ─── pages/FollowList.vue ───
  "followList.actionFailed": "Action failed",

  // ─── pages/NovelDetail.vue ───
  "novelDetail.watchAdded": "Following",
  "novelDetail.seriesTitle": "“{{title}}”",

  // ─── stores/authStore.ts ───
  "authStore.nativeAuthUnavailable": "Native authentication module unavailable",
  "authStore.responseParseFailed": "Could not parse the sign-in response",
  "authStore.emptyToken": "Enter a refresh_token",

  // ─── stores/downloadStore.ts ───
  "downloadStore.executorNotReady": "Download feature is unavailable",
  "downloadStore.nothingToShare": "No downloaded files to share",
  "downloadStore.shareUnavailable": "Sharing is unavailable",

  // ─── utils/downloadsViewModel.ts ───
  "downloadsViewModel.kind.ugoira": "Ugoira",
  "downloadsViewModel.kind.novel": "Novel",
  "downloadsViewModel.kind.images": "{{count}} images",
  "downloadsViewModel.status.queued": "Queued",
  "downloadsViewModel.status.downloading": "Downloading",
  "downloadsViewModel.status.paused": "Paused",
  "downloadsViewModel.status.stopped": "Stopped",
  "downloadsViewModel.status.completed": "Completed",
  "downloadsViewModel.status.failed": "Failed",
  "downloadsViewModel.failedWithReason": "Failed: {{error}}",

  // ─── utils/backupCore.ts ───
  "backupCore.notBackupJson": "Not a valid Pictelio backup (JSON parsing failed)",
  "backupCore.notBackupFormat": "Not a Pictelio backup (unrecognized format identifier)",
  "backupCore.schemaMissing": "Backup schemaVersion is missing or invalid",
  "backupCore.schemaTooNew":
    "This backup was created by a newer app version (schemaVersion {{version}} > {{supported}}). Update the app to restore it",
  "backupCore.fieldsInvalid": "Backup fields are missing or have the wrong type",

  // ─── utils/backupService.ts ───
  "backupService.encryptedNeedsPassword": "This backup is encrypted. Enter the backup password to restore it",

  // ─── utils/withTimeout.ts ───
  "withTimeout.timeout": "Request timed out",

  // ─── utils/fetchWrapper.ts ───
  "fetchWrapper.unavailable": "Network requests are unavailable in this environment",

  // ─── composables/useBookmarkMutation.ts ───
  "useBookmarkMutation.actionFailed": "Action failed",
} as const satisfies Record<ZhMiscKey, string>;

export default enMisc;
