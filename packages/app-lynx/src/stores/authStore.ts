// ─── 认证状态（app-lynx） ───
// refresh_token 持久化策略（ADR-0050）：
// - web-core（lynx-bg Worker，无 localStorage）：IndexedDB 持久化，
//   重启恢复登录（XSS 风险与 localStorage 同级，MVP 接受；token 为个人资产）
// - 原生 LynxView（#41）：Lynx Native Module 对齐主项目 @aparajita Keystore
//   存储（同 key/同加密，登录态与 webview client 共享）
// Pinia 化（ADR-0139 / spec #337）：setup store——state 移入 defineStore 闭包为
// 私有 ref（不 return，物理私有替代原 `_` 命名约定）；getters 移入为 computed；
// actions 逐字搬入（行为零变化，纯重构约束）。消费方由「具名 import + `.value`」
// 改为 `const auth = useAuthStore()` + 属性访问（setup store 自动解包，模板亦然）。
// 跨 store 消费：settingsStore 在 setup 内 `useAuthStore()` 取 currentUser（替换原
// 模块级 `import { currentUser }` + 兼容桥；T5 收口）。
import { ref, computed } from "vue"
import { defineStore } from "pinia"
import { isNativeMode, getNativeModules, setAccessToken, setOnUnauthorized, setAuthPermanentFailure } from "../api/client"
import { loginWithRefreshToken } from "../api/auth"
import type { PixivUser } from "../api/types"
import { ApiErrorType } from "../api/types"
import { toApiError } from "../utils/errors"
import { reportSessionError } from "../utils/errorPresentation"
import { saveRefreshToken, loadRefreshToken, clearRefreshToken } from "../utils/tokenStorage"

export const useAuthStore = defineStore("auth", () => {
  // ── 私有 state（闭包内 ref，不 return —— 物理私有，替代原 `_` 命名约定）──
  const _refreshToken = ref<string | null>(null)
  const _accessTokenReady = ref(false)
  const _user = ref<PixivUser | null>(null)
  const _authError = ref<string | null>(null)

  // ── 公共 getters（return 后 setup store 自动解包；模板 / .value 皆可）──
  // 登录态 = 持久凭证存在（spec #393 乐观登录）：restore 后即登录，user 由后台刷新
  // 异步就位；瞬时网络失败不回滚登录态，仅凭证被服务端拒绝（logout）清除。
  const isLoggedIn = computed(() => _refreshToken.value !== null)
  const currentUser = computed(() => _user.value)
  const authError = computed(() => _authError.value)

  // ── 私有 helpers（闭包内私有，不 return）──

  /**
   * 启动恢复（ADR-0050）：web-core 从 IndexedDB 读 refresh_token → 刷新 access_token 恢复登录态；
   * 原生模式（#41）由 Native Module 从 Keystore 存储恢复。
   */
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
            // 凭证被服务端拒绝（"凭证/invalid" 字样 = OAuth 4xx）→ 登出全套（清持久化凭证）；
            // 网络/超时类瞬时错误 → 仅告警保持登录态（spec #393：不惩罚瞬时故障）
            if (err.includes("凭证") || err.includes("invalid")) {
              logout()
            } else {
              console.warn("[authStore] token 刷新瞬时失败（保持登录态，网络恢复后自愈）", err)
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
      // 永久失效（OAuth 400）→ 登出全套（清持久化凭证，守卫跳登录页）；
      // 瞬时（网络/超时/429/5xx）→ 仅告警保持登录态（spec #393）
      if (apiErr.type === ApiErrorType.UNAUTHORIZED) {
        await logout()
      } else {
        console.warn("[authStore] token 刷新瞬时失败（保持登录态，网络恢复后自愈）", err)
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

  // ── 公共 actions（return）──

  /**
   * 启动恢复（ADR-0050）：从持久化层读 refresh_token → 交换 access_token 恢复登录态。
   * 已在就绪态时短路返回 true（幂等）。
   */
  async function restoreToken(): Promise<boolean> {
    if (_refreshToken.value) return true
    const token = await loadRefreshToken()
    if (!token) return false
    // 乐观登录（spec #393）：持久凭证存在即登录态，路由立即放行；刷新后台执行，
    // 瞬时失败仅告警不回滚（真机实测：直连抖动把用户误踢登录页的死循环根因）。
    _refreshToken.value = token
    void performRefresh(token)
    return true
  }

  /** 用 refresh_token 登录：OAuth 交换 → 设置内存态 */
  async function loginWithToken(token: string): Promise<void> {
    const trimmed = token.trim()
    if (!trimmed) {
      _authError.value = "请输入 refresh_token"
      return
    }
    await performRefresh(trimmed)
  }

  function logout() {
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
  function registerUnauthorizedHandler() {
    setOnUnauthorized(async () => {
      const token = _refreshToken.value
      if (!token) {
        console.warn("[authStore] 401 触发刷新但内存无 refresh_token（登录态已丢失），跳过刷新")
        return
      }
      const ok = await performRefresh(token)
      // 会话失效判定（spec #393）：仅凭证被永久清理（logout 已清 _refreshToken）才报
      // 全屏错误页；瞬时失败 _refreshToken 仍在 → 保持登录态，由各请求错误态呈现。
      if (!ok && _refreshToken.value === null && _authError.value) {
        reportSessionError({ type: ApiErrorType.UNAUTHORIZED, message: _authError.value })
      }
    })
  }

  return {
    // getters
    isLoggedIn,
    currentUser,
    authError,
    // actions
    restoreToken,
    loginWithToken,
    logout,
    registerUnauthorizedHandler,
  }
})
