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
import { ref, computed, watch } from "vue"
import { defineStore } from "pinia"
import { idbGet, idbSet, idbRemove } from "../utils/idbKV"
import { getNativeModules, isNativeMode } from "../api/client"
import { useAuthStore } from "./authStore"
import { unquoteNativeString } from "../utils/tokenStorage"
import { setLocale, followSystemLocale } from "../i18n"
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
import {
  currentDarkMode,
  DEFAULT_DARK_MODE,
  ensureDarkModeInit,
  isDarkModeId,
  type DarkModeId,
  type ResolvedDark,
} from "../utils/darkMode"

// ── 跨 client 契约键（ADR-0103：与 webview settingsStore defineFactory 同格式）──
const r18Key = (uid: number) => `show_r18_${uid}`
const r18gKey = (uid: number) => `show_r18g_${uid}`
// 翻译授权（spec §9.7；ADR-0173）：**独立于内容显示开关** —— 「允许看见 R18 内容」
// 与「允许把 R18 内容发给第三方 LLM」是两个不同的授权，前者不能替代后者。
const translateR18Key = (uid: number) => `settings_translate_r18_${uid}`
const translateR18gKey = (uid: number) => `settings_translate_r18g_${uid}`
/** 老设备级键（webview 遗留，SharedPreferences）——native 环境迁移源 */
const LEGACY_R18 = "show_r18"
const LEGACY_R18G = "show_r18g"
/** lynx dev（web-core IndexedDB）遗留键 */
const DEV_LEGACY_R18 = "settings_show_r18"
const DEV_LEGACY_R18G = "settings_show_r18g"
/** AI 三态过滤（ADR-0155）：账号级共享键（与 app 同契约），无 legacy 键 */
const aiFilterModeKey = (uid: number) => `ai_filter_mode_${uid}`
/**
 * 标签静音（ADR-0187 / #732）：账号级集合键，键名与 webview muteTagStore 逐字一致
 * （ADR-0103 契约，PictelioPrefs → SharedPreferences "CapacitorStorage" 跨引擎同步）。
 * 值 = JSON string[]，元素为 trim 后的原始标签名（存储态已 trim，匹配侧再 trim 容错）。
 */
const muteTagsKey = (uid: number) => `mute_tags_${uid}`
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
/** 外观暗色状态（spec lynx-night-mode T1）：设备级三态 light/dark/system，默认 system；
 *  与 THEME_COLOR_KEY 同级（外观设备级），沿用 PrefsStorage seam 读写。
 *  键与 Java 侧 LynxActivity.KEY_DARK_MODE 逐字一致（原生唯一读点），
 *  经 darkModeJavaContract 契约测试钉住（JS 写入 ⇄ 原生读点） */
const DARK_MODE_KEY = "settings_dark_mode"
/** 相关作品注入行（spec docs/specs/related-injection.md）：设备级开关，默认开；键与 app 逐字一致 */
const RELATED_INJECTION_KEY = "related_injection"
/** 排行榜入口大卡（spec docs/specs/ranking.md §5.8）：设备级开关，默认开；键与 app 逐字一致 */
const RANKING_ENTRY_KEY = "ranking_entry"
/** 小说介绍页开关（spec docs/specs/lynx-novel-intro-toggle.md / ADR-0183）：设备级布尔，默认开
 *  （介绍页先行 = ADR-0167 三段式现状，升级零感知）；关闭后六入口点击小说直达正文页。
 *  lynx 专属语义（webview 无介绍页概念），不跨引擎共享键。 */
const NOVEL_INTRO_FIRST_KEY = "novel_intro_first"
/** 引擎自动回退开关（ADR-0164 / spec engine-default-lynx §3）：设备级布尔，缺省开；
 *  只管 Lynx 运行时硬错误是否自动跳 WebView（不管预检降级）。键与 app 侧逐字一致，
 *  唯一所有者 = Java EnginePrefs.KEY_AUTO_FALLBACK，TS 侧镜像常量经一致性测试钉住 */
