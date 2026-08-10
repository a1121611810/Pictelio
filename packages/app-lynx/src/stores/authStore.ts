// ─── 认证状态（app-lynx） ───
// refresh_token 持久化策略（ADR-0050）：
// - web-core（lynx-bg Worker，无 localStorage）：IndexedDB 持久化，
//   重启恢复登录（XSS 风险与 localStorage 同级，MVP 接受；token 为个人资产）
// - 原生 LynxView（#41）：Lynx Native Module 对齐主项目 @aparajita Keystore
//   存储（同 key/同加密，登录态与 webview client 共享）
import { ref, computed } from "vue"
import { isNativeMode, getNativeModules, setAccessToken, setOnUnauthorized, setAuthPermanentFailure } from "../api/client"
import { loginWithRefreshToken } from "../api/auth"
import type { PixivUser } from "../api/types"
import { ApiErrorType } from "../api/types"
import { toApiError } from "../utils/errors"
import { reportSessionError } from "../utils/errorPresentation"
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

  // #53 原生模式：Native OAuth 交换——access_token 只留 Java 堆，JS 零知
  if (isNativeMode()) {
    const auth = getNativeModules()?.PictelioAuth as {
      loginWithRefreshToken: (token: string, callback: (userInfo: string, err: string) => void) => void
      clearTokens: (callback: (arg1: string, arg2: string) => void) => void
    } | undefined
    if (!auth) {
      _authError.value = "原生认证模块不可用"
      return false
    }
    return new Promise((resolve) => {
      auth.loginWithRefreshToken(token, (userInfoJson: string, err: string) => {
        if (err) {
          _authError.value = err
          // 仅凭证类错误（OAuth 400）标记永久失效；网络/解析类错误允许重试
          if (err.includes("凭证") || err.includes("invalid")) {
            setAuthPermanentFailure(true)
            _accessTokenReady.value = false
            _user.value = null
            _refreshToken.value = null
          }
          resolve(false)
          return
        }
        try {
          const info = JSON.parse(userInfoJson) as {
            userId: number
            userName: string
            userAccount: string
            profileImageUrls?: Record<string, string>
            refreshToken?: string
          }
          _user.value = {
            id: info.userId,
            name: info.userName,
            account: info.userAccount,
            profile_image_urls: info.profileImageUrls ?? {},
          } as PixivUser
          const newToken = info.refreshToken || token
          _refreshToken.value = newToken
          _accessTokenReady.value = true
          setAuthPermanentFailure(false)
          // 原生模式 JS 零知 access_token——不调用 setAccessToken（API 请求走 Native 附加）
          void saveRefreshToken(newToken).catch((e) => {
            console.warn("[authStore] 持久化 refresh_token 失败（维持内存态）", e)
          })
          resolve(true)
        } catch (e) {
          _authError.value = "登录响应解析失败"
          resolve(false)
        }
      })
    })
  }

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
  // ADR-0050：持久化最新 refresh_token（登录成功 / 401 刷新轮换都更新；失败维持内存态并告警）
  void saveRefreshToken(resp.refresh_token).catch((err) => {
    console.warn("[authStore] 持久化 refresh_token 失败（维持内存态）", err)
  })
}

export function logout() {
  // #53 原生模式：清 Java 堆 token（access_token/refresh_token），避免登出后 API 仍鉴权
  if (isNativeMode()) {
    const auth = getNativeModules()?.PictelioAuth as
      | { clearTokens: (callback: (arg1: string, arg2: string) => void) => void }
      | undefined
    auth?.clearTokens(() => {})
  }
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
    if (!token) {
      console.warn("[authStore] 401 触发刷新但内存无 refresh_token（登录态已丢失），跳过刷新")
      return
    }
    const ok = await performRefresh(token)
    // 会话失效判定：仅「已登录会话的 401 刷新失败且进入永久失效清理态」触发全屏错误页。
    // 登录页输错 token / 启动恢复失败也走 performRefresh，但不经过本 handler——
    // 它们无会话可失效（Login 内联错误 / 静默回登录页是正确行为，不应跳错误页）。
    // 判别：刷新失败 + accessToken 不再就绪（unauthorized 分支已清空状态；网络类错误保持就绪不触发）。
    if (!ok && _accessTokenReady.value === false && _authError.value) {
      reportSessionError({ type: ApiErrorType.UNAUTHORIZED, message: _authError.value })
    }
  })
}
