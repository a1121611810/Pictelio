// 核心层域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
// 按 docs/style-guides/ui-copy.md：sentence case、动词开头 CTA、无 please、术语表（sign in /
// ugoira / novel）、R9 占位符 camelCase 且数量一致。
import type { ZhCoreKey } from "../zh-CN/core";

const enCore = {
  // ── stores/imageHostStore ──
  "core.store.imageHostStore.modeRace": "Concurrent requests",
  "core.store.imageHostStore.modeWeighted": "Load balancing",
  "core.store.imageHostStore.modeFastestIp": "Fastest IP address",
  "core.store.imageHostStore.modeSingle": "Single image host",

  // ── stores/downloadStore ──
  "core.store.downloadStore.executorNotReady": "Downloads unavailable",
  "core.store.downloadStore.nothingToShare": "No downloaded files to share",
  "core.store.downloadStore.sharerNotReady": "Sharing unavailable",

  // ── stores/novelBookmarkStore ──
  "core.store.novelBookmarkStore.notSignedIn": "Not signed in",

  // ── stores/searchStore ──
  "core.store.searchStore.searchFailed": "Search failed. Try again later",

  // ── utils/downloadsViewModel ──
  "core.util.downloadsViewModel.kindUgoira": "Ugoira",
  "core.util.downloadsViewModel.kindNovel": "Novel",
  "core.util.downloadsViewModel.kindPageCount": "{{count}} images",
  "core.util.downloadsViewModel.statusQueued": "Queued",
  "core.util.downloadsViewModel.statusDownloading": "Downloading",
  "core.util.downloadsViewModel.statusPaused": "Paused",
  "core.util.downloadsViewModel.statusStopped": "Stopped",
  "core.util.downloadsViewModel.statusCompleted": "Completed",
  "core.util.downloadsViewModel.statusFailed": "Failed",
  "core.util.downloadsViewModel.statusFailedWithReason": "Failed: {{reason}}",

  // ── utils/capacitorShare ──
  "core.util.capacitorShare.nothingToShare": "No files to share",

  // ── utils/backupService ──
  "core.util.backupService.backupEncrypted":
    "This backup is encrypted. Enter the backup password first",

  // ── utils/backupCore ──
  "core.util.backupCore.notBackupJson": "Not a valid Pictelio backup (JSON parsing failed)",
  "core.util.backupCore.notBackupFormat": "Not a Pictelio backup (format identifier mismatch)",
  "core.util.backupCore.schemaVersionInvalid": "Backup schemaVersion is missing or invalid",
  "core.util.backupCore.schemaTooNew":
    "This backup is from a newer app version (schemaVersion {{current}} > {{supported}}). Update the app to restore it",
  "core.util.backupCore.fieldsInvalid": "Backup fields are missing or have the wrong type",

  // ── primitives/useComments ──
  "core.primitive.useComments.loadFailed": "Couldn't load comments. Try again",
  "core.primitive.useComments.loadMoreFailed": "Couldn't load more",
  "core.primitive.useComments.postFailed": "Couldn't post. Try again",
  "core.primitive.useComments.deleteFailed": "Couldn't delete",

  // ── services/imageHostService ──
  "core.service.imageHostService.nameRequired": "Name can't be empty",
  "core.service.imageHostService.urlRequired": "Proxy URL can't be empty",
  "core.service.imageHostService.urlInvalid": "Enter a valid URL",
  "core.service.imageHostService.protocolUnsupported": "Only http:// or https:// is supported",
  "core.service.imageHostService.pixivDomainRejected":
    "Image host URL can't use an official Pixiv domain",
  "core.service.imageHostService.cleartextHttpRejected":
    "Android blocks cleartext HTTP. Use an https:// mirror",

  // ── services/otaService ──
  "core.service.otaService.noBundleAvailable": "No update package available",

  // ── stores/reportStore (cross-layer: store holds keys, ReportSheet renders via t()) ──
  "core.store.reportStore.reasonPornography": "Pornography",
  "core.store.reportStore.reasonViolence": "Violence",
  "core.store.reportStore.reasonInfringement": "Copyright infringement",
  "core.store.reportStore.reasonSpam": "Spam",
  "core.store.reportStore.reasonOther": "Other",
  "core.store.reportStore.emailSubject": "[Pictelio report] Work ID: {{id}}",
  "core.store.reportStore.emailBody":
    "Work ID: {{id}}\nReason: {{reason}}\n\nAdditional details:\n",

  // ── stores/readerSettingsStore (cross-layer: options hold labelKey, rendered via t()) ──
  "core.store.readerSettings.fontFamilySans": "Sans-serif",
  "core.store.readerSettings.fontFamilySerif": "Serif",
  "core.store.readerSettings.fontFamilySystem": "System",
  "core.store.readerSettings.fontFamilyMono": "Monospace",
  "core.store.readerSettings.fontWeightLight": "Light",
  "core.store.readerSettings.fontWeightRegular": "Regular",
  "core.store.readerSettings.fontWeightMedium": "Medium",
  "core.store.readerSettings.fontWeightSemibold": "Semibold",
  "core.store.readerSettings.fontWeightBold": "Bold",
} as const satisfies Record<ZhCoreKey, string>;

export default enCore;
