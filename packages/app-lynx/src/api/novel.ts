// ─── 小说 API（复用现有 app 端点 + 正文提取逻辑） ───
import { apiClient, getAccessToken } from "./client"
import type { PixivNovelListResponse, PixivNovelDetailResponse } from "./types"
import { PIXIV_USER_AGENT, PIXIV_REFERER } from "./userAgent"
import { requestFetch } from "../utils/fetchWrapper"

export function loadRecommendedNovels(signal?: AbortSignal): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(
    "/v1/novel/recommended",
    { filter: "for_ios" },
    signal,
  )
}

export function loadNovelDetail(novelId: number): Promise<PixivNovelDetailResponse> {
  return apiClient.get<PixivNovelDetailResponse>("/v2/novel/detail", {
    novel_id: String(novelId),
  })
}

export function loadNovelNext(url: string, signal?: AbortSignal): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(url, undefined, signal)
}

/**
 * 从 /webview/v2/novel 返回的 HTML 中提取小说正文。
 * 正文数据藏在 <script> 标签的 window.pixiv.novel.text 中。
 * （与现有 app 的 extractNovelTextFromHtml 逻辑同源）
 */
export function extractNovelTextFromHtml(html: string): string {
  const match = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/u)
  if (!match) return ""
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1].replace(/\\n/gu, "\n").replace(/\\r/gu, "").replace(/\\t/gu, " ")
  }
}

/** 加载小说正文纯文本（走 /pixiv-api/webview/v2/novel 代理） */
export async function fetchNovelText(novelId: number): Promise<string> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    "User-Agent": PIXIV_USER_AGENT,
    Referer: PIXIV_REFERER,
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const params = new URLSearchParams({ id: String(novelId) })
  const res = await requestFetch(`/pixiv-api/webview/v2/novel?${params}`, { headers })
  if (!res.ok) throw new Error(`小说正文加载失败 (HTTP ${res.status})`)
  const html = await res.text()
  const text = extractNovelTextFromHtml(html)
  if (!text) throw new Error("小说正文提取失败")
  return text
}
