// 英文 · 设置域：文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出。
// R8：语言本名（autonym）不适用本域；R9：占位符与 zh 完全一致（不得增删）。
import type { SettingsKey } from "../zh-CN/settings";

const enSettings = {
  "settings.appearance.sectionTitle": "Display & Interaction",
  "settings.appearance.theme": "Theme",
  "settings.appearance.detailStairs": "Detail page stair navigation",
  "settings.appearance.detailStairsDesc":
    "Show a page-number rail on multi-page works for quick navigation",
  "settings.appearance.autoHideNav": "Auto-hide navigation bar",
  "settings.appearance.autoHideNavDesc":
    "Collapse the nav bar when scrolling down on profile and follow lists. Scroll up to reveal",
  "settings.appearance.persistScroll": "Persistent scroll restoration",
  "settings.appearance.persistScrollDesc":
    "Off: reopen at the top of lists (default). On: restore your last position.",
  "settings.appearance.language": "Language",
  "settings.appearance.followSystem": "Automatic",
  "settings.appearance.languageDesc": "Change the interface language. Applies immediately.",

  // ── Content & filtering (SettingsContent) ──
  "settings.content.sectionTitle": "Content & Filtering",
  "settings.content.showR18": "Show R18 content",
  "settings.content.showR18Desc":
    "Hides sensitive content from lists when off. Refresh lists to apply.",
  "settings.content.showR18G": "Show R-18G content",
  "settings.content.showR18GDesc":
    "Hides graphic content from lists when off. Refresh lists to apply.",
  "settings.content.relatedInjection": "Related works injection",
  "settings.content.relatedInjectionDesc":
    "Shows a row of related works under a work when you return from its detail page.",
  "settings.content.aiFilter.title": "AI works",
  "settings.content.aiFilter.desc":
    "Controls how AI-generated and AI-assisted works are displayed.",
  "settings.content.aiFilter.groupLabel": "AI works filter mode",
  "settings.content.aiFilter.show": "Show",
  "settings.content.aiFilter.mask": "Mask",
  "settings.content.aiFilter.only": "Only",
  "settings.content.blocklist": "Manage blocked users",
  "settings.content.blocklistDesc": "View or unblock artists you have blocked",

  // ── Account (SettingsAccount) ──
  "settings.account.sectionTitle": "Account",
  "settings.account.clearData": "Clear all local data",
  "settings.account.clearDataDesc":
    "Deletes sign-in credentials, image cache, settings, and block and report records",
  "settings.account.deleteAccount": "Delete Pixiv account",
  "settings.account.deleteAccountDesc":
    "Opens Pixiv's official account deletion page. Follow the official steps there.",

  // ── Updates & About (SettingsUpdate) ──
  "settings.update.sectionTitle": "Updates & About",
  "settings.update.autoCheck": "Check for updates on launch",
  "settings.update.autoCheckDesc":
    "Checks for new versions in the background each time the app opens",
  "settings.update.otaAutoDownload": "Auto-download web updates",
  "settings.update.otaAutoDownloadDesc":
    "Downloads silently and applies at next launch. The forced-update minimum version ignores this switch.",
  "settings.update.checkNow": "Check for updates",
  "settings.update.about": "About",
  "settings.update.aboutVersion": "About · v{{version}}",

  // ── Translation (SettingsTranslate) ──
  "settings.translate.sectionTitle": "Translation",
  "settings.translate.byokDesc":
    "Enter your own API key. It is stored encrypted on this device and used only to call the DeepSeek translation service directly (pay per use). Keep the key private. You are responsible for any loss caused by leaking it.",
  "settings.translate.show": "Show",
  "settings.translate.hide": "Hide",
  "settings.translate.clearKey": "Clear saved key",
  "settings.translate.save": "Save",
  "settings.translate.saving": "Saving…",
  "settings.translate.saveFailed": "Save failed. Try again",
  "settings.translate.saved": "Saved",
  "settings.translate.cleared": "Cleared",
  "settings.translate.cacheCleared": "Translation cache cleared",
  "settings.translate.qualityTitle": "Translation quality & thinking",
  "settings.translate.defaultTierLabel":
    "Default translation quality (tier switching arrives in a later version)",
  "settings.translate.tierStandard": "Standard",
  "settings.translate.tierStandardPrice": "v4-flash · ¥1/2 per million",
  "settings.translate.tierPro": "High quality",
  "settings.translate.tierProPrice": "v4-pro · ¥3/6 per million",
  "settings.translate.thinking": "Enable thinking mode",
  "settings.translate.thinkingDesc":
    "Off by default. When on, translation is slower, extra reasoning tokens are billed, and temperature has no effect.",
  "settings.translate.sensitiveTitle": "Sensitive content translation",
  "settings.translate.r18": "Translate R18 content",
  "settings.translate.r18Desc":
    "Off by default. Turning it on requires risk confirmation; the text is sent to your AI provider.",
  "settings.translate.r18g": "Translate R18G content",
  "settings.translate.r18gDesc":
    "Off by default. This is a legal red line; a stronger warning and double confirmation are required.",
  "settings.translate.cacheTitle": "Translation cache",
  "settings.translate.cacheDesc":
    "Caps at 200 novels / ~8MB (LRU). Entries re-translate automatically after the author edits the text. Clearing the cache keeps your saved API key.",
  "settings.translate.clearCache": "Clear translation cache",
  "settings.translate.r18DialogAria": "Enable R18 translation?",
  "settings.translate.r18DialogTitle": "Turn on “Translate R18 content”?",
  "settings.translate.r18DialogBody":
    "This work contains R18 content. Translating sends the text to your chosen AI provider, which may: 1) reject it in content review (failed passages keep the original text); 2) violate the provider's terms of service, leading to warnings, suspension, or bans on your API account; 3) use de-identified content for model training. You assume all of these risks.",
  "settings.translate.cancel": "Cancel",
  "settings.translate.r18DialogConfirm": "I understand. Turn on",
  "settings.translate.r18gDialogAria": "Enable R18G translation?",
  "settings.translate.r18gDialogTitle": "Turn on “Translate R18G content”? (legal red line)",
  "settings.translate.r18gDialogBody":
    "This work contains R18G (extreme) content. Beyond the risks above, this content crosses legal red lines: your API account may be closed, and the provider may report it to regulators or law enforcement. The app provider accepts no liability for any of this.",
  "settings.translate.r18gDialogConfirm": "I understand and accept all risks",

  // ── Export (SettingsExport) ──
  "settings.export.sectionTitle": "Export",
  "settings.export.formatTitle": "Novel export format",
  "settings.export.formatDesc":
    "Used by default when exporting from the detail page. The export panel can override it for a single export without changing this default.",
  "settings.export.contentTitle": "Export content",
  "settings.export.includeMetadata": "Include metadata",
  "settings.export.includeMetadataDesc":
    "Title, author, tags, series, publish date, and original link",
  "settings.export.includeCover": "Include cover",
  "settings.export.includeCoverDesc":
    "Embeds the cover in formats that support images (HTML/PDF/EPUB/DOCX/FB2)",
  "settings.export.includeImages": "Include inline images",
  "settings.export.includeImagesDesc":
    "Embeds Pixiv images from the text; text formats (TXT/MD/RTF) keep image links only",
  "settings.export.formatTxt": "Novel export format TXT",
  "settings.export.formatHtml": "Novel export format HTML",
  "settings.export.formatMd": "Novel export format Markdown",
  "settings.export.formatDocx": "Novel export format Word (.docx)",
  "settings.export.formatPdf": "Novel export format PDF",
  "settings.export.formatEpub": "Novel export format EPUB",
  "settings.export.formatRtf": "Novel export format RTF",
  "settings.export.formatJson": "Novel export format JSON",
  "settings.export.formatFb2": "Novel export format FB2",

  // ── Downloads (SettingsDownload) ──
  "settings.download.sectionTitle": "Downloads",
  "settings.download.manage": "Download manager",
  "settings.download.formatTitle": "Ugoira download format",
  "settings.download.formatDesc":
    "All ugoira export in this format. It can't be set per item. Changes only affect tasks queued afterwards.",

  // ── Client (SettingsClient) ──
  "settings.client.sectionTitle": "Client",
  "settings.client.switchEngine": "Switch rendering engine",
  "settings.client.currentLynx": "Current: Lynx (experimental) · Tap for engine details",
  "settings.client.currentWebview": "Current: WebView · Tap for engine details",

  // ── Sign out (LogoutRow) ──
  "settings.logout.title": "Sign out",
  "settings.logout.desc": "Clears the current sign-in credentials. Other local data is kept.",

  // ── Images & network (SettingsImage) ──
  "settings.image.sectionTitle": "Images & Network",
  "settings.image.listQuality": "List image quality",
  "settings.image.detailQuality": "Detail image quality",
  "settings.image.qualityMedium": "Default",
  "settings.image.qualityHigh": "High",
  "settings.image.qualityOriginal": "Original",
  "settings.image.ugoiraModeTitle": "Ugoira playback mode",
  "settings.image.ugoiraFflate": "fflate (default)",
  "settings.image.ugoiraRange": "Range streaming",
  "settings.image.ugoiraModeDesc":
    "Range streaming fetches frames on demand with lower memory use. Native (WebView) falls back to full loading automatically; playback never interrupts.",
  "settings.image.ugoiraDialogAria": "Switch to Range streaming?",
  "settings.image.ugoiraDialogTitle": "Switch to Range streaming?",
  "settings.image.ugoiraDialogBody1":
    "Range streaming fetches frames on demand with lower memory use. If a Range request fails, playback switches to full loading automatically (native/WebView always switches automatically) without interrupting playback.",
  "settings.image.ugoiraDialogBody2": "After confirming, ugoira will prefer Range streaming.",
  "settings.image.cancel": "Cancel",
  "settings.image.ugoiraDialogConfirm": "Switch",
  "settings.image.cache": "Image cache",
  "settings.image.clearCache": "Clear image cache",
  "settings.image.clearCacheDesc": "Clears cached illustrations and novel covers",
  "settings.image.clearCacheFailed": "Couldn't clear the image cache",
  "settings.image.cacheCleared": "Image cache cleared",
  "settings.image.hostProxy": "Image host proxy",
  "settings.image.hostProxySummary": "{{label}} · {{count}} image hosts",
  "settings.image.hostProxyDefault": "Using the default proxy",
  "settings.image.hostProxyEnable": "Enable image host proxy",

  // ── Network self-check (SettingsNetDiag) ──
  "settings.netdiag.sectionTitle": "Diagnostics",
  "settings.netdiag.entry": "Network self-check",
  "settings.netdiag.desc":
    "Checks local network, DNS, connectivity, TLS, and Pixiv reachability, then produces a copyable, redacted diagnostic report.",

  // ── Clear data / delete account dialogs (SettingsDialogs) ──
  "settings.dialogs.clearAria": "Clear all local data?",
  "settings.dialogs.clearTitle": "Clear all local data?",
  "settings.dialogs.clearBody":
    "This deletes all data the app stored on this device: sign-in credentials, image cache, browsing settings, blocklist, and report records. This can't be undone. Your Pixiv account and its data on Pixiv's servers are not affected.",
  "settings.dialogs.cancel": "Cancel",
  "settings.dialogs.clearConfirm": "Clear all data",
  "settings.dialogs.deleteAria": "Delete Pixiv account?",
  "settings.dialogs.deleteTitle": "Delete Pixiv account?",
  "settings.dialogs.deleteBody":
    "Pictelio is a third-party client and can't delete your Pixiv account directly. Confirming opens Pixiv's official account deletion page. Follow the official steps there.",
  "settings.dialogs.deleteConfirm": "Go to Pixiv",

  // ── WebDAV backup (SettingsWebdav) ──
  "settings.webdav.sectionTitle": "WebDAV backup",
  "settings.webdav.enable": "Enable WebDAV backup",
  "settings.webdav.serverUrl": "Server URL",
  "settings.webdav.httpsWarning": "Non-HTTPS connections can leak credentials",
  "settings.webdav.username": "Username",
  "settings.webdav.password": "Password (stored encrypted)",
  "settings.webdav.dir": "Directory",
  "settings.webdav.backupPassword": "Backup password (optional, encrypts the backup file)",
  "settings.webdav.backupPasswordPlaceholder": "Leave empty to skip encryption",
  "settings.webdav.sensitiveExclude":
    "Excluded sensitive items (checked items stay out of backup files)",
  "settings.webdav.autoBackup": "Auto-backup on launch",
  "settings.webdav.autoBackupDays": "Every {{days}} days",
  "settings.webdav.lastBackupLabel": "Last backup: ",
  "settings.webdav.neverBackedUp": "Never",
  "settings.webdav.action.test": "Test connection",
  "settings.webdav.action.backupNow": "Back up now",
  "settings.webdav.action.restore": "Restore",
  "settings.webdav.action.undoLast": "Undo last restore",
  "settings.webdav.action.loadList": "Loading backup list",
  "settings.webdav.action.prepare": "Reading backup summary",
  "settings.webdav.action.undo": "Undoing restore",
  "settings.webdav.status.testOk": "Connected. {{count}} backups found on the server.",
  "settings.webdav.status.backupOk":
    "Backed up {{name}} ({{bytes}} bytes, {{count}} old backups cleaned up)",
  "settings.webdav.status.backupOkEncrypted":
    "Backed up {{name}} ({{bytes}} bytes, encrypted, {{count}} old backups cleaned up)",
  "settings.webdav.status.noBackups": "No backups on the server yet",
  "settings.webdav.status.skippedLoggedOut":
    "Not signed in; all {{count}} account keys were skipped",
  "settings.webdav.status.skippedOtherAccount":
    "{{count}} keys belonging to other accounts were skipped",
  "settings.webdav.status.restoreOk":
    "Restored the backup from {{time}} ({{applied}} keys written, {{skipped}} skipped; device {{device}}, account {{account}}, sets {{sets}}; {{skippedLabel}})",
  "settings.webdav.status.nothingToUndo": "No emergency snapshot to undo",
  "settings.webdav.status.undoOk": "Rolled back to the state before the restore",
  // Error copy: mirrors WEBDAV_ERROR_MESSAGES semantics (zh stays byte-identical for contract tests)
  "settings.webdav.error.AUTH_FAILED": "Authentication failed. Check your username and password",
  "settings.webdav.error.FORBIDDEN": "The server refused access. Check the directory permissions",
  "settings.webdav.error.NOT_FOUND": "Path not found. Check the server URL and directory",
  "settings.webdav.error.QUOTA_EXCEEDED": "Not enough server storage quota",
  "settings.webdav.error.CONFLICT": "Server file conflict. Try again",
  "settings.webdav.error.NETWORK": "Network interrupted. Check your connection and try again",
  "settings.webdav.error.SERVER": "Server error. Try again later",
  "settings.webdav.error.CRYPTO": "Wrong password or corrupted file",
  "settings.webdav.error.httpStatus": "{{base}} (HTTP {{code}})",
  "settings.webdav.restoreTitle": "Restore WebDAV backup",
  "settings.webdav.restoreEmpty": "No backup files on the server yet",
  "settings.webdav.fileEncrypted": " (encrypted)",
  "settings.webdav.encryptedPrompt":
    "“{{name}}” is encrypted. Enter the backup password to read the summary:",
  "settings.webdav.cancel": "Cancel",
  "settings.webdav.decryptAndPreview": "Decrypt and show summary",
  "settings.webdav.restoreWillApply": "About to restore: {{name}}",
  "settings.webdav.summaryCreatedAt": "Backed up at: {{value}}",
  "settings.webdav.summaryEngine": "Source engine: {{value}}",
  "settings.webdav.summaryAppVersion": "App version: {{value}}",
  "settings.webdav.summaryCounts":
    "{{device}} device keys / {{account}} account keys (current account) / {{sets}} set groups",
  "settings.webdav.summarySkipped": "{{count}} account keys skipped",
  "settings.webdav.summarySkippedLoggedOut": " (not signed in; all account keys skipped)",
  "settings.webdav.summarySkippedOther": " (belonging to another account)",
  "settings.webdav.restoredEncrypted":
    "This backup was encrypted and has been decrypted with the backup password.",
  "settings.webdav.restoreWarning":
    "Restoring overwrites the matching settings on this device (only keys present in the backup). An emergency snapshot is saved automatically beforehand and can be undone.",
  "settings.webdav.back": "Back",
  "settings.webdav.confirmRestore": "Restore",
} as const satisfies Record<SettingsKey, string>;

export default enSettings;
