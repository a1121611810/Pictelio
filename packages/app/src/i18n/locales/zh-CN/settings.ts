// 设置域（SettingsAppearance 等 settings/ 子组件 + settingsStore 消费的文案）。
// B2 机械抽取（工单 #501）：zh 值 = 抽取前源文案逐字节一致（含 JSX 折行的单空格拼接），测试断言依赖。
const zhSettings = {
  "settings.appearance.sectionTitle": "显示与交互",
  "settings.appearance.theme": "明暗主题",
  "settings.appearance.detailStairs": "详情页楼梯导航",
  "settings.appearance.detailStairsDesc": "在多页作品中显示右侧页码导航条，方便快速跳转",
  "settings.appearance.autoHideNav": "自动隐藏导航栏",
  "settings.appearance.autoHideNavDesc":
    "在个人页与关注列表等页面向下滚动时收起导航栏，上滑时重新显示",
  "settings.appearance.persistScroll": "持久化滚动恢复",
  "settings.appearance.persistScrollDesc":
    "关闭时重新打开应用始终从列表顶部开始（默认）；开启后恢复上次浏览位置",
  "settings.appearance.language": "语言",
  "settings.appearance.followSystem": "跟随系统",
  "settings.appearance.languageDesc": "切换界面显示语言，立即生效",

  // ── 内容与过滤（SettingsContent）──
  "settings.content.sectionTitle": "内容与过滤",
  "settings.content.showR18": "显示 R18 内容",
  "settings.content.showR18Desc": "关闭后列表中不展示敏感内容，需刷新列表生效",
  "settings.content.showR18G": "显示 R-18G 内容",
  "settings.content.showR18GDesc": "关闭后列表中不展示猎奇内容，需刷新列表生效",
  "settings.content.relatedInjection": "相关作品注入",
  "settings.content.relatedInjectionDesc": "从详情返回后，在该作品下方插入一行相关作品推荐",
  "settings.content.aiFilter.title": "AI 作品",
  "settings.content.aiFilter.desc": "控制 AI 生成 / AI 辅助作品的显示方式",
  "settings.content.aiFilter.groupLabel": "AI 作品过滤模式",
  "settings.content.aiFilter.show": "显示",
  "settings.content.aiFilter.mask": "遮罩",
  "settings.content.aiFilter.only": "仅看",
  "settings.content.blocklist": "管理屏蔽列表",
  "settings.content.blocklistDesc": "查看或解除已屏蔽的作者",

  // ── 账户（SettingsAccount）──
  "settings.account.sectionTitle": "账户",
  "settings.account.clearData": "清除所有本地数据",
  "settings.account.clearDataDesc": "删除登录凭证、图片缓存、设置、屏蔽与举报记录",
  "settings.account.deleteAccount": "删除 Pixiv 账号",
  "settings.account.deleteAccountDesc": "打开 Pixiv 官方账号删除页面，按官方流程操作",

  // ── 更新与关于（SettingsUpdate）──
  "settings.update.sectionTitle": "更新与关于",
  "settings.update.autoCheck": "启动时检查更新",
  "settings.update.autoCheckDesc": "每次打开 App 时后台检测新版本",
  "settings.update.otaAutoDownload": "自动下载 Web 更新包",
  "settings.update.otaAutoDownloadDesc": "静默下载并在下次启动生效；强制更新门槛不受此开关影响",
  "settings.update.checkNow": "检查更新",
  "settings.update.about": "关于",
  "settings.update.aboutVersion": "关于 · v{{version}}",

  // ── 翻译设置（SettingsTranslate）──
  "settings.translate.sectionTitle": "翻译设置",
  "settings.translate.byokDesc":
    "填写你自己的 API Key，加密存储于本机，仅用于直连 DeepSeek 翻译服务（按量自付）。 请妥善保管，勿将 key 暴露给他人；泄露造成的损失由你自行承担。",
  "settings.translate.show": "显示",
  "settings.translate.hide": "隐藏",
  "settings.translate.clearKey": "清除已保存的 Key",
  "settings.translate.save": "保存",
  "settings.translate.saving": "保存中…",
  "settings.translate.saveFailed": "保存失败，请重试",
  "settings.translate.saved": "已保存",
  "settings.translate.cleared": "已清除",
  "settings.translate.cacheCleared": "已清除翻译缓存",
  "settings.translate.qualityTitle": "翻译质量与思考",
  "settings.translate.defaultTierLabel": "默认翻译质量（档位切换入口后续版本提供）",
  "settings.translate.tierStandard": "标准",
  "settings.translate.tierStandardPrice": "v4-flash · ¥1/2 每百万",
  "settings.translate.tierPro": "高质量",
  "settings.translate.tierProPrice": "v4-pro · ¥3/6 每百万",
  "settings.translate.thinking": "启用思考模式",
  "settings.translate.thinkingDesc":
    "默认关。开启后翻译更慢、产生额外 reasoning token 计费、temperature 不生效",
  "settings.translate.sensitiveTitle": "敏感内容翻译",
  "settings.translate.r18": "翻译 R18 内容",
  "settings.translate.r18Desc": "默认关。开启需确认风险，正文将发送至 AI 服务商",
  "settings.translate.r18g": "翻译 R18G 内容",
  "settings.translate.r18gDesc": "默认关。法律红线，需更强警告与二次确认",
  "settings.translate.cacheTitle": "译文缓存",
  "settings.translate.cacheDesc":
    "LRU 200 章 / ~8MB 上限，作者修改正文后自动失效重翻。清除不影响已保存的 API Key。",
  "settings.translate.clearCache": "清除翻译缓存",
  "settings.translate.r18DialogAria": "开启 R18 翻译？",
  "settings.translate.r18DialogTitle": "开启「翻译 R18 内容」？",
  "settings.translate.r18DialogBody":
    "该作品包含 R18 内容。翻译需将正文发送至你选择的 AI 服务商，可能：① 被内容审核拒绝（失败段落保留原文）；② 违反服务商使用条款，导致你的 API 账号被警告、暂停或封禁；③ 内容可能被去标识化后用于模型训练。所有风险由你自行承担。",
  "settings.translate.cancel": "取消",
  "settings.translate.r18DialogConfirm": "我已了解并开启",
  "settings.translate.r18gDialogAria": "开启 R18G 翻译？",
  "settings.translate.r18gDialogTitle": "开启「翻译 R18G 内容」？（法律红线）",
  "settings.translate.r18gDialogBody":
    "该作品包含 R18G（极端）内容。除上述风险外，此类内容违反法律法规红线，可能导致你的 API 账号被关闭，服务商可能向主管部门/执法机构报告。App 提供方不承担由此产生的任何责任。",
  "settings.translate.r18gDialogConfirm": "我已了解并承担全部风险",

  // ── 导出（SettingsExport）──
  "settings.export.sectionTitle": "导出",
  "settings.export.formatTitle": "小说导出格式",
  "settings.export.formatDesc":
    "详情页导出时默认使用该格式；导出面板可临时覆盖本次格式，不影响此默认值。",
  "settings.export.contentTitle": "导出内容",
  "settings.export.includeMetadata": "包含元数据",
  "settings.export.includeMetadataDesc": "标题、作者、标签、系列、发布日期与原文链接",
  "settings.export.includeCover": "包含封面",
  "settings.export.includeCoverDesc": "在支持图片的格式（HTML/PDF/EPUB/DOCX/FB2）中嵌入封面",
  "settings.export.includeImages": "包含正文插图",
  "settings.export.includeImagesDesc":
    "嵌入正文中的 Pixiv 插图；文本格式（TXT/MD/RTF）仅保留图片链接",
  "settings.export.formatTxt": "小说导出格式 TXT",
  "settings.export.formatHtml": "小说导出格式 HTML",
  "settings.export.formatMd": "小说导出格式 Markdown",
  "settings.export.formatDocx": "小说导出格式 Word (.docx)",
  "settings.export.formatPdf": "小说导出格式 PDF",
  "settings.export.formatEpub": "小说导出格式 EPUB",
  "settings.export.formatRtf": "小说导出格式 RTF",
  "settings.export.formatJson": "小说导出格式 JSON",
  "settings.export.formatFb2": "小说导出格式 FB2",

  // ── 下载（SettingsDownload）──
  "settings.download.sectionTitle": "下载",
  "settings.download.manage": "下载管理",
  "settings.download.formatTitle": "动图下载格式",
  "settings.download.formatDesc":
    "所有动图统一使用该格式导出，不可逐图设置。修改设置只影响之后加入队列的任务。",

  // ── 客户端（SettingsClient）──
  "settings.client.sectionTitle": "客户端",
  "settings.client.switchEngine": "切换渲染引擎",
  "settings.client.currentLynx": "当前：Lynx（实验性）· 点击查看引擎说明",
  "settings.client.currentWebview": "当前：WebView · 点击查看引擎说明",

  // ── 退出登录（LogoutRow）──
  "settings.logout.title": "退出登录",
  "settings.logout.desc": "清除当前登录凭证，不会删除本地其他数据",

  // ── 图片与网络（SettingsImage）──
  "settings.image.sectionTitle": "图片与网络",
  "settings.image.listQuality": "列表画质",
  "settings.image.detailQuality": "详情画质",
  "settings.image.qualityMedium": "默认",
  "settings.image.qualityHigh": "高清",
  "settings.image.qualityOriginal": "原图",
  "settings.image.ugoiraModeTitle": "动图播放方案",
  "settings.image.ugoiraFflate": "fflate（默认）",
  "settings.image.ugoiraRange": "Range 流式",
  "settings.image.ugoiraModeDesc":
    "Range 流式按需取帧、内存更低；原生端（WebView）自动降级为全量，失败不中断播放。",
  "settings.image.ugoiraDialogAria": "切换到 Range 流式？",
  "settings.image.ugoiraDialogTitle": "切换到 Range 流式？",
  "settings.image.ugoiraDialogBody1":
    "Range 流式按需取帧、内存占用更低；若 Range 请求失败将自动切换为 fflate 全量播放（原生端/WebView 恒走自动切换），不中断播放。",
  "settings.image.ugoiraDialogBody2": "确认切换后，动图将优先使用 Range 流式方案。",
  "settings.image.cancel": "取消",
  "settings.image.ugoiraDialogConfirm": "确认切换",
  "settings.image.cache": "图片缓存",
  "settings.image.clearCache": "清除图片缓存",
  "settings.image.clearCacheDesc": "清理已下载的插画和小说封面缓存",
  "settings.image.clearCacheFailed": "清除图片缓存失败",
  "settings.image.cacheCleared": "图片缓存已清除",
  "settings.image.hostProxy": "图床代理",
  "settings.image.hostProxySummary": "{{label}} · {{count}} 个图床",
  "settings.image.hostProxyDefault": "使用默认代理",
  "settings.image.hostProxyEnable": "启用图床代理",

  // ── 网络自检（SettingsNetDiag）──
  "settings.netdiag.sectionTitle": "诊断",
  "settings.netdiag.entry": "网络自检",
  "settings.netdiag.desc":
    "检测本机网络、DNS、连接、TLS 与 Pixiv 可达性，并生成可复制的脱敏诊断报告。",

  // ── 数据清理/删号确认（SettingsDialogs）──
  "settings.dialogs.clearAria": "清除所有本地数据？",
  "settings.dialogs.clearTitle": "清除所有本地数据？",
  "settings.dialogs.clearBody":
    "这将删除本应用在本机保存的全部数据，包括：登录凭证、图片缓存、浏览设置、屏蔽列表、举报记录。此操作不可恢复，但不会删除你的 Pixiv 账号及其在 Pixiv 服务器上的数据。",
  "settings.dialogs.cancel": "取消",
  "settings.dialogs.clearConfirm": "确认清除",
  "settings.dialogs.deleteAria": "删除 Pixiv 账号？",
  "settings.dialogs.deleteTitle": "删除 Pixiv 账号？",
  "settings.dialogs.deleteBody":
    "Pictelio 是第三方客户端，无法直接删除你的 Pixiv 账号。点击确认将打开 Pixiv 官方账号删除页面，请按官方流程操作。",
  "settings.dialogs.deleteConfirm": "前往 Pixiv",

  // ── WebDAV 备份（SettingsWebdav）──
  "settings.webdav.sectionTitle": "WebDAV 备份",
  "settings.webdav.enable": "启用 WebDAV 备份",
  "settings.webdav.serverUrl": "服务器地址",
  "settings.webdav.httpsWarning": "非 HTTPS 连接存在泄露风险（spec §7）",
  "settings.webdav.username": "用户名",
  "settings.webdav.password": "密码（加密存储）",
  "settings.webdav.dir": "目录",
  "settings.webdav.backupPassword": "备份密码（可选，加密备份文件）",
  "settings.webdav.backupPasswordPlaceholder": "留空则不加密",
  "settings.webdav.sensitiveExclude": "敏感项排除（勾选后不进入备份文件）",
  "settings.webdav.autoBackup": "启动时自动备份",
  "settings.webdav.autoBackupDays": "每 {{days}} 天",
  "settings.webdav.lastBackupLabel": "上次备份：",
  "settings.webdav.neverBackedUp": "从未备份",
  "settings.webdav.action.test": "连接测试",
  "settings.webdav.action.backupNow": "立即备份",
  "settings.webdav.action.restore": "恢复",
  "settings.webdav.action.undoLast": "撤销上次恢复",
  "settings.webdav.action.loadList": "读取备份列表",
  "settings.webdav.action.prepare": "读取备份摘要",
  "settings.webdav.action.undo": "撤销恢复",
  "settings.webdav.status.testOk": "连接成功，远端已有 {{count}} 份备份",
  "settings.webdav.status.backupOk": "已备份 {{name}}（{{bytes}} 字节，清理旧档 {{count}} 份）",
  "settings.webdav.status.backupOkEncrypted":
    "已备份 {{name}}（{{bytes}} 字节，已加密，清理旧档 {{count}} 份）",
  "settings.webdav.status.noBackups": "远端暂无备份",
  "settings.webdav.status.skippedLoggedOut": "未登录，账号级键全部跳过 {{count}} 项",
  "settings.webdav.status.skippedOtherAccount": "跳过异账号键 {{count}} 项",
  "settings.webdav.status.restoreOk":
    "已恢复 {{time}} 的备份（写入 {{applied}} 项，跳过 {{skipped}} 项；设备级 {{device}}，账号级 {{account}}，sets {{sets}}；{{skippedLabel}}）",
  "settings.webdav.status.nothingToUndo": "没有可撤销的应急快照",
  "settings.webdav.status.undoOk": "已回滚到恢复前的本地状态",
  // 错误文案：zh 与 utils/backupCore.ts WEBDAV_ERROR_MESSAGES 逐字一致（备份契约测试钉原文）
  "settings.webdav.error.AUTH_FAILED": "认证失败，请检查用户名与密码",
  "settings.webdav.error.FORBIDDEN": "服务器拒绝访问，请检查目录权限",
  "settings.webdav.error.NOT_FOUND": "路径不存在，请检查服务器地址与目录",
  "settings.webdav.error.QUOTA_EXCEEDED": "服务器配额不足",
  "settings.webdav.error.CONFLICT": "服务器文件冲突，请重试",
  "settings.webdav.error.NETWORK": "网络中断，请检查网络后重试",
  "settings.webdav.error.SERVER": "服务器返回错误，请稍后重试",
  "settings.webdav.error.CRYPTO": "密码错误或文件损坏",
  "settings.webdav.error.httpStatus": "{{base}}（HTTP {{code}}）",
  "settings.webdav.restoreTitle": "恢复 WebDAV 备份",
  "settings.webdav.restoreEmpty": "远端暂无备份文件",
  "settings.webdav.fileEncrypted": "（加密）",
  "settings.webdav.encryptedPrompt": "「{{name}}」已加密，请输入备份密码以读取摘要：",
  "settings.webdav.cancel": "取消",
  "settings.webdav.decryptAndPreview": "解密并查看摘要",
  "settings.webdav.restoreWillApply": "将恢复：{{name}}",
  "settings.webdav.summaryCreatedAt": "备份时间：{{value}}",
  "settings.webdav.summaryEngine": "来源引擎：{{value}}",
  "settings.webdav.summaryAppVersion": "应用版本：{{value}}",
  "settings.webdav.summaryCounts":
    "设备级 {{device}} 项 / 账号级（当前账号）{{account}} 项 / sets {{sets}} 组",
  "settings.webdav.summarySkipped": "跳过账号级键 {{count}} 项",
  "settings.webdav.summarySkippedLoggedOut": "（当前未登录，账号级键全部跳过）",
  "settings.webdav.summarySkippedOther": "（非当前账号）",
  "settings.webdav.restoredEncrypted": "该备份已加密，已用备份密码解密。",
  "settings.webdav.restoreWarning":
    "恢复会覆盖本机对应设置（仅覆盖备份中存在的键）；恢复前会自动保存应急快照，可撤销。",
  "settings.webdav.back": "返回",
  "settings.webdav.confirmRestore": "确认恢复",
} as const;

export default zhSettings;
export type SettingsKey = keyof typeof zhSettings;
