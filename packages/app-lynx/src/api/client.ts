// ─── Pixiv API HTTP 客户端（app-lynx MVP） ───
// Web 模式：fetch + Vite/rspeedy 代理（与现有 app 的 dev 分支同源）。
// 原生模式（LynxView）：T7 迁移到 Native Module（Java 堆隔离 access_token），
// 此处预留接口边界 —— fetch 抽象 + 401 刷新 Promise queue。
import { ApiErrorType, type ApiError } from "./types"
import { requestFetch } from "../utils/fetchWrapper"
import { PIXIV_USER_AGENT, PIXIV_REFERER, PIXIV_CONTENT_TYPE, PIXIV_API_BASE, PIXIV_AUTH_BASE } from "./userAgent"

export interface PixivApiClient {
  get<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T>
  post<T>(path: string, body: Record<string, string>): Promise<T>
}

// ─── access_token 管理（MVP：内存态；生产隔离见 T7） ───
let accessToken = ""
export function setAccessToken(token: string) {
  accessToken = token
}
export function getAccessToken(): string {
  return accessToken
}

// ─── 401 自动刷新（Promise queue，复用现有 app 模式） ───
let onUnauthorizedHandler: (() => Promise<void>) | null = null
let refreshPromise: Promise<void> | null = null
let authPermanentFailure = false

export function setOnUnauthorized(handler: (() => Promise<void>) | null) {
  onUnauthorizedHandler = handler
}
export function setAuthPermanentFailure(v: boolean) {
  authPermanentFailure = v
}

// ─── GET 去重 ───
const inflightGetRequests = new Map<string, Promise<unknown>>()

function getRequestKey(path: string, data?: Record<string, string>): string {
  return `GET:${path}:${JSON.stringify(data ?? {})}`
}

// ─── 错误分类（与现有 app 的 classifyError 逻辑同构） ───
export function extractPixivErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (d.errors && typeof d.errors === "object") {
    const errors = d.errors as Record<string, unknown>
    const sys = errors.system
    if (sys && typeof sys === "object") {
      const { message, code } = sys as Record<string, unknown>
      if (typeof message === "string") return code ? `[${code}] ${message}` : message
    }
  }
  if (typeof d.message === "string") return d.message
  if (typeof d.error === "object" && d.error !== null) {
    const errObj = d.error as Record<string, unknown>
    if (typeof errObj.message === "string") return errObj.message
  }
  if (typeof d.error === "string") return d.error
  return null
}

export function isOAuthTokenErrorResponse(status: number, body: unknown): boolean {
  if (status !== 400 || !body || typeof body !== "object") return false
  const d = body as Record<string, unknown>
  // Pixiv OAuth 响应：{ error: "invalid_grant" }（error 为字符串）
  if (typeof d.error === "string" && d.error === "invalid_grant") return true
  // 其他格式：{ error: { message: "...OAuth...invalid_request..." } }
  const err = d.error
  if (typeof err !== "object" || err === null) return false
  const msg = (err as Record<string, unknown>).message
  return (
    typeof msg === "string" &&
    (msg.includes("OAuth") || msg.includes("invalid_request") || msg.includes("invalid_grant"))
  )
}

export function classifyError(status: number, error: unknown, responseBody?: unknown): ApiError {
  if (
    responseBody &&
    typeof responseBody === "object" &&
    (responseBody as Record<string, unknown>).error === "proxy_error"
  ) {
    return { type: ApiErrorType.PROXY, message: "本地代理连接失败，请检查代理软件是否运行" }
  }
  if (!status && error instanceof TypeError) {
    return { type: ApiErrorType.NETWORK, message: "网络不可用，请检查连接" }
  }
  const pixivMsg = responseBody ? extractPixivErrorMessage(responseBody) : null
  const suffix = pixivMsg ? ` (${pixivMsg})` : ""
  switch (status) {
    case 401:
      return { type: ApiErrorType.UNAUTHORIZED, message: `登录已过期 (HTTP 401)${suffix}`, status: 401 }
    case 403:
      return { type: ApiErrorType.FORBIDDEN, message: `没有权限访问 (HTTP 403)${suffix}`, status: 403 }
    case 429:
      return { type: ApiErrorType.RATE_LIMIT, message: "请求过于频繁，请稍后重试 (HTTP 429)", status: 429 }
    default:
      if (status === 400 && isOAuthTokenErrorResponse(status, responseBody)) {
        return { type: ApiErrorType.UNAUTHORIZED, message: "登录凭证已失效，请重新登录", status: 400 }
      }
      if (status >= 500) {
        return { type: ApiErrorType.SERVER, message: `服务器错误 (HTTP ${status})${suffix}`, status }
      }
      if (status > 0) {
        return { type: ApiErrorType.UNKNOWN, message: `请求失败 (HTTP ${status})${suffix}`, status }
      }
      return { type: ApiErrorType.UNKNOWN, message: `未知错误${suffix}`, status }
  }
}

