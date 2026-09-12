// ─── 内容设置（R18/R18G 开关，ADR-0051 + 动图播放方案 T6 + 详情页画质 T1） ───
// ADR-0103：R18/R18G 改为账号级设置（键 show_r18_${uid}），经 PrefsStorage seam 读写
// 共享 SharedPreferences "CapacitorStorage"（与 webview client 同契约，跨引擎同步）。
// - 原生 LynxView：NativeModules.PictelioPrefs（真实产品面，修复"每次启动重置"）
// - web-core dev 预览：IndexedDB KV（无 NativeModules，仅开发环境）
// ugoiraMode / detailQuality 仍走 idbKV（非账号级，不在本次范围）。
// x_restrict: 0=全年龄, 1=R-18, 2=R-18G
// Pinia 化（ADR-0139 / spec #337）：setup store——state 移入 defineStore 闭包为私有 ref
//（不 return，物理私有替代原 `_` 命名约定）；公共 state 以同名 getter 暴露（setup store
// 自动解包，模板 / .value 皆可，与原模块级 ref 行为等价）；actions 逐字搬入（行为零变化，
// 纯重构约束）。跨 store 消费：setup 内 `useAuthStore()` 读 currentUser（替换原模块级
// `import { currentUser } from "./authStore"`），watch 在 setup 内注册（仅在首次
// useSettingsStore() 时挂载；晚于原模块加载期，login/initRouter 调用前 pinia 已就绪）。
import { ref, watch } from "vue"
import { defineStore } from "pinia"
import { idbGet, idbSet, idbRemove } from "../utils/idbKV"
import { getNativeModules, isNativeMode } from "../api/client"
import { useAuthStore } from "./authStore"
import { unquoteNativeString } from "../utils/tokenStorage"
import type { ImageQuality } from "../utils/imageQuality"
import type { UgoiraExtractMode } from "../api/ugoira"
import { UGOIRA_FORMATS, type UgoiraFormat } from "../utils/downloadQueueCore"
import {
  DEFAULT_NOVEL_EXPORT_FORMAT,
  DEFAULT_NOVEL_EXPORT_OPTIONS,
  NOVEL_EXPORT_FORMATS,
  type NovelExportFormat,
  type NovelExportOptions,
} from "@pictelio/novel-export"
import { DEFAULT_THEME_COLOR, isThemeColorId, type ThemeColorId } from "../utils/themeColor"

// ── 跨 client 契约键（ADR-0103：与 webview settingsStore defineFactory 同格式）──
const r18Key = (uid: number) => `show_r18_${uid}`
const r18gKey = (uid: number) => `show_r18g_${uid}`
/** 老设备级键（webview 遗留，SharedPreferences）——native 环境迁移源 */
const LEGACY_R18 = "show_r18"
const LEGACY_R18G = "show_r18g"
/** lynx dev（web-core IndexedDB）遗留键 */
const DEV_LEGACY_R18 = "settings_show_r18"
const DEV_LEGACY_R18G = "settings_show_r18g"
/** AI 三态过滤（ADR-0155）：账号级共享键（与 app 同契约），无 legacy 键 */
const aiFilterModeKey = (uid: number) => `ai_filter_mode_${uid}`
/** AI 模式：show 显示 / mask 遮罩 / only 仅看 */
export type AiFilterMode = "show" | "mask" | "only"
function isAiFilterMode(v: unknown): v is AiFilterMode {
  return v === "show" || v === "mask" || v === "only"
}

