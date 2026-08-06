// ─── 详情页画质档位（issue #146 T1，JS 侧 prefactor） ───
// 对齐主项目 settingsStore（packages/app/src/stores/settingsStore.ts:7/230）：
// ImageQuality = "medium" | "large" | "original"，默认 medium。
// resolveQualityUrl 为纯函数：优先精确档位，缺档时沿 fallback 链降级，
// 与 webview client IllustDetail 的画质取值语义一致。
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
