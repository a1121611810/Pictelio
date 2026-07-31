// ─── Client 切换设置（webview / lynx） ───
// MVP：Web 模式用 localStorage 占位；原生模式由 T7 桥接 SharedPreferences。
// 保存后自动重启：Web 模式 location.reload()；原生模式预留 restart() 桥。
import { ref } from "vue"

export type ClientKind = "webview" | "lynx"

const STORAGE_KEY = "pictelio_client_kind"
const CURRENT: ClientKind = "lynx" // app-lynx 自身是 lynx client

const _selected = ref<ClientKind>(CURRENT)

export const selectedClient = _selected

export function initClientSetting(): void {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    _selected.value = raw === "webview" || raw === "lynx" ? raw : CURRENT
  } catch {
    _selected.value = CURRENT
  }
}

/** 保存选择并重启（MVP：reload；原生桥由 T7 提供） */
export function switchClient(kind: ClientKind): void {
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
