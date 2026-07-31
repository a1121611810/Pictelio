// ─── 认证状态（app-lynx MVP） ───
// 安全：refresh_token 仅存内存（Web 模式不写入 localStorage —— 防 XSS 窃取）。
// 原生生产环境由 T7 迁移到 Native Module 安全存储（Android Keystore）。
import { ref, computed } from "vue"
import { setAccessToken, setOnUnauthorized, setAuthPermanentFailure } from "../api/client"
import { loginWithRefreshToken, loginWithPassword } from "../api/auth"
import type { PixivUser } from "../api/types"
import { toApiError } from "../utils/errors"

const _refreshToken = ref<string | null>(null)
const _accessTokenReady = ref(false)
const _user = ref<PixivUser | null>(null)
const _authError = ref<string | null>(null)

export const isLoggedIn = computed(() => _accessTokenReady.value && _user.value !== null)
export const currentUser = computed(() => _user.value)
export const authError = computed(() => _authError.value)

/**
 * 启动恢复：内存态无持久化 → 直接返回未登录。
 * 原生模式（T7）将由 Native Module 从安全存储恢复 refresh_token 后调用 performRefresh。
 */
export async function restoreToken(): Promise<boolean> {
  if (_accessTokenReady.value) return true
  // Web 模式：无持久化 token，需要用户重新登录（安全权衡：防 XSS 窃取 refresh_token）
  return false
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

/** 用用户名密码登录 */
export async function loginWithCredentials(username: string, password: string): Promise<void> {
  _authError.value = null
  try {
    const resp = await loginWithPassword(username, password)
    applyAuthResponse(resp)
  } catch (err) {
    _authError.value = toApiError(err).message
    throw err
  }
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
}

export function logout() {
  setAccessToken("")
  setAuthPermanentFailure(false)
  _refreshToken.value = null
  _accessTokenReady.value = false
  _user.value = null
}

/** 注册 401 自动刷新处理器（客户端在请求失败时调用） */
export function registerUnauthorizedHandler() {
  setOnUnauthorized(async () => {
    const token = _refreshToken.value
    if (!token) return
    await performRefresh(token)
  })
}
