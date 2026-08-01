// ─── OAuth 认证（app-lynx MVP） ───
// Web 模式：spark-md5 签名 + fetch 走 /pixiv-oauth 代理（与现有 app _oauthFetch 同源）。
// __CREDENTIALS__ 仅在 __DEV__ 分支引用 —— 生产构建整块消除，凭证不进 bundle。
import { setAccessToken, isOAuthTokenErrorResponse, isNativeMode } from "./client"
import type { PixivAuthResponse } from "./types"
import { PIXIV_USER_AGENT, PIXIV_AUTH_BASE } from "./userAgent"
import { requestFetch } from "../utils/fetchWrapper"
// 静态 import：vue-lynx web 环境的 background worker 对动态 import 的 chunk 路径处理
// 有 bug（publicPath 缺 /__web_preview 前缀），改用静态 import。
// 安全不变：__CREDENTIALS__ 引用仍在 __DEV__ 编译期分支内，生产构建整块消除。
import SparkMD5 from "spark-md5"

interface OAuthCreds {
  clientId: string
  clientSecret: string
  hashSecret: string
  appOs: string
  appOsVersion: string
}

export async function oauthTokenRequest(
  grantType: string,
  extraParams: Record<string, string>,
): Promise<PixivAuthResponse> {
  // __DEV__ 常量由 lynx.config.ts 编译期注入；生产构建为 false，整块消除
  if (!__DEV__) {
    throw new Error("OAuth 仅支持开发/调试环境")
  }
  const creds = __CREDENTIALS__ as OAuthCreds

  const time = new Date().toISOString().replace(/Z$/u, "+00:00")
  const hash = SparkMD5.hash(time + creds.hashSecret)

  const headers: Record<string, string> = {
    "X-Client-Time": time,
    "X-Client-Hash": hash,
    "App-OS": creds.appOs,
    "App-OS-Version": creds.appOsVersion,
    "User-Agent": PIXIV_USER_AGENT,
  }

  const bodyStr = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: grantType,
    get_secure_url: "1",
    ...extraParams,
  }).toString()

  // 原生 LynxView（#53）：无 dev proxy → 绝对 URL 直连 oauth.secure.pixiv.net；
  // web-core 走 /pixiv-oauth 代理（与现有 app _oauthFetch 同源）
  const oauthUrl = isNativeMode() ? PIXIV_AUTH_BASE : "/pixiv-oauth/auth/token"
  const resp = await requestFetch(oauthUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyStr,
    credentials: "omit",
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    // OAuth 400（refresh_token 失效/被撤销）→ 归类为 UNAUTHORIZED，
    // 触发 authStore 的永久失效清理（标记永久失败，强制重新登录）
    let parsedBody: unknown = null
    try {
      parsedBody = JSON.parse(text)
    } catch {
      /* 非 JSON 错误体，按通用错误处理 */
    }
    if (resp.status === 400 && isOAuthTokenErrorResponse(resp.status, parsedBody)) {
      const err = new Error(`登录凭证已失效，请重新登录 (HTTP ${resp.status})`) as Error & {
        type?: string
      }
      err.type = "unauthorized"
      throw err
    }
    // 安全：错误提示不携带原始响应体（可能含敏感信息），只保留状态码
    throw new Error(`OAuth 失败 (HTTP ${resp.status})`)
  }

  const data = (await resp.json()) as PixivAuthResponse
  setAccessToken(data.access_token)
  return data
}

/** 使用 refresh_token 交换 access_token */
export function loginWithRefreshToken(refreshToken: string): Promise<PixivAuthResponse> {
  return oauthTokenRequest("refresh_token", { refresh_token: refreshToken })
}
