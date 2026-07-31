// ─── 认证状态（app-lynx MVP） ───
// Web 模式：token 存内存 + localStorage 占位（原生安全存储见 T7）。
import { ref, computed } from "vue"
import { setAccessToken, setOnUnauthorized, setAuthPermanentFailure } from "../api/client"
import { loginWithRefreshToken, loginWithPassword } from "../api/auth"
import type { PixivUser } from "../api/types"
import { toApiError } from "../utils/errors"

const STORAGE_KEY = "pictelio_lynx_refresh_token"

const _refreshToken = ref<string | null>(null)
const _accessTokenReady = ref(false)
const _user = ref<PixivUser | null>(null)
const _authError = ref<string | null>(null)

export const isLoggedIn = computed(() => _accessTokenReady.value && _user.value !== null)
export const currentUser = computed(() => _user.value)
export const authError = computed(() => _authError.value)

/** 尝试从本地存储恢复 refresh_token（Web 模式；原生模式由 T7 桥接安全存储） */
export async function restoreToken(): Promise<boolean> {
  if (_accessTokenReady.value) return true
  let token: string | null = null
  try {
    token = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    token = null
  }
  if (!token) return false
  return await performRefresh(token)
}

/** 用 refresh_token 登录：OAuth 交换 → 持久化 → 设置状态 */
export async function loginWithToken(token: string): Promise<void> {
  const trimmed = token.trim()
  if (!trimmed) {
    _authError.value = "请输入 refresh_token"
    return
  }
  await performRefresh(trimmed)
  if (_accessTokenReady.value) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, trimmed)
    } catch {
      /* 存储不可用不阻塞登录 */
    }
  }
}

/** 用用户名密码登录 */
export async function loginWithCredentials(username: string, password: string): Promise<void> {
  _authError.value = null
  try {
    const resp = await loginWithPassword(username, password)
    applyAuthResponse(resp)
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, resp.refresh_token)
    } catch {
      /* ignore */
    }
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
    // 永久失效（OAuth 400）→ 清除持久化 token，强制重新登录
    if (apiErr.type === "unauthorized") {
      setAuthPermanentFailure(true)
      try {
        globalThis.localStorage?.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      _accessTokenReady.value = false
      _user.value = null
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
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 注册 401 自动刷新处理器（客户端在请求失败时调用） */
export function registerUnauthorizedHandler() {
  setOnUnauthorized(async () => {
    const token = _refreshToken.value
    if (!token) return
    await performRefresh(token)
  })
}
