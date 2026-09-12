// 核心层域（stores/utils/primitives/services 的用户可见文案，工单 #506 B7）。
// zh 值 = 抽取前源文案逐字节一致（含模板串拼接形态），测试断言依赖。
// 白名单（不抽，见工单回报）：utils/prompts.ts（LLM prompt 非 UI 文案）、
// readerSettingsStore FONT_FAMILIES/FONT_WEIGHTS label、reportStore REPORT_REASON_LABELS
// （模块加载期常量，消费方在 components 层渲染，跨批移交）、WEBDAV_ERROR_MESSAGES（契约常量，
// UI 渲染走 settings.webdav.error.*，契约测试钉原文）。
const zhCore = {
  // ── stores/imageHostStore ──
  "core.store.imageHostStore.modeRace": "并发请求",
  "core.store.imageHostStore.modeWeighted": "负载均衡",
  "core.store.imageHostStore.modeFastestIp": "最快 IP 地址",
  "core.store.imageHostStore.modeSingle": "单一图床",

  // ── stores/downloadStore ──
  "core.store.downloadStore.executorNotReady": "下载执行器未接入",
  "core.store.downloadStore.nothingToShare": "没有可分享的已下载文件",
  "core.store.downloadStore.sharerNotReady": "分享功能未接入",

  // ── stores/novelBookmarkStore ──
  "core.store.novelBookmarkStore.notSignedIn": "未登录",

  // ── stores/searchStore ──
  "core.store.searchStore.searchFailed": "搜索失败，请稍后重试",

  // ── utils/downloadsViewModel ──
  "core.util.downloadsViewModel.kindUgoira": "动图",
  "core.util.downloadsViewModel.kindNovel": "小说",
  "core.util.downloadsViewModel.kindPageCount": "{{count}} 张",
  "core.util.downloadsViewModel.statusQueued": "排队中",
  "core.util.downloadsViewModel.statusDownloading": "下载中",
  "core.util.downloadsViewModel.statusPaused": "已暂停",
  "core.util.downloadsViewModel.statusStopped": "已停止",
  "core.util.downloadsViewModel.statusCompleted": "已完成",
  "core.util.downloadsViewModel.statusFailed": "失败",
  "core.util.downloadsViewModel.statusFailedWithReason": "失败：{{reason}}",

  // ── utils/capacitorShare ──
  "core.util.capacitorShare.nothingToShare": "没有可分享的文件",

  // ── utils/backupService ──
  "core.util.backupService.backupEncrypted": "该备份已加密，请先输入备份密码",

  // ── utils/backupCore（parseSnapshot 拒绝边界，经 SettingsWebdav errorMessage 原样展示）──
  "core.util.backupCore.notBackupJson": "不是有效的 Pictelio 备份（JSON 解析失败）",
  "core.util.backupCore.notBackupFormat": "不是 Pictelio 备份（format 标识不符）",
  "core.util.backupCore.schemaVersionInvalid": "备份 schemaVersion 缺失或非法",
  "core.util.backupCore.schemaTooNew":
    "备份来自更新版本的应用（schemaVersion {{current}} > {{supported}}），请升级后恢复",
  "core.util.backupCore.fieldsInvalid": "备份字段缺失或类型不符",

  // ── primitives/useComments ──
  "core.primitive.useComments.loadFailed": "加载评论失败，请重试",
  "core.primitive.useComments.loadMoreFailed": "加载更多失败",
  "core.primitive.useComments.postFailed": "发送失败，请重试",
  "core.primitive.useComments.deleteFailed": "删除失败",

  // ── services/imageHostService ──
  "core.service.imageHostService.nameRequired": "名称不能为空",
  "core.service.imageHostService.urlRequired": "代理 URL 不能为空",
  "core.service.imageHostService.urlInvalid": "请输入有效的 URL",
  "core.service.imageHostService.protocolUnsupported": "仅支持 http:// 或 https:// 协议",
  "core.service.imageHostService.pixivDomainRejected": "图床 URL 不能直接使用 Pixiv 官方域名",
  "core.service.imageHostService.cleartextHttpRejected":
    "Android 禁止明文 HTTP，请使用 https:// 镜像",

  // ── services/otaService ──
  "core.service.otaService.noBundleAvailable": "无可用更新包",
} as const;

export default zhCore;
export type ZhCoreKey = keyof typeof zhCore;