const UGOIRA_MODE_KEY = "settings_ugoira_mode"
/** 全局动图下载格式（与 app 包共享键，spec download-manager §5） */
const UGOIRA_DOWNLOAD_FORMAT_KEY = "settings_ugoira_download_format"
const DETAIL_QUALITY_KEY = "settings_detail_quality"
/** 主题色（外观）：设备级共享键（native SharedPreferences / dev IndexedDB），未登录也恢复 */
const THEME_COLOR_KEY = "settings_theme_color"
/** 相关作品注入行（spec docs/specs/related-injection.md）：设备级开关，默认开；键与 app 逐字一致 */
const RELATED_INJECTION_KEY = "related_injection"
/** 小说导出（spec docs/specs/novel-export.md §6）：全局默认格式 + 三项内容开关（与 app 共享键） */
const NOVEL_EXPORT_FORMAT_KEY = "settings_novel_export_format"
const NOVEL_EXPORT_INCLUDE_METADATA_KEY = "settings_novel_export_include_metadata"
const NOVEL_EXPORT_INCLUDE_COVER_KEY = "settings_novel_export_include_cover"
const NOVEL_EXPORT_INCLUDE_IMAGES_KEY = "settings_novel_export_include_images"
// WebDAV 连接配置（spec docs/specs/webdav-backup.md §7/§8；跨引擎共享键，
// 键字符串与 app settingsStore 逐字一致，app 侧契约测试 differential/webdavSettingsConsistency 防漂移）
const WEBDAV_ENABLED_KEY = "settings_webdav_enabled"
const WEBDAV_URL_KEY = "settings_webdav_url"
const WEBDAV_USERNAME_KEY = "settings_webdav_username"
const WEBDAV_DIR_KEY = "settings_webdav_dir"
const WEBDAV_AUTO_BACKUP_KEY = "settings_webdav_auto_backup"
const WEBDAV_AUTO_BACKUP_DAYS_KEY = "settings_webdav_auto_backup_days"
const WEBDAV_LAST_BACKUP_KEY = "settings_webdav_last_backup"
const WEBDAV_EXCLUDED_KEYS_KEY = "settings_webdav_excluded_keys"

/**
 * 备份域设备级键清单（spec docs/specs/webdav-backup.md §3.1）：与 app settingsStore
 * 的持久化设置键对齐；sets 在 app-lynx 暂无对应 store（无屏蔽/举报功能），
 * 因此 lynx 备份的 sets 为空对象（跨引擎恢复时由 app 侧 sets 覆盖）。
 */
export const BACKUP_DEVICE_KEYS = [
  UGOIRA_MODE_KEY,
  UGOIRA_DOWNLOAD_FORMAT_KEY,
  DETAIL_QUALITY_KEY,
  THEME_COLOR_KEY,
  NOVEL_EXPORT_FORMAT_KEY,
  NOVEL_EXPORT_INCLUDE_METADATA_KEY,
  NOVEL_EXPORT_INCLUDE_COVER_KEY,
  NOVEL_EXPORT_INCLUDE_IMAGES_KEY,
  WEBDAV_ENABLED_KEY,
  WEBDAV_URL_KEY,
  WEBDAV_USERNAME_KEY,
  WEBDAV_DIR_KEY,
  WEBDAV_AUTO_BACKUP_KEY,
  WEBDAV_AUTO_BACKUP_DAYS_KEY,
  WEBDAV_LAST_BACKUP_KEY,
  WEBDAV_EXCLUDED_KEYS_KEY,
] as const

/** 备份域账号级键（spec §3.1；恢复按当前 uid 过滤，spec §6） */
export function backupAccountKeys(uid: number): string[] {
  return [r18Key(uid), r18gKey(uid), aiFilterModeKey(uid)]
}

/**
 * 仅走 idbKV 的设备级键（native 与 web-core 一致——见 loadSettings 与对应 setter）：
 * exportRawValues 必须双源读取，否则这些键会静默漏出备份域（本文件 loadSettings
 * 的 ugoiraMode/detailQuality 即直接读 idbGet，不经 PrefsStorage seam）。
 */
const BACKUP_IDB_KEYS = [UGOIRA_MODE_KEY, DETAIL_QUALITY_KEY] as const

// ── PrefsStorage seam（ADR-0103 决策 3：两 adapter = 真 seam）──

interface PrefsStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** 原生 adapter：NativeModules.PictelioPrefs → SharedPreferences "CapacitorStorage"（webview 同文件） */
function nativePrefs(): PrefsStorage {
  const mod = getNativeModules()?.PictelioPrefs as
    | {
        prefsGet(key: string, callback: (value: string, err: string | null) => void): void
        prefsSet(key: string, value: string, callback: (err: string | null) => void): void
        prefsRemove(key: string, callback: (err: string | null) => void): void
      }
    | undefined
  return {
    get(key) {
      return new Promise((resolve) => {
        if (!mod) {
          console.warn("[settingsStore] 原生 PictelioPrefs 不可用（按缺失处理）")
          resolve(null)
          return
        }
        mod.prefsGet(key, (value, err) => {
          if (err) {
            console.warn("[settingsStore] 原生读取失败", err)
            resolve(null)
            return
          }
          // lynx Callback 的字符串参数带 JSON 引号（tokenStorage 同款坑）——unquote；
          // 键不存在时 Java 返回 ""（契约），映射为 null。
          resolve(value === "" ? null : unquoteNativeString(value))
        })
      })
    },
    set(key, value) {
      return new Promise((resolve, reject) => {
        if (!mod) {
          console.warn("[settingsStore] 原生 PictelioPrefs 不可用（写失败）")
          reject(new Error("native prefs unavailable"))
          return
        }
        mod.prefsSet(key, value, (err) => {
          if (err) {
            console.warn("[settingsStore] 原生写入失败", err)
            reject(new Error(err))
          } else {
            resolve()
          }
        })
      })
    },
    remove(key) {
      return new Promise((resolve, reject) => {
        if (!mod) {
          console.warn("[settingsStore] 原生 PictelioPrefs 不可用（删失败）")
          reject(new Error("native prefs unavailable"))
          return
        }
        mod.prefsRemove(key, (err) => {
          if (err) {
            console.warn("[settingsStore] 原生删除失败", err)
            reject(new Error(err))
          } else {
            resolve()
          }
        })
      })
    },
  }
}

