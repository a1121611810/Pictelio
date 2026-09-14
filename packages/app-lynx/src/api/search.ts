// ─── Pixiv 搜索 API 端点适配层（app-lynx 全局搜索，issue #291） ───
// 参数构建（端点路由 / search_target 规则 / 筛选映射）单点在 @pictelio/search-core
// （#480 拍板；ADR-0132 第 8 条修订——原「与 webview 逐字对齐」升级为共享核心单点）。
// 本文件只做 GET 与 next_url 断言（传输层零加工，分页决策在控制器）。
import { apiClient } from "./client"
import {
  buildIllustSearchRequest,
  buildNovelSearchRequest,
  DEFAULT_SEARCH_FILTERS,
  type SearchFilters,
} from "@pictelio/search-core"
import type {
  PixivIllustListResponse,
  PixivNovelListResponse,
  SearchSort,
} from "./types"

/** 非法 next_url 的统一错误：带模块前缀（便于定位）+ warn 可见，不静默 */
function invalidNextUrlError(fnName: string): Error {
  const message = `${fnName}: invalid next_url — must point to app-api.pixiv.net`
  console.warn(`[api/search] ${message}`)
  return new Error(`[api/search] ${message}`)
}

/**
 * 验证 next_url 只指向 Pixiv API 域名（防御 SSRF，webview assertPixivUrl 先例移植）。
 * 允许：本地代理路径（`/pixiv-api`，web 模式 rewriteUrl 后的形态）或绝对 URL
 * 且 hostname 精确等于 app-api.pixiv.net（精确比对天然防伪后缀域）。
 * 注意：此处只断言，不做 URL 重写 —— rewriteUrl 职责在 client（勿重复重写）。
 */
function assertPixivUrl(url: string, fnName: string): void {
  // 允许本地代理路径
  if (url.startsWith("/pixiv-api")) return
  // 验证绝对 URL 的 hostname
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw invalidNextUrlError(fnName)
  }
  if (parsed.hostname === "app-api.pixiv.net") return
  throw invalidNextUrlError(fnName)
}

export function searchIllust(
  word: string,
  sort: SearchSort = "date_desc",
  signal?: AbortSignal,
  filters: SearchFilters = DEFAULT_SEARCH_FILTERS,
): Promise<PixivIllustListResponse> {
  const req = buildIllustSearchRequest({ word, sort, filters })
  return apiClient.get<PixivIllustListResponse>(req.endpoint, req.params, signal)
}

export function searchNovel(
  word: string,
  sort: SearchSort = "date_desc",
  signal?: AbortSignal,
  filters: SearchFilters = DEFAULT_SEARCH_FILTERS,
): Promise<PixivNovelListResponse> {
  const req = buildNovelSearchRequest({ word, sort, filters })
  return apiClient.get<PixivNovelListResponse>(req.endpoint, req.params, signal)
}

export function searchIllustNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  // 安全校验：只允许 Pixiv API 域名的 next_url（预防 SSRF）
  assertPixivUrl(url, "searchIllustNext")
  // rewriteUrl（绝对 URL 剥离域名 / 重写为代理路径）在 client 内统一执行
  return apiClient.get<PixivIllustListResponse>(url, undefined, signal)
}

export function searchNovelNext(
  url: string,
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  assertPixivUrl(url, "searchNovelNext")
  return apiClient.get<PixivNovelListResponse>(url, undefined, signal)
}

// ── 传输接口：useSearch 通过它取数，测试可注入内存替身（与 CommentsTransport 同构） ──

export interface SearchTransport {
  searchIllust(
    word: string,
    sort: SearchSort,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<PixivIllustListResponse>
  searchNovel(
    word: string,
    sort: SearchSort,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<PixivNovelListResponse>
  searchIllustNext(url: string, signal?: AbortSignal): Promise<PixivIllustListResponse>
  searchNovelNext(url: string, signal?: AbortSignal): Promise<PixivNovelListResponse>
}

// ── 默认传输实现（真实端点绑定） ──

export const searchTransport: SearchTransport = {
  searchIllust,
  searchNovel,
  searchIllustNext,
  searchNovelNext,
}
