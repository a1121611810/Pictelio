<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'me' })
import { ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { navigate, resetHistory, ensureAuth } from '../router'
import { useGlobalFabStore } from '../stores/globalFab'
import { useAuthStore } from '../stores/authStore'
import { useClientSwitchStore, supportsClientSwitch, type ClientKind } from '../stores/clientSwitchStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { ImageQuality } from '../utils/imageQuality'
import { proxyImageUrl } from '../utils/imageUrl'
import { ME_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import GlassCard from '../components/GlassCard.vue'
import { themeColorClass } from '../utils/themeColor'
import {
  createLynxBackupDeps,
  createLynxBackupWiring,
  clearPreRestoreSnapshot,
  loadPreRestoreSnapshot,
  undoLastRestore,
} from '../services/backupWiring'
import { isNativeMode } from '../api/client'
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

const auth = useAuthStore()
const settings = useSettingsStore()
const clientSwitch = useClientSwitchStore()
const { showR18, showR18G, aiFilterMode, ugoiraMode, ugoiraDownloadFormat, detailQuality, themeColor, novelExportFormat, novelExportOptions, relatedInjection } = storeToRefs(settings)

const switching = ref(false)

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
  // M3：敏感项候选 = 当前账号级键（show_r18_* / show_r18g_* / ai_filter_mode_*）
  const raw = await settings.exportRawValues()
  webdavSensitiveKeys.value = Object.keys(raw).filter(
    (k) => k.startsWith('show_r18_') || k.startsWith('show_r18g_') || k.startsWith('ai_filter_mode_'),
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
onMounted(async () => {
  unreg = useGlobalFabStore().usePage('me', {})
  await ensureAuth()
  refreshWebdavLastBackupLabel()
  if (settings.webdavEnabled) await loadWebdavCredentials()
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

function openDownloads() {
  void navigate('/downloads')
}

function openNetworkCheck() {
  void navigate('/network-check')
}

function pickClient(kind: ClientKind) {
  if (clientSwitch.selectedClient === kind || switching.value) return
  switching.value = true
  clientSwitch.switchClient(kind)
  // switchClient 内部触发重启（原生桥或 reload），此处仅兜底
}

// ADR-0051：R18/R18G 开关（对齐主项目 settingsStore，默认隐藏，持久化 IndexedDB）
// T6：动图播放方案——Range 需二次确认
const ugoiraConfirm = ref(false)

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

function toggleR18() {
  settings.setShowR18(!showR18.value)
}
function toggleR18G() {
  settings.setShowR18G(!showR18G.value)
}
function toggleRelatedInjection() {
  settings.setRelatedInjection(!relatedInjection.value)
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
            <text class="text-headline-small font-bold text-surface-on">{{ auth.currentUser.name }}</text>
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
          <text class="text-title-medium text-surface-on-variant">›</text>
        </view>
        <!-- 追更列表入口（issue #225 / spec §US7）：账户组第二行 -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.watchlist"
          @tap="openWatchlist"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.watchlist') }}</text>
          <text class="text-title-medium text-surface-on-variant">›</text>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.downloads"
          @tap="openDownloads"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.downloads') }}</text>
          <text class="text-title-medium text-surface-on-variant">›</text>
        </view>
        <!-- 网络自检入口（spec docs/specs/network-self-check.md / #445） -->
        <view
          class="flex flex-row items-center justify-between py-3.5"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.networkCheck"
          @tap="openNetworkCheck"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.networkCheck') }}</text>
          <text class="text-title-medium text-surface-on-variant">›</text>
        </view>
      </GlassCard>

      <!-- 客户端组（ADR-0062：仅 full 包同时含 webview+lynx 时渲染；独立包隐藏） -->
      <view v-if="supportsClientSwitch(clientSwitch.availableKinds)" class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text
          class="text-title-small font-medium text-surface-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.clientGroupTitle"
          >{{ t('me.client.title') }}</text
        >
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.client.hint') }}</text>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.switchToWebview"
          @tap="pickClient('webview')"
        >
          <view class="flex flex-col">
            <text
              class="text-title-medium text-surface-on"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webviewOptionTitle"
              >{{ t('me.client.webview') }}</text
            >
            <text class="text-label-medium text-surface-on-variant mt-0.5">SolidJS + Capacitor</text>
          </view>
          <!-- M3 radio button：选中 primary 实心 + on-primary 圆点，未选 outline 空心 -->
          <view
            class="w-[5.333vw] h-[5.333vw] rounded-full flex items-center justify-center active:bg-layer-pressed-on-surface"
            :class="clientSwitch.selectedClient === 'webview' ? 'bg-primary' : 'border-2 border-outline'"
          >
            <view v-if="clientSwitch.selectedClient === 'webview'" class="w-[2.667vw] h-[2.667vw] rounded-full bg-primary-on" />
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.switchToLynx"
          @tap="pickClient('lynx')"
        >
          <view class="flex flex-col">
            <text
              class="text-title-medium text-surface-on"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.lynxOptionTitle"
              >{{ t('me.client.lynx') }}</text
            >
            <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('me.client.lynxHint') }}</text>
          </view>
          <view
            class="w-[5.333vw] h-[5.333vw] rounded-full flex items-center justify-center active:bg-layer-pressed-on-surface"
            :class="clientSwitch.selectedClient === 'lynx' ? 'bg-primary' : 'border-2 border-outline'"
          >
            <view v-if="clientSwitch.selectedClient === 'lynx'" class="w-[2.667vw] h-[2.667vw] rounded-full bg-primary-on" />
          </view>
        </view>
        <text v-if="switching" class="text-body-small text-primary mt-3">{{ t('me.client.restarting') }}</text>
      </view>

      <!-- 外观组（主题色）：色板类 .theme-* 定义在 tokens.css，根 <page> 应用即整体换色；
           色块自身加对应色板类（默认 sky 用 .theme-sky，与基础 page 色板共用规则）+ bg-primary 预览该色板主色。 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.appearance.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.appearance.themeColorHint') }}</text>
        <view class="flex flex-row items-start justify-between">
          <view class="flex flex-col items-center gap-1">
            <!-- 天蓝（默认） -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'sky' ? 'border-primary' : 'border-transparent', themeColorClass('sky')]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorSky"
              @tap="settings.setThemeColor('sky')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <text v-if="themeColor === 'sky'" class="text-primary-on text-label-small">✓</text>
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorSky') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 紫罗兰 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'violet' ? 'border-primary' : 'border-transparent', themeColorClass('violet')]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorViolet"
              @tap="settings.setThemeColor('violet')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <text v-if="themeColor === 'violet'" class="text-primary-on text-label-small">✓</text>
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorViolet') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 樱花粉 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'pink' ? 'border-primary' : 'border-transparent', themeColorClass('pink')]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorPink"
              @tap="settings.setThemeColor('pink')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <text v-if="themeColor === 'pink'" class="text-primary-on text-label-small">✓</text>
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorPink') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 松柏绿 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'green' ? 'border-primary' : 'border-transparent', themeColorClass('green')]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorGreen"
              @tap="settings.setThemeColor('green')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <text v-if="themeColor === 'green'" class="text-primary-on text-label-small">✓</text>
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorGreen') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 落日橙 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'orange' ? 'border-primary' : 'border-transparent', themeColorClass('orange')]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorOrange"
              @tap="settings.setThemeColor('orange')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <text v-if="themeColor === 'orange'" class="text-primary-on text-label-small">✓</text>
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorOrange') }}</text>
          </view>
          <view class="flex flex-col items-center gap-1">
            <!-- 深青 -->
            <view
              class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"
              :class="[themeColor === 'teal' ? 'border-primary' : 'border-transparent', themeColorClass('teal')]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.themeColorTeal"
              @tap="settings.setThemeColor('teal')"
            >
              <view class="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <text v-if="themeColor === 'teal'" class="text-primary-on text-label-small">✓</text>
              </view>
            </view>
            <text class="text-label-small text-surface-on-variant">{{ t('me.appearance.colorTeal') }}</text>
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
          <!-- M3 switch（官方 token v0.192 + _handle.scss）：轨道 52×32dp；
               thumb 外层 32×32 handle-container 居中定位（未选中 16dp→距左 8px，
               选中 24dp→距右 4px，按压 28dp 居中不溢出）；未选中轨道 2dp outline 边框 -->
          <view
            class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
            :class="showR18 ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
          >
            <!-- handle-container：32×32 与轨道同高，thumb 居中 → 距边 8px/4px -->
            <view class="w-8 h-8 flex items-center justify-center">
              <view class="rounded-full active:w-[7.467vw] active:h-[7.467vw]" :class="showR18 ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
            </view>
          </view>
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.r18gToggle"
          @tap="toggleR18G"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.showR18G') }}</text>
          <view
            class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
            :class="showR18G ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
          >
            <!-- handle-container：32×32 与轨道同高，thumb 居中 → 距边 8px/4px -->
            <view class="w-8 h-8 flex items-center justify-center">
              <view class="rounded-full active:w-[7.467vw] active:h-[7.467vw]" :class="showR18G ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
            </view>
          </view>
        </view>

        <!-- 相关作品注入行开关（spec docs/specs/related-injection.md）：设备级，默认开 -->
        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.relatedInjectionToggle"
          @tap="toggleRelatedInjection"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.content.relatedInjection') }}</text>
          <view
            class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
            :class="relatedInjection ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
          >
            <view class="w-8 h-8 flex items-center justify-center">
              <view class="rounded-full active:w-[7.467vw] active:h-[7.467vw]" :class="relatedInjection ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
            </view>
          </view>
        </view>

        <!-- AI 作品三态过滤（ADR-0155）：显示 / 遮罩 / 仅看；逐项静态 a11y label（注册表完整性测试要求） -->
        <view class="flex flex-row items-center justify-between py-3.5">
          <text class="text-title-medium text-surface-on">{{ t('me.content.ai') }}</text>
          <view class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden">
            <view
              class="flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface"
              :class="aiFilterMode === 'show' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.aiFilterShow"
              @tap="settings.setAiFilterMode('show')"
            >
              <text class="text-label-large" :class="aiFilterMode === 'show' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.content.aiShow') }}</text>
            </view>
            <view
              class="flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface"
              :class="aiFilterMode === 'mask' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.aiFilterMask"
              @tap="settings.setAiFilterMode('mask')"
            >
              <text class="text-label-large" :class="aiFilterMode === 'mask' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.content.aiMask') }}</text>
            </view>
            <view
              class="flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface"
              :class="aiFilterMode === 'only' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.aiFilterOnly"
              @tap="settings.setAiFilterMode('only')"
            >
              <text class="text-label-large" :class="aiFilterMode === 'only' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.content.aiOnly') }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- T6：动图播放组 -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.ugoira.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.ugoira.hint') }}</text>
        <!-- M3 segmented button：容器 outline 边框 + 全圆角，40dp 高，选中段 secondary-container -->
        <view class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden">
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface"
            :class="ugoiraMode === 'fflate' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraFflate"
            @tap="pickUgoiraMode('fflate')"
          >
            <text class="text-label-large" :class="ugoiraMode === 'fflate' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.ugoira.fflate') }}</text>
          </view>
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center border-l border-l-outline active:bg-layer-pressed-on-surface"
            :class="ugoiraMode === 'range' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.ugoiraRange"
            @tap="pickUgoiraMode('range')"
          >
            <text class="text-label-large" :class="ugoiraMode === 'range' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.ugoira.range') }}</text>
          </view>
        </view>
        <text class="text-label-medium text-surface-on-variant mt-2 leading-snug">
          {{ t('me.ugoira.rangeHint') }}
        </text>
      </view>

      <!-- issue #148 T2：详情画质档位组（medium=标准 / large=高清 / original=原图） -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('me.quality.title') }}</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.quality.hint') }}</text>
        <!-- M3 segmented button（三档）：容器 outline 边框 + 全圆角，40dp 高，选中段 secondary-container -->
        <view class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden">
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface"
            :class="detailQuality === 'medium' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityMedium"
            @tap="pickDetailQuality('medium')"
          >
            <text class="text-label-large" :class="detailQuality === 'medium' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.quality.medium') }}</text>
          </view>
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center border-l border-l-outline active:bg-layer-pressed-on-surface"
            :class="detailQuality === 'large' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityLarge"
            @tap="pickDetailQuality('large')"
          >
            <text class="text-label-large" :class="detailQuality === 'large' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.quality.large') }}</text>
          </view>
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center border-l border-l-outline active:bg-layer-pressed-on-surface"
            :class="detailQuality === 'original' ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.detailQualityOriginal"
            @tap="pickDetailQuality('original')"
          >
            <text class="text-label-large" :class="detailQuality === 'original' ? 'text-secondary-on-container' : 'text-surface-on'">{{ t('me.quality.original') }}</text>
          </view>
        </view>
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
            <view
              class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
              :class="novelExportOptions.includeMetadata ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
            >
              <view class="w-8 h-8 flex items-center justify-center">
                <view class="rounded-full" :class="novelExportOptions.includeMetadata ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
              </view>
            </view>
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
            <view
              class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
              :class="novelExportOptions.includeCover ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
            >
              <view class="w-8 h-8 flex items-center justify-center">
                <view class="rounded-full" :class="novelExportOptions.includeCover ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
              </view>
            </view>
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
            <view
              class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
              :class="novelExportOptions.includeInlineImages ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
            >
              <view class="w-8 h-8 flex items-center justify-center">
                <view class="rounded-full" :class="novelExportOptions.includeInlineImages ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'" />
              </view>
            </view>
          </view>
        </view>
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
        <text class="text-title-small font-medium text-surface-on">WebDAV 备份</text>
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('me.webdav.hint') }}</text>

        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ME_A11Y_LABELS.webdavToggle"
          @tap="toggleWebdavEnabled"
        >
          <text class="text-title-medium text-surface-on">{{ t('me.webdav.enabled') }}</text>
          <view class="w-[13.867vw] h-[8.533vw] rounded-full flex items-center px-[1.067vw]"
            :class="settings.webdavEnabled ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start'">
            <view class="w-[6.4vw] h-[6.4vw] rounded-full" :class="settings.webdavEnabled ? 'bg-primary-on' : 'bg-outline'" />
          </view>
        </view>

        <template v-if="settings.webdavEnabled">
          <!-- M1：v-model 直改 ref 不落盘——@input 追加调用 setter 持久化（vue-lynx 保证 v-model 先于 @input） -->
          <input
            v-model="settings.webdavUrl"
            class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] text-body-large text-surface-on px-4 mt-3"
            placeholder="https://dav.example.com/remote.php/dav/files/me/"
            placeholder-color="#41474e"
            @input="onWebdavFieldInput('url', $event)"
          />
          <!-- M4：非 HTTPS 警告（spec §7） -->
          <text
            v-if="settings.webdavUrl !== '' && !settings.webdavUrl.startsWith('https://')"
            class="text-label-medium text-error mt-1"
          >
            非 HTTPS 连接存在泄露风险
          </text>
          <input
            v-model="settings.webdavUsername"
            class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] text-body-large text-surface-on px-4 mt-3"
            placeholder="用户名"
            placeholder-color="#41474e"
            @input="onWebdavFieldInput('username', $event)"
          />
          <!-- B1：密码输入框不可逆显（spec §7） -->
          <input
            v-model="webdavLoginPassword"
            type="password"
            class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] text-body-large text-surface-on px-4 mt-3"
            placeholder="密码（加密存储）"
            placeholder-color="#41474e"
          />
          <input
            v-model="settings.webdavDir"
            class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] text-body-large text-surface-on px-4 mt-3"
            placeholder="目录（默认 Pictelio/backup）"
            placeholder-color="#41474e"
            @input="onWebdavFieldInput('dir', $event)"
          />
          <input
            v-model="webdavBackupPassword"
            type="password"
            class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] text-body-large text-surface-on px-4 mt-3"
            placeholder="备份密码（可选，加密备份文件）"
            placeholder-color="#41474e"
          />
          <!-- M3：敏感项排除（spec §7；账号级敏感键勾选后不进备份文件） -->
          <view
            v-if="webdavSensitiveKeys.length > 0"
            class="mt-3"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.webdavSensitiveGroup"
          >
            <text class="text-label-medium text-surface-on-variant">敏感项排除（勾选后不进入备份文件）</text>
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
            <text class="text-title-medium text-surface-on">启动时自动备份</text>
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

          <text class="text-label-medium text-surface-on-variant mt-3">上次备份：{{ webdavLastBackupLabel }}</text>

          <view class="flex flex-row gap-2 mt-3">
            <view
              class="flex-1 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webdavTest"
              @tap="onWebdavTest"
            >
              <text class="text-label-large text-surface-on">连接测试</text>
            </view>
            <view
              class="flex-1 h-[10.667vw] bg-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="ME_A11Y_LABELS.webdavBackup"
              @tap="onWebdavBackup"
            >
              <text class="text-label-large font-medium text-primary-on">立即备份</text>
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
              <text class="text-label-large text-surface-on">撤销上次恢复</text>
            </view>
          </view>

          <view
            v-if="webdavShowRestore"
            class="mt-3"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ME_A11Y_LABELS.webdavRestoreFiles"
          >
            <text class="text-label-medium text-surface-on-variant">选择要恢复的备份</text>
            <view v-for="file in webdavFiles" :key="file.name" class="py-2.5" @tap="onWebdavSelectFile(file)">
              <text class="text-body-medium" :class="webdavSelected?.name === file.name ? 'text-primary' : 'text-surface-on'">
                {{ file.name }}{{ file.encrypted ? t('me.webdav.encryptedBadge') : '' }}
              </text>
            </view>
            <!-- S7：加密档且无已保存备份密码 → 本次输入 -->
            <view v-if="webdavNeedsPassword && webdavSelected" class="mt-2">
              <text class="text-label-medium text-surface-on-variant">{{ t('me.webdav.encryptedPrompt') }}</text>
              <input
                v-model="webdavPromptPassword"
                type="password"
                class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] text-body-large text-surface-on px-4 mt-2"
                :placeholder="t('me.webdav.restorePromptPlaceholder')"
                placeholder-color="#41474e"
              />
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
                恢复会覆盖本机对应设置（仅覆盖备份中存在的键），恢复前自动保存应急快照。
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
                <text class="text-label-large text-error-on">确认恢复</text>
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
        <text class="text-headline-small font-medium text-surface-on">{{ t('me.ugoira.confirmTitle') }}</text>
        <text class="text-body-medium text-surface-on-variant mt-4 leading-snug">
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