/** dev adapter：IndexedDB KV（web-core Worker 环境唯一持久化手段） */
function devPrefs(): PrefsStorage {
  return { get: idbGet, set: idbSet, remove: idbRemove }
}

/** 环境适配：原生 LynxView → 共享 SharedPreferences；web-core dev → IndexedDB */
function prefs(): PrefsStorage {
  return isNativeMode() ? nativePrefs() : devPrefs()
}

/** 迁移：账号键缺失且老键存在 → 播种 → 删老键（先写后删，幂等） */
async function migrateLegacy(
  storage: PrefsStorage,
  legacyKey: string,
  accountKey: string,
): Promise<void> {
  const existing = await storage.get(accountKey)
  if (existing !== null) return
  const legacy = await storage.get(legacyKey)
  if (legacy === null) return
  await storage.set(accountKey, legacy)
  await storage.remove(legacyKey)
}

export const useSettingsStore = defineStore("settings", () => {
  // ── 私有 state（闭包内 ref，不 return —— 物理私有，替代原 `_` 命名约定）──
  const _showR18 = ref(false)
  const _showR18G = ref(false)
  const _aiFilterMode = ref<AiFilterMode>("show")
  const _ugoiraMode = ref<UgoiraExtractMode>("fflate")
  const _ugoiraDownloadFormat = ref<UgoiraFormat>("zip")
  const _detailQuality = ref<ImageQuality>("medium")
  const _themeColor = ref<ThemeColorId>(DEFAULT_THEME_COLOR)
  const _relatedInjection = ref(true)
  const _novelExportFormat = ref<NovelExportFormat>(DEFAULT_NOVEL_EXPORT_FORMAT)
  const _novelExportOptions = ref<NovelExportOptions>({ ...DEFAULT_NOVEL_EXPORT_OPTIONS })

  // WebDAV 连接配置（设备级，默认与 app §7 逐字一致）
  const _webdavEnabled = ref(false)
  const _webdavUrl = ref("")
  const _webdavUsername = ref("")
  const _webdavDir = ref("Pictelio/backup")
  const _webdavAutoBackup = ref(false)
  const _webdavAutoBackupDays = ref(7)
  const _webdavLastBackup = ref("")
  const _webdavExcludedKeys = ref<string[]>([])

  // ── 跨 store 组合：读 authStore.currentUser.id 推导 uid（替换原模块级 currentUser import）
  const auth = useAuthStore()
  /** 当前账号 ID（未登录 null）——登出由下方 watch 兜底重置 refs */
  const uid = (): number | null => auth.currentUser?.id ?? null

  // ── 公共 state（return —— setup store 自动解包，模板 / `.value` 皆可）──
  const showR18 = _showR18
  const showR18G = _showR18G
  const aiFilterMode = _aiFilterMode
  const ugoiraMode = _ugoiraMode
  const ugoiraDownloadFormat = _ugoiraDownloadFormat
  const detailQuality = _detailQuality
  const themeColor = _themeColor
  const relatedInjection = _relatedInjection
  const novelExportFormat = _novelExportFormat
  const novelExportOptions = _novelExportOptions
  const webdavEnabled = _webdavEnabled
  const webdavUrl = _webdavUrl
  const webdavUsername = _webdavUsername
  const webdavDir = _webdavDir
  const webdavAutoBackup = _webdavAutoBackup
  const webdavAutoBackupDays = _webdavAutoBackupDays
  const webdavLastBackup = _webdavLastBackup
  const webdavExcludedKeys = _webdavExcludedKeys

  // ── 公共 actions（return）──

  /**
   * 加载设置（initRouter 在 restoreToken 之后调用，此时 uid 已知）。
   * R18/R18G 走账号级共享存储 + 迁移；ugoira/detailQuality 走 idbKV（非账号级）。
   */
  async function loadSettings(): Promise<void> {
    const [ugoira, detailQ] = await Promise.all([idbGet(UGOIRA_MODE_KEY), idbGet(DETAIL_QUALITY_KEY)])
    if (ugoira === "fflate" || ugoira === "range") _ugoiraMode.value = ugoira
    if (detailQ === "medium" || detailQ === "large" || detailQ === "original") _detailQuality.value = detailQ

    // 全局动图下载格式：native 走共享 SharedPreferences（与 webview 同键），dev 走 idbKV
    try {
      const raw = await prefs().get(UGOIRA_DOWNLOAD_FORMAT_KEY)
      if (raw !== null) {
        if ((UGOIRA_FORMATS as readonly string[]).includes(raw)) {
          _ugoiraDownloadFormat.value = raw as UgoiraFormat
        } else {
          console.warn("[settingsStore] ugoira 下载格式值非法，维持默认 zip:", raw)
        }
      }
    } catch (e) {
      console.warn("[settingsStore] ugoira 下载格式加载失败（维持默认）", e)
    }

    // 主题色（外观）：设备级，未登录也需要恢复（先于 uid 判定）
    try {
      const raw = await prefs().get(THEME_COLOR_KEY)
      if (raw !== null) {
        if (isThemeColorId(raw)) {
          _themeColor.value = raw
        } else {
          console.warn("[settingsStore] 主题色值非法，维持默认:", raw)
        }
      }
    } catch (e) {
      console.warn("[settingsStore] 主题色加载失败（维持默认）", e)
    }

    // 相关作品注入（spec docs/specs/related-injection.md）：设备级，未登录也恢复
    try {
      const raw = await prefs().get(RELATED_INJECTION_KEY)
      if (raw === "true") _relatedInjection.value = true
      else if (raw === "false") _relatedInjection.value = false
      else if (raw !== null) {
        console.warn("[settingsStore] 相关作品注入开关值非法，维持默认 true:", raw)
      }
    } catch (e) {
      console.warn("[settingsStore] 相关作品注入开关加载失败（维持默认）", e)
    }

    // 小说导出：全局默认格式 + 三项内容开关（native 共享 SharedPreferences / dev idbKV）
    try {
      const rawFormat = await prefs().get(NOVEL_EXPORT_FORMAT_KEY)
      if (rawFormat !== null) {
        if ((NOVEL_EXPORT_FORMATS as readonly string[]).includes(rawFormat)) {
          _novelExportFormat.value = rawFormat as NovelExportFormat
        } else {
          console.warn("[settingsStore] 小说导出格式值非法，维持默认 txt:", rawFormat)
        }
      }
      const opts: NovelExportOptions = { ...DEFAULT_NOVEL_EXPORT_OPTIONS }
      const toggleKeys = [
        [NOVEL_EXPORT_INCLUDE_METADATA_KEY, "includeMetadata"],
        [NOVEL_EXPORT_INCLUDE_COVER_KEY, "includeCover"],
        [NOVEL_EXPORT_INCLUDE_IMAGES_KEY, "includeInlineImages"],
      ] as const
      for (const [key, field] of toggleKeys) {
        const raw = await prefs().get(key)
        if (raw === "true" || raw === "false") {
          opts[field] = raw === "true"
        } else if (raw !== null) {
          console.warn(`[settingsStore] 小说导出开关值非法，维持默认（${key}）:`, raw)
        }
      }
      _novelExportOptions.value = opts
    } catch (e) {
      console.warn("[settingsStore] 小说导出设置加载失败（维持默认）", e)
    }

    // WebDAV 连接配置：设备级，未登录也加载（恢复配置无需登录）
    try {
      const p = prefs()
      // 布尔键：值损坏（非 true/false 的非 null 值）warn 可见（禁静默降级，
      // 对齐小说导出开关先例与 app 侧 registry corrupt warn 行为）
      const enabled = await p.get(WEBDAV_ENABLED_KEY)
      if (enabled === "true") _webdavEnabled.value = true
      else if (enabled !== null && enabled !== "false") {
        console.warn("[settingsStore] WebDAV 开关值非法，维持默认 false:", enabled)
      }
      const url = await p.get(WEBDAV_URL_KEY)
      if (url !== null) _webdavUrl.value = url
      const username = await p.get(WEBDAV_USERNAME_KEY)
      if (username !== null) _webdavUsername.value = username
      const dir = await p.get(WEBDAV_DIR_KEY)
      if (dir !== null) _webdavDir.value = dir
      const auto = await p.get(WEBDAV_AUTO_BACKUP_KEY)
      if (auto === "true") _webdavAutoBackup.value = true
      else if (auto !== null && auto !== "false") {
        console.warn("[settingsStore] WebDAV 自动备份开关值非法，维持默认 false:", auto)
      }
      const days = await p.get(WEBDAV_AUTO_BACKUP_DAYS_KEY)
      if (days !== null) {
        const n = Number(days)
        if (Number.isInteger(n) && n >= 1 && n <= 30) {
          _webdavAutoBackupDays.value = n
        } else {
          console.warn("[settingsStore] WebDAV 自动备份周期非法，维持默认 7:", days)
        }
      }
      const last = await p.get(WEBDAV_LAST_BACKUP_KEY)
      if (last !== null) _webdavLastBackup.value = last
      // 注：prefs adapter 的 get 已做 unquoteNativeString（native 路径），此处直接解析
      const rawExcluded = await p.get(WEBDAV_EXCLUDED_KEYS_KEY)
      if (rawExcluded !== null) {
        try {
          const parsed: unknown = JSON.parse(rawExcluded)
          if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
            _webdavExcludedKeys.value = parsed
          } else {
            console.warn("[settingsStore] WebDAV 排除清单非法，维持默认空:", rawExcluded)
          }
        } catch {
          console.warn("[settingsStore] WebDAV 排除清单解析失败，维持默认空:", rawExcluded)
        }
      }
    } catch (e) {
      console.warn("[settingsStore] WebDAV 连接配置加载失败（维持默认）", e)
    }

    const id = uid()
    if (id === null) {
      _showR18.value = false
      _showR18G.value = false
      _aiFilterMode.value = "show"
      return
    }
    const storage = prefs()
    const legacy = isNativeMode()
      ? ([LEGACY_R18, LEGACY_R18G] as const)
      : ([DEV_LEGACY_R18, DEV_LEGACY_R18G] as const)
    try {
      await migrateLegacy(storage, legacy[0], r18Key(id))
      await migrateLegacy(storage, legacy[1], r18gKey(id))
      _showR18.value = (await storage.get(r18Key(id))) === "true"
      _showR18G.value = (await storage.get(r18gKey(id))) === "true"
      const rawAi = await storage.get(aiFilterModeKey(id))
      if (rawAi === null) {
        _aiFilterMode.value = "show"
      } else if (isAiFilterMode(rawAi)) {
        _aiFilterMode.value = rawAi
      } else {
        console.warn("[settingsStore] AI 模式值非法，维持默认 show:", rawAi)
        _aiFilterMode.value = "show"
      }
    } catch (e) {
      // 存储不可用：维持默认（静默降级规则：warn 可见）
      console.warn("[settingsStore] 账号级设置加载失败（维持默认）", e)
      _showR18.value = false
      _showR18G.value = false
      _aiFilterMode.value = "show"
    }
  }

  function setShowR18(enabled: boolean): void {
    _showR18.value = enabled
    const id = uid()
    if (id === null) return // 未登录不落盘（账号级语义）
    void prefs()
      .set(r18Key(id), String(enabled))
      .catch((e) => console.warn("[settingsStore] R18 写入失败", e))
  }

  function setShowR18G(enabled: boolean): void {
    _showR18G.value = enabled
    const id = uid()
    if (id === null) return
    void prefs()
      .set(r18gKey(id), String(enabled))
      .catch((e) => console.warn("[settingsStore] R18G 写入失败", e))
  }

  /** 设置 AI 三态（账号级，未登录不落盘；ADR-0155） */
  function setAiFilterMode(mode: AiFilterMode): void {
    _aiFilterMode.value = mode
    const id = uid()
    if (id === null) return
    void prefs()
      .set(aiFilterModeKey(id), mode)
      .catch((e) => console.warn("[settingsStore] AI 模式写入失败", e))
  }

  function setUgoiraDownloadFormat(format: UgoiraFormat): void {
    _ugoiraDownloadFormat.value = format
    void prefs()
      .set(UGOIRA_DOWNLOAD_FORMAT_KEY, format)
      .catch((e) => console.warn("[settingsStore] ugoira 下载格式写入失败", e))
  }

  function setUgoiraMode(mode: UgoiraExtractMode): void {
    _ugoiraMode.value = mode
    void idbSet(UGOIRA_MODE_KEY, mode).catch(() => {
      /* IndexedDB 不可用则维持内存态 */
    })
  }

  function setDetailQuality(quality: ImageQuality): void {
    _detailQuality.value = quality
    void idbSet(DETAIL_QUALITY_KEY, quality).catch(() => {
      /* IndexedDB 不可用则维持内存态 */
    })
  }

  function setThemeColor(id: ThemeColorId): void {
    _themeColor.value = id
    void prefs()
      .set(THEME_COLOR_KEY, id)
      .catch((e) => console.warn("[settingsStore] 主题色写入失败", e))
  }

  function setRelatedInjection(enabled: boolean): void {
    _relatedInjection.value = enabled
    void prefs()
      .set(RELATED_INJECTION_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 相关作品注入开关写入失败", e))
  }

  function setNovelExportFormat(format: NovelExportFormat): void {
    _novelExportFormat.value = format
    void prefs()
      .set(NOVEL_EXPORT_FORMAT_KEY, format)
      .catch((e) => console.warn("[settingsStore] 小说导出格式写入失败", e))
  }

  function setNovelExportIncludeMetadata(enabled: boolean): void {
    _novelExportOptions.value = { ..._novelExportOptions.value, includeMetadata: enabled }
    void prefs()
      .set(NOVEL_EXPORT_INCLUDE_METADATA_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 小说导出开关写入失败", e))
  }

  function setNovelExportIncludeCover(enabled: boolean): void {
    _novelExportOptions.value = { ..._novelExportOptions.value, includeCover: enabled }
    void prefs()
      .set(NOVEL_EXPORT_INCLUDE_COVER_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 小说导出开关写入失败", e))
  }

  function setNovelExportIncludeImages(enabled: boolean): void {
    _novelExportOptions.value = { ..._novelExportOptions.value, includeInlineImages: enabled }
    void prefs()
      .set(NOVEL_EXPORT_INCLUDE_IMAGES_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 小说导出开关写入失败", e))
  }

  // ── WebDAV 连接配置 actions（spec §7/§8；进备份域，密码除外走 utils/webdavCredentials）──

  function setWebdavEnabled(enabled: boolean): void {
    _webdavEnabled.value = enabled
    void prefs().set(WEBDAV_ENABLED_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] WebDAV 开关写入失败", e))
  }

  function setWebdavUrl(url: string): void {
    _webdavUrl.value = url
    void prefs().set(WEBDAV_URL_KEY, url)
      .catch((e) => console.warn("[settingsStore] WebDAV 服务器地址写入失败", e))
  }

  function setWebdavUsername(username: string): void {
    _webdavUsername.value = username
    void prefs().set(WEBDAV_USERNAME_KEY, username)
      .catch((e) => console.warn("[settingsStore] WebDAV 用户名写入失败", e))
  }

  function setWebdavDir(dir: string): void {
    _webdavDir.value = dir
    void prefs().set(WEBDAV_DIR_KEY, dir)
      .catch((e) => console.warn("[settingsStore] WebDAV 目录写入失败", e))
  }

  function setWebdavAutoBackup(enabled: boolean): void {
    _webdavAutoBackup.value = enabled
    void prefs().set(WEBDAV_AUTO_BACKUP_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] WebDAV 自动备份开关写入失败", e))
  }

  function setWebdavAutoBackupDays(days: number): void {
    _webdavAutoBackupDays.value = days
    void prefs().set(WEBDAV_AUTO_BACKUP_DAYS_KEY, String(days))
      .catch((e) => console.warn("[settingsStore] WebDAV 自动备份周期写入失败", e))
  }

  function setWebdavLastBackup(iso: string): void {
    _webdavLastBackup.value = iso
    void prefs().set(WEBDAV_LAST_BACKUP_KEY, iso)
      .catch((e) => console.warn("[settingsStore] WebDAV 上次备份时间写入失败", e))
  }

  function setWebdavExcludedKeys(keys: string[]): void {
    _webdavExcludedKeys.value = keys
    void prefs().set(WEBDAV_EXCLUDED_KEYS_KEY, JSON.stringify(keys))
      .catch((e) => console.warn("[settingsStore] WebDAV 排除清单写入失败", e))
  }

  /**
   * 遮罩判定：该条目是否因 R18/R18G 开关处于受限态（issue #91：过滤 → 遮罩）。
   * 纯函数，读 ref —— 开关切换后所有依赖处即时重算，无需重新请求。
   */
  function isRestricted(item: { x_restrict: number }): boolean {
    if (!_showR18.value && item.x_restrict === 1) return true
    if (!_showR18G.value && item.x_restrict === 2) return true
    return false
  }

  /** AI 判定：ai_type >= 1（AI 辅助与纯 AI 都算）；字段缺失视为 0（ADR-0155 D1） */
  function isAiWork(item: { illust_ai_type?: number; novel_ai_type?: number }): boolean {
    return (item.illust_ai_type ?? item.novel_ai_type ?? 0) >= 1
  }

  /** 「遮罩」态：AI 条目应渲染 AI 遮罩卡（列表/详情） */
  function isAiRestricted(item: { illust_ai_type?: number; novel_ai_type?: number }): boolean {
    return _aiFilterMode.value === "mask" && isAiWork(item)
  }

  /** 「仅看」态：非 AI 条目应被过滤移除（app-lynx 唯一的 AI 过滤态） */
  function isAiOnlyFiltered(item: { illust_ai_type?: number; novel_ai_type?: number }): boolean {
    return _aiFilterMode.value === "only" && !isAiWork(item)
  }

  /** shouldHideByAi：统一过滤谓词（show 时恒 false） */
  function shouldHideByAi(item: { illust_ai_type?: number; novel_ai_type?: number }): boolean {
    return _aiFilterMode.value === "mask" ? isAiWork(item) : isAiOnlyFiltered(item)
  }

  /**
   * 登出重置（ADR-0103 Q5）：账号消失时内存态回默认，不写盘。
   * flush: "sync"——登出是同一 tick 内连续同步变更（_user=null 等），
   * 异步 watcher 在此场景下任务会被调度器丢弃（vitest/lynx env 实证）；
   * sync 即时重置，且避免登出后陈旧值闪现窗口。setup 内 watch（store 单例，
   * 跨 useSettingsStore() 调用共享同一 watcher，无需释放；login/initRouter
   * 调用前 pinia 已就绪，watcher 注册时机晚于原模块加载期但早于登出信号——行为等价）。
   */
  watch(
    () => auth.currentUser,
    (u) => {
      if (!u) {
        _showR18.value = false
        _showR18G.value = false
        _aiFilterMode.value = "show"
      }
    },
    { flush: "sync" },
  )

  // ── 备份原语（spec docs/specs/webdav-backup.md §3.1/§3.2/§6；与 app registry
  //    rawValues/setRawValues 同源同语义：原始字符串口径 + merge-by-keys）──

  /** 备份导出：设备级键 + 当前账号级键的存储层原始字符串（无记录者省略） */
  async function exportRawValues(): Promise<Record<string, string>> {
    const p = prefs()
    const out: Record<string, string> = {}
    // 双源：idbKV 键（ugoiraMode/detailQuality）+ prefs 键（其余设备级与账号级）
    for (const key of BACKUP_IDB_KEYS) {
      try {
        const v = await idbGet(key)
        if (v !== null) out[key] = v
      } catch (e) {
        console.warn("[settingsStore] 备份导出读取失败（idbKV）", key, e)
      }
    }
    const keys: string[] = [...BACKUP_DEVICE_KEYS]
    const id = uid()
    if (id !== null) keys.push(...backupAccountKeys(id))
    for (const key of keys) {
      if ((BACKUP_IDB_KEYS as readonly string[]).includes(key)) continue
      try {
        const v = await p.get(key)
        if (v !== null) out[key] = v
      } catch (e) {
        // 读取失败 = 该键不进快照；必须可见（硬约束 #3）
        console.warn("[settingsStore] 备份导出读取失败", key, e)
      }
    }
    return out
  }

  /**
   * 备份恢复（merge-by-keys）：仅识别已注册键；未识别键/异账号账号级键跳过。
   * 值经既有 setter 写回（setter 自带校验与持久化，非法值返回 false 计入 skipped）。
   */
  async function importRawValues(
    entries: Record<string, string>,
  ): Promise<{ applied: string[]; skipped: string[] }> {
    const applied: string[] = []
    const skipped: string[] = []
    const id = uid()
    for (const [key, raw] of Object.entries(entries)) {
      if (applyRawKey(key, raw, id)) applied.push(key)
      else skipped.push(key)
    }
    return { applied, skipped }
  }

  /** 单键写回；返回是否识别并成功应用（异账号账号级键 → false） */
  function applyRawKey(key: string, raw: string, id: number | null): boolean {
    switch (key) {
      case UGOIRA_MODE_KEY:
        if (raw !== "fflate" && raw !== "range") return false
        setUgoiraMode(raw)
        return true
      case UGOIRA_DOWNLOAD_FORMAT_KEY:
        if (!(UGOIRA_FORMATS as readonly string[]).includes(raw)) return false
        setUgoiraDownloadFormat(raw as UgoiraFormat)
        return true
      case DETAIL_QUALITY_KEY:
        if (raw !== "medium" && raw !== "large" && raw !== "original") return false
        setDetailQuality(raw)
        return true
      case THEME_COLOR_KEY:
        if (!isThemeColorId(raw)) return false
        setThemeColor(raw)
        return true
      case NOVEL_EXPORT_FORMAT_KEY:
        if (!(NOVEL_EXPORT_FORMATS as readonly string[]).includes(raw)) return false
        setNovelExportFormat(raw as NovelExportFormat)
        return true
      case NOVEL_EXPORT_INCLUDE_METADATA_KEY:
        if (raw !== "true" && raw !== "false") return false
        setNovelExportIncludeMetadata(raw === "true")
        return true
      case NOVEL_EXPORT_INCLUDE_COVER_KEY:
        if (raw !== "true" && raw !== "false") return false
        setNovelExportIncludeCover(raw === "true")
        return true
      case NOVEL_EXPORT_INCLUDE_IMAGES_KEY:
        if (raw !== "true" && raw !== "false") return false
        setNovelExportIncludeImages(raw === "true")
        return true
      case WEBDAV_ENABLED_KEY:
        if (raw !== "true" && raw !== "false") return false
        setWebdavEnabled(raw === "true")
        return true
      case WEBDAV_URL_KEY:
        setWebdavUrl(raw)
        return true
      case WEBDAV_USERNAME_KEY:
        setWebdavUsername(raw)
        return true
      case WEBDAV_DIR_KEY:
        setWebdavDir(raw)
        return true
      case WEBDAV_AUTO_BACKUP_KEY:
        if (raw !== "true" && raw !== "false") return false
        setWebdavAutoBackup(raw === "true")
        return true
      case WEBDAV_AUTO_BACKUP_DAYS_KEY: {
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 1 || n > 30) return false
        setWebdavAutoBackupDays(n)
        return true
      }
      case WEBDAV_LAST_BACKUP_KEY:
        setWebdavLastBackup(raw)
        return true
      case WEBDAV_EXCLUDED_KEYS_KEY: {
        try {
          const parsed: unknown = JSON.parse(raw)
          if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === "string")) return false
          setWebdavExcludedKeys(parsed as string[])
          return true
        } catch {
          return false
        }
      }
      default:
        break
    }
    // 账号级键：仅当前 uid
    if (id === null) return false
    if (key === r18Key(id)) {
      if (raw !== "true" && raw !== "false") return false
      setShowR18(raw === "true")
      return true
    }
    if (key === r18gKey(id)) {
      if (raw !== "true" && raw !== "false") return false
      setShowR18G(raw === "true")
      return true
    }
    if (key === aiFilterModeKey(id)) {
      if (!isAiFilterMode(raw)) return false
      setAiFilterMode(raw)
      return true
    }
    return false
  }

  return {
    // getters（公共 ref）
    showR18,
    showR18G,
    aiFilterMode,
    ugoiraMode,
    detailQuality,
    themeColor,
    relatedInjection,
    ugoiraDownloadFormat,
    novelExportFormat,
    novelExportOptions,
    webdavEnabled,
    webdavUrl,
    webdavUsername,
    webdavDir,
    webdavAutoBackup,
    webdavAutoBackupDays,
    webdavLastBackup,
    webdavExcludedKeys,
    // actions
    loadSettings,
    setShowR18,
    setShowR18G,
    setAiFilterMode,
    setUgoiraMode,
    setUgoiraDownloadFormat,
    setDetailQuality,
    setThemeColor,
    setRelatedInjection,
    setNovelExportFormat,
    setNovelExportIncludeMetadata,
    setNovelExportIncludeCover,
    setNovelExportIncludeImages,
    setWebdavEnabled,
    setWebdavUrl,
    setWebdavUsername,
    setWebdavDir,
    setWebdavAutoBackup,
    setWebdavAutoBackupDays,
    setWebdavLastBackup,
    setWebdavExcludedKeys,
    exportRawValues,
    importRawValues,
    isRestricted,
    isAiWork,
    isAiRestricted,
    isAiOnlyFiltered,
    shouldHideByAi,
  }
})