const AUTO_FALLBACK_ENGINE_KEY = "pictelio_engine_auto_fallback"
/** 全屏模式开关（spec docs/specs/lynx-systembars.md D5）：设备级布尔，默认关；
 *  隐藏系统栏（immersive）——边到边基底之上的 opt-in 沉浸。键与 Java 侧
 *  LynxActivity.KEY_FULLSCREEN_MODE 逐字一致（唯一所有者），经 safeAreaJavaContract 测试钉住 */
const FULLSCREEN_MODE_KEY = "settings_fullscreen_mode"
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
/** UI 语言（spec docs/specs/i18n.md §4.1）：设备级共享键，与 app i18n PREF_KEY_LANGUAGE 逐字一致；"" = 跟随系统 */
const LANGUAGE_KEY = "settings_language"

/**
 * 备份域设备级键清单（spec docs/specs/webdav-backup.md §3.1）：与 app settingsStore
 * 的持久化设置键对齐；集合型账号级键（mute_tags_${uid}，ADR-0187 / #732）走
 * backupAccountKeys 不在本清单，lynx 备份的 sets 仍为空对象（跨引擎恢复时由 app 侧 sets 覆盖）。
 */
export const BACKUP_DEVICE_KEYS = [
  UGOIRA_MODE_KEY,
  UGOIRA_DOWNLOAD_FORMAT_KEY,
  DETAIL_QUALITY_KEY,
  THEME_COLOR_KEY,
  DARK_MODE_KEY,
  LANGUAGE_KEY,
  RELATED_INJECTION_KEY,
  RANKING_ENTRY_KEY,
  NOVEL_INTRO_FIRST_KEY,
  AUTO_FALLBACK_ENGINE_KEY,
  FULLSCREEN_MODE_KEY,
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
  return [r18Key(uid), r18gKey(uid), aiFilterModeKey(uid), muteTagsKey(uid)]
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

/**
 * 静音标签集合解析（ADR-0187 D1）：仅接受 JSON string[]。
 * 读到损坏/非法值 → console.warn 可见 + 空集合（禁静默降级，测试硬约束 #3）。
 */
export function parseMuteTagsRaw(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed
    }
    console.warn("[settingsStore] 静音标签集合值非法，维持空集合:", raw)
  } catch {
    console.warn("[settingsStore] 静音标签集合解析失败，维持空集合:", raw)
  }
  return []
}

/** 标签静音判定输入（PixivIllust.tags / PixivNovel.tags 的最小结构） */
export interface TagMuteCheckable {
  tags?: { name: string }[] | null
}

