// ─── 图片 URL 工具（app-lynx） ───
// Pixiv CDN 直连 URL → 本地代理路径（/pixiv-img/...），与现有 app 同策略。
// 禁止在代码中硬编码 i.pximg.net。
import { extractHostname } from './safeParseUrl'

export function proxyImageUrl(url: string): string {
  if (!url) return ""
  if (url.startsWith("/pixiv-img/")) return url
  // https://i.pximg.net/... → /pixiv-img/...
  const marker = "/i.pximg.net/"
  const idx = url.indexOf(marker)
  if (idx !== -1) {
    return `/pixiv-img/${url.slice(idx + marker.length)}`
  }
  // 已是相对或本地路径
  if (url.startsWith("/")) return url
  // 非 Pixiv 域绝对 URL：拒绝加载（security-review #165：防外部/内网地址探测面；
  // 本项目所有图片来源均为 Pixiv API，pximg/pixiv 域外无合法场景）
  if (isTrustedImageHost(url)) return url
  return ""
}

/**
 * 图片主机白名单：*.pximg.net 与 *.pixiv.net（含根域）。
 * 与既有 /i.pximg.net/ marker 同风格，禁止硬编码完整 CDN URL（项目约束）。
 * 迁移（review P1-1 挂账清账）：解析改经 safeParseUrl（禁 URL 全局，ADR-0163）；
 * hostname 小写化对齐 WHATWG 语义（浏览器 URL 会小写化 host）。
 */
function isTrustedImageHost(url: string): boolean {
  const host = extractHostname(url)?.toLowerCase()
  if (host === undefined) return false
  return host === "pximg.net" || host.endsWith(".pximg.net") || host === "pixiv.net" || host.endsWith(".pixiv.net")
}

/** 生成代理后的缩略图 URL（square_medium 加速列表加载） */
export function thumbUrl(urls: {
  square_medium?: string
  medium?: string
  large?: string
}): string {
  return proxyImageUrl(urls.square_medium || urls.medium || urls.large || "")
}
