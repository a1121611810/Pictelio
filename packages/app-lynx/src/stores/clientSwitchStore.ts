// ─── Client 切换设置（webview / lynx） ───
// 双路径：
// - 原生 LynxView（#51）：NativeModules.PictelioApp —— Native 落盘
//   SharedPreferences("CapacitorStorage") 的 "pictelio_client_kind"（与
//   @capacitor/preferences 同文件，webview 侧可读同一开关）+ restart 重启进程
// - Web 模式：localStorage 占位 + location.reload()
import { ref } from "vue"

export type ClientKind = "webview" | "lynx"

const STORAGE_KEY = "pictelio_client_kind"
const CURRENT: ClientKind = "lynx" // app-lynx 自身是 lynx client

const _selected = ref<ClientKind>(CURRENT)

export const selectedClient = _selected

/** 原生 App Module（#51：NativeModules.PictelioApp）——web-core 下不存在 → null */
function nativeAppModule() {
  // 同时检查裸 NativeModules（lynx runtime 全局对象，真机实测不在 globalThis 上）
  const nm = (typeof NativeModules !== "undefined" ? NativeModules : undefined) ??
    (globalThis as { NativeModules?: { PictelioApp?: PictelioAppModule } }).NativeModules
  return nm?.PictelioApp ?? null
}

/** PictelioAppModule JS 契约（Java 侧 PictelioAppModule.java） */
interface PictelioAppModule {
  setClientKind(kind: string, callback: (err: string | null) => void): void
  getClientKind(callback: (kind: string | null, err: string | null) => void): void
  getClientKinds(callback: (kinds: string[], err: string | null) => void): void
  restart(callback: (err: string | null) => void): void
}

/** 当前包支持的 client 引擎列表（ADR-0062）；null = 未知（保守视为双引擎） */
export const availableKinds = ref<ClientKind[] | null>(null)

/** 过滤 Native 返回的 client 列表为合法 ClientKind（ADR-0062）；非法值剔除 */
export function normalizeKinds(raw: unknown): ClientKind[] | null {
  if (!Array.isArray(raw)) return null
  const kinds = raw.filter((k): k is ClientKind => k === "webview" || k === "lynx")
  return kinds.length > 0 ? kinds : null
}

/** 当前包是否支持引擎切换（同时含 webview 与 lynx；null=未知保守视为支持） */
export function supportsClientSwitch(kinds: ClientKind[] | null): boolean {
  return kinds === null || (kinds.includes("webview") && kinds.includes("lynx"))
}

export function initClientSetting(): void {
  const mod = nativeAppModule() as PictelioAppModule | null
  if (mod) {
    // 原生模式：从 Native 读当前开关 + 包能力列表（异步回调）
    try {
      mod.getClientKinds((kinds, err) => {
        if (!err) {
          availableKinds.value = normalizeKinds(kinds)
        }
      })
    } catch {
      /* 忽略：能力查询失败按未知处理 */
    }
    try {
      mod.getClientKind((kind, err) => {
        _selected.value = !err && (kind === "webview" || kind === "lynx") ? kind : CURRENT
      })
    } catch {
      _selected.value = CURRENT
    }
    return
  }
  // Web 模式（现状）：localStorage 占位
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    _selected.value = raw === "webview" || raw === "lynx" ? raw : CURRENT
  } catch {
    _selected.value = CURRENT
  }
}

/** 保存选择并重启：原生 Native 落盘 + 进程重启；Web reload（#51） */
export function switchClient(kind: ClientKind): void {
  const mod = nativeAppModule() as PictelioAppModule | null
  if (mod) {
    try {
      mod.setClientKind(kind, (err) => {
        if (err) {
          console.warn("[clientSwitchStore] setClientKind 失败", err)
          return
        }
        mod.restart((err2) => {
          if (err2) {
            console.warn("[clientSwitchStore] restart 失败", err2)
          }
        })
      })
    } catch (e) {
      console.warn("[clientSwitchStore] 原生切换失败", e)
    }
    _selected.value = kind
    return
  }
  // Web 模式（现状）
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, kind)
  } catch {
    /* ignore */
  }
  _selected.value = kind
  restartClient()
}

export function restartClient(): void {
  // 原生模式：T7 通过 Native Module 调用 App.restart()
  const nativeRestart = (globalThis as Record<string, unknown>).__lynxRestartClient
  if (typeof nativeRestart === "function") {
    ;(nativeRestart as () => void)()
    return
  }
  // Web 模式（Lynx for Web）：重载当前页面，宿主启动逻辑按设置分发
  try {
    globalThis.location?.reload()
  } catch {
    /* ignore */
  }
}
