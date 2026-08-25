// 类型徽章判定纯函数（ADR-0113 / spec: docs/specs/work-type-badges.md）。
// 与 app 端 packages/app/src/components/illustTypeBadges.ts 语义互镜像：
// 独立判定、允许并存、动图在前。跨端等价由差分测试（Ticket #215）保证。
// 术语见 CONTEXT.md「作品标识」节。

/** 类型徽章项：ugoira = 动图；multi = 多图（携带页数） */
export type IllustTypeBadgeItem = { kind: 'ugoira' } | { kind: 'multi'; pageCount: number }

/** 判定所需的 illust 最小字段集（与 PixivIllust 结构兼容） */
export interface IllustTypeBadgeSource {
  type: string
  page_count: number
}

/**
 * 解析作品应显示的类型徽章列表（有序，动图在前）。
 * 普通单图静态插画返回空数组；字段异常（page_count <= 1）自然判定为无多图标。
 */
export function resolveIllustTypeBadges(source: IllustTypeBadgeSource): IllustTypeBadgeItem[] {
  const badges: IllustTypeBadgeItem[] = []
  if (source.type === 'ugoira') {
    badges.push({ kind: 'ugoira' })
  }
  if (source.page_count > 1) {
    badges.push({ kind: 'multi', pageCount: source.page_count })
  }
  return badges
}
