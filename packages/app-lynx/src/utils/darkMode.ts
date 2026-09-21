// ─── 外观暗色状态：清单单一事实源 + 跟随系统检测哑桥（spec docs/specs/lynx-night-mode.md T1）───
// - 持久化三态 light/dark/system 与 ADR-0152 themeColor.ts 同模式（清单 + is*Id + 非法 warn）。
// - 系统检测走哑桥（isNativeMode seam 双路径）：
//   * native 路径：PictelioAppModule.getDarkMode(cb) 订阅后拉初值（ADR-0168 subscribe-then-pull 同构）
//     + pictelioDarkMode 全局事件推后续变化。
//   * web-core 预览：matchMedia("(prefers-color-scheme: dark)") 拉初值 + change 监听。
// - 当前系统暗色值 = currentDarkMode ref，所有派生只读它；生产侧经 ensureDarkModeInit()
//   启桥后响应式读取，命令式订阅入口（getDarkMode / subscribeDarkMode / unsubscribeDarkMode）
//   为模块 seam，非响应式场景预留。
// - 模块前缀：[darkMode]（与 settingsStore 主前缀分桶；themeColor 模块亦同）。
import { ref } from 'vue'

/**
 * 三态可选清单（id 用于持久化与校验）。
 * 注意：本文件不持有 label 字符串——展示层文案由 i18n 字典派生
 * （spec docs/specs/i18n.md §6 回潮门禁：禁硬编码中文文案）。
 * 消费方应基于 id 通过 i18n t() 函数派生文案。
 */
export const DARK_MODE_OPTIONS = [
  { id: 'light' },
  { id: 'dark' },
  { id: 'system' },
] as const

export type DarkModeId = (typeof DARK_MODE_OPTIONS)[number]['id']
/** 实际生效的暗色态（system 模式与系统同步后归一为 light/dark） */
export type ResolvedDark = 'light' | 'dark'

/** 全部可选三态 id（由清单派生，避免第二份 id 列表漂移） */
export const DARK_MODE_IDS: readonly DarkModeId[] = DARK_MODE_OPTIONS.map((o) => o.id)

/** 默认 = 跟随系统（spec §1：缺省即与系统其它应用一致、零配置成本） */
export const DEFAULT_DARK_MODE: DarkModeId = 'system'

const ID_SET: ReadonlySet<string> = new Set<string>(DARK_MODE_IDS)

/**
 * 持久化值校验：非法值不得写入状态。
 * 静默降级规则：调用方（settingsStore.loadSettings）对非法值输出 console.warn。
 */
export function isDarkModeId(value: string): value is DarkModeId {
  return ID_SET.has(value)
}

/**
 * 当前系统暗色状态 ref（响应式）。所有派生（settingsStore.resolvedDark 等）只读它。
 * 初值 = "light"（最保守兜底：matchMedia 不可用 / 事件未到位时显示亮色，避免暗色首闪）。
 */
export const currentDarkMode = ref<ResolvedDark>('light')

/** 初始化哨兵（ensureInit 幂等，重复调用安全） */
let initialized = false

/** 已订阅回调集合（变化时逐个通知；调用方负责兜住异常） */
const subscribers = new Set<(mode: ResolvedDark) => void>()

function setMode(mode: ResolvedDark): void {
  if (currentDarkMode.value === mode) return
  currentDarkMode.value = mode
  for (const cb of subscribers) {
    try {
      cb(mode)
    } catch (e) {
      // 订阅者回调异常不污染其他订阅者（隔离硬约束）
      console.warn('[darkMode] 订阅者回调异常', e)
    }
  }
}

/**
 * 解析原生 pictelioDarkMode 事件载荷：契约 = JSON.stringify({mode: 'light' | 'dark'})。
 * 容忍两种格式（与 tokenStorage 同样保守）：
 * 1) 标准：JSON.stringify({mode})（spec 决定）
 * 2) 兼容：裸字符串 'light'/'dark'（早期实现 / 跨端复用余地）
 * 非法一律 console.warn + 忽略（不污染现值，debug 可见）
 */
function parseNativePayload(raw: unknown): ResolvedDark | null {
  if (raw === 'light' || raw === 'dark') return raw
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const mode = (parsed as { mode?: unknown }).mode
        if (mode === 'light' || mode === 'dark') return mode
      }
    } catch {
      // 非 JSON 字符串，按非法处理（裸字符串分支已在函数顶处理）
    }
  }
  return null
}

interface PictelioAppNativeDark {
  getDarkMode(callback: (mode: string) => void): void
}

/**
 * 初始化暗色哑桥（订阅后拉取语义，镜像 safeArea.initSafeArea §4.2）。
 *
 * 通道分流：
 * - native（LynxView）：先注册 pictelioDarkMode 全局事件监听，再调 PictelioApp.getDarkMode
 *   拉初值。pull 后写入 currentDarkMode；事件后续变化经 parseNativePayload 解析。
 * - web-core 预览：matchMedia("(prefers-color-scheme: dark)") 拉初值 + change 监听；
 *   不可用 → console.warn + 维持 light 兜底（禁静默降级）。
 *
 * 幂等：重复调用 no-op；getDarkMode(cb) 内部确保在初始化后被调用，避免消费方踩时序。
 */
