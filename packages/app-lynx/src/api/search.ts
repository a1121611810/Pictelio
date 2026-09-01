// ─── Pixiv 搜索 API 端点适配层（app-lynx 全局搜索，issue #291） ───
// 端点/参数/next_url 断言与 webview 版（packages/app/src/api/search.ts）逐字对齐
// （ADR-0132 第 8 条：双端共享同一后端语义，改契约须同步 ADR）。
// 差异注记：search_target 默认按词派生（对齐 webview 调用点 searchStore 的
// `keyword().includes(" ")` 语义，而非 webview 函数签名的常量默认值）。
import { apiClient } from "./client"
import type {
  PixivIllustListResponse,
  PixivNovelListResponse,
  SearchSort,
  SearchTarget,
} from "./types"

/**
 * 搜索目标派生：关键词含空格 → 多标签精确匹配，否则单标签部分匹配
 * （对齐 webview searchStore 的 `keyword().includes(" ")` 语义）。
 */
export function deriveSearchTarget(word: string): SearchTarget {
  return word.includes(" ") ? "exact_match_for_tags" : "partial_match_for_tags"
}

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
  searchTarget: SearchTarget = deriveSearchTarget(word),
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  // sort=popular_desc 路由到独立热门预览端点（不分页），其他排序走标准搜索端点
  if (sort === "popular_desc") {
    return apiClient.get<PixivIllustListResponse>(
      "/v1/search/popular-preview/illust",
      { word, search_target: searchTarget, filter: "for_ios" },
      signal,
    )
  }
  return apiClient.get<PixivIllustListResponse>(
    "/v1/search/illust",
    { word, sort, search_target: searchTarget, filter: "for_ios" },
    signal,
  )
}

export function searchNovel(
  word: string,
  sort: SearchSort = "date_desc",
  searchTarget: SearchTarget = deriveSearchTarget(word),
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  // sort=popular_desc 路由到独立热门预览端点（不分页），其他排序走标准搜索端点
  if (sort === "popular_desc") {
    return apiClient.get<PixivNovelListResponse>(
      "/v1/search/popular-preview/novel",
      { word, search_target: searchTarget, filter: "for_ios" },
      signal,
    )
  }
  return apiClient.get<PixivNovelListResponse>(
    "/v1/search/novel",
    { word, sort, search_target: searchTarget, filter: "for_ios" },
    signal,
  )
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
    searchTarget: SearchTarget,
    signal?: AbortSignal,
  ): Promise<PixivIllustListResponse>
  searchNovel(
    word: string,
    sort: SearchSort,
    searchTarget: SearchTarget,
    signal?: AbortSignal,
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
