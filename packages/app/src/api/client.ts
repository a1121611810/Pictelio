import { Capacitor } from "@capacitor/core";
import { ApiErrorType, type ApiError } from "./types";
import { PIXIV_USER_AGENT } from "./userAgent";
import { PixivApi } from "../native/PixivApi";

// ─── 端点（编译时常量，从 credentials.json5 注入） ───
const PIXIV_API_BASE = __PUBLIC_CONFIG__.apiBaseUrl;
const PIXIV_AUTH_URL = __PUBLIC_CONFIG__.authUrl;

// ─── 平台检测 ───
const isNative = Capacitor.isNativePlatform();

// ─── 对外接口 ───
export interface PixivApiClient {
  get<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body: Record<string, string>): Promise<T>;
}

// ─── 仅 DEV 模式：access_token 与 401 管理 ───
// 生产 Native 模式下 access_token 和 401 刷新由 PixivApiPlugin 内部处理。
// DEV 模式（浏览器 pnpm dev）仍需要本地管理。
let devAccessToken = "";
const devAuth: {
  onUnauthorized: (() => Promise<void>) | null;
  refreshPromise: Promise<void> | null;
  /** 认证就绪信号：首次 token 刷新完成后 resolve。所有请求在入口处 await 此 barrier */
  tokenReady: Promise<void>;
  /** 永久失效标记：token 刷新失败后设为 true，后续请求立即失败，不产生网络流量 */
  authPermanentFailure: boolean;
} = {
  onUnauthorized: null,
  refreshPromise: null,
  tokenReady: Promise.resolve(),
  authPermanentFailure: false,
};

export function setAccessToken(token: string) {
  devAccessToken = token;
}

export function getAccessToken(): string {
  return devAccessToken;
}

export function setOnUnauthorized(handler: (() => Promise<void>) | null) {
  devAuth.onUnauthorized = handler;
}

export function setRefreshPromise(p: Promise<void> | null) {
  devAuth.refreshPromise = p;
}

/** 设置 tokenReady barrier：所有 API 请求 await 此 promise 后才发送 */
export function setTokenReadyPromise(p: Promise<void>) {
  devAuth.tokenReady = p;
}

/** 设置认证永久失效标记 */
export function setAuthPermanentFailure(v: boolean) {
  devAuth.authPermanentFailure = v;
}

// ─── GET 请求去重 ───
/** 飞行中的 GET 请求，相同 URL+参数只发一个真实 HTTP 请求 */
const inflightGetRequests = new Map<string, Promise<any>>();

function getRequestKey(path: string, data?: Record<string, string>): string {
  return `GET:${path}:${JSON.stringify(data ?? {})}`;
}

/** 尝试从 Pixiv 错误响应体中提取人类可读的错误消息 */
export function extractPixivErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const d = data as Record<string, unknown>;
  if (d.errors && typeof d.errors === "object") {
    const errors = d.errors as Record<string, unknown>;
    const sys = errors.system;
    if (sys && typeof sys === "object") {
      const { message, code } = sys as Record<string, unknown>;
      if (typeof message === "string") {
        return code ? `[${code}] ${message}` : message;
      }
    }
  }
  if (typeof d.message === "string") {
    return d.message;
  }
  if (typeof d.error === "string") {
    return d.error;
  }
  // OAuth 错误: { error: { message: "..." } }
  if (typeof d.error === "object" && d.error !== null) {
    const errObj = d.error as Record<string, unknown>;
    if (typeof errObj.message === "string") {
      return errObj.message;
    }
  }
  return null;
}

/**
 * 检测是否为 OAuth token 失效错误（400 + 特定错误体）。
 * Pixiv OAuth 端点在 refresh_token 过期时返回 400 而非 401，
 * 响应体格式为 { error: { message: "...OAuth...invalid_request..." } }。
 * 纯函数，O(1)，零分配。
 */
export function isOAuthTokenErrorResponse(status: number, responseBody: unknown): boolean {
  if (status !== 400 || !responseBody || typeof responseBody !== "object") {
    return false;
  }
  const d = responseBody as Record<string, unknown>;
  const err = d.error;
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const msg = (err as Record<string, unknown>).message;
  return typeof msg === "string" && (msg.includes("OAuth") || msg.includes("invalid_request"));
}