// ─── URL 重写：Pixiv 直连 URL → 本地代理路径 ───
export function rewriteUrl(path: string): string {
  if (path.startsWith("/pixiv-")) return path
  if (path.startsWith("http")) {
    if (path.startsWith(PIXIV_API_BASE)) return path.replace(PIXIV_API_BASE, "/pixiv-api")
    if (path.startsWith(PIXIV_AUTH_BASE)) return "/pixiv-oauth/auth/token"
    return path
  }
  return `/pixiv-api${path}`
}

/**
 * 决定是否给请求附加 Bearer access_token。
 * 仅当重写后的 URL 是本地代理路径（/pixiv-*）时才携带——
 * 外部绝对 URL（如服务端 next_url 指向非 Pixiv 域）不带 Authorization。
 * 纯函数，可单测。
 */
export function shouldAttachAuth(path: string): boolean {
  return rewriteUrl(path).startsWith("/pixiv-")
}

async function execute<T>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, string>,
  body?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  if (authPermanentFailure) throw new Error("认证已失效，请重新登录")
  if (method === "GET" && !accessToken) {
    throw { type: ApiErrorType.UNAUTHORIZED, message: "未登录，请先登录" } as ApiError
  }

  const headers: Record<string, string> = {
    "User-Agent": PIXIV_USER_AGENT,
    Referer: PIXIV_REFERER,
  }
  // 先重写 URL，再基于结果决定是否附加 Bearer。
  // rewriteUrl 仅把已知 Pixiv 主机映射为 /pixiv-* 代理路径；外部绝对 URL
  // （如服务端返回的 next_url）原样返回且不带 /pixiv- 前缀 → 不携带
  // Authorization，防止 access_token 被带到非 Pixiv 域。
  const url = rewriteUrl(path)
  if (shouldAttachAuth(path) && accessToken) headers["Authorization"] = `Bearer ${accessToken}`

  let res: Response
  try {
    if (method === "GET") {
      const params = data ? "?" + new URLSearchParams(data).toString() : ""
      res = await requestFetch(url + params, { method: "GET", headers, signal })
    } else {
      headers["Content-Type"] = PIXIV_CONTENT_TYPE
      const bodyStr = body ? new URLSearchParams(body).toString() : ""
      res = await requestFetch(url, { method: "POST", headers, body: bodyStr })
    }
  } catch (err) {
    // fetch 拒绝（网络中断/超时/CORS）→ 归类为 NETWORK，避免裸 TypeError 泄漏给 UI
    throw classifyError(0, err, null)
  }

  if (!res.ok) {
    throw classifyError(res.status, null, await res.json().catch(() => null))
  }
  return res.json() as Promise<T>
}

async function execWithAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const apiErr = err as ApiError
    if (apiErr.type === ApiErrorType.UNAUTHORIZED && onUnauthorizedHandler) {
      if (refreshPromise) {
        await refreshPromise
      } else {
        const p = onUnauthorizedHandler().finally(() => {
          refreshPromise = null
        })
        refreshPromise = p
        await p
      }
      return await fn()
    }
    throw err
  }
}

function request<T>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, string>,
  body?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  if (method === "GET") {
    const key = getRequestKey(path, data)
    // 有 AbortSignal 的调用不参与去重：signal 属于调用方生命周期，
    // 共享 promise 会导致一方 abort 取消所有人的请求。
    if (!signal) {
      const existing = inflightGetRequests.get(key)
      if (existing) return existing as Promise<T>
    }
    const promise = execWithAuthRetry<T>(() => execute<T>(method, path, data, undefined, signal))
    if (!signal) {
      inflightGetRequests.set(key, promise)
      void promise.finally(() => inflightGetRequests.delete(key))
    }
    return promise
  }
  return execWithAuthRetry<T>(() => execute<T>(method, path, data, body, signal))
}

export const apiClient: PixivApiClient = {
  get: <T>(path: string, params?: Record<string, string>, signal?: AbortSignal) =>
    request<T>("GET", path, params, undefined, signal),
  post: <T>(path: string, body: Record<string, string>) => request<T>("POST", path, undefined, body),
}
