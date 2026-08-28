// 推荐轮播封面图三态 + 重试 URL 的纯逻辑（app-lynx，spec: app-lynx-recommended-carousel-image-fab-polish §3.1）。
// 与「深模块可测」惯例一致：无 DOM 依赖、node 可测；组件渲染行为归 web-core/真机（§4 验证闭环）。
export type CoverState = 'skeleton' | 'image' | 'failed'

/**
 * 推导封面三态：加载中（骨架）/ 加载成功 / 加载失败。
 * 状态互斥：failed 优先，其次 loaded，否则加载中（skeleton）。重试时调用方把 loaded/failed 复位为 false → 回到骨架。
 * 性质/invariant：单一输入组合必映射到三者之一，且重试后从 skeleton 重新开始。
 */
export function deriveCoverState(loaded: boolean, failed: boolean): CoverState {
  if (failed) return 'failed'
  if (loaded) return 'image'
  return 'skeleton'
}

/**
 * 给图片 URL 追加一次性 cache-bust 参数（「重试」仅重载该图，不触发整页刷新；spec §2.1）。
 * 已有 query 用 &，否则用 ?；不产生重复的 ?。空 src 原样返回。
 * URL 语义 oracle：`https://a/b.jpg` → `https://a/b.jpg?retry=<ts>`；`https://a/b.jpg?x=1` → `?x=1&retry=<ts>`。
 */
export function withRetryQuery(src: string): string {
  if (!src) return src
  const sep = src.includes('?') ? '&' : '?'
  return `${src}${sep}retry=${Date.now()}`
}

/**
 * 「重试」整组状态：从**干净 base src** 重建 imageSrc（带新 retry 参数），并把 loaded/failed 复位回骨架。
 * ⚠️ 关键不变量：必须用 baseSrc（props.src，本轮无 retry）而非已带 retry 的 imageSrc 重建，否则 `&retry` 会累积。
 * spec §2.1/§3.1：重试仅重载该图（cache-bust），回到骨架，不整页刷新。
 */
export function deriveRetryState(baseSrc: string): {
  imageSrc: string
  loaded: false
  failed: false
} {
  return { imageSrc: withRetryQuery(baseSrc), loaded: false, failed: false }
}