function ensureInit(): void {
  if (initialized) return
  initialized = true

  const nm =
    (typeof NativeModules !== 'undefined' ? NativeModules : undefined) ??
    (globalThis as { NativeModules?: { PictelioApp?: PictelioAppNativeDark } }).NativeModules
  const app = nm?.PictelioApp

  // ── native 路径（判定 = PictelioApp 模块存在：isNativeMode 同口径，避免第三份重复判定）──
  if (app) {
    // 先订阅（镜像 safeArea.ts D2 修订：订阅后拉，防首帧事件丢失）
    const lynxGlobal =
      typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: LynxGlobal }).lynx
    const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
    if (!emitter || typeof emitter.addListener !== 'function') {
      // native 模式但 emitter 缺失属异常版本漂移，必须可见（禁静默降级）
      console.warn('[darkMode] GlobalEventEmitter 不可用，pictelioDarkMode 事件订阅失败')
    } else {
      emitter.addListener('pictelioDarkMode', (...args: unknown[]) => {
        const mode = parseNativePayload(args[0])
        if (mode === null) {
          console.warn('[darkMode] pictelioDarkMode 非法载荷，忽略:', args[0])
          return
        }
        setMode(mode)
      })
    }
    // 此分支已在 `if (app)` 块内：`!app` 恒假（review round-2 清理的死条件），只判方法缺失
    if (typeof app.getDarkMode !== 'function') {
      console.warn('[darkMode] NativeModules.PictelioApp.getDarkMode 不可用，系统暗色恒 light')
      return
    }
    app.getDarkMode((mode: string) => {
      const parsed = parseNativePayload(mode)
      if (parsed === null) {
        console.warn('[darkMode] 原生 getDarkMode 非法载荷，忽略:', mode)
        return
      }
      setMode(parsed)
    })
    return
  }

  // ── web-core 预览路径 ──
  // 用 globalThis.matchMedia 而非 window.matchMedia：浏览器里 globalThis === window，
  // node 测试环境（vitest environment: node）无 window 但可通过 globalThis 注入 mock；
  // 这样双环境一致不依赖宿主是否有 window。
  const mm = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia
  if (typeof mm !== 'function') {
    console.warn('[darkMode] matchMedia 不可用，系统暗色恒 light（web-core 预览属预期）')
    return
  }
  const mq = mm('(prefers-color-scheme: dark)')
  setMode(mq.matches ? 'dark' : 'light')
  const handler = (e: MediaQueryListEvent): void => setMode(e.matches ? 'dark' : 'light')
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler)
  } else if (typeof (mq as MediaQueryList & { addListener?: unknown }).addListener === 'function') {
    // Safari < 14 兼容（lynx 不需要，但 web-core 预览旧浏览器兜底）
    ;(mq as unknown as { addListener: (cb: typeof handler) => void }).addListener(handler)
  }
}

/**
 * 初始化暗色哑桥入口（幂等；**不注册回调、不消费初值**）。
 * 语义 = 「只把桥接起来」：启动 native pull / matchMedia 监听，让 currentDarkMode 反映真实
 * 系统态。生产消费方（settingsStore setup）用自己的 computed 读 currentDarkMode 响应式派生，
 * 不需要回调——故用本函数而非 getDarkMode(() => {})（后者会留下无主订阅回调）。
 */
export function ensureDarkModeInit(): void {
  ensureInit()
}

/**
 * 订阅 + 立即回放入口（ADR-0168 subscribe-then-pull 同构；**非原生的 pull**——
 * 语义 = 订阅 + 立即以当前值回放一次，便于消费方拿到首帧态）。
 * - 立即以 currentDarkMode 当前值回调 cb（首帧即正确态）。
 * - 注册 cb 至订阅集合，后续 currentDarkMode 变化时通知。
 * - 返回 unsubscribe 函数；亦可走显式 unsubscribeDarkMode 退订。
 */
export function getDarkMode(cb: (mode: ResolvedDark) => void): () => void {
  ensureInit()
  cb(currentDarkMode.value)
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/**
 * 仅订阅（不立即回调）——**模块 seam，非响应式场景预留**。
 * 当前生产侧不直接调用：settingsStore 走 {@link ensureDarkModeInit} 启桥 + 读
 * currentDarkMode ref（响应式，computed resolvedDark 自动重算）；本函数给「命令式回调」
 * 消费方（原生事件式通知 / 无 Vue 响应式上下文）预留，与 getDarkMode 共用订阅集合。
 * 返回 unsubscribe 函数（与 getDarkMode 返回形态一致，便于退订对称）。
 */
export function subscribeDarkMode(cb: (mode: ResolvedDark) => void): () => void {
  ensureInit()
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/** 显式退订（与 getDarkMode / subscribeDarkMode 返回的 unsubscribe 函数兼容）——
 *  模块 seam 的一部分：非响应式场景预留，当前无生产调用方。 */
export function unsubscribeDarkMode(handle: () => void): void {
  handle()
}
