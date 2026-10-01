<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'me' })
import { ref, computed, onMounted, onUnmounted, onActivated } from 'vue'
import { storeToRefs } from 'pinia'
import { navigate, resetHistory, ensureAuth } from '../router'
import { useGlobalFabStore } from '../stores/globalFab'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore, type AiFilterMode } from '../stores/settingsStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useWatchLaterStore } from '../stores/watchLaterStore'
import type { ImageQuality } from '../utils/imageQuality'
import type { UgoiraExtractMode } from '../api/ugoira'
import { buildSaveFileNameFromTemplate, DEFAULT_DOWNLOAD_TEMPLATE } from '../utils/galleryDownload'
import { proxyImageUrl } from '../utils/imageUrl'
import { ME_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import AppIcon from '../components/AppIcon.vue'
import GlassCard from '../components/GlassCard.vue'
import SettingsEndpoint from '../components/SettingsEndpoint.vue'
import M3Switch from '../components/M3Switch.vue'
import M3SegmentedButton, { type M3SegmentOption } from '../components/M3SegmentedButton.vue'
import { appearanceClasses } from '../utils/appearanceClasses'
import type { DarkModeId } from '../utils/darkMode'
import {
  createLynxBackupDeps,
  createLynxBackupWiring,
  clearPreRestoreSnapshot,
  loadPreRestoreSnapshot,
  undoLastRestore,
} from '../services/backupWiring'
import { isNativeMode } from '../api/client'
import {
  RATE_LIMIT_BASE_DELAY_MS_OPTIONS,
  RATE_LIMIT_MAX_DELAY_MS_OPTIONS,
  RATE_LIMIT_MAX_RETRIES_OPTIONS,
} from '../api/rateLimitBackoff'
import {
  applyPreparedRestore,
  backupNow,
  listBackups,
  prepareRestore,
  testConnection,
  type BackupFileInfo,
  type PreparedRestore,
} from '../utils/backupService'
import { WEBDAV_ERROR_MESSAGES } from '../utils/backupCore'
import { WebDavError } from '../utils/webDavBridge'
import {
  loadBackupPassword,
  loadWebdavPassword,
  saveBackupPassword,
  saveWebdavPassword,
} from '../utils/webdavCredentials'
import { t, locale } from '../i18n'
import { INPUT_PLACEHOLDER_COLOR } from '../utils/lynxPlatformColors'

const auth = useAuthStore()
const settings = useSettingsStore()
// 通知角标（ADR-0188 D7 / #728）：Me 挂载静默刷新未读，行尾圆点数据源
const notificationStore = useNotificationStore()
// 稍后看计数徽标数据源（ADR-0191 D5 / #753 T4）
const watchLaterStore = useWatchLaterStore()
const { showR18, showR18G, aiFilterMode, ugoiraMode, ugoiraDownloadFormat, detailQuality, themeColor, darkMode, resolvedDark, language, novelExportFormat, novelExportOptions, relatedInjection, rankingEntry, novelIntroFirst, fullscreenMode, downloadByAuthorDir, rateLimitBackoffEnabled, rateLimitMaxRetries, rateLimitBaseDelayMs, rateLimitMaxDelayMs } = storeToRefs(settings)



/** 全屏模式开关（spec docs/specs/lynx-systembars.md D5）：一键翻转 + 原生即时切换（setter 内） */
function toggleFullscreenMode() {
  settings.setFullscreenMode(!fullscreenMode.value)
}

// ─── 限流退避四参数（ADR-0199 D4 / #779）：网络组开关 + 三档位行（设备级 setter 自带落盘
//     与组装注入 client 即时生效）；档位集合 = api/rateLimitBackoff.ts 单一事实源常量 ───

/** 限流退避开关（一键翻转范式）：关闭后 429 立即报错零重试 */
function toggleRateLimitBackoff() {
  settings.setRateLimitBackoffEnabled(!rateLimitBackoffEnabled.value)
}

/** 档位选择（镜像 pickWebdavAutoBackupDays 范式） */
function pickRateLimitMaxRetries(retries: number): void {
  settings.setRateLimitMaxRetries(retries)
}

function pickRateLimitBaseDelayMs(ms: number): void {
  settings.setRateLimitBaseDelayMs(ms)
}

function pickRateLimitMaxDelayMs(ms: number): void {
  settings.setRateLimitMaxDelayMs(ms)
}

/** 档位毫秒 → 秒显示值（500→0.5、1000→1、…、60000→60；单一换算点供两个 delay 行复用） */
function toSeconds(ms: number): number {
  return ms / 1000
}

// ─── WebDAV 备份（spec docs/specs/webdav-backup.md §7；仅原生 LynxView 渲染，§2）───
const webdavAvailable = isNativeMode()
const webdavBusy = ref<string | null>(null)
const webdavStatus = ref('')
const webdavError = ref('')
const webdavLoginPassword = ref('')
const webdavBackupPassword = ref('')
const webdavLastBackupLabel = ref('')
const webdavHasPreRestore = ref(false)
const webdavFiles = ref<BackupFileInfo[]>([])
const webdavShowRestore = ref(false)
const webdavSelected = ref<BackupFileInfo | null>(null)
const webdavPrepared = ref<PreparedRestore | null>(null)
const webdavNeedsPassword = ref(false)
const webdavPromptPassword = ref('')
const webdavRestoreError = ref('')
const webdavSensitiveKeys = ref<string[]>([])

/** 错误分类 → 用户文案（spec §5；与 app 侧 SettingsWebdav 同语义） */
function webdavErrorMessage(err: unknown): string {
  if (err instanceof WebDavError) {
    const base = WEBDAV_ERROR_MESSAGES[err.kind] ?? err.message
    // spec §5「其他（含原始状态码）」，与 app 侧 SettingsWebdav 同语义
    // i18n: 拼接时快照（瞬态）
    return err.kind === 'SERVER' && err.statusCode > 0
      ? `${base}${t('me.webdav.httpStatusSuffix', { status: err.statusCode })}`
      : base
  }
  if (err instanceof Error) return err.message
  return String(err)
}

async function runWebdav(label: string, action: () => Promise<string>): Promise<void> {
  webdavBusy.value = label
  webdavStatus.value = ''
  webdavError.value = ''
  try {
    webdavStatus.value = await action()
  } catch (e) {
    console.warn('[Me] WebDAV ' + label + ' 失败', e)
    webdavError.value = webdavErrorMessage(e)
  } finally {
    webdavBusy.value = null
  }
}

async function loadWebdavCredentials(): Promise<void> {
  webdavLoginPassword.value = (await loadWebdavPassword()) ?? ''
  webdavBackupPassword.value = (await loadBackupPassword()) ?? ''
  webdavHasPreRestore.value = (await loadPreRestoreSnapshot()) !== null
  // M3：敏感项候选 = 当前账号级键（show_r18_* / show_r18g_* / ai_filter_mode_* / mute_tags_*——
  // 静音词表为账号级内容设置，ADR-0187 D1 进备份域后同列敏感候选）
  const raw = await settings.exportRawValues()
  webdavSensitiveKeys.value = Object.keys(raw).filter(
    (k) => k.startsWith('show_r18_') || k.startsWith('show_r18g_') || k.startsWith('ai_filter_mode_') || k.startsWith('mute_tags_'),
  )
}

/** M1：v-model 直改 ref 不落盘——@input 后追加 setter 调用（v-model 先赋值，setter 幂等） */
function onWebdavFieldInput(kind: 'url' | 'username' | 'dir', data: { detail?: { value?: string } }): void {
  const value = data?.detail?.value
  if (typeof value !== 'string') return
  if (kind === 'url') settings.setWebdavUrl(value)
  else if (kind === 'username') settings.setWebdavUsername(value)
  else settings.setWebdavDir(value)
}

// ─── MD3 filled text field 状态（ADR-0209 决策 1/2；本文件 7 处 <input> 同构改造）───
// 官方规格回源（ADR-0209 决策 1，勿凭记忆改）：容器 56dp、顶 4dp / 底 0dp 圆角、
// 底部指示条未聚焦 1px on-surface-variant → 聚焦 2px primary、
// label 静止 body-large + on-surface-variant → 浮动态 body-small + primary。
//
// label 浮动用 bindfocus / bindblur **事件**驱动，不依赖 `:focus` 伪类：
// ADR-0207 决策 5 已真机实证该伪类在 Lynx 引擎不匹配（阳性对照 `:active` 生效而
// 这两类无任何变化），而 Lynx `<input>` 官方支持 bindfocus / bindblur
// （Android / iOS / Harmony，since 3.4；本项目 Lynx SDK 4.0.1 满足）。
// 来源：https://lynxjs.org/3.6/api/elements/built-in/input 的 Events 段。
//
// 竞态防护（AGENTS.md 硬约束 3）：blur 与 input 会竞态（失焦瞬间仍有按键在途）。
// 因此浮动态**不存派生布尔**，而是每次由 (focus, value) 两个活数据源现算——
// input 与 blur 无论谁先到都收敛到同一表达式，不存在「旧值覆盖新值」的窗口。
// 同理 focus 用**按字段 id 分槽**的记录而非单一共享布尔：A 的 blur 晚于 B 的 focus
// 到达时不会误清 B 的聚焦态（单布尔的经典反模式）。
//
// ⚠️ @lynx-js/types 未在本仓落地 ⇒ vue-tsc 对 Lynx 元素属性零校验，写错属性名不会
// 报错、只会在真机静默失效（ADR-0209 决策 2 前提风险）。合规由单测 + 真机承担。
const fieldFocus = ref<Record<string, boolean>>({})

/** 记录某字段的聚焦态（@focus → true / @blur → false） */
function setFieldFocus(id: string, focused: boolean): void {
  fieldFocus.value[id] = focused
}

/** 官方语义：label 浮动态 = 聚焦中 或 值非空（见上方竞态防护说明） */
function isFieldFloating(id: string, value: string): boolean {
  return fieldFocus.value[id] === true || value !== ''
}

/* 底部指示条分两层承载，**刻意不用互斥类对**（历史实现 fieldIndicatorClass 已删）：
 *  ① 未聚焦 1px + on-surface-variant 写在 input 的**静态** class（官方 active-indicator-color，
 *     不是 outline-variant —— 后者是 outlined 变体的色，见 ADR-0209 决策 1）；
 *  ② 聚焦 2px + primary 是 input 之后的**独立 <view>** 覆盖（见各字段下的 h-[2px] bg-primary）。
 * 换成互斥类对（同一个 CSS 属性上叠 border-b-[1px] 与 border-b-[2px]）会让胜负取决于
 * Tailwind 产物里的**声明顺序** —— 实测 `.border-b-primary` 排在
 * `.border-b-surface-on-variant` **之前**，颜色侧会静默停在未聚焦色。
 * 这与 AGENTS.md 点名的「写错层级 = 死类名 / 静默无样式」是同一族陷阱。
 * 覆盖元素的 2px 叠在 1px 之上，视觉即「指示条加粗转主色」。 */

/** placeholder 可见性（真机实证修）：**聚焦中**才显示 placeholder。
 *  静止态由 label 承担文案；有值但未聚焦时 label 已浮到顶部、内容即输入值，
 *  再叠一层 placeholder 会得到「目录 / 目录（默认 Pictelio/backup）」双行
 *  （2026-10-01 emulator-5554 实测）。故判据是**聚焦**（`isFieldFloating` 含「有值」
 *  那一支，语义上不对——placeholder 的职责是「提示可输入什么」，值已存在时提示无意义）。 */
function isPlaceholderShown(id: string): boolean {
  return fieldFocus.value[id] === true
}

/** label 视觉：静止 body-large + on-surface-variant → 浮动态 body-small + primary */
function fieldLabelClass(id: string, value: string): string {
  return isFieldFloating(id, value) ? 'text-body-small text-primary' : 'text-body-large text-surface-on-variant'
}

/** label 行程：静止垂直居中于 56dp 容器 / 浮动态贴顶 */
function fieldLabelWrapClass(id: string, value: string): string {
  return isFieldFloating(id, value) ? 'pt-[1.067vw]' : 'h-[14.933vw]'
}

/** 输入文字避让：浮动态留顶部 padding（不被 label 压住）/ 静止时垂直居中不留白 */
function fieldInputPadClass(id: string, value: string): string {
  return isFieldFloating(id, value) ? 'pt-[5.333vw]' : ''
}

/** M3：敏感项排除勾选切换（持久化，spec §7） */
function toggleWebdavExcluded(key: string): void {
  const next = settings.webdavExcludedKeys.includes(key)
    ? settings.webdavExcludedKeys.filter((k) => k !== key)
    : [...settings.webdavExcludedKeys, key]
  settings.setWebdavExcludedKeys(next)
}

async function saveWebdavCredentials(): Promise<void> {
  await saveWebdavPassword(webdavLoginPassword.value)
  await saveBackupPassword(webdavBackupPassword.value)
}

function toggleWebdavEnabled(): void {
  const next = !settings.webdavEnabled
  settings.setWebdavEnabled(next)
  if (next) void loadWebdavCredentials()
}

function toggleWebdavAutoBackup(): void {
  settings.setWebdavAutoBackup(!settings.webdavAutoBackup)
}

function pickWebdavAutoBackupDays(days: number): void {
  settings.setWebdavAutoBackupDays(days)
}

function refreshWebdavLastBackupLabel(): void {
  webdavLastBackupLabel.value =
    settings.webdavLastBackup === ''
      ? t('me.webdav.neverBackedUp') // i18n: 赋值时快照（瞬态）
      : new Date(settings.webdavLastBackup).toLocaleString(locale.value === 'en' ? 'en-US' : 'zh-CN')
}

function onWebdavTest(): void {
  void runWebdav(t('me.webdav.action.test'), async () => {
    // i18n: busy 标签赋值时快照（瞬态）
    await saveWebdavCredentials()
    const { fileCount } = await testConnection(createLynxBackupDeps())
    return t('me.webdav.testOk', { count: fileCount }) // i18n: 赋值时快照（瞬态）
  })
}

function onWebdavBackup(): void {
  void runWebdav(t('me.webdav.action.backup'), async () => {
    // i18n: busy 标签赋值时快照（瞬态）
    await saveWebdavCredentials()
    const r = await backupNow(createLynxBackupDeps())
    settings.setWebdavLastBackup(new Date().toISOString())
    refreshWebdavLastBackupLabel()
    await clearPreRestoreSnapshot()
    webdavHasPreRestore.value = false
    return t('me.webdav.backupDone', {
      name: r.fileName,
      size: r.bytes,
      encrypted: r.encrypted ? t('me.webdav.encryptedSuffix') : '',
    }) // i18n: 赋值时快照（瞬态）
  })
}

function onWebdavOpenRestore(): void {
  void runWebdav(t('me.webdav.action.listBackups'), async () => {
    // i18n: busy 标签赋值时快照（瞬态）
    await saveWebdavCredentials()
    webdavFiles.value = await listBackups(createLynxBackupDeps())
    webdavSelected.value = null
    webdavPrepared.value = null
    webdavRestoreError.value = ''
    webdavShowRestore.value = true
    return webdavFiles.value.length === 0 ? t('me.webdav.noRemoteBackups') : '' // i18n: 赋值时快照（瞬态）
  })
}

/** S2/S7：选档后先准备（下载→解密→解析→摘要），确认前零写回 */
function onWebdavSelectFile(file: BackupFileInfo): void {
  webdavSelected.value = file
  webdavPrepared.value = null
  webdavRestoreError.value = ''
  if (file.encrypted && webdavBackupPassword.value === '') {
    webdavNeedsPassword.value = true
    return
  }
  webdavNeedsPassword.value = false
  void prepareWebdavSelected(file)
}

async function prepareWebdavSelected(fileArg?: BackupFileInfo): Promise<void> {
  const file = fileArg ?? webdavSelected.value
  if (file === null) return
  webdavBusy.value = t('me.webdav.action.readSummary') // i18n: 赋值时快照（瞬态）
  webdavRestoreError.value = ''
  try {
    webdavPrepared.value = await prepareRestore(
      createLynxBackupDeps(),
      file,
      webdavNeedsPassword.value ? webdavPromptPassword.value : undefined,
    )
  } catch (e) {
    console.warn('[Me] 读取备份摘要失败', e)
    webdavRestoreError.value = webdavErrorMessage(e)
  } finally {
    webdavBusy.value = null
  }
}

function onWebdavRestore(): void {
  const prepared = webdavPrepared.value
  if (prepared === null) return
  void runWebdav(t('me.webdav.action.restore'), async () => {
    // i18n: busy 标签赋值时快照（瞬态）
    try {
      const result = await applyPreparedRestore(createLynxBackupDeps(), prepared)
      webdavShowRestore.value = false
      const uid = auth.currentUser?.id ?? null
      const skippedLabel =
        uid === null
          ? t('me.webdav.restoreSkipSignedOut', { count: prepared.plan.skippedAccountKeys.length })
          : t('me.webdav.restoreSkipOtherAccount', { count: prepared.plan.skippedAccountKeys.length }) // i18n: 快照（瞬态）
      return t('me.webdav.restoreDone', {
        createdAt: prepared.summary.createdAt,
        applied: result.applied.length,
        skipped: result.skipped.length,
        skippedDetail: skippedLabel,
      }) // i18n: 赋值时快照（瞬态）
    } finally {
      // S4：写回中途失败也必须暴露可回滚入口
      webdavHasPreRestore.value = (await loadPreRestoreSnapshot()) !== null
    }
  })
}

function onWebdavUndo(): void {
  void runWebdav(t('me.webdav.action.undoRestore'), async () => {
    // i18n: busy 标签赋值时快照（瞬态）
    const ok = await undoLastRestore(createLynxBackupWiring())
    if (!ok) return t('me.webdav.nothingToUndo') // i18n: 赋值时快照（瞬态）
    return t('me.webdav.undone') // i18n: 赋值时快照（瞬态）
  })
}

// 启动时自动备份（T8）已移至 router 启动钩子（settings hydrate 之后），
// 此处不再触发——避免「用户未打开 Me 页则永不执行」与 hydration 竞态。

// ─── 全局放射 FAB 桥（ADR-0120）：注册空动作（内环空 = 仅外环导航），卸载时注销 ───
let unreg: (() => void) | undefined
// 角标刷新挂 onActivated 而非 onMounted：Me 在 App.vue KeepAlive include 内，
// onMounted 每会话仅触发一次，会话内新通知到达后角标无法 0→1（code-review Round 2 F3）；
// onActivated 首挂载与每次重入均触发，恰好覆盖原意图。
onActivated(() => {
  // 通知未读角标静默刷新（ADR-0188 D7 lynx 侧刷新时机）：失败 warn、不影响页面（store 内部兜底）
  void notificationStore.refreshUnreadBadge()
})
onMounted(async () => {
  unreg = useGlobalFabStore().usePage('me', {})
  await ensureAuth()
  refreshWebdavLastBackupLabel()
  if (settings.webdavEnabled) await loadWebdavCredentials()
  // 命名模板输入框对齐 store（loadSettings 为异步，晚于本页挂载完成时以装载结果为准）
  templateInput.value = settings.downloadFileTemplate
})

onUnmounted(() => {
  unreg?.()
})

function onLogout() {
  auth.logout()
  // [lynx:fix] 登出 = 会话结束：清历史栈 + replace 导航，登录页不应被"返回"（ADR-0049）
  resetHistory()
  void navigate('/login', { replace: true })
}

function openBookmarks() {
  void navigate('/bookmarks')
}

function openWatchlist() {
  void navigate('/watchlist')
}

/** 稍后看列表入口（ADR-0191 D5 / #753 T4）：功能入口卡区行 */
function openWatchLater() {
  void navigate('/later')
}

/** 好P友列表入口（ADR-0193 D3 / #754 T7）：功能入口卡区行（稍后看行后邻位） */
function openMyPixiv() {
  void navigate('/mypixiv')
}

function openDownloads() {
  void navigate('/downloads')
}

function openNetworkCheck() {
  void navigate('/network-check')
}

/** 通知中心入口（ADR-0188 D7 / #728）：功能入口卡区行 */
function openNotifications() {
  void navigate('/notifications')
}

/** 静音标签管理入口（ADR-0187 D5 / #732）：内容组行（AI 三态分段之后） */
function openMuteTags() {
  void navigate('/mute-tags')
}

// ADR-0051：R18/R18G 开关（对齐主项目 settingsStore，默认隐藏，持久化 IndexedDB）
// T6：动图播放方案——Range 需二次确认
const ugoiraConfirm = ref(false)

// ─── M3 segmented button options（spec docs/specs/app-lynx-m3-segmented-button.md §4.2：
// 必须 computed 构建，t() 语言切换时 label 自动重算；a11yLabel 原样引用 ME_A11Y_LABELS 注册表）───
const appearanceOptions = computed<M3SegmentOption<DarkModeId>[]>(() => [
  { value: 'light', label: t('me.appearance.modeLight'), a11yLabel: ME_A11Y_LABELS.appearanceLight },
  { value: 'dark', label: t('me.appearance.modeDark'), a11yLabel: ME_A11Y_LABELS.appearanceDark },
  { value: 'system', label: t('me.appearance.modeSystem'), a11yLabel: ME_A11Y_LABELS.appearanceSystem },
])
const aiFilterOptions = computed<M3SegmentOption<AiFilterMode>[]>(() => [
  { value: 'show', label: t('me.content.aiShow'), a11yLabel: ME_A11Y_LABELS.aiFilterShow },
  { value: 'mask', label: t('me.content.aiMask'), a11yLabel: ME_A11Y_LABELS.aiFilterMask },
  { value: 'only', label: t('me.content.aiOnly'), a11yLabel: ME_A11Y_LABELS.aiFilterOnly },
])
const ugoiraModeOptions = computed<M3SegmentOption<UgoiraExtractMode>[]>(() => [
  { value: 'fflate', label: t('me.ugoira.fflate'), a11yLabel: ME_A11Y_LABELS.ugoiraFflate },
  { value: 'range', label: t('me.ugoira.range'), a11yLabel: ME_A11Y_LABELS.ugoiraRange },
])
const detailQualityOptions = computed<M3SegmentOption<ImageQuality>[]>(() => [
  { value: 'medium', label: t('me.quality.medium'), a11yLabel: ME_A11Y_LABELS.detailQualityMedium },
  { value: 'large', label: t('me.quality.large'), a11yLabel: ME_A11Y_LABELS.detailQualityLarge },
  { value: 'original', label: t('me.quality.original'), a11yLabel: ME_A11Y_LABELS.detailQualityOriginal },
])

function pickUgoiraMode(m: 'fflate' | 'range') {
  if (m === 'fflate') {
    ugoiraConfirm.value = false
    settings.setUgoiraMode('fflate')
  } else {
    ugoiraConfirm.value = true // 显示二次确认（告知原生端限制）
  }
}

function confirmUgoiraRange() {
  settings.setUgoiraMode('range')
  ugoiraConfirm.value = false
}

// issue #148 T2：详情画质档位（medium=标准 / large=高清 / original=原图）
function pickDetailQuality(q: ImageQuality) {
  settings.setDetailQuality(q)
}

// ─── 下载命名（ADR-0192 / spec docs/specs/lynx-download-naming.md D6/D9）：模板输入 + 作者目录开关 ───
// 预览样例上下文（固定单页样例：默认模板展开 = Pictelio_12345678.jpg，ADR-0192 D6 示例；
// 样例 id/title/author 为纯展示占位值，不进 i18n——与 client 组 "SolidJS + Capacitor" 同口径）
const TEMPLATE_PREVIEW_CTX = { id: 12345678, title: 'Sample', author: 'Author', page: 0, pageCount: 1 }
// 预览 URL 仅用于 extForUrl 扩展名推断（sample.jpg → jpg）——中性示例串，禁硬编码 Pixiv CDN URL
const TEMPLATE_PREVIEW_URL = 'sample.jpg'

const templateInput = ref(settings.downloadFileTemplate)
const templateFallbackHint = ref(false)
/** 净化后示例预览（读 store 值，提交/重置即时重算） */
const templatePreview = computed(() =>
  buildSaveFileNameFromTemplate(settings.downloadFileTemplate, TEMPLATE_PREVIEW_CTX, TEMPLATE_PREVIEW_URL),
)

/** 提交模板（@input 逐键 + @confirm 键盘确认双通道）：净化持久化 + 非法回落可见提示（禁静默回落）；
 *  @input 不回写输入框（避免逐键光标跳动），@confirm 键盘确认后回写净化值（trim/截断可见） */
function commitTemplate(writeBack: boolean) {
  templateFallbackHint.value = settings.setDownloadFileTemplate(templateInput.value)
  if (writeBack) templateInput.value = settings.downloadFileTemplate
}

/** 一键恢复默认模板（ADR-0192 D9），清除回落提示 */
function resetTemplate() {
  settings.setDownloadFileTemplate(DEFAULT_DOWNLOAD_TEMPLATE)
  templateInput.value = settings.downloadFileTemplate
  templateFallbackHint.value = false
}

/** 按作者建目录开关：一键翻转，设备级 setter 自带持久化（目录段由命名纯函数生成） */
function toggleDownloadByAuthorDir() {
  settings.setDownloadByAuthorDir(!downloadByAuthorDir.value)
}

function toggleR18() {
  settings.setShowR18(!showR18.value)
}
function toggleR18G() {
  settings.setShowR18G(!showR18G.value)
}
function toggleRelatedInjection() {
  settings.setRelatedInjection(!relatedInjection.value)
}
function toggleRankingEntry() {
  settings.setRankingEntry(!rankingEntry.value)
}
// 小说先进介绍页开关（spec docs/specs/lynx-novel-intro-toggle.md / ADR-0183）：一键翻转，setter 自带持久化
function toggleNovelIntroFirst() {
  settings.setNovelIntroFirst(!novelIntroFirst.value)
}

// T2：外观模式三态切换（spec docs/specs/lynx-night-mode.md §3 + §4.7）—— 即时生效，
// 经 settingsStore.setDarkMode 走设备级持久化 + Pinia ref 即时更新 → App.vue 根类重算
// 入参类型取清单单一事实源 DarkModeId（手写联合会与 DARK_MODE_OPTIONS 漂移）
function pickAppearanceMode(mode: DarkModeId) {
  settings.setDarkMode(mode)
}
</script>

<!--
  accessibility 标注约定（issue #103 / ADR-0061）：
  关键交互元素（@tap 容器）与页面标识文本必须标注
  accessibility-element（绑定 A11Y_ELEMENT_ENABLED 常量）+ accessibility-label
  （label 取自 src/utils/accessibility.ts 的 ME_A11Y_LABELS 注册表），否则不进入
  Android accessibility 树，Appium/UiAutomator 无法定位。新增关键交互元素前必须先
  在注册表登记 label（单测会断言注册表全部被模板消费）。纯增量标注，不改变视觉与
  交互行为。
-->
<template>
  <!-- [lynx:fix] 设置页滚动（issue #90）：header 固定在滚动容器外（与 Bookmarks/Recommended 同模式），
       内容由 scroll-view 承接溢出，web-core 与 native LynxView 行为一致 -->
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头；pageTitle 标注保留（E2E 锚点） -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text
        class="text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="ME_A11Y_LABELS.pageTitle"
        >{{ t('me.title') }}</text
      >
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1">
      <!-- 账户组：用户信息 + 收藏入口（GlassCard = M3 elevated card） -->
      <GlassCard class="mt-3 mx-3 p-4">
        <view v-if="auth.currentUser" class="flex flex-row items-center pb-4 border-b-[1px] border-b-outline-variant">
          <image
            class="w-[14.933vw] h-[14.933vw] rounded-full bg-surface-container-high"
            :src="
              proxyImageUrl(
                auth.currentUser.profile_image_urls?.px_170x170 ||
                  auth.currentUser.profile_image_urls?.medium ||
                  '',
              )
            "
          />
          <view class="ml-4 flex flex-col">
            <!-- T07 档位清理：原为 700 字重。账号名属身份文本，headline-small 官方
                 regular(400)、emphasized 500；身份已由左侧 17vw 头像 + 下方 @account 承担，
                 且同屏另一标题（:492 title-large）本就是 500，留 700 会让同一屏出现两套
                 字重口径。判为**非**必须 700 的强强调（不同于价格/警示数字）→ 500。 -->
            <text class="text-headline-small font-regular text-surface-on">{{ auth.currentUser.name }}</text>
            <text class="text-body-small text-surface-on-variant mt-1">@{{ auth.currentUser.account }}</text>
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.bookmarks"
          @tap="openBookmarks"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.bookmarks') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
        <!-- 追更列表入口（issue #225 / spec §US7）：账户组第二行 -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.watchlist"
          @tap="openWatchlist"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.watchlist') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
        <!-- 稍后看入口（ADR-0191 D5 / #753 T4）：账户组第三行，行尾条目计数徽标（数据源同 store；
             徽标为装饰性，语义由行级 accessibility-label 承载——通知未读圆点同款约定） -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.watchLater"
          @tap="openWatchLater"
        >
          <text class="text-title-medium text-surface-on">{{ t('later.me.entry') }}</text>
          <view class="flex flex-row items-center">
            <view class="min-w-[5.333vw] h-[5.333vw] px-[1.6vw] rounded-[var(--md-shape-full)] bg-secondary-container flex items-center justify-center mr-2">
              <text class="text-label-small text-secondary-on-container">{{ watchLaterStore.count }}</text>
            </view>
            <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
          </view>
        </view>
        <!-- 好P友入口（ADR-0193 D3 / #754 T7）：账户组行（稍后看行后邻位）；双向好P友关系列表，
             与 following/follower 单向关系不同族（术语表辨析 #5） -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.mypixiv"
          @tap="openMyPixiv"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.mypixiv') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.downloads"
          @tap="openDownloads"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.downloads') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
        <!-- 网络自检入口（spec docs/specs/network-self-check.md / #445） -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.networkCheck"
          @tap="openNetworkCheck"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.networkCheck') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
        <!-- 通知中心入口（ADR-0188 D7 / #728）：行尾未读圆点（M3 error 语义色，纯 CSS） -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.notifications"
          @tap="openNotifications"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.notifications') }}</text>
          <view class="flex flex-row items-center">
            <!-- 未读圆点（装饰性：状态语义由行级 accessibility-label 承载，不加独立标注——
                 unit.test.ts 钉死 Me 页 element/label 与 ME_A11Y_LABELS 注册表严格配平） -->
            <view v-if="notificationStore.unreadCount > 0" class="w-[2.667vw] h-[2.667vw] rounded-full bg-error mr-2" />
            <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
          </view>
        </view>
      </GlassCard>

      <!-- 全屏模式组（#806）：从客户端组移出。它与引擎无关，是 Lynx 侧沉浸式功能
           （spec docs/specs/lynx-systembars.md D5：隐藏系统栏 + 边缘滑动唤出），
           不得随单引擎隐藏客户端组而一并消失。 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.fullscreenMode"
          @tap="toggleFullscreenMode"
        >
          <view class="flex flex-col">
            <text class="text-title-medium text-surface-on">{{ t('me.fullscreenMode') }}</text>
            <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('me.fullscreenModeDesc') }}</text>
          </view>
          <M3Switch
            :checked="fullscreenMode"
          />
        </view>
      </view>

      <!-- 网络组（ADR-0199 D4 / #779：限流退避四参数设置；卡片/行结构镜像客户端组） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text
          class="text-title-small font-medium text-surface-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.networkGroupTitle"
          >{{ t('me.network.title') }}</text
        >
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.network.hint') }}</text>
        <!-- 限流退避开关行：关闭后 429 立即报错零重试 -->
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.rateLimitBackoff"
          @tap="toggleRateLimitBackoff"
        >
          <view class="flex flex-col">
            <text class="text-title-medium text-surface-on">{{ t('me.network.backoff') }}</text>
            <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('me.network.backoffDesc') }}</text>
          </view>
          <M3Switch
            :checked="rateLimitBackoffEnabled"
          />
        </view>
        <!-- 最大重试次数档位行（镜像 webdavAutoBackupDays chips 行；档位集 = 单一事实源常量） -->
        <view class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant">
          <text class="text-title-medium text-surface-on">{{ t('me.network.maxRetries') }}</text>
          <view
            class="flex flex-row gap-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.rateLimitMaxRetries"
          >
            <view
              v-for="n in RATE_LIMIT_MAX_RETRIES_OPTIONS"
              :key="n"
              class="px-3 py-1 rounded-[var(--md-shape-full)]"
              :class="rateLimitMaxRetries === n ? 'bg-primary' : 'bg-surface-container-high'"
              @tap="pickRateLimitMaxRetries(n)"
            >
              <text class="text-label-medium" :class="rateLimitMaxRetries === n ? 'text-primary-on' : 'text-surface-on'">{{ n }}</text>
            </view>
          </view>
        </view>
        <!-- 初始等待档位行：毫秒档位按 delaySeconds 插值渲染秒数（500→0.5 … 5000→5） -->
        <view class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant">
          <text class="text-title-medium text-surface-on">{{ t('me.network.baseDelay') }}</text>
          <view
            class="flex flex-row gap-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.rateLimitBaseDelay"
          >
            <view
              v-for="ms in RATE_LIMIT_BASE_DELAY_MS_OPTIONS"
              :key="ms"
              class="px-3 py-1 rounded-[var(--md-shape-full)]"
              :class="rateLimitBaseDelayMs === ms ? 'bg-primary' : 'bg-surface-container-high'"
              @tap="pickRateLimitBaseDelayMs(ms)"
            >
              <text class="text-label-medium" :class="rateLimitBaseDelayMs === ms ? 'text-primary-on' : 'text-surface-on'">{{ t('me.network.delaySeconds', { seconds: toSeconds(ms) }) }}</text>
            </view>
          </view>
        </view>
        <!-- 最长等待档位行：10/30/60 秒（末行不带分隔线，镜像客户端组末行收尾） -->
        <view class="flex flex-row items-center justify-between py-3.5">
          <text class="text-title-medium text-surface-on">{{ t('me.network.maxDelay') }}</text>
          <view
            class="flex flex-row gap-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.rateLimitMaxDelay"
          >
            <view
              v-for="ms in RATE_LIMIT_MAX_DELAY_MS_OPTIONS"
              :key="ms"
              class="px-3 py-1 rounded-[var(--md-shape-full)]"
              :class="rateLimitMaxDelayMs === ms ? 'bg-primary' : 'bg-surface-container-high'"
              @tap="pickRateLimitMaxDelayMs(ms)"
            >
              <text class="text-label-medium" :class="rateLimitMaxDelayMs === ms ? 'text-primary-on' : 'text-surface-on'">{{ t('me.network.delaySeconds', { seconds: toSeconds(ms) }) }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 外观组（主题色）：色板类 .theme-* 定义在 tokens.css，根 <page> 应用即整体换色；
           色块自身加对应色板类（默认 sky 用 .theme-sky，与基础 page 色板共用规则）+ bg-primary 预览该色板主色。
           T2 增补（spec lynx-night-mode §4.7）：
             - 顶部加「外观模式」M3 segmented button 三格（亮/暗/跟随），点击即时切换
             - 色块同步挂 .dark 类 → 暗色 resolved 下显示对应主题的暗色色板真实主色（WYSIWYG） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.appearance.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.appearance.themeColorHint') }}</text>
        <!-- 模式组标签（i18n 键 me.appearance.mode 的真实渲染点）：原实现只有模式名（亮色/暗色/
             跟随系统），缺组标签导致该键成孤儿；样式镜像同区 themeColorHint 的 label-medium 用法，
             紧贴 segmented 上方（mb-2），其余视觉不变 -->
        <text class="text-label-medium text-surface-on-variant mb-2">{{ t('me.appearance.mode') }}</text>
        <!-- M3 segmented button（三档）：亮色 / 暗色 / 跟随系统（spec §4.4：分解写法，副作用走 pickAppearanceMode；mb-4 随 class 透传落在容器根） -->
        <M3SegmentedButton class="mb-4" :model-value="darkMode" :options="appearanceOptions" @update:modelValue="pickAppearanceMode" />
        <!-- 色板行：7 个色块的选中态 ✓ 裸字形统一换 Material Symbols `check`（T12/ADR-0208），
             :size=2.93vw = 原 text-label-small（11sp = 22rpx = 11px @375），视觉尺寸不变；
             「已选中」语义仍由色块的 accessibility-label + border/bg 表达，图标只画形状不承载语义 -->
        <view class="flex flex-row items-start justify-between">
          <view class="flex flex-col items-center gap-1">
            <!-- 天蓝（默认） -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'sky' ? 'border-primary' : 'border-transparent', ...appearanceClasses('sky', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorSky"
              @tap="settings.setThemeColor('sky')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'sky'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorSky') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 紫罗兰 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'violet' ? 'border-primary' : 'border-transparent', ...appearanceClasses('violet', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorViolet"
              @tap="settings.setThemeColor('violet')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'violet'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorViolet') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 樱花粉 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'pink' ? 'border-primary' : 'border-transparent', ...appearanceClasses('pink', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorPink"
              @tap="settings.setThemeColor('pink')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'pink'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorPink') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 松柏绿 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'green' ? 'border-primary' : 'border-transparent', ...appearanceClasses('green', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorGreen"
              @tap="settings.setThemeColor('green')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'green'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorGreen') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 落日橙 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'orange' ? 'border-primary' : 'border-transparent', ...appearanceClasses('orange', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorOrange"
              @tap="settings.setThemeColor('orange')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'orange'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorOrange') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 深青 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'teal' ? 'border-primary' : 'border-transparent', ...appearanceClasses('teal', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorTeal"
              @tap="settings.setThemeColor('teal')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'teal'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorTeal') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 哔哩粉 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'bili' ? 'border-primary' : 'border-transparent', ...appearanceClasses('bili', resolvedDark)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorBili"
              @tap="settings.setThemeColor('bili')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <AppIcon v-if="themeColor === 'bili'" name="check" :size="2.93" class="text-primary-on" />
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorBili') }}</text>
          </view>
        </view>
        <!-- 界面语言（spec docs/specs/i18n.md §3：跟随系统 + 手动覆盖 + 即时切换；autonym 按 ui-copy R8 不翻译） -->
        <view class="mt-4 pt-3 border-t-[1px] border-t-surface-variant">
          <text class="text-label-medium text-surface-on-variant">{{ t('me.appearance.language') }}</text>
          <view class="flex flex-row flex-wrap gap-2 mt-2">
            <view
              class="px-3 py-1.5 rounded-full border-[0.533vw]"
              :class="language === '' ? 'bg-secondary-container border-primary' : 'bg-surface-container border-transparent'"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.languageFollowSystem"
              @tap="settings.setLanguage('')"
            >
              <text class="text-label-medium" :class="language === '' ? 'text-primary-on' : 'text-surface-on'">{{ t('me.appearance.languageFollowSystem') }}</text>
            </view>
            <view
              class="px-3 py-1.5 rounded-full border-[0.533vw]"
              :class="language === 'zh-CN' ? 'bg-secondary-container border-primary' : 'bg-surface-container border-transparent'"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.languageZh"
              @tap="settings.setLanguage('zh-CN')"
            >
              <text class="text-label-medium" :class="language === 'zh-CN' ? 'text-primary-on' : 'text-surface-on'">简体中文</text>
            </view>
            <view
              class="px-3 py-1.5 rounded-full border-[0.533vw]"
              :class="language === 'en' ? 'bg-secondary-container border-primary' : 'bg-surface-container border-transparent'"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.languageEn"
              @tap="settings.setLanguage('en')"
            >
              <text class="text-label-medium" :class="language === 'en' ? 'text-primary-on' : 'text-surface-on'">English</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 内容组（ADR-0051：R18/R18G 开关） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.content.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.content.hint') }}</text>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18Toggle"
          @tap="toggleR18"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.showR18') }}</text>
          <M3Switch
            :checked="showR18"
          />
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18gToggle"
          @tap="toggleR18G"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.showR18G') }}</text>
          <M3Switch
            :checked="showR18G"
          />
        </view>

        <!-- 相关作品注入行开关（spec docs/specs/related-injection.md）：设备级，默认开 -->
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.relatedInjectionToggle"
          @tap="toggleRelatedInjection"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.relatedInjection') }}</text>
          <M3Switch
            :checked="relatedInjection"
          />
        </view>

        <!-- 排行榜入口开关（spec docs/specs/ranking.md §5.8）：设备级，默认开 -->
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.rankingEntryToggle"
          @tap="toggleRankingEntry"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.rankingEntry') }}</text>
          <M3Switch
            :checked="rankingEntry"
          />
        </view>

        <!-- 小说先进介绍页开关（spec docs/specs/lynx-novel-intro-toggle.md / ADR-0183）：设备级，默认开；
             描述两行式照 autoFallback 行范式（行级 @tap 翻转 + M3Switch，ADR-0179 组件） -->
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.novelIntroFirstToggle"
          @tap="toggleNovelIntroFirst"
        >
          <view class="flex flex-col">
            <text class="text-title-medium text-surface-on">{{ t('me.content.novelIntroFirst') }}</text>
            <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('me.content.novelIntroFirstDesc') }}</text>
          </view>
          <M3Switch
            :checked="novelIntroFirst"
          />
        </view>

        <!-- AI 作品三态过滤（ADR-0155）：显示 / 遮罩 / 仅看；逐项静态 a11y label（注册表完整性测试要求）。
             布局：组标签独占一行 + 整宽 segmented（对齐外观组「模式」标签范式；同行窄控件文字拥挤，
             视觉验收未过——#739 review 迭代，修订 spec §4.4/§6 #2） -->
        <view class="py-3.5">
          <text class="text-title-medium text-surface-on mb-3">{{ t('me.content.ai') }}</text>
          <!-- 段级 a11y 由组件自持；段间分隔线随组件自动生成（本组 bug 修复随迁移生效，spec §1/§2） -->
          <M3SegmentedButton :model-value="aiFilterMode" :options="aiFilterOptions" @update:modelValue="settings.setAiFilterMode" />
        </view>

        <!-- 静音标签管理入口（ADR-0187 D5 / #732）：内容组末行，跳 /mute-tags -->
        <view
          class="flex flex-row items-center justify-between py-3.5 pt-4 mt-1 border-t-[1px] border-t-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.muteTags"
          @tap="openMuteTags"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.muteTags') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
      </view>

      <!-- T6：动图播放组 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.ugoira.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.ugoira.hint') }}</text>
        <!-- M3 segmented button：容器 outline 边框 + 全圆角，40dp 高，选中段 secondary-container（range 档二次确认仍走 pickUgoiraMode） -->
        <M3SegmentedButton :model-value="ugoiraMode" :options="ugoiraModeOptions" @update:modelValue="pickUgoiraMode" />
        <!-- T10/ADR-0206 决策 3：删掉自选 leading-snug，行高由 text-label-medium 档位携带（16sp） -->
        <text class="text-label-medium text-surface-on-variant mt-2">
          {{ t('me.ugoira.rangeHint') }}
        </text>
      </view>

      <!-- issue #148 T2：详情画质档位组（medium=标准 / large=高清 / original=原图） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.quality.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.quality.hint') }}</text>
        <!-- M3 segmented button（三档）：容器 outline 边框 + 全圆角，40dp 高，选中段 secondary-container -->
        <M3SegmentedButton :model-value="detailQuality" :options="detailQualityOptions" @update:modelValue="pickDetailQuality" />
      </view>

      <!-- 下载格式组（spec download-manager §5）：全局统一，不可逐图 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.download.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.download.formatHint') }}</text>
        <view class="flex flex-row flex-wrap gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="ugoiraDownloadFormat === 'gif' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadFormatGif"
            @tap="settings.setUgoiraDownloadFormat('gif')"
          >
            <text class="text-label-large" :class="ugoiraDownloadFormat === 'gif' ? 'text-secondary-on-container' : 'text-surface-on'">GIF</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="ugoiraDownloadFormat === 'mp4' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadFormatMp4"
            @tap="settings.setUgoiraDownloadFormat('mp4')"
          >
            <text class="text-label-large" :class="ugoiraDownloadFormat === 'mp4' ? 'text-secondary-on-container' : 'text-surface-on'">MP4</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="ugoiraDownloadFormat === 'webp' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadFormatWebp"
            @tap="settings.setUgoiraDownloadFormat('webp')"
          >
            <text class="text-label-large" :class="ugoiraDownloadFormat === 'webp' ? 'text-secondary-on-container' : 'text-surface-on'">WebP</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="ugoiraDownloadFormat === 'apng' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadFormatApng"
            @tap="settings.setUgoiraDownloadFormat('apng')"
          >
            <text class="text-label-large" :class="ugoiraDownloadFormat === 'apng' ? 'text-secondary-on-container' : 'text-surface-on'">APNG</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="ugoiraDownloadFormat === 'zip' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadFormatZip"
            @tap="settings.setUgoiraDownloadFormat('zip')"
          >
            <text class="text-label-large" :class="ugoiraDownloadFormat === 'zip' ? 'text-secondary-on-container' : 'text-surface-on'">ZIP</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="ugoiraDownloadFormat === 'tar' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadFormatTar"
            @tap="settings.setUgoiraDownloadFormat('tar')"
          >
            <text class="text-label-large" :class="ugoiraDownloadFormat === 'tar' ? 'text-secondary-on-container' : 'text-surface-on'">TAR</text>
          </view>
        </view>

        <!-- 下载命名（ADR-0192 / spec docs/specs/lynx-download-naming.md D9）：命名模板输入 + 预览回显 -->
        <view class="mt-4 pt-3 border-t-[1px] border-t-surface-variant">
          <text class="text-title-medium text-surface-on">{{ t('me.download.templateLabel') }}</text>
          <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('me.download.templateHint') }}</text>
          <!-- lynx input（默认普通文本键盘）：v-model 先于 @input（vue-lynx 保证，WebDAV 输入同款）；
               @input 逐键持久化 + 预览回显，@confirm 键盘确认后回写净化值（trim/截断可见）
               MD3 filled text field（ADR-0209）：label 复用本区块既有的 me.download.templateLabel
               文案（该 key 已在同一区块上方渲染为小标题，浮动态下二者同源不冲突）。
               @focus/@blur 驱动 label 浮动（ADR-0209 决策 2：:focus 伪类在 Lynx 引擎不匹配）。 -->
          <view class="relative self-stretch mt-2">
            <input
              v-model="templateInput"
              class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
              :class="fieldInputPadClass('template', templateInput)"
              :placeholder="t('me.download.templatePlaceholder')"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              @focus="setFieldFocus('template', true)"
              @blur="setFieldFocus('template', false)"
              @input="commitTemplate(false)"
              @confirm="commitTemplate(true)"
            />
          <view
            v-if="fieldFocus['template'] === true"
            class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
          />
          <!-- 无浮动 label：本区块上方已有常驻字段名 me.download.templateLabel，
                 同屏出现两份「模板名」即 ADR-0209 决策 6 禁止的重复（该决策以「重复本身」
                 为由豁免 BookmarkPanel，反向量同样约束此处）。仅保留聚焦态指示条。 -->
          </view>
          <view class="flex flex-row items-center justify-between mt-2">
            <text class="text-label-medium text-surface-on-variant flex-1">{{ t('me.download.templatePreview', { value: templatePreview }) }}</text>
            <view
              class="px-3 py-1 rounded-[var(--md-shape-full)] bg-surface-container-high ml-2"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.downloadTemplateReset"
              @tap="resetTemplate"
            >
              <text class="text-label-medium text-surface-on">{{ t('me.download.templateReset') }}</text>
            </view>
          </view>
          <!-- 非法输入（空串/全净化为空）回落默认值：可见提示（spec D6 禁静默回落） -->
          <text v-if="templateFallbackHint" class="text-label-medium text-error mt-1">
            {{ t('me.download.templateFallbackHint') }}
          </text>
          <!-- 按作者建目录开关（M3Switch ADR-0179 范式）：开启后相对目录 = 基座 + 净化作者段 -->
          <view
            class="flex flex-row items-center justify-between mt-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.downloadAuthorDirToggle"
            @tap="toggleDownloadByAuthorDir"
          >
            <view class="flex flex-col">
              <text class="text-title-medium text-surface-on">{{ t('me.download.authorDir') }}</text>
              <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('me.download.authorDirDesc') }}</text>
            </view>
            <M3Switch
              :checked="downloadByAuthorDir"
            />
          </view>
        </view>
      </view>

      <!-- 导出组（spec docs/specs/novel-export.md §6/§7.2）：全局默认格式 + 三项内容开关 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.export.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.export.formatHint') }}</text>
        <view class="flex flex-row flex-wrap gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'txt' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatTxt"
            @tap="settings.setNovelExportFormat('txt')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'txt' ? 'text-secondary-on-container' : 'text-surface-on'">TXT</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'html' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatHtml"
            @tap="settings.setNovelExportFormat('html')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'html' ? 'text-secondary-on-container' : 'text-surface-on'">HTML</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'md' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatMd"
            @tap="settings.setNovelExportFormat('md')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'md' ? 'text-secondary-on-container' : 'text-surface-on'">MD</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'docx' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatDocx"
            @tap="settings.setNovelExportFormat('docx')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'docx' ? 'text-secondary-on-container' : 'text-surface-on'">Word</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'pdf' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatPdf"
            @tap="settings.setNovelExportFormat('pdf')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'pdf' ? 'text-secondary-on-container' : 'text-surface-on'">PDF</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'epub' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatEpub"
            @tap="settings.setNovelExportFormat('epub')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'epub' ? 'text-secondary-on-container' : 'text-surface-on'">EPUB</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'rtf' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatRtf"
            @tap="settings.setNovelExportFormat('rtf')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'rtf' ? 'text-secondary-on-container' : 'text-surface-on'">RTF</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'json' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatJson"
            @tap="settings.setNovelExportFormat('json')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'json' ? 'text-secondary-on-container' : 'text-surface-on'">JSON</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="novelExportFormat === 'fb2' ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportFormatFb2"
            @tap="settings.setNovelExportFormat('fb2')"
          >
            <text class="text-label-large" :class="novelExportFormat === 'fb2' ? 'text-secondary-on-container' : 'text-surface-on'">FB2</text>
          </view>
        </view>
        <!-- 内容开关：默认全开；文本格式（TXT/MD/RTF）对图像退化为链接 -->
        <view class="mt-4 flex flex-col">
          <view
            class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportIncludeMetadata"
            @tap="settings.setNovelExportIncludeMetadata(!novelExportOptions.includeMetadata)"
          >
            <view class="flex flex-col">
              <text class="text-title-medium text-surface-on">{{ t('me.export.includeMetadata') }}</text>
              <text class="text-label-medium text-surface-on-variant">{{ t('me.export.includeMetadataHint') }}</text>
            </view>
            <M3Switch
              :checked="novelExportOptions.includeMetadata"
            />
          </view>
          <view
            class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportIncludeCover"
            @tap="settings.setNovelExportIncludeCover(!novelExportOptions.includeCover)"
          >
            <view class="flex flex-col">
              <text class="text-title-medium text-surface-on">{{ t('me.export.includeCover') }}</text>
              <text class="text-label-medium text-surface-on-variant">{{ t('me.export.includeCoverHint') }}</text>
            </view>
            <M3Switch
              :checked="novelExportOptions.includeCover"
            />
          </view>
          <view
            class="flex flex-row items-center justify-between py-3.5"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.novelExportIncludeImages"
            @tap="settings.setNovelExportIncludeImages(!novelExportOptions.includeInlineImages)"
          >
            <view class="flex flex-col">
              <text class="text-title-medium text-surface-on">{{ t('me.export.includeImages') }}</text>
              <text class="text-label-medium text-surface-on-variant">{{ t('me.export.includeImagesHint') }}</text>
            </view>
            <M3Switch
              :checked="novelExportOptions.includeInlineImages"
            />
          </view>
        </view>
      </view>

      <!-- 翻译设置（spec docs/specs/app-lynx-novel-translation.md §6.1；T9 #637） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <SettingsEndpoint />
      </view>

      <!-- 退出登录（危险操作独立沉底） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view
          class="py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.logout"
          @tap="onLogout"
        >
          <text class="text-title-medium text-error">{{ t('me.logout') }}</text>
        </view>
      </view>
      <!-- WebDAV 备份（spec docs/specs/webdav-backup.md §7；仅原生渲染，§2 web-core 不显示） -->
      <view
        v-if="webdavAvailable"
        class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
      >
        <text class="text-title-small font-medium text-surface-on">{{ t('me.webdav.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.webdav.hint') }}</text>

        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.webdavToggle"
          @tap="toggleWebdavEnabled"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.webdav.enabled') }}</text>
          <M3Switch
            :checked="settings.webdavEnabled"
          />
        </view>

        <template v-if="settings.webdavEnabled">
          <!-- M1：v-model 直改 ref 不落盘——@input 追加调用 setter 持久化（v-model 先赋值，setter 幂等）
               MD3 filled text field（ADR-0209）：底部指示条 + label 浮动。
               label 用专门的 *Label 短 key（i18n 后续补入 zh-CN/en），不复用 *Placeholder：
               后者可带括号补充说明，浮到 56dp 容器顶部后会与输入文字挤在一行（ADR-0209 决策 3）。 -->
          <view class="relative self-stretch mt-3">
            <input
              v-model="settings.webdavUrl"
              class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
              :class="fieldInputPadClass('webdavUrl', settings.webdavUrl)"
              :placeholder="isPlaceholderShown('webdavUrl') ? 'https://dav.example.com/remote.php/dav/files/me/' : ''"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              @focus="setFieldFocus('webdavUrl', true)"
              @blur="setFieldFocus('webdavUrl', false)"
              @input="onWebdavFieldInput('url', $event)"
            />
          <view
            v-if="fieldFocus['webdavUrl'] === true"
            class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
          />
          <text
              class="absolute left-4 flex items-center"
              :class="[fieldLabelWrapClass('webdavUrl', settings.webdavUrl), fieldLabelClass('webdavUrl', settings.webdavUrl)]"
              >{{ t('me.webdav.urlLabel') }}</text
            >
          </view>
          <!-- M4：非 HTTPS 警告（spec §7） -->
          <text
            v-if="settings.webdavUrl !== '' && !settings.webdavUrl.startsWith('https://')"
            class="text-label-medium text-error mt-1"
          >
            {{ t('me.webdav.httpsWarning') }}
          </text>
          <view class="relative self-stretch mt-3">
            <input
              v-model="settings.webdavUsername"
              class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
              :class="fieldInputPadClass('webdavUsername', settings.webdavUsername)"
              :placeholder="isPlaceholderShown('webdavUsername') ? t('me.webdav.usernamePlaceholder') : ''"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              @focus="setFieldFocus('webdavUsername', true)"
              @blur="setFieldFocus('webdavUsername', false)"
              @input="onWebdavFieldInput('username', $event)"
            />
          <view
            v-if="fieldFocus['webdavUsername'] === true"
            class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
          />
          <text
              class="absolute left-4 flex items-center"
              :class="[
                fieldLabelWrapClass('webdavUsername', settings.webdavUsername),
                fieldLabelClass('webdavUsername', settings.webdavUsername),
              ]"
              >{{ t('me.webdav.usernameLabel') }}</text
            >
          </view>
          <!-- B1：密码输入框不可逆显（spec §7） -->
          <view class="relative self-stretch mt-3">
            <input
              v-model="webdavLoginPassword"
              type="password"
              class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
              :class="fieldInputPadClass('webdavPassword', webdavLoginPassword)"
              :placeholder="isPlaceholderShown('webdavPassword') ? t('me.webdav.passwordPlaceholder') : ''"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              @focus="setFieldFocus('webdavPassword', true)"
              @blur="setFieldFocus('webdavPassword', false)"
            />
          <view
            v-if="fieldFocus['webdavPassword'] === true"
            class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
          />
          <text
              class="absolute left-4 flex items-center"
              :class="[
                fieldLabelWrapClass('webdavPassword', webdavLoginPassword),
                fieldLabelClass('webdavPassword', webdavLoginPassword),
              ]"
              >{{ t('me.webdav.passwordLabel') }}</text
            >
          </view>
          <view class="relative self-stretch mt-3">
            <input
              v-model="settings.webdavDir"
              class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
              :class="fieldInputPadClass('webdavDir', settings.webdavDir)"
              :placeholder="isPlaceholderShown('webdavDir') ? t('me.webdav.dirPlaceholder') : ''"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              @focus="setFieldFocus('webdavDir', true)"
              @blur="setFieldFocus('webdavDir', false)"
              @input="onWebdavFieldInput('dir', $event)"
            />
          <view
            v-if="fieldFocus['webdavDir'] === true"
            class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
          />
          <text
              class="absolute left-4 flex items-center"
              :class="[fieldLabelWrapClass('webdavDir', settings.webdavDir), fieldLabelClass('webdavDir', settings.webdavDir)]"
              >{{ t('me.webdav.dirLabel') }}</text
            >
          </view>
          <view class="relative self-stretch mt-3">
            <input
              v-model="webdavBackupPassword"
              type="password"
              class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
              :class="fieldInputPadClass('webdavBackupPassword', webdavBackupPassword)"
              :placeholder="isPlaceholderShown('webdavBackupPassword') ? t('me.webdav.backupPasswordPlaceholder') : ''"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              @focus="setFieldFocus('webdavBackupPassword', true)"
              @blur="setFieldFocus('webdavBackupPassword', false)"
            />
          <view
            v-if="fieldFocus['webdavBackupPassword'] === true"
            class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
          />
          <text
              class="absolute left-4 flex items-center"
              :class="[
                fieldLabelWrapClass('webdavBackupPassword', webdavBackupPassword),
                fieldLabelClass('webdavBackupPassword', webdavBackupPassword),
              ]"
              >{{ t('me.webdav.backupPasswordLabel') }}</text
            >
          </view>
          <!-- M3：敏感项排除（spec §7；账号级敏感键勾选后不进备份文件） -->
          <view
            v-if="webdavSensitiveKeys.length > 0"
            class="mt-3"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.webdavSensitiveGroup"
          >
            <text class="text-label-medium text-surface-on-variant">{{ t('me.webdav.sensitiveExclusionHint') }}</text>
            <view class="flex flex-row flex-wrap gap-2 mt-2">
              <view
                v-for="key in webdavSensitiveKeys"
                :key="key"
                class="px-3 py-1 rounded-[var(--md-shape-full)]"
                :class="settings.webdavExcludedKeys.includes(key) ? 'bg-error' : 'bg-surface-container-high'"
                @tap="toggleWebdavExcluded(key)"
              >
                <text class="text-label-medium" :class="settings.webdavExcludedKeys.includes(key) ? 'text-error-on' : 'text-surface-on'">
                  {{ key }}
                </text>
              </view>
            </view>
          </view>

          <view class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant mt-2">
            <text class="text-title-medium text-surface-on">{{ t('me.webdav.autoBackup') }}</text>
            <view class="flex flex-row gap-2">
              <view
                class="flex flex-row gap-2"
                :accessibility-element="A11Y_ELEMENT_ENABLED"
                :accessibility-label="ME_A11Y_LABELS.webdavAutoDays"
              >
                <view
                  v-for="d in [1, 3, 7, 30]"
                  :key="d"
                  class="px-3 py-1 rounded-[var(--md-shape-full)]"
                  :class="settings.webdavAutoBackupDays === d ? 'bg-primary' : 'bg-surface-container-high'"
                  @tap="pickWebdavAutoBackupDays(d)"
                >
                  <text class="text-label-medium" :class="settings.webdavAutoBackupDays === d ? 'text-primary-on' : 'text-surface-on'">{{ t('me.webdav.days', { count: d }) }}</text>
                </view>
              </view>
              <view
                class="px-3 py-1 rounded-[var(--md-shape-full)]"
                :class="settings.webdavAutoBackup ? 'bg-primary' : 'bg-surface-container-high'"
                :accessibility-element="A11Y_ELEMENT_ENABLED"
                :accessibility-label="ME_A11Y_LABELS.webdavAutoToggle"
                @tap="toggleWebdavAutoBackup"
              >
                <text class="text-label-medium" :class="settings.webdavAutoBackup ? 'text-primary-on' : 'text-surface-on'">
                  {{ settings.webdavAutoBackup ? t('me.webdav.on') : t('me.webdav.off') }}
                </text>
              </view>
            </view>
          </view>

          <text class="text-label-medium text-surface-on-variant mt-3">{{ t('me.webdav.lastBackup', { value: webdavLastBackupLabel }) }}</text>

          <view class="flex flex-row gap-2 mt-3">
            <view
              class="flex-1 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webdavTest"
              @tap="onWebdavTest"
            >
              <text class="text-label-large text-surface-on">{{ t('me.webdav.action.test') }}</text>
            </view>
            <view
              class="flex-1 h-[10.667vw] bg-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webdavBackup"
              @tap="onWebdavBackup"
            >
              <text class="text-label-large font-medium text-primary-on">{{ t('me.webdav.action.backup') }}</text>
            </view>
          </view>
          <view class="flex flex-row gap-2 mt-2">
            <view
              class="flex-1 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webdavRestore"
              @tap="onWebdavOpenRestore"
            >
              <text class="text-label-large text-surface-on">{{ t('me.webdav.action.restore') }}</text>
            </view>
            <view
              v-if="webdavHasPreRestore"
              class="flex-1 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webdavUndo"
              @tap="onWebdavUndo"
            >
              <text class="text-label-large text-surface-on">{{ t('me.webdav.undoLastRestore') }}</text>
            </view>
          </view>

          <view
            v-if="webdavShowRestore"
            class="mt-3"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.webdavRestoreFiles"
          >
            <text class="text-label-medium text-surface-on-variant">{{ t('me.webdav.chooseBackup') }}</text>
            <view v-for="file in webdavFiles" :key="file.name" class="py-2.5" @tap="onWebdavSelectFile(file)">
              <text class="text-body-medium" :class="webdavSelected?.name === file.name ? 'text-primary' : 'text-surface-on'">
                {{ file.name }}{{ file.encrypted ? t('me.webdav.encryptedBadge') : '' }}
              </text>
            </view>
            <!-- S7：加密档且无已保存备份密码 → 本次输入（MD3 filled text field，ADR-0209） -->
            <view v-if="webdavNeedsPassword && webdavSelected" class="mt-2">
              <text class="text-label-medium text-surface-on-variant">{{ t('me.webdav.encryptedPrompt') }}</text>
              <view class="relative self-stretch mt-2">
                <input
                  v-model="webdavPromptPassword"
                  type="password"
                  class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
                  :class="fieldInputPadClass('webdavPromptPassword', webdavPromptPassword)"
                  :placeholder="isPlaceholderShown('webdavPromptPassword') ? t('me.webdav.restorePromptPlaceholder') : ''"
                  :placeholder-color="INPUT_PLACEHOLDER_COLOR"
                  @focus="setFieldFocus('webdavPromptPassword', true)"
                  @blur="setFieldFocus('webdavPromptPassword', false)"
                />
              <view
                v-if="fieldFocus['webdavPromptPassword'] === true"
              class="absolute left-0 right-0 bottom-0 h-[2px] bg-primary"
            />
                <text
                  class="absolute left-4 flex items-center"
                  :class="[
                    fieldLabelWrapClass('webdavPromptPassword', webdavPromptPassword),
                    fieldLabelClass('webdavPromptPassword', webdavPromptPassword),
                  ]"
                  >{{ t('me.webdav.restorePromptLabel') }}</text
                >
              </view>
              <view
                class="h-[10.667vw] bg-primary rounded-[var(--md-shape-full)] flex items-center justify-center mt-2"
                :accessibility-element="A11Y_ELEMENT_ENABLED"
                :accessibility-label="ME_A11Y_LABELS.webdavDecrypt"
                @tap="prepareWebdavSelected()"
              >
                <text class="text-label-large font-medium text-primary-on">{{ t('me.webdav.decrypt') }}</text>
              </view>
            </view>
            <!-- S2：摘要展示在写回之前 -->
            <view v-if="webdavPrepared" class="mt-2">
              <text class="text-label-medium text-surface-on-variant">{{ t('me.webdav.summaryCreatedAt', { value: webdavPrepared.summary.createdAt }) }}</text>
              <text class="text-label-medium text-surface-on-variant">{{ t('me.webdav.summarySource', { engine: webdavPrepared.summary.engine, version: webdavPrepared.summary.appVersion }) }}</text>
              <text class="text-label-medium text-surface-on-variant">
                {{ t('me.webdav.summaryCounts', { device: webdavPrepared.summary.deviceKeyCount, account: webdavPrepared.summary.accountKeyCountForUid, sets: webdavPrepared.summary.setCount }) }}
              </text>
              <text class="text-label-medium text-error mt-2">
                {{ t('me.webdav.overwriteWarning') }}
              </text>
            </view>
            <text v-if="webdavRestoreError" class="text-label-medium text-error mt-2">{{ webdavRestoreError }}</text>
            <view v-if="webdavPrepared" class="flex flex-row gap-2 mt-2">
              <view
                class="flex-1 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center justify-center"
                :accessibility-element="A11Y_ELEMENT_ENABLED"
                :accessibility-label="ME_A11Y_LABELS.webdavRestoreCancel"
                @tap="webdavShowRestore = false"
              >
                <text class="text-label-large text-surface-on">{{ t('me.webdav.cancel') }}</text>
              </view>
              <view
                class="flex-1 h-[10.667vw] bg-error rounded-[var(--md-shape-full)] flex items-center justify-center"
                :accessibility-element="A11Y_ELEMENT_ENABLED"
                :accessibility-label="ME_A11Y_LABELS.webdavRestoreConfirm"
                @tap="onWebdavRestore"
              >
                <text class="text-label-large text-error-on">{{ t('me.webdav.confirmRestore') }}</text>
              </view>
            </view>
          </view>

          <text v-if="webdavBusy" class="text-label-medium text-surface-on-variant mt-3">{{ webdavBusy }}…</text>
          <text v-if="webdavStatus" class="text-label-medium text-surface-on-variant mt-2">{{ webdavStatus }}</text>
          <text v-if="webdavError" class="text-label-medium text-error mt-2">{{ webdavError }}</text>
        </template>
      </view>

      <!-- 底部留白：让滚动到底时最后一张卡片不贴底 -->
      <view class="h-[8vw]" />
    </scroll-view>

    <!-- M3 Dialog（二次确认，选择 Range 时）：fixed 全屏 scrim 遮罩 + 居中卡片 + 标题/内容/操作区 -->
    <view v-if="ugoiraConfirm" class="fixed inset-0 bg-scrim z-50 flex items-center justify-center">
      <view class="w-[74.667vw] max-w-[74.667vw] bg-surface-container-high rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]">
        <text class="text-headline-small font-regular text-surface-on">{{ t('me.ugoira.confirmTitle') }}</text>
        <!-- T10/ADR-0206 决策 3：删掉自选 leading-snug，行高由 text-body-medium 档位携带（20sp） -->
        <text class="text-body-medium text-surface-on-variant mt-4">
          {{ t('me.ugoira.confirmBody') }}
        </text>
        <view class="flex flex-row justify-end mt-6 gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center active:bg-layer-pressed-primary"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraCancel"
            @tap="ugoiraConfirm = false"
          >
            <text class="text-label-large font-medium text-primary">{{ t('me.ugoira.cancel') }}</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center active:bg-layer-pressed-primary"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraConfirm"
            @tap="confirmUgoiraRange"
          >
            <text class="text-label-large font-medium text-primary">{{ t('me.ugoira.confirm') }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
