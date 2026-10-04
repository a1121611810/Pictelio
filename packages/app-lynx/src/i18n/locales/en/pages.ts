// lynx 页面域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// 译文按 docs/style-guides/ui-copy.md（Apple HIG 风格基线）执行：sentence case、
// 动词 CTA、按钮无句号、避免客套词、术语表（bookmark/follow/sign in）。
import type { ZhPagesKey } from "../zh-CN/pages";

const enPages = {
  // Recommended.vue (renamed to "Discover"; component filename kept)
  // "recommended.title" removed: the page no longer draws a physical top bar
  //   (ADR-0216) — the heading is an in-flow <text> using discover.title.
  "recommended.charCount": "{{count}} characters",

  // IllustList.vue
  "illustList.title": "Illustrations",
  "illustList.tab.recommend": "Recommended",
  "illustList.tab.follow": "Following",
  "illustList.empty.follow.title": "No followed illustrations",
  "illustList.empty.follow.hint": "New illustrations from artists you follow will appear here",
  "illustList.empty.recommend.title": "No recommended illustrations",
  "illustList.empty.recommend.hint": "Check back later for new recommendations",
  "illustList.related.title": "Related works",
  "illustList.related.collapse": "Hide",
  "illustList.related.collapseA11y": "Hide related works",
  "illustList.related.viewA11y": "View related work {{title}}",
  "illustList.footer.loading": "Loading…",
  "illustList.footer.end": "No more content",

  // IllustDetail.vue
  "illustDetail.title": "Artwork details",
  "illustDetail.actionFailed": "Action failed",
  "illustDetail.follow.following": "Following",
  "illustDetail.follow.follow": "Follow",
  "illustDetail.save.action": "Save",
  "illustDetail.save.viewDownloads": "View downloads",
  "illustDetail.save.noOriginal": "No downloadable originals",
  "illustDetail.save.queued": "Added {{count}} items to the download queue (see Downloads)",
  "illustDetail.save.ugoiraInfoFailed": "Could not load ugoira info",

  // Immersive view a11y (#887 / ADR-0213 decision 9): dynamic accessibility-label per state
  // (screen-reader users need to be told the image is a toggle, or they cannot exit immersive mode);
  // the multi-image variant also carries "image n of N" because the badge is hidden while immersive.
  "illustDetail.a11y.immersiveEnter": "Enter immersive mode",
  "illustDetail.a11y.immersiveExit": "Exit immersive mode",
  "illustDetail.a11y.immersiveEnterPage": "Image {{n}} of {{total}}, enter immersive mode",
  "illustDetail.a11y.immersiveExitPage": "Image {{n}} of {{total}}, exit immersive mode",

  // Tag neighbors (ADR-0197 / spec docs/specs/tag-neighbors.md)
  "tagNeighbors.entry": "Similar by tags",
  "tagNeighbors.title": "Similar by tags",
  "tagNeighbors.similarity": "{{score}} match",
  "tagNeighbors.commonTags": "{{common}}/{{total}} shared tags",
  "tagNeighbors.source.author": "Same artist",
  "tagNeighbors.source.sitewide": "Site-wide",
  "tagNeighbors.skip.tooFewTags": "This artwork has only 1 tag, so similarity cannot be compared. Searched site-wide instead.",
  "tagNeighbors.empty": "No similar artworks found",
  "tagNeighbors.gated": "{{count}} item(s) hidden by your content and muted-tag settings",
  "tagNeighbors.retry": "Retry",
  "tagNeighbors.broadening": "Broadening the tag range…",
  "tagNeighbors.broadeningDone": "Searched site-wide with {{count}} tags",
  "tagNeighbors.broadeningDismiss": "Don't show again",

  // Watch Later (ADR-0191 / #751 T3 / #753 T4): shared by illust detail + novel intro entries
  "later.action.add": "Watch Later",
  "later.action.added": "In Watch Later",
  "later.title": "Watch Later",
  "later.empty.title": "Nothing saved for later yet",
  "later.empty.hint": "Tap Watch Later on artwork details or novel intro to save it here",
  "later.remove": "Remove",
  "later.badge.illust": "Illustration",
  "later.badge.novel": "Novel",
  "later.me.entry": "Watch Later",

  // NovelIntro.vue (novel intro page, map #575 / spec #585)
  "novelIntro.retry": "Retry",
  "novelIntro.startReading": "Start reading",
  "novelIntro.startReadingA11y": "Start reading",
  // Ticket #928 / ADR-0219 §2.4: intro CTA when a continue-reading position exists
  // (single-button shape unchanged — only this label branches)
  "novelIntro.continueReading": "Continue reading",
  "novelIntro.continueReadingA11y": "Continue reading",
  "novelIntro.authorA11y": "View author profile",
  "novelIntro.noCaption": "No description",
  "novelIntro.captionTitle": "Description",
  "novelIntro.closeA11y": "Close",
  "novelIntro.commentsA11y": "View comments",

  // NovelDetail.vue
  "novelDetail.title": "Novel",
  "novelDetail.export.a11y": "Export novel",
  "novelDetail.export.action": "Export",
  "novelDetail.export.queued": "Added to the download queue (see Downloads)",
  // 正文选中操作菜单（spec docs/specs/app-lynx-novel-text-selection.md）
  "novelDetail.selection.copy": "Copy",
  "novelDetail.selection.search": "Search",
  "novelDetail.selection.copied": "Copied",
  "novelDetail.selection.copyFailed": "Copy failed",
  "novelDetail.bodyExtractFailed": "Could not extract novel text",
  "novelDetail.end": "— End —",

  // NovelList.vue
  "novels.title": "Novels",
  "novels.tab.recommend": "Recommended",
  "novels.tab.follow": "Following",
  "novels.empty.follow.title": "No followed novels",
  "novels.empty.follow.hint": "New works from novelists you follow will appear here",
  "novels.empty.recommend.title": "No recommended novels",
  "novels.empty.recommend.hint": "Check back later for new recommendations",
  "novels.charCount": "{{count}} characters",
  "novels.footer.loading": "Loading…",
  "novels.footer.end": "No more content",

  // Bookmarks.vue
  "bookmarks.title": "Bookmarks",
  "bookmarks.tab.illust": "Illustrations",
  "bookmarks.tab.novel": "Novels",
  "bookmarks.empty.title": "Nothing bookmarked yet",
  "bookmarks.empty.hint": "Works you bookmark will appear here",
  "bookmarks.charCount": "{{count}} characters",
  "bookmarks.footer.loading": "Loading…",
  "bookmarks.footer.end": "No more content",

  // Login.vue
  "login.error.failed": "Sign in failed",
  "login.token.placeholder": "Paste a Pixiv refresh_token",
  "login.submit": "Sign in",
  "login.submitting": "Signing in…",
  // Corrected 2026-10-03 with the dimension restructure: sign-in lands on
  // "Discover" (DISCOVER_PATH in router.ts). The old copy still named the three
  // pre-restructure top-level destinations.
  "login.afterHint": "After signing in, you'll land on Discover — illustrations and novels",

  // DownloadManager.vue
  "downloads.title": "Downloads",
  "downloads.shared": "Opened the system share sheet",
  "downloads.deletedFiles": "Deleted files and records",
  "downloads.deletedRecords": "Cleared records",
  "downloads.empty.title": "No downloads yet",
  "downloads.empty.hint": "Tap Save on an artwork to add it to the download queue",
  "downloads.selectAll": "Select all",
  "downloads.deselectAll": "Deselect all",
  "downloads.countSelected": "{{selected}} of {{total}} selected",
  "downloads.countAll": "Total {{total}}",
  "downloads.taskA11y": "Select {{name}}",
  "downloads.summary": "{{count}} items · {{completed}} done · {{active}} in progress",
  "downloads.startAll": "Start all",
  "downloads.startSelected": "Start selected",
  "downloads.pauseAll": "Pause all",
  "downloads.pauseSelected": "Pause selected",
  "downloads.stopAll": "Stop all",
  "downloads.stopSelected": "Stop selected",
  "downloads.share": "Share",
  "downloads.deleteAll": "Delete all",
  "downloads.deleteSelected": "Delete selected",
  "downloads.deleteTitle": "Delete downloads",
  "downloads.deleteBody":
    "This removes {{count}} download records. Delete Files and Records also deletes downloaded files; Clear Records keeps them.",
  "downloads.cancel": "Cancel",
  "downloads.deleteRecordsOnly": "Clear records",
  "downloads.deleteFilesAndRecords": "Delete files and records",

  // ErrorPage.vue
  "errorPage.backToLogin": "Back to sign in",

  // FollowList.vue
  "followList.title.following": "Following",
  "followList.title.followers": "Followers",
  "followList.loadMoreFailed": "Could not load more",
  "followList.empty.following": "No following",
  "followList.empty.followers": "No followers",
  "followList.empty.followingHint": "People you follow will appear here",
  "followList.empty.followersHint": "People who follow you will appear here",
  "followList.retry": "Retry",
  "followList.following": "Following",
  "followList.follow": "Follow",
  "followList.footer.loading": "Loading…",

  // MyPixiv.vue (MyPixiv friends list, ADR-0193 / #754 T7; glossary term "MyPixiv")
  "mypixiv.title": "My Pixiv",
  "mypixiv.empty.title": "No My Pixiv friends yet",
  "mypixiv.empty.hint": "Follow each other to become My Pixiv friends",
  "mypixiv.retry": "Retry",
  "mypixiv.loadMoreFailed": "Could not load more",
  "mypixiv.actionFailed": "Action failed",
  "mypixiv.footer.loading": "Loading…",
  "mypixiv.footer.end": "No more content",

  // Following.vue
  "following.backA11y": "Back",
  "following.title": "Following",
  "following.retry": "Retry",
  "following.empty.title": "No updates from people you follow",
  "following.empty.hint": "Follow artists you like and their new works will appear here",
  "following.footer.loading": "Loading…",
  "following.footer.end": "No more content",

  // NetworkCheck.vue
  "networkCheck.status.ok": "Pass",
  "networkCheck.status.warn": "Warning",
  "networkCheck.status.fail": "Fail",
  "networkCheck.status.skipped": "Skipped",
  "networkCheck.back": "Back",
  "networkCheck.title": "Network check",
  "networkCheck.running": "Checking…",
  "networkCheck.degraded": "Degraded in dev mode: only some checks run",
  "networkCheck.action": "Suggestion: {{action}}",
  "networkCheck.runningAction": "Checking…",
  "networkCheck.rerun": "Run again",
  "networkCheck.copied": "Copied",
  "networkCheck.copyReport": "Copy report",
  "networkCheck.copyFailed": "Copy failed: clipboard is unavailable here (screenshot the report instead)",

  // UpdatePage.vue
  "update.exit": "Exit app",
  "update.title": "Update",
  "update.newVersion": "New version available",
  "update.currentVersion": "Current version v{{version}}",
  "update.changelogTitle": "What's new",
  "update.noChangelog": "No release notes",
  "update.download": "Download new version",

  // UserHome.vue
  "userHome.titleFallback": "User profile",
  "userHome.loadProfileFailed": "Could not load profile",
  "userHome.followCount": "{{count}} following",
  "userHome.followers": "Followers",
  "userHome.tab.illust": "Illustrations",
  "userHome.tab.novel": "Novels",
  "userHome.empty.title": "No works yet",
  "userHome.empty.hint": "This user hasn't published any works yet",
  "userHome.charCount": "{{count}} characters",
  "userHome.footer.loading": "Loading…",
  "userHome.footer.end": "No more content",

  // Watchlist.vue
  "watchlist.title": "Watchlist",
  "watchlist.retry": "Retry",
  "watchlist.empty.title": "No followed series",
  "watchlist.empty.hint": "You can follow a series while reading it",
  "watchlist.chapterCount": "{{count}} chapters",
  "watchlist.updatedAt": "Updated {{date}}",
  "watchlist.unwatch": "Stop following",
  "watchlist.footer.loading": "Loading…",
  "watchlist.footer.end": "No more content",
  "watchlist.unwatchTitle": "Stop following?",
  "watchlist.unwatchBody": "{{title}} will be removed from your watchlist",
  "watchlist.keepFollowing": "Keep following",
  "watchlist.processing": "Working…",

  // Me.vue
  "me.title": "Me",
  "me.bookmarks": "My bookmarks",
  "me.watchlist": "Watchlist",
  "me.mypixiv": "My Pixiv",
  "me.downloads": "Downloads",
  "me.notifications": "Notifications",
  "me.fullscreenMode": "Fullscreen mode",
  "me.fullscreenModeDesc": "Hide status and navigation bars; swipe from the edge to reveal them",
  // Network group in Me.vue (ADR-0199 D4 / #779): rate-limit backoff settings; delaySeconds renders chip seconds
  "advanced.network.title": "Network",
  "advanced.network.hint": "Automatically wait and retry when rate-limited by Pixiv",
  "advanced.network.backoff": "Rate-limit backoff",
  "advanced.network.backoffDesc": "Wait and retry automatically on HTTP 429; off fails immediately",
  "advanced.network.maxRetries": "Max retries",
  "advanced.network.baseDelay": "Initial delay",
  "advanced.network.maxDelay": "Max delay",
  "advanced.network.delaySeconds": "{{seconds}}s",
  // Local usage metrics (spec §4 P0.5) — the single read-out for the four metrics
  // (revisit interval / top-level share / sub-tab share / empty-section rate).
  // Rate helpers return null for a zero denominator (never fake 0%); this panel
  // surfaces that as noData rather than inventing a number.
  "advanced.metrics.title": "Local usage metrics",
  "advanced.metrics.hint": "Counted on this device only; never uploaded",
  "advanced.metrics.revisit": "Revisit interval",
  "advanced.metrics.revisitLast": "Latest",
  "advanced.metrics.sampleCount": "Samples",
  "advanced.metrics.samples": "{{count}} samples",
  "advanced.metrics.hours": "{{hours}} h",
  "advanced.metrics.topShare": "Top-level share",
  "advanced.metrics.subShare": "Sub-tab share",
  "advanced.metrics.emptyRate": "Empty-section rate",
  "advanced.metrics.noData": "No data",

  // Notifications.vue (ADR-0188 / #728)
  "notifications.title": "Notifications",
  "notifications.retry": "Retry",
  "notifications.empty.title": "No notifications",
  "notifications.empty.hint": "Events like follows and likes will appear here",
  "notifications.noContent": "(no content)",
  "notifications.footer.loading": "Loading…",
  "notifications.footer.end": "No more",
  "notifications.children.loading": "Loading…",
  "notifications.children.end": "No more",
  "notifications.children.error": "Failed to load, tap to retry",
  // Row-level a11y labels carry no read/unread semantics (ADR-0188 D5 v1 does not
  // consume the server-side read field; local read tracking would conflict on screen).

  // MuteTags.vue (muted-tag management page, ADR-0187 / #732)
  "muteTags.title": "Muted tags",
  "muteTags.empty.title": "No muted tags",
  "muteTags.empty.hint": "Long-press a tag on artwork to mute it",
  "muteTags.remove": "Remove",

  // Engine fallback reason copy (ADR-0164 / #555): engine-state snapshot reason code → UI copy.
  // Code set = EngineRoute.Reason (10 codes) + unknown fallback.
  // ⚠️ ADR-0203 decision 7 removed the only renderer (Me page effective-state row) — it sat
  // inside the client-switch group whose v-if is always false in a single-engine package.
  // Copy and engineState.ts are now consumer-less retained items, and "switched to WebView"
  // wording can never be true again. Traceability gap explicitly acknowledged in #846
  // (downgraded to characterization rather than papered over).
  "engineFallback.reason.preferred": "Running on your preferred engine",
  "engineFallback.reason.lynx_unavailable": "Lynx isn’t available on this device; WebView is in use",
  "engineFallback.reason.lynx_known_bad": "Lynx failed before on this version; WebView is in use",
  "engineFallback.reason.lynx_retry": "WebView unavailable; retrying with Lynx",
  "engineFallback.reason.webview_unavailable": "WebView unavailable; Lynx is in effect",
  "engineFallback.reason.a11y_webview": "WebView enabled for accessibility services",
  "engineFallback.reason.a11y_lynx_last_resort": "WebView unavailable; staying on Lynx for accessibility",
  "engineFallback.reason.no_engine": "Neither engine is available",
  "engineFallback.reason.forced_webview": "WebView was forced for this launch",
  "engineFallback.reason.runtime_failure": "Lynx hit an error; WebView is in use",
  "engineFallback.reason.unknown": "Engine state unknown",
  // App.vue fallback banner (word-for-word migration of the legacy zh copy, T4 #556)
  "engineFallback.legacyBanner":
    "Your WebView version is too low, so the app ran on the Lynx engine this time; it switches back automatically once WebView is updated.",
  "me.appearance.title": "Appearance",
  "me.appearance.language": "Interface language",
  "me.appearance.languageFollowSystem": "Automatic",
  "me.appearance.themeColorHint": "Choose a theme color",
  "me.appearance.colorSky": "Sky blue",
  "me.appearance.colorViolet": "Violet",
  "me.appearance.colorPink": "Cherry pink",
  "me.appearance.colorGreen": "Pine green",
  "me.appearance.colorOrange": "Sunset orange",
  "me.appearance.colorTeal": "Teal",
  "me.appearance.colorBili": "Bilibili Pink",
  // 外观模式（spec docs/specs/lynx-night-mode.md T2 §4.7）：M3 segmented button three-segment
  "me.appearance.mode": "Appearance",
  "me.appearance.modeLight": "Light",
  "me.appearance.modeDark": "Dark",
  "me.appearance.modeSystem": "Follow system",
  "me.content.title": "Content",
  "me.content.hint": "R-18 / R-18G content is hidden by default",
  "me.content.showR18": "Show R-18 content",
  "me.content.showR18G": "Show R-18G content",
  "me.content.relatedInjection": "Related works injection",
  "me.content.rankingEntry": "Rankings entry",
  "me.content.novelIntroFirst": "Show novel intro first",
  "me.content.novelIntroFirstDesc": "When off, tapping a novel goes straight to the text",
  "me.content.ai": "AI works",
  "me.content.aiShow": "Show",
  "me.content.aiMask": "Mask",
  "me.content.aiOnly": "Only",
  "me.content.muteTags": "Manage muted tags",
  "me.ugoira.title": "Ugoira playback",
  "me.ugoira.hint": "How ugoira frames are loaded",
  "me.ugoira.fflate": "fflate (default)",
  "me.ugoira.range": "Range streaming",
  "me.ugoira.rangeHint":
    "Range streaming loads frames on demand and uses less memory. If a Range request fails, web playback falls back to full fflate loading without interruption. Native mode is unaffected by this setting.",
  "me.ugoira.confirmTitle": "Switch to Range streaming?",
  "me.ugoira.confirmBody":
    "Range streaming loads frames on demand and uses less memory. It depends on Range support on the native side and may be slower on some networks.",
  "me.ugoira.cancel": "Cancel",
  "me.ugoira.confirm": "Confirm",
  "me.quality.title": "Image quality",
  "me.quality.hint": "Resolution for list thumbnails and detail images",
  "me.quality.medium": "Standard",
  "me.quality.large": "High",
  "me.quality.original": "Original",
  "me.download.title": "Download",
  "me.download.formatHint": "Ugoira export format (one global setting, not per image)",
  "me.download.templateLabel": "File name template",
  "me.download.templateHint": "Placeholders: {id} work ID, {title} title, {author} author, {p} multi-page index (single-page works omit it)",
  "me.download.templatePlaceholder": "Pictelio_{id}",
  "me.download.templatePreview": "Preview: {{value}}",
  "me.download.templateReset": "Reset to default",
  "me.download.templateFallbackHint": "Template was empty or invalid; reset to the default naming",
  "me.download.authorDir": "Per-author folders",
  "me.download.authorDirDesc": "Saved images go into a subfolder named after the author",
  "me.export.title": "Export",
  "me.export.formatHint": "Default novel export format (the export panel can override it per export)",
  "me.export.includeMetadata": "Include metadata",
  "me.export.includeMetadataHint": "Title, author, tags, series, and source link",
  "me.export.includeCover": "Include cover",
  "me.export.includeCoverHint": "Embed the cover in formats that support images",
  "me.export.includeImages": "Include inline images",
  "me.export.includeImagesHint": "Text formats keep image links only",
  "me.logout": "Sign out",
  "me.webdav.hint": "Back up local settings to a self-hosted WebDAV server",
  "me.webdav.enabled": "Enable WebDAV backup",
  "me.webdav.restorePromptPlaceholder": "Backup password",
  "me.webdav.encryptedPrompt": "This backup is encrypted. Enter the backup password to read its summary:",
  "me.webdav.decrypt": "Decrypt and view summary",
  "me.webdav.encryptedBadge": " (encrypted)",
  "me.webdav.on": "On",
  "me.webdav.off": "Off",
  "me.webdav.days": "{{count}}d",
  "me.webdav.neverBackedUp": "Never backed up",
  "me.webdav.action.test": "Test connection",
  "me.webdav.action.backup": "Back up now",
  "me.webdav.action.listBackups": "List backups",
  "me.webdav.action.readSummary": "Reading backup summary",
  "me.webdav.action.restore": "Restore",
  "me.webdav.action.undoRestore": "Undo restore",
  "me.webdav.testOk": "Connected. {{count}} backups on the server",
  "me.webdav.backupDone": "Backed up {{name}} ({{size}} bytes{{encrypted}})",
  "me.webdav.encryptedSuffix": ", encrypted",
  "me.webdav.noRemoteBackups": "No backups on the server yet",
  "me.webdav.restoreSkipSignedOut": "Signed out, {{count}} account keys skipped",
  "me.webdav.restoreSkipOtherAccount": "{{count}} keys from other accounts skipped",
  "me.webdav.restoreDone":
    "Restored the backup from {{createdAt}} ({{applied}} written, {{skipped}} skipped; {{skippedDetail}})",
  "me.webdav.nothingToUndo": "No emergency snapshot to undo",
  "me.webdav.undone": "Rolled back to the state before restore",
  "me.webdav.httpStatusSuffix": " (HTTP {{status}})",
  "me.webdav.summaryCreatedAt": "Backup date: {{value}}",
  "me.webdav.summarySource": "Source engine: {{engine}} · version {{version}}",
  "me.webdav.summaryCounts": "{{device}} device keys / {{account}} account keys (current account) / {{sets}} sets",
  // One-time navigation migration notice (spec §7 mitigation #2; previously absent)
  "me.migration.title": "Navigation has changed",
  "me.migration.body": "Illustrations and novels now live under Discover. Your bookmarks, watch-later, notifications and watchlist are all still below.",
  "me.migration.dismiss": "Got it",
  "me.webdav.cancel": "Cancel",

  // ── Ranking page (spec docs/specs/ranking.md; #517 page skeleton) ──
  "ranking.page.title": "Rankings",
  "ranking.page.retry": "Retry",
  "ranking.page.empty": "No ranking entries",
  "ranking.page.emptyHint": "Check back later",
  "ranking.footer.loading": "Loading…",
  "ranking.footer.end": "No more results",

  // ── Ranking mode/date controls + R-18 guidance (spec docs/specs/ranking.md §5.3/§5.7; #518) ──
  "ranking.mode.daily": "Daily",
  "ranking.mode.weekly": "Weekly",
  "ranking.mode.monthly": "Monthly",
  "ranking.mode.newcomer": "Newcomers",
  "ranking.mode.original": "Original",
  "ranking.mode.r18": "R-18",
  "ranking.mode.r18g": "R-18G",
  "ranking.modeListAria": "Ranking categories",
  "ranking.prevDayAria": "Previous day",
  "ranking.nextDayAria": "Next day",
  "ranking.today": "Today",
  "ranking.dateLong": "{{year}}-{{month}}-{{day}}",
  "ranking.r18Notice.title": "R-18 rankings require a pixiv setting",
  "ranking.r18Notice.body":
    "This ranking requires \"Show R-18 works\" to be enabled in your pixiv web settings. Enable it, then come back and retry.",
  "ranking.r18Notice.action": "Open pixiv settings",
  "ranking.r18Notice.retry": "Retry",

  // ── Recommended-feed entry card (spec docs/specs/ranking.md §5.2; #519) ──
  "ranking.entry.firstBadge": "No. 1",
  "ranking.entry.viewAll": "See all",
  "ranking.entry.viewAllAria": "View full rankings",
  "ranking.entry.collapseAria": "Collapse rankings",
  "ranking.entry.stripAria": "Rankings entry",
  "ranking.entry.itemAria": "No.{{rank}}: {{title}}",

  // ─── Dimension restructure (2026-10-03): Discover / Updates / Shelf / Advanced ───
  // Top level now groups by the question the user asks, not by medium;
  // media demoted to a second-level tab inside Discover.

  /** Discover (reworked Recommended.vue): second level = medium dimension */
  "discover.title": "Discover",
  "discover.tab.all": "All",
  "discover.tab.illust": "Illustrations",
  "discover.tab.novel": "Novels",

  /** Updates (three-segment aggregate): following / watchlist / notifications */
  "updates.title": "Updates",
  "updates.section.following": "Following",
  "updates.section.watchlist": "Watchlist",
  "updates.section.notifications": "Notifications",
  "updates.empty": "Nothing yet",
  // Following-segment empty state (spec §7). Previously the generic "Nothing yet"
  // with no next step — found by the 3rd-round Spec review (I-2).
  "updates.emptyFollowingTitle": "No followed updates yet",
  "updates.emptyFollowingHint": "Follow artists and their new works and chapters show up here",
  "updates.emptyFollowingToFollowing": "Follow artists",
  "updates.emptyFollowingToRanking": "Browse rankings",
  "updates.viewAll": "View all",
  "updates.newCount": "{{count}} new",

  /** Shelf (three-segment aggregate): bookmarks / watch later / continue reading */
  "shelf.title": "Shelf",
  "shelf.section.bookmarks": "Bookmarks",
  "shelf.section.later": "Watch Later",
  "shelf.section.continueReading": "Continue Reading",
  "shelf.empty": "Nothing saved yet",
  // Shelf's own "View all" (section-header jump) — stays in the shelf namespace.
  "shelf.viewAll": "View all",
  // Continue reading is not implemented yet (the old WebView client's historyStore
  // was removed with ADR-0203) — say so instead of faking an empty list.
  "shelf.continueReading.empty": "Nothing here yet",
  "shelf.continueReading.hint": "Open any novel or illustration to come back to where you left off",

  // ─── Continue reading full list (/continue) ───
  // 小说阅读位置 + 插画浏览历史**同段同页**（ADR-0219 §2.1 / 票 #927）：空态与提示文案
  // 刻意不提「哪一轴」——两轴对用户是同一种意图（「我上次在这儿」）。
  "continue.title": "Continue Reading",
  "continue.empty.title": "Nothing here yet",
  "continue.empty.hint": "Open any novel or illustration and this list will remember where you left off",
  "continue.remove": "Remove",
  // {type} = 类型徽章文案（小说 / 插画）。整行挂了 accessibility-label，
  // 子文本不再被朗读 ⇒ 徽章不进标签的话，屏读用户分不出「在读」与「刷过」。
  "continue.open": "Open {{type}} entry",
  "continue.badge.novel": "Novel",
  "continue.badge.illust": "Illustration",
  "continue.restricted": "Restricted by browser settings",
  "continue.back": "Back",
  "continue.unavailable": "This work is no longer available",
  "continue.label.chapter": "Stopped at chapter {{n}}",
  "continue.completed.title": "Finished",

  /** Advanced settings (absorbs the debug/self-check rows previously in Me) */
  "advanced.title": "Advanced",
  "advanced.networkCheck": "Network self-check",
  "advanced.platformCheck": "Platform consistency check",
} as const satisfies Record<ZhPagesKey, string>;

export default enPages;