/** 统一将任意错误值转换为 ApiError，已有 type 的保留原 type，否则创建 UNKNOWN */
export function toApiError(e: unknown, fallbackMsg = "加载失败"): ApiError {
  if (e && typeof e === "object" && "type" in e) {
    return e as ApiError;
  }
  return {
    type: ApiErrorType.UNKNOWN,
    message: (e as { message?: string }).message ?? fallbackMsg,
  };
}

/** 错误类型优先级（索引越小越具体/重要） */
const ERROR_TYPE_PRIORITY: ApiErrorType[] = [
  ApiErrorType.PROXY,
  ApiErrorType.NETWORK,
  ApiErrorType.UNAUTHORIZED,
  ApiErrorType.RATE_LIMIT,
  ApiErrorType.SERVER,
  ApiErrorType.UNKNOWN,
];

/**
 * 从一组 ApiError 中选出最具体的错误类型
 * 优先级：PROXY > NETWORK > UNAUTHORIZED > RATE_LIMIT > SERVER > UNKNOWN
 */
export function pickBestErrorType(...errors: ApiError[]): ApiErrorType {
  for (const t of ERROR_TYPE_PRIORITY) {
    if (errors.some((e) => e.type === t)) {
      return t;
    }
  }
  return ApiErrorType.UNKNOWN;
}

export function classifyError(status: number, error: unknown, responseBody?: unknown): ApiError {
  // 检测代理错误：Vite 代理层返回 { error: "proxy_error", message: "..." }
  // 必须在状态码分类之前检测，因为 proxy_error 可能伴随任何 HTTP 状态码
  if (
    responseBody &&
    typeof responseBody === "object" &&
    (responseBody as Record<string, unknown>).error === "proxy_error"
  ) {
    return {
      type: ApiErrorType.PROXY,
      message: "本地代理连接失败（127.0.0.1:10808），请检查代理软件是否运行",
    };
  }

  if (!status && error instanceof TypeError) {
    return { type: ApiErrorType.NETWORK, message: "网络不可用，请检查连接" };
  }
  // 尝试提取 Pixiv 错误消息
  const pixivMsg = responseBody ? extractPixivErrorMessage(responseBody) : null;
  const suffix = pixivMsg ? ` (${pixivMsg})` : "";
  switch (status) {
    case 401:
      return {
        type: ApiErrorType.UNAUTHORIZED,
        message: `登录已过期 (HTTP 401)${suffix ? `: ${pixivMsg}` : ""}`,
        status: 401,
      };
    case 403:
      return {
        type: ApiErrorType.FORBIDDEN,
        message: `没有权限访问 (HTTP 403)${suffix}`,
        status: 403,
      };
    case 429:
      return {
        type: ApiErrorType.RATE_LIMIT,
        message: "请求过于频繁，请稍后重试 (HTTP 429)",
        status: 429,
      };
    default:
      // 400 OAuth 错误 → refresh_token 已失效，视为 UNAUTHORIZED
      if (status === 400 && isOAuthTokenErrorResponse(status, responseBody)) {
        return {
          type: ApiErrorType.UNAUTHORIZED,
          message: "登录凭证已失效，请重新登录",
          status: 400,
        };
      }
      if (status >= 500) {
        return {
          type: ApiErrorType.SERVER,
          message: `服务器错误 (HTTP ${status})${suffix}`,
          status,
        };
      }
      if (status > 0) {
        return {
          type: ApiErrorType.UNKNOWN,
          message: `请求失败 (HTTP ${status})${suffix}`,
          status,
        };
      }
      return { type: ApiErrorType.UNKNOWN, message: `未知错误${suffix}`, status };
  }
}

/**
 * Web 模式下，将 Pixiv 直连 URL 重写为 Vite 代理路径
 * 原生模式下保持原 URL（CapacitorHttp 可直接访问）
 */
export function rewriteUrl(path: string): string {
  // 已经是本地代理路径，直接返回
  if (path.startsWith("/pixiv-")) {
    return path;
  }
  // 已经是 http(s) URL
  if (path.startsWith("http")) {
    if (!isNative) {
      if (path.startsWith(PIXIV_API_BASE)) {
        return path.replace(PIXIV_API_BASE, "/pixiv-api");
      }
      if (path.startsWith(PIXIV_AUTH_URL)) {
        return "/pixiv-oauth/auth/token";
      }
    }
    return path;
  }
  // 相对路径：web 走 Vite 代理，native 拼完整 URL
  if (!isNative) {
    return `/pixiv-api${path}`;
  }
  return `${PIXIV_API_BASE}${path}`;
}