export const useSettingsStore = defineStore("settings", () => {
  // ── 私有 state（闭包内 ref，不 return —— 物理私有，替代原 `_` 命名约定）──
  const _showR18 = ref(false)
  const _showR18G = ref(false)
  // 翻译授权（默认 false：未经明确同意，R18 内容不外发给 LLM）
  const _translateR18 = ref(false)
  const _translateR18G = ref(false)
  const _aiFilterMode = ref<AiFilterMode>("show")
  /** 标签静音集合（ADR-0187 / #732）：账号级，内存态为存储顺序的 string[]（元素已 trim） */
  const _muteTags = ref<string[]>([])
  /** 静音成功轻提示载荷（当前提示的标签名；null = 无）——App.vue 宿主渲染，store 不快照文案 */
  const _muteTagHint = ref<string | null>(null)
  const _ugoiraMode = ref<UgoiraExtractMode>("fflate")
  const _ugoiraDownloadFormat = ref<UgoiraFormat>("zip")
  const _detailQuality = ref<ImageQuality>("medium")
  const _themeColor = ref<ThemeColorId>(DEFAULT_THEME_COLOR)
  // 外观暗色三态（spec lynx-night-mode T1）：默认 system（跟随系统），设备级
  const _darkMode = ref<DarkModeId>(DEFAULT_DARK_MODE)
  /** UI 语言："" = 跟随系统；设备级，未登录也恢复 */
  const _language = ref<"" | "zh-CN" | "en">("")
  const _relatedInjection = ref(true)
  const _rankingEntry = ref(true)
  /** 小说介绍页开关（ADR-0183）：设备级，默认开 = 介绍页先行 */
  const _novelIntroFirst = ref(true)
  /** 引擎自动回退开关（ADR-0164）：设备级，缺省开（用户设置，进备份域；区别于失败记忆等设备事实） */
  const _autoFallbackEngine = ref(true)
  /** 全屏模式开关（spec lynx-systembars D5）：设备级，默认关（隐藏系统栏的 opt-in 沉浸） */
  const _fullscreenMode = ref(false)
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
  const translateR18 = _translateR18
  const translateR18G = _translateR18G
  const aiFilterMode = _aiFilterMode
  /** 静音成功轻提示载荷（#732 / ADR-0187 D5）：null = 无；App.vue 宿主 v-if 渲染 */
  const muteTagHint = _muteTagHint
  const ugoiraMode = _ugoiraMode
  const ugoiraDownloadFormat = _ugoiraDownloadFormat
  const detailQuality = _detailQuality
  const themeColor = _themeColor
  const darkMode = _darkMode
  /**
   * 派生归一输出（spec §1.2）：手动 light/dark 直接映射；system 模式订阅暗色哑桥源。
   * 所有消费方（根类绑定 / 状态栏图标 / 暗色 token 切换）只读 resolvedDark，不重复解析。
   * - darkMode === "light" → "light"
   * - darkMode === "dark"  → "dark"
   * - darkMode === "system" → currentDarkMode.value（哑桥 ref，system 模式跟随系统变化即时重算）
   */
  const resolvedDark = computed<ResolvedDark>(() => {
    const m = _darkMode.value
    if (m === 'dark') return 'dark'
    if (m === 'light') return 'light'
    return currentDarkMode.value
  })

  // system 模式下 resolvedDark 读 currentDarkMode；为避免「system 模式下消费方从未订阅，
  // currentDarkMode 停在 light 初值」的 stale 状态，setup 末尾触发一次 ensureInit 副作用
  // （幂等：重复调用 no-op；不注册回调、不消费初值——本 store 只用响应式 ref 派生）。
  // spec §4.3：订阅后拉语义，setup 内触发等价于消费方首次订阅。
  ensureDarkModeInit()
  const language = _language
  const relatedInjection = _relatedInjection
  const rankingEntry = _rankingEntry
  const novelIntroFirst = _novelIntroFirst
  const autoFallbackEngine = _autoFallbackEngine
  const fullscreenMode = _fullscreenMode
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
   * 外观类设备级键加载 helper（spec lynx-night-mode T1 §4.6 + ADR-0152 同模式收敛）：
   * - 读 prefs → isValid 校验 → 非法/IO 异常均 console.warn + 维持现状（禁静默降级）
   * - 仅外观类（themeColor / darkMode）走此 helper；其它键形态不同（language / fullscreenMode）不进
   * - 失败回退策略：调用方传入的 assign 永不抛异常，prefs() 抛错被 catch 转 warn
   */
  async function loadAppearanceSetting<T extends string>(opts: {
    key: string
    isValid: (v: string) => v is T
    assign: (v: T) => void
    invalidWarn: () => string
    ioWarn: () => string
  }): Promise<void> {
    try {
      const raw = await prefs().get(opts.key)
      if (raw !== null) {
        if (opts.isValid(raw)) {
          opts.assign(raw)
        } else {
          console.warn(opts.invalidWarn(), raw)
        }
      }
    } catch (e) {
      console.warn(opts.ioWarn(), e)
    }
  }

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

    // ── 外观类设备级键（themeColor + darkMode，同模式收敛到 helper）──
    await loadAppearanceSetting({
      key: THEME_COLOR_KEY,
      isValid: isThemeColorId,
      assign: (raw) => {
        _themeColor.value = raw
      },
      invalidWarn: () => "[settingsStore] 主题色值非法，维持默认:",
      ioWarn: () => "[settingsStore] 主题色加载失败（维持默认）",
    })
    await loadAppearanceSetting({
      key: DARK_MODE_KEY,
      isValid: isDarkModeId,
      assign: (raw) => {
        _darkMode.value = raw
      },
      invalidWarn: () => "[settingsStore.darkMode] 暗色外观值非法，维持默认 system:",
      ioWarn: () => "[settingsStore.darkMode] 暗色外观加载失败（维持默认 system）",
    })

    // UI 语言（spec docs/specs/i18n.md §4.1）：设备级，未登录也需要恢复；非法值维持跟随系统
    try {
      const raw = await prefs().get(LANGUAGE_KEY)
      if (raw === "en" || raw === "zh-CN") {
        _language.value = raw
        setLocale(raw)
      } else if (raw !== null) {
        console.warn("[settingsStore] 语言值非法，维持跟随系统:", raw)
      }
    } catch (e) {
      console.warn("[settingsStore] 语言加载失败（维持跟随系统）", e)
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

    // 排行榜入口大卡（spec docs/specs/ranking.md §5.8）：设备级，未登录也恢复
    try {
      const raw = await prefs().get(RANKING_ENTRY_KEY)
      if (raw === "true") _rankingEntry.value = true
      else if (raw === "false") _rankingEntry.value = false
      else if (raw !== null) {
        console.warn("[settingsStore] 排行榜入口开关值非法，维持默认 true:", raw)
      }
    } catch (e) {
      console.warn("[settingsStore] 排行榜入口开关加载失败（维持默认）", e)
    }

    // 小说介绍页开关（spec docs/specs/lynx-novel-intro-toggle.md / ADR-0183）：设备级，未登录也恢复
    try {
      const raw = await prefs().get(NOVEL_INTRO_FIRST_KEY)
      if (raw === "true") _novelIntroFirst.value = true
      else if (raw === "false") _novelIntroFirst.value = false
      else if (raw !== null) {
        console.warn("[settingsStore] 小说介绍页开关值非法，维持默认 true:", raw)
      }
    } catch (e) {
      console.warn("[settingsStore] 小说介绍页开关加载失败（维持默认）", e)
    }

    // 引擎自动回退开关（ADR-0164）：设备级，未登录也恢复
    try {
      const raw = await prefs().get(AUTO_FALLBACK_ENGINE_KEY)
      if (raw === "true") _autoFallbackEngine.value = true
      else if (raw === "false") _autoFallbackEngine.value = false
      else if (raw !== null) {
        console.warn("[settingsStore] 引擎自动回退开关值非法，维持默认 true:", raw)
      }
    } catch (e) {
      console.warn("[settingsStore] 引擎自动回退开关加载失败（维持默认）", e)
    }

    // 全屏模式开关（spec lynx-systembars D5）：设备级，未登录也恢复
    try {
      const raw = await prefs().get(FULLSCREEN_MODE_KEY)
      if (raw === "true") _fullscreenMode.value = true
      else if (raw === "false") _fullscreenMode.value = false
      else if (raw !== null) {
        console.warn("[settingsStore] 全屏模式开关值非法，维持默认 false:", raw)
      }
    } catch (e) {
      console.warn("[settingsStore] 全屏模式开关加载失败（维持默认）", e)
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
      _translateR18.value = false
      _translateR18G.value = false
      _aiFilterMode.value = "show"
      _muteTags.value = []
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
      // 翻译授权独立读取（spec §9.7）；缺失即 false
      _translateR18.value = (await storage.get(translateR18Key(id))) === "true"
      _translateR18G.value = (await storage.get(translateR18gKey(id))) === "true"
      const rawAi = await storage.get(aiFilterModeKey(id))
      if (rawAi === null) {
        _aiFilterMode.value = "show"
      } else if (isAiFilterMode(rawAi)) {
        _aiFilterMode.value = rawAi
      } else {
        console.warn("[settingsStore] AI 模式值非法，维持默认 show:", rawAi)
        _aiFilterMode.value = "show"
      }
      // 标签静音集合（ADR-0187 / #732）：缺失即空集合；损坏由 parseMuteTagsRaw warn 可见
      const rawMuteTags = await storage.get(muteTagsKey(id))
      _muteTags.value = rawMuteTags === null ? [] : parseMuteTagsRaw(rawMuteTags)
    } catch (e) {
      // 存储不可用：维持默认（静默降级规则：warn 可见）
      console.warn("[settingsStore] 账号级设置加载失败（维持默认）", e)
      _showR18.value = false
      _showR18G.value = false
      _translateR18.value = false
      _translateR18G.value = false
      _aiFilterMode.value = "show"
      _muteTags.value = []
    }

    // Dev hook：强制开启 R18（R18/R18G 同开）。
    // 取代之前的事件总线（sendGlobalEvent "pictelioDevForceR18" + JS listener 置 globalThis.__FORCE_R18__）
    // ——native 端 adb `am start --es pictelio_dev_force_r18=true` 触发 BuildConfig.DEBUG 门禁下的
    // LynxActivity.applyDevIntentHooks，直接写 SharedPreferences "CapacitorStorage" 的
    // dev_force_r18=true；本函数末尾读取该键并强制覆盖上方 _showR18 / _showR18G 计算结果。
    // 持久化比事件总线更可靠：bundle 渲染竞态不会丢（loadSettings 总会读到），登出→重登录后
    // 仍生效（键跨会话持久），JS 挂载时序无关。键名与 Java 端 LynxActivity.DEV_FORCE_R18_PREFS_KEY
    // 逐字一致，唯一所有者 = Java 端，TS 侧镜像常量（契约测试如需可后续钉住）。
    try {
      const devForce = await prefs().get("dev_force_r18")
      if (devForce === "true") {
        _showR18.value = true
        _showR18G.value = true
      }
    } catch (e) {
      console.warn("[settingsStore] dev hook dev_force_r18 读取失败（忽略）", e)
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

  /**
   * 设置「允许翻译 R18」授权（spec §9.7；账号级）。
   * 与内容显示开关独立：开启前 UI 必须过一次风险确认（R18：账号封禁 / 模型训练风险）。
   */
  function setTranslateR18(enabled: boolean): void {
    _translateR18.value = enabled
    const id = uid()
    if (id === null) return
    void prefs()
      .set(translateR18Key(id), String(enabled))
      .catch((e) => console.warn("[settingsStore] 翻译 R18 授权写入失败", e))
  }

  /** 设置「允许翻译 R18G」授权（spec §9.7；强提示法律红线后） */
  function setTranslateR18G(enabled: boolean): void {
    _translateR18G.value = enabled
    const id = uid()
    if (id === null) return
    void prefs()
      .set(translateR18gKey(id), String(enabled))
      .catch((e) => console.warn("[settingsStore] 翻译 R18G 授权写入失败", e))
  }

  /**
   * 翻译授权闸门（spec §9.7 应用层）：
   * `xRestrict=1` 需 `translate_r18`，`xRestrict=2` 需 `translate_r18g`。
   * **不复用 isRestricted**：那是内容显示谓词（看见 ≠ 允许外发给第三方 LLM）。
   */
  function isTranslationRestricted(xRestrict: number): boolean {
    if (xRestrict === 2) return !_translateR18G.value
    if (xRestrict === 1) return !_translateR18.value
    return false
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

  // ── 标签静音（ADR-0187 / #732）：账号级集合 + 匹配谓词 ──
  // 匹配语义（ADR-0187 D2）：任一 tags[].name 经 trim 后与集合精确相等——无大小写折叠、
  // 无全半角归一、不匹配 translated_name；空 tags / undefined / 空集合一律放行。

  /** 静音标签集合快照（响应式 accessor：computed/渲染内调用建立依赖；整集快照读） */
  function mutedTags(): Set<string> {
    return new Set(_muteTags.value)
  }

  /** 写内存 + 落盘（未登录不落盘，账号级语义）；写失败 warn 可见（禁静默降级） */
  function setMuteTags(tags: string[]): void {
    _muteTags.value = tags
    const id = uid()
    if (id === null) return
    void prefs()
      .set(muteTagsKey(id), JSON.stringify(tags))
      .catch((e) => console.warn("[settingsStore] 静音标签写入失败", e))
  }

  /** 静音轻提示展示时长（与 router exitHint 同值，App.vue 提示条宿主同形态） */
  const MUTE_TAG_HINT_MS = 2000
  let muteTagHintTimer: ReturnType<typeof setTimeout> | undefined

  /** 静音标签并持久化（trim、幂等）；未登录 no-op（webview muteTagStore 同语义） */
  function muteTag(name: string): void {
    const id = uid()
    if (id === null) return
    const trimmed = name.trim()
    if (trimmed === "") return
    if (!_muteTags.value.includes(trimmed)) {
      setMuteTags([..._muteTags.value, trimmed])
    }
    // 轻提示（ADR-0187 D5）：长按必有反馈，重复静音同样提示（webview 同语义）；
    // 连续静音重置计时，避免前一条提示提前消失
    _muteTagHint.value = trimmed
    if (muteTagHintTimer !== undefined) clearTimeout(muteTagHintTimer)
    muteTagHintTimer = setTimeout(() => {
      muteTagHintTimer = undefined
      _muteTagHint.value = null
    }, MUTE_TAG_HINT_MS)
  }

  /** 取消静音并持久化；未静音时 no-op；未登录 no-op */
  function unmuteTag(name: string): void {
    const id = uid()
    if (id === null) return
    if (!_muteTags.value.includes(name)) return
    setMuteTags(_muteTags.value.filter((t) => t !== name))
  }

  /**
   * 静音判定（数据组装点过滤谓词）：item.tags 任一 name.trim() 命中集合。
   * 空集合短路（免逐条 trim）；空 tags / undefined 放行。
   */
  function isTagMuted(item: TagMuteCheckable | null | undefined): boolean {
    const list = _muteTags.value
    if (list.length === 0) return false
    const tags = item?.tags
    if (!tags || tags.length === 0) return false
    return tags.some((tag) => list.includes(tag.name.trim()))
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

  /**
   * 设置外观暗色三态（spec lynx-night-mode T1）：写设备级键 + 即时切换 + 原生即时下发。
   * 不动 currentDarkMode（哑桥 ref），由 resolvedDark computed 自动归一：
   * - 手动 light/dark：直接映射
   * - system：跟随 currentDarkMode（native/web-core matchMedia 推送变化）
   *
   * 原生即时下发（follow-up #692，镜像 setFullscreenMode 范式）：写入 resolve 之后调
   * PictelioApp.applyDarkModePreference——原生侧重读本键（LynxActivity.readDarkModeRaw）
   * 重下发状态栏图标深浅 + splash 持久化主题，故**必须落盘后再下发**（否则原生读到旧值）；
   * dev/web-core 无 NativeModules → 仅写键（console.debug 可见）；原生环境方法缺失
   * （版本漂移异常）→ console.warn（硬约束 #3 禁静默）。冷启动由 LynxActivity.onCreate
   * 读同键重设（重建自动恢复）。
   */
  function setDarkMode(mode: DarkModeId): void {
    _darkMode.value = mode
    void prefs()
      .set(DARK_MODE_KEY, mode)
      .then(
        () => applyDarkModeToNative(),
        (e: unknown) => {
          console.warn("[settingsStore.darkMode] 暗色外观写入失败", e)
        },
      )
      .catch((e: unknown) => {
        // 下发路径自身抛错（原生桥异常）：不吞（硬约束 #3）
        console.warn("[settingsStore.darkMode] 原生暗色外观下发异常", e)
      })
  }

  /**
   * 把已落盘的偏好下发给原生（`PictelioApp.applyDarkModePreference`）。无入参——原生侧
   * 自读 settings_dark_mode（单一读点 = LynxActivity.readDarkModeRaw + normalizeDarkMode），
   * 避免同一偏好出现「JS 传值 / 原生读键」两套来源。
   * 分支口径照抄 setFullscreenMode：原生可用 → 调；非原生 → debug 跳过；原生缺方法 → warn。
   */
  function applyDarkModeToNative(): void {
    const nm = getNativeModules()
    // getNativeModules 的 PictelioApp 类型为 unknown（api/client 既有口径）——本调用面收窄
    const app = nm?.PictelioApp as
      | { applyDarkModePreference?: (cb: (err: string | null) => void) => void }
      | undefined
    if (isNativeMode() && app && typeof app.applyDarkModePreference === "function") {
      app.applyDarkModePreference((err) => {
        if (err) console.warn("[settingsStore.darkMode] 原生暗色外观下发失败", err)
      })
    } else if (!isNativeMode()) {
      console.debug("[settingsStore.darkMode] 暗色外观下发跳过（非原生环境，仅持久化设置）")
    } else {
      // 原生环境但模块/方法缺失（版本漂移异常）：必须可见（硬约束 #3 禁静默）
      console.warn(
        "[settingsStore.darkMode] NativeModules.PictelioApp.applyDarkModePreference 不可用，仅持久化设置",
      )
    }
  }

  /** UI 语言切换（B10）：同步 lynx i18n module ref，持久化设备级共享键 */
  function setLanguage(l: "" | "zh-CN" | "en"): void {
    _language.value = l
    if (l === "") followSystemLocale()
    else setLocale(l)
    void prefs()
      .set(LANGUAGE_KEY, l)
      .catch((e) => console.warn("[settingsStore] 语言写入失败", e))
  }

  function setRelatedInjection(enabled: boolean): void {
    _relatedInjection.value = enabled
    void prefs()
      .set(RELATED_INJECTION_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 相关作品注入开关写入失败", e))
  }

  function setRankingEntry(enabled: boolean): void {
    _rankingEntry.value = enabled
    void prefs()
      .set(RANKING_ENTRY_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 排行榜入口开关写入失败", e))
  }

  /** 小说介绍页开关（ADR-0183）：导航偏好属设备/个人习惯，非账号内容授权，不区分 uid */
  function setNovelIntroFirst(enabled: boolean): void {
    _novelIntroFirst.value = enabled
    void prefs()
      .set(NOVEL_INTRO_FIRST_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 小说介绍页开关写入失败", e))
  }

  /** 引擎自动回退开关（ADR-0164）：双端共享键（Java 侧 EnginePrefs 同读此键） */
  function setAutoFallbackEngine(enabled: boolean): void {
    _autoFallbackEngine.value = enabled
    void prefs()
      .set(AUTO_FALLBACK_ENGINE_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 引擎自动回退开关写入失败", e))
  }

  /**
   * 全屏模式开关（spec lynx-systembars D5）：写设备级键 + 原生运行时切换。
   * 原生模式下调 PictelioApp.setSystemBarsHidden 即时生效（insets 事件回流 →
   * Root padding 重算）；dev/web-core 无 NativeModules → 仅写键（console.debug 可见，
   * 预览无系统栏概念）。冷启动由 LynxActivity.onCreate 读同键重设（重建自动恢复）。
   */
  function setFullscreenMode(enabled: boolean): void {
    _fullscreenMode.value = enabled
    void prefs()
      .set(FULLSCREEN_MODE_KEY, String(enabled))
      .catch((e) => console.warn("[settingsStore] 全屏模式开关写入失败", e))
    const nm = getNativeModules()
    // getNativeModules 的 PictelioApp 类型为 unknown（api/client 既有口径）——本调用面收窄
    const app = nm?.PictelioApp as
      | { setSystemBarsHidden?: (hidden: boolean, cb: (err: string | null) => void) => void }
      | undefined
    if (isNativeMode() && app && typeof app.setSystemBarsHidden === "function") {
      app.setSystemBarsHidden(enabled, (err) => {
        if (err) {
          // 原生切换失败：回滚内存态（UI 与真实系统栏状态一致，spec §5 边界行）；
          // 设置键保留用户意图（下次启动 onCreate 重试）
          _fullscreenMode.value = !enabled
          console.warn("[settingsStore] 全屏模式切换失败", err)
        }
      })
    } else if (!isNativeMode()) {
      console.debug("[settingsStore] 全屏模式切换跳过（非原生环境，仅持久化设置）")
    } else {
      // 原生环境但模块/方法缺失（版本漂移异常）：必须可见（硬约束 #3 禁静默）
      console.warn("[settingsStore] NativeModules.PictelioApp.setSystemBarsHidden 不可用，仅持久化设置")
    }
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
        _muteTags.value = []
        _muteTagHint.value = null
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
      case DARK_MODE_KEY:
        if (!isDarkModeId(raw)) return false
        setDarkMode(raw)
        return true
      case LANGUAGE_KEY:
        if (raw !== "" && raw !== "en" && raw !== "zh-CN") return false
        setLanguage(raw)
        return true
      case RELATED_INJECTION_KEY:
        if (raw !== "true" && raw !== "false") return false
        setRelatedInjection(raw === "true")
        return true
      case RANKING_ENTRY_KEY:
        if (raw !== "true" && raw !== "false") return false
        setRankingEntry(raw === "true")
        return true
      case NOVEL_INTRO_FIRST_KEY:
        if (raw !== "true" && raw !== "false") return false
        setNovelIntroFirst(raw === "true")
        return true
      case AUTO_FALLBACK_ENGINE_KEY:
        if (raw !== "true" && raw !== "false") return false
        setAutoFallbackEngine(raw === "true")
        return true
      case FULLSCREEN_MODE_KEY:
        if (raw !== "true" && raw !== "false") return false
        setFullscreenMode(raw === "true")
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
    if (key === muteTagsKey(id)) {
      // 静音标签集合（ADR-0187 / #732）：仅接受 JSON string[]（损坏 → skipped）
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return false
      }
      if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === "string")) return false
      setMuteTags(parsed)
      return true
    }
    return false
  }

  return {
    // getters（公共 ref）
    showR18,
    showR18G,
    translateR18,
    translateR18G,
    aiFilterMode,
    ugoiraMode,
    detailQuality,
    themeColor,
    darkMode,
    resolvedDark,
    language,
    relatedInjection,
    rankingEntry,
    novelIntroFirst,
    autoFallbackEngine,
    fullscreenMode,
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
    setDarkMode,
    setLanguage,
    setRelatedInjection,
    setRankingEntry,
    setNovelIntroFirst,
    setAutoFallbackEngine,
    setFullscreenMode,
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
    isTranslationRestricted,
    setTranslateR18,
    setTranslateR18G,
    isAiWork,
    isAiRestricted,
    isAiOnlyFiltered,
    shouldHideByAi,
    // 标签静音（ADR-0187 / #732）
    mutedTags,
    muteTag,
    unmuteTag,
    isTagMuted,
    muteTagHint,
  }
})
