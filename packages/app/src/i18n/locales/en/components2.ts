// components 域 II（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// 文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出；R9：占位符与 zh 完全一致。
import type { ZhComponents2Key } from "../zh-CN/components2";

const enComponents2 = {
  // ── novel/NovelTopBar ──
  "novel.topBar.backAria": "Back",
  "novel.topBar.searchAria": "Search",
  "novel.topBar.novelLabel": "Novel",
  "novel.topBar.titleWrapped": "{{title}}",

  // ── novel/NovelCoverCard ──
  "novel.coverCard.seriesAria": "Open series: {{title}}",
  "novel.coverCard.seriesLabel": "Series: {{title}}",
  "novel.coverCard.expandAria": "Expand cover",
  "novel.coverCard.collapseAria": "Collapse cover",
  "novel.coverCard.statsWords": "📖 {{count}} characters",

  // ── search/SearchFilterSheet: header ──
  "search.filterSheet.title": "Filters",
  "search.filterSheet.clearAll": "Clear all",
  "search.filterSheet.clearAllAria": "Clear all filters",
  "search.filterSheet.closeAria": "Close",

  // ── search/SearchFilterSheet: post date ──
  "search.filterSheet.periodGroupAria": "Date posted",
  "search.filterSheet.periodLabel": "Date posted",
  "search.filterSheet.all": "All",
  "search.filterSheet.custom": "Custom",
  "search.filterSheet.startDateAria": "Start date",
  "search.filterSheet.endDateAria": "End date",
  "search.filterSheet.period24h": "Past 24 hours",
  "search.filterSheet.period1w": "Past week",
  "search.filterSheet.period1m": "Past month",
  "search.filterSheet.period6m": "Past 6 months",
  "search.filterSheet.period1y": "Past year",

  // ── search/SearchFilterSheet: bookmarks ──
  "search.filterSheet.bookmarkGroupAria": "Bookmarks",
  "search.filterSheet.bookmarkLabel": "Bookmarks",
  "search.filterSheet.any": "Any",
  "search.filterSheet.bookmarkDisabledHint":
    "Bookmark count filters aren't available for Popular. Switch to Newest or Oldest to restore them.",

  // ── search/SearchFilterSheet: aspect ratio ──
  "search.filterSheet.ratioGroupAria": "Aspect ratio",
  "search.filterSheet.ratioLabel": "Aspect ratio",
  "search.filterSheet.illustOnly": "Illustrations only",
  "search.filterSheet.ratioLandscape": "Landscape",
  "search.filterSheet.ratioPortrait": "Portrait",
  "search.filterSheet.ratioSquare": "Square",
  "search.filterSheet.ratioDisabledHint":
    "Available after switching to the Illustrations scope. Your selection is kept.",

  // ── search/SearchFilterSheet: resolution ──
  "search.filterSheet.resolutionGroupAria": "Resolution",
  "search.filterSheet.resolutionLabel": "Resolution",

  // ── search/SearchFilterSheet: AI works ──
  "search.filterSheet.aiGroupAria": "AI works",
  "search.filterSheet.aiLabel": "AI works",
  "search.filterSheet.aiFollow": "Follow app setting",
  "search.filterSheet.aiShowAll": "Show all",
  "search.filterSheet.aiHide": "Hide AI",
  "search.filterSheet.aiHint":
    "Only applies to this search. Doesn't change your AI preference in Settings.",

  // ── BlocklistSheet (B6) ──
  "blocklist.title": "Blocklist",
  "blocklist.closeAria": "Close",
  "blocklist.empty": "No blocked users",
  "blocklist.userId": "User ID: {{userId}}",
  "blocklist.unblockAria": "Unblock user {{userId}}",
  "blocklist.unblock": "Unblock",
  "blocklist.hint":
    "Works from blocked users no longer appear in your Recommended and Following feeds",

  // ── CommentInput / CommentList / CommentOverlay (B6) ──
  "comment.replyingTo": "Replying to @{{name}}",
  "comment.cancelReply": "Cancel reply",
  "comment.replyPlaceholder": "Reply to @{{name}}...",
  "comment.placeholder": "Write a comment...",
  "comment.send": "Send",
  "comment.reply": "Reply",
  "comment.delete": "Delete",
  "comment.empty": "No comments yet",
  "comment.emptyHint": "Be the first to comment",
  "comment.title": "Comments",
  "comment.closeAria": "Close",
  "comment.retry": "Retry",

  // ── ExportSheet (B6) ──
  "export.title": "Export novel",
  "export.closeAria": "Close export panel",
  "export.formatLabel": "Format",
  "export.formatAria.txt": "Export format TXT",
  "export.formatAria.html": "Export format HTML",
  "export.formatAria.md": "Export format Markdown",
  "export.formatAria.docx": "Export format Word (.docx)",
  "export.formatAria.pdf": "Export format PDF",
  "export.formatAria.epub": "Export format EPUB",
  "export.formatAria.rtf": "Export format RTF",
  "export.formatAria.json": "Export format JSON",
  "export.formatAria.fb2": "Export format FB2",
  "export.formatHint":
    "Defaults to the format selected in Settings. Changes here apply to this export only.",
  "export.contentLabel": "Content",
  "export.contentSummary":
    "Body text (always included) · Metadata {{metadata}} · Cover {{cover}} · Inline images {{inlineImages}}",
  "export.contentHint": "Change content options in Settings under Export.",
  "export.optionOn": "On",
  "export.optionOff": "Off",
  "export.exportAria": "Start export",
  "export.export": "Export",

  // ── GateOverlay (B6) ──
  "gate.title": "Update required to continue",
  "gate.updateRequiredBody":
    "Your version is below the minimum supported version{{floor}}. The automatic update didn't complete{{error}}",
  "gate.floorSuffix": " ({{version}})",
  "gate.errorSuffix": ": {{detail}}",
  "gate.period": ".",
  "gate.retryUpdate": "Retry update",
  "gate.downloadVersion": "Download v{{version}}",
  "gate.updating": "Updating…",
  "gate.updatingHint": "Updating to the new version. The app continues automatically when done.",

  // ── GridCard (B6) ──
  "gridCard.aiAssisted": "AI-assisted",
  "gridCard.bookmarkAria": "Bookmark",
  "gridCard.unbookmarkAria": "Remove bookmark",
  "gridCard.privateBadge": "Private",
  "gridCard.followAria": "Follow",
  "gridCard.unfollowAria": "Unfollow",
  "gridCard.follow": "Follow",
  "gridCard.followed": "Following",

  // ── IllustActionMenu (B6) ──
  "illustMenu.report": "Report",
  "illustMenu.blockAuthor": "Block author",

  // ── IllustTags (B6) ──
  "illustTags.listAria": "Illust tags",

  // ── IllustTypeBadge (B6) ──
  "illustBadge.ugoira": "Ugoira",
  "illustBadge.ugoiraAria": "Ugoira",
  "illustBadge.pageCountAria": "{{count}} images",

  // ── ImageCard (B6) ──
  "imageCard.aiAssisted": "AI-assisted",
  "imageCard.bookmarkAria": "Bookmark",
  "imageCard.unbookmarkAria": "Remove bookmark",
  "imageCard.privateBadge": "Bookmarked privately",
  "imageCard.followAria": "Follow",
  "imageCard.unfollowAria": "Unfollow",
  "imageCard.follow": "Follow",
  "imageCard.followed": "Following",
  "imageCard.following": "Following…",

  // ── ImageViewer (B6) ──
  "imageViewer.loadingPage": "Loading page {{current}} of {{total}}",
  "imageViewer.savePageAria": "Save current page to gallery",

  // ── NovelCard / NovelCoverCard (B6) ──
  "novelCard.aiAssisted": "AI-assisted",
  "novelCard.seriesAria": "View series: {{title}}",
  "novelCard.statsWords": "{{count}} characters",
  "novelCard.bookmarkAria": "Bookmark",
  "novelCard.unbookmarkAria": "Remove bookmark",
  "novelCard.privateBadge": "Bookmarked privately",

  // ── NovelFooterNav (B6) ──
  "novelFooterNav.prev": "Previous chapter",
  "novelFooterNav.next": "Next chapter",
  "novelFooterNav.seriesAria": "Open series contents",
  "novelFooterNav.contents": "Contents",
  "novelFooterNav.displaySettings": "Display settings",
  "novelFooterNav.original": "Original",
  "novelFooterNav.translation": "Translation",
  "novelFooterNav.translate": "Translate",
  "novelFooterNav.switchOriginalAria": "Switch to original",
  "novelFooterNav.switchTranslationAria": "Switch to translation",
  "novelFooterNav.openTranslateAria": "Open translation panel",
  "novelFooterNav.exportAria": "Export novel",
  "novelFooterNav.export": "Export",

  // ── NovelSearchBar (B6) ──
  "novelSearch.placeholder": "Search in novel",
  "novelSearch.searchAria": "Search in novel",
  "novelSearch.clear": "Clear",
  "novelSearch.prevMatch": "Previous match",
  "novelSearch.nextMatch": "Next match",
  "novelSearch.close": "Close search",

  // ── NovelTextListCard (B6) ──
  "novelTextCard.authorAria": "Author: {{name}}",
  "novelTextCard.statsWords": "{{count}} characters",
  "novelTextCard.aiAssisted": "AI-assisted",
  "novelTextCard.seriesAria": "View series: {{title}}",
  "novelTextCard.bookmarkAria": "Bookmark",
  "novelTextCard.unbookmarkAria": "Remove bookmark",

  // ── NovelVirtualFeed / VirtualFeed (B6) ──
  "virtualFeed.loading": "Loading...",
  "virtualFeed.endReached": "You've reached the end",
  "virtualFeed.empty": "No novels",
  "virtualFeed.emptyNew": "No new works",
  "virtualFeed.loadMoreFailed": "Load more failed",

  // ── OAuthWebView (B6) ──
  "oauth.signInFailed": "OAuth sign-in failed",
  "oauth.title": "Pixiv sign-in",
  "oauth.cancel": "Cancel",

  // ── PixivImage (B6; failure state reuses error.fallback.loadFailed) ──
  "pixivImage.loading": "Loading...",

  // ── PullIndicator (B6) ──
  "pullIndicator.refreshing": "Refreshing...",
  "pullIndicator.settingsReady": "⚙️ Release to open settings",
  "pullIndicator.refreshReady": "✨ Release to refresh. Pull further for settings",
  "pullIndicator.pulling": "↓ Pull to refresh",
  "pullIndicator.releaseToRefresh": "✨ Release to refresh",

  // ── ReaderSettingsSheet (B6) ──
  "readerSettings.title": "Reading settings",
  "readerSettings.closeAria": "Close",
  "readerSettings.previewBody":
    "The night was deep. She pushed open the window, and wind mixed with rain brushed her face.",
  "readerSettings.previewCaption": "Live preview",
  "readerSettings.fontSize": "Font size",
  "readerSettings.autoSize": "Auto · {{size}}px",
  "readerSettings.decreaseFontSize": "Decrease font size",
  "readerSettings.increaseFontSize": "Increase font size",
  "readerSettings.autoAria": "Auto font size",
  "readerSettings.auto": "Auto",
  "readerSettings.fontWeight": "Font weight",
  "readerSettings.fontFamily": "Font",
  "readerSettings.lineHeight": "Line spacing",
  "readerSettings.textColor": "Text color",
  "readerSettings.textColorValue": "Text color {{color}}",
  "readerSettings.reset": "Reset",
  "readerSettings.customTextColorAria": "Custom text color",
  "readerSettings.bgColor": "Background color",
  "readerSettings.bgColorValue": "Background color {{color}}",
  "readerSettings.bgColorDefault": "Default background color",
  "readerSettings.customBgColorAria": "Custom background color",

  // ── ReportSheet (B6) ──
  "report.title": "Report work",
  "report.closeAria": "Close",
  "report.selectReason": "Select a report reason:",
  "report.reported": "Reported",
  "report.submitting": "Submitting…",
  "report.submit": "Submit report",
  "report.emailHint": "Your email client opens with the report details after submitting",

  // ── SearchResults (B6) ──
  "searchResults.loading": "Loading...",
  "searchResults.loadMoreFailed": "Load more failed",
  "searchResults.endReached": "No more results",
  "searchResults.empty": "No results found",
  "searchResults.emptyHint": "Try different keywords or adjust your filters",

  // ── SearchableTag (B6) ──
  "searchableTag.searchAria": "Search tag: {{name}}",
  "searchableTag.translatedLabel": "{{name}} ({{translated}})",

  // ── SeriesSheet / SeriesSheetItem (B6) ──
  "series.title": "Series works",
  "series.closeAria": "Close",
  "series.closeScrimAria": "Close",
  "series.stats": "Total {{words}} characters · {{count}} works{{more}}",
  "series.loading": "Loading...",
  "series.loadFailed": "Load failed: {{detail}}",
  "series.retry": "Retry",
  "series.empty": "No works yet",
  "series.itemActiveAria": "Current chapter: {{title}}",
  "series.itemWords": "📖 {{count}} characters",
  "series.currentBadge": "Current",

  // ── StartupUpdateDialog (B6; trailing space in bodyPublishedSuffix is part of the copy) ──
  "startupUpdate.title": "New version available",
  "startupUpdate.bodyPublishedSuffix": "is now available. Current version is ",
  "startupUpdate.bodyEnd": ".",
  "startupUpdate.later": "Later",
  "startupUpdate.download": "Download",

  // ── ThemeSelector (B6) ──
  "theme.light": "Light",
  "theme.system": "System",
  "theme.dark": "Dark",
  "theme.groupAria": "Appearance",

  // ── TranslateSheet (B6) ──
  "translate.setUpKey": "Set up your API key in Settings",
  "translate.translating": "Translating…",
  "translate.retryFailedCount": "Retry {{count}} failed blocks",
  "translate.start": "Start translation",
  "translate.dialogAria": "AI translation",
  "translate.title": "AI translation",
  "translate.closeAria": "Close",
  "translate.noKeyHint":
    "No DeepSeek API key configured. Go to Settings > Translation to add your own API key (BYOK: stored on this device only, connects directly to the provider).",
  "translate.privacyHint":
    "Novel text is translated into Simplified Chinese. Content is sent to DeepSeek (the model you chose) and billed by usage.",
  "translate.tierLabel": "Quality (this page only)",
  "translate.tierStandard": "Standard",
  "translate.tierPro": "High quality",
  "translate.progress": "Translated {{done}} / {{total}} blocks{{suffix}}",
  "translate.progressSuffix":
    ". The first screen is ready. The rest continues in the background…",
  "translate.failedHint":
    "{{count}} blocks failed (marked as Untranslated in the text). Retry the failed blocks. Successful blocks aren't billed again.",

  // ── UgoiraViewer (B6) ──
  "ugoira.loadFailed": "Couldn't load ugoira",
  "ugoira.closeAria": "Close",
  "ugoira.loading": "Loading...",
  "ugoira.paused": "Paused",
  "ugoira.back": "Back",

  // ── NavBar (B6) ──
  "navBar.mainAria": "Main navigation",
  "navBar.searchAria": "Search",
  "navBar.tab.recommended": "Recommended",
  "navBar.tab.follow": "Following",
  "navBar.tab.bookmarks": "Bookmarks",
  "navBar.tab.history": "History",
} as const satisfies Record<ZhComponents2Key, string>;

export default enComponents2;