/**
 * 统一请求执行函数。
 * 原生模式：通过 PixivApi 插件发出请求；
 * Web 模式：通过 fetch 走 Vite 代理。
 */
async function nativeExecuteRequest<T>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, string>,
  body?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  // 认证永久失效 → 快速失败，不产生网络流量
  if (devAuth.authPermanentFailure) {
    throw new Error("认证已失效，请重新登录");
  }
  // 等待首次 token 刷新完成
  if (devAuth.tokenReady) {
    await devAuth.tokenReady;
  }

  // Web 模式且无 access_token → 未登录，快速失败
  if (!isNative && !devAccessToken) {
    throw {
      type: ApiErrorType.UNAUTHORIZED,
      message: "未登录，请先登录",
    };
  }

  /** 实际执行请求（不包含重试逻辑） */
  async function exec(): Promise<T> {
    if (isNative) {
      const result = await PixivApi.request({
        method,
        path,
        params: data,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (result.status >= 400) {
        let parsedBody: unknown = null;
        try {
          parsedBody = JSON.parse(result.data);
        } catch {
          /* ignore parse errors */
        }
        throw classifyError(result.status, null, parsedBody);
      }
      return JSON.parse(result.data) as T;
    }

    // Web 模式：走 Vite 代理
    const headers: Record<string, string> = {
      "User-Agent": PIXIV_USER_AGENT,
      Referer: __PUBLIC_CONFIG__.referer,
    };
    if (method === "GET") {
      if (devAccessToken) headers["Authorization"] = `Bearer ${devAccessToken}`;
      const params = data ? "?" + new URLSearchParams(data).toString() : "";
      const res = await fetch(rewriteUrl(path) + params, { method: "GET", headers, signal });
      if (!res.ok) throw classifyError(res.status, null, await res.json().catch(() => null));
      return res.json() as Promise<T>;
    } else {
      if (devAccessToken) headers["Authorization"] = `Bearer ${devAccessToken}`;
      headers["Content-Type"] = __PUBLIC_CONFIG__.contentType;
      const bodyStr = data ? new URLSearchParams(data).toString() : "";
      const res = await fetch(rewriteUrl(path), { method: "POST", headers, body: bodyStr });
      if (!res.ok) throw classifyError(res.status, null, await res.json().catch(() => null));
      return res.json() as Promise<T>;
    }
  }

  // 等待启动中的 auth 刷新完成（避免在 token 就绪前发送请求）
  if (devAuth.refreshPromise) {
    await devAuth.refreshPromise;
  }

  // 认证失效重试：UNAUTHORIZED 错误（含 400 OAuth 错误）先调 onUnauthorized 刷新 token
  // 并发 401 通过 refreshPromise 去重：第一个触发刷新，后续等待同一个 promise
  try {
    return await exec();
  } catch (err) {
    const apiErr = err as ApiError;
    if (apiErr.type === ApiErrorType.UNAUTHORIZED && devAuth.onUnauthorized) {
      if (devAuth.refreshPromise) {
        // 已有请求在刷新 token，等待即可
        await devAuth.refreshPromise;
      } else {
        // 第一个遇到 401 的请求触发刷新
        const promise = devAuth.onUnauthorized().finally(() => setRefreshPromise(null));
        setRefreshPromise(promise);
        await promise;
      }
      return await exec();
    }
    throw err;
  }
}

/**
 * 发送 HTTP 请求（GET 带去重，POST 不缓存）。
 * GET 请求去重：同一 URL+参数的并发请求自动合并为一个真实 HTTP 请求。
 */
function request<T>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  // GET 请求去重：相同 path+data 只发一个真实 HTTP 请求
  if (method === "GET") {
    const key = getRequestKey(path, data);
    const existing = inflightGetRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = nativeExecuteRequest<T>(method, path, data, undefined, signal);
    inflightGetRequests.set(key, promise);
    void tryAsync(
      promise.finally(() => {
        inflightGetRequests.delete(key);
      }),
    );
    return promise;
  }

  // POST 请求透传（不做去重，因为涉及收藏/关注等副作用）
  return nativeExecuteRequest<T>(method, path, data);
}

export const apiClient: PixivApiClient = {
  get: <T>(path: string, params?: Record<string, string>, signal?: AbortSignal) =>
    request<T>("GET", path, params, signal),
  post: <T>(path: string, body: Record<string, string>) => request<T>("POST", path, body),
};
