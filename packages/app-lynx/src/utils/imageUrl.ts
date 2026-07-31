// ─── 图片 URL 工具（app-lynx） ───
// Pixiv CDN 直连 URL → 本地代理路径（/pixiv-img/...），与现有 app 同策略。
// 禁止在代码中硬编码 i.pximg.net。

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
  return url
}

/** 生成代理后的缩略图 URL（square_medium 加速列表加载） */
export function thumbUrl(urls: {
  square_medium?: string
  medium?: string
  large?: string
}): string {
  return proxyImageUrl(urls.square_medium || urls.medium || urls.large || "")
}
