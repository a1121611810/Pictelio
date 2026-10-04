// ─── 详情页画质档位（issue #146 T1，JS 侧 prefactor） ───
// 与 settingsStore 的档位口径一致：
// ImageQuality = "medium" | "large" | "original"，默认 medium。
// resolveQualityUrl 为纯函数：优先精确档位，缺档时沿 fallback 链降级，
// 画质取值语义见下方 ImageQuality 与 fallback 链。
// resolvePageSrcs（ADR-0129 多图详情列表）为纯函数：逐页 apply resolveQualityUrl + proxyImageUrl。
import { proxyImageUrl } from "./imageUrl"

export type ImageQuality = "medium" | "large" | "original"

/**
 * 按画质档位解析展示用图片 URL（返回空串表示无可用 URL）。
 * - medium → urls.medium || urls.large
 * - large → urls.large || urls.medium
 * - original → originalImageUrl || urls.original || urls.large || urls.medium
 */
export function resolveQualityUrl(
  urls: { medium?: string; large?: string; original?: string },
  quality: ImageQuality,
  originalImageUrl?: string,
): string {
  switch (quality) {
    case "medium":
      return urls.medium || urls.large || ""
    case "large":
      return urls.large || urls.medium || ""
    case "original":
      return originalImageUrl || urls.original || urls.large || urls.medium || ""
    default:
      // 类型上不可达（ImageQuality 已穷尽）；防御性兜底
      return ""
  }
}

/**
 * 多图列表逐页 URL 解析（ADR-0129 / spec §2.4）：
 * 每页按画质档位 resolveQualityUrl（singleOriginalUrl = meta_single_page.original_image_url，
 * 仅单页场景有值，作为原图档兜底），再经 proxyImageUrl 代理改写。
 * 输出数组长度恒等页数（不过滤——缺档/代理拒绝时元素为空串，由 CoverImage isUnloadableSrc 走失败态，非静默降级）。
 */
export function resolvePageSrcs(
  pages: Array<{ medium?: string; large?: string; original?: string }>,
  quality: ImageQuality,
  singleOriginalUrl?: string,
): string[] {
  return pages.map((page) => proxyImageUrl(resolveQualityUrl(page, quality, singleOriginalUrl)))
}
