// ─── 认证状态（app-lynx） ───
// refresh_token 持久化策略（ADR-0050）：
// - web-core（lynx-bg Worker，无 localStorage）：IndexedDB 持久化，
//   重启恢复登录（XSS 风险与 localStorage 同级，MVP 接受；token 为个人资产）
// - 原生 LynxView（#41）：Lynx Native Module 对齐主项目 @aparajita Keystore
//   存储（同 key/同加密，登录态与 webview client 共享）
import { ref, computed } from "vue"
import { setAccessToken, setOnUnauthorized, setAuthPermanentFailure } from "../api/client"
import { loginWithRefreshToken } from "../api/auth"
import type { PixivUser } from "../api/types"
import { toApiError } from "../utils/errors"
import { saveRefreshToken, loadRefreshToken, clearRefreshToken } from "../utils/tokenStorage"

const _refreshToken = ref<string | null>(null)
const _accessTokenReady = ref(false)
const _user = ref<PixivUser | null>(null)
const _authError = ref<string | null>(null)

export const isLoggedIn = computed(() => _accessTokenReady.value && _user.value !== null)
export const currentUser = computed(() => _user.value)
export const authError = computed(() => _authError.value)

/**
 * 启动恢复（ADR-0050）：web-core 从 IndexedDB 读 refresh_token → 刷新 access_token 恢复登录态；
 * 原生模式（#41）由 Native Module 从 Keystore 存储恢复。
 */
export async function restoreToken(): Promise<boolean> {
  if (_accessTokenReady.value) return true
  const token = await loadRefreshToken()
  if (!token) return false
  return performRefresh(token)
}

/** 用 refresh_token 登录：OAuth 交换 → 设置内存态 */
export async function loginWithToken(token: string): Promise<void> {
  const trimmed = token.trim()
  if (!trimmed) {
    _authError.value = "请输入 refresh_token"
    return
  }
  await performRefresh(trimmed)
}

async function performRefresh(token: string): Promise<boolean> {
  _authError.value = null
  try {
    const resp = await loginWithRefreshToken(token)
    applyAuthResponse(resp)
    return true
  } catch (err) {
    const apiErr = toApiError(err)
    _authError.value = apiErr.message
    // 永久失效（OAuth 400）→ 标记永久失败，强制重新登录
    if (apiErr.type === "unauthorized") {
      setAuthPermanentFailure(true)
      _accessTokenReady.value = false
      _user.value = null
      _refreshToken.value = null
    }
    return false
  }
}

function applyAuthResponse(resp: {
  access_token: string
  refresh_token: string
  user: PixivUser
}) {
  setAccessToken(resp.access_token)
  setAuthPermanentFailure(false)
  _refreshToken.value = resp.refresh_token
  _user.value = resp.user
  _accessTokenReady.value = true
  // ADR-0050：持久化最新 refresh_token（登录成功 / 401 刷新轮换都更新；IndexedDB 失败静默忽略）
  void saveRefreshToken(resp.refresh_token).catch(() => {
    /* IndexedDB 不可用则维持内存态 */
  })
}

export function logout() {
  setAccessToken("")
  setAuthPermanentFailure(false)
  _refreshToken.value = null
  _accessTokenReady.value = false
  _user.value = null
  // ADR-0050：清除持久化 refresh_token
  void clearRefreshToken()
}

/** 注册 401 自动刷新处理器（客户端在请求失败时调用） */
export function registerUnauthorizedHandler() {
  setOnUnauthorized(async () => {
    const token = _refreshToken.value
    if (!token) return
    await performRefresh(token)
  })
}
