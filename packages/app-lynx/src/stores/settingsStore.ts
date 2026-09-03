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

// ── 跨 client 契约键（ADR-0103：与 webview settingsStore defineFactory 同格式）──
const r18Key = (uid: number) => `show_r18_${uid}`
const r18gKey = (uid: number) => `show_r18g_${uid}`
/** 老设备级键（webview 遗留，SharedPreferences）——native 环境迁移源 */
const LEGACY_R18 = "show_r18"
const LEGACY_R18G = "show_r18g"
/** lynx dev（web-core IndexedDB）遗留键 */
const DEV_LEGACY_R18 = "settings_show_r18"
const DEV_LEGACY_R18G = "settings_show_r18g"

const UGOIRA_MODE_KEY = "settings_ugoira_mode"
const DETAIL_QUALITY_KEY = "settings_detail_quality"

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
  const _ugoiraMode = ref<UgoiraExtractMode>("fflate")
  const _detailQuality = ref<ImageQuality>("medium")

  // ── 跨 store 组合：读 authStore.currentUser.id 推导 uid（替换原模块级 currentUser import）
  const auth = useAuthStore()
  /** 当前账号 ID（未登录 null）——登出由下方 watch 兜底重置 refs */
  const uid = (): number | null => auth.currentUser?.id ?? null

  // ── 公共 state（return —— setup store 自动解包，模板 / `.value` 皆可）──
  const showR18 = _showR18
  const showR18G = _showR18G
  const ugoiraMode = _ugoiraMode
  const detailQuality = _detailQuality

  // ── 公共 actions（return）──

  /**
   * 加载设置（initRouter 在 restoreToken 之后调用，此时 uid 已知）。
   * R18/R18G 走账号级共享存储 + 迁移；ugoira/detailQuality 走 idbKV（非账号级）。
   */
  async function loadSettings(): Promise<void> {
    const [ugoira, detailQ] = await Promise.all([idbGet(UGOIRA_MODE_KEY), idbGet(DETAIL_QUALITY_KEY)])
    if (ugoira === "fflate" || ugoira === "range") _ugoiraMode.value = ugoira
    if (detailQ === "medium" || detailQ === "large" || detailQ === "original") _detailQuality.value = detailQ

    const id = uid()
    if (id === null) {
      _showR18.value = false
      _showR18G.value = false
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
    } catch (e) {
      // 存储不可用：维持默认（静默降级规则：warn 可见）
      console.warn("[settingsStore] 账号级设置加载失败（维持默认）", e)
      _showR18.value = false
      _showR18G.value = false
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

  /**
   * 遮罩判定：该条目是否因 R18/R18G 开关处于受限态（issue #91：过滤 → 遮罩）。
   * 纯函数，读 ref —— 开关切换后所有依赖处即时重算，无需重新请求。
   */
  function isRestricted(item: { x_restrict: number }): boolean {
    if (!_showR18.value && item.x_restrict === 1) return true
    if (!_showR18G.value && item.x_restrict === 2) return true
    return false
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
      }
    },
    { flush: "sync" },
  )

  return {
    // getters（公共 ref）
    showR18,
    showR18G,
    ugoiraMode,
    detailQuality,
    // actions
    loadSettings,
    setShowR18,
    setShowR18G,
    setUgoiraMode,
    setDetailQuality,
    isRestricted,
  }
})
