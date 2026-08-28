// 自研 swipe 轮播的纯数学函数（ADR-0115 / spec: app-lynx-recommended-carousel §3.1；
// 吸附阈值 + fling 判定 = ADR-0118 / spec: app-lynx-recommended-carousel-polish-r2 §2.2/§3.1）。
// 无依赖、纯 TS，node 可测（与 createMixFeed / mergeByTime 同「深模块可测」惯例）。
// calcNearestPage 的 oracle = vue-lynx 教程《商品详情页图片轮播》语义（吸附最近页 round + 边界钳制）；
// calcSnapTarget 的 oracle = ADR-0118 决策 2（1/3 屏宽阈值 + fling 甩动，双向对称）。

/** 吸附阈值（屏宽比例）：拖过 1/3 屏宽松手即翻页，未过回弹（ADR-0118 决策 2） */
export const SNAP_THRESHOLD_RATIO = 1 / 3

/** fling 甩动速度阈值（px/ms）：速度超阈值且位移未到 1/3 时，也沿速度方向翻页（ADR-0118 决策 2） */
export const FLING_VELOCITY_PX_PER_MS = 0.4

/**
 * 松手吸附目标页（ADR-0118 决策 2，替代 calcNearestPage 的 50% round 语义）：
 * - 位移过 1/3 屏宽（|frac| >= SNAP_THRESHOLD_RATIO）→ 沿位移方向翻一页；
 * - 否则若甩动速度超阈值（|velocity| >= FLING_VELOCITY_PX_PER_MS）→ 沿速度方向翻一页（快甩短距离也翻页）；
 * - 否则回弹当前页。
 * 返回目标 offset（px，**不钳制**——由调用方 clampOffset / updateOffset 边界处理）。
 * 位移方向与速度方向符号约定一致：负 = 左滑 = 下一页（offset 负向）。
 * 非法输入（offset 非有限 / itemWidth <= 0）返回 0（避免 NaN 污染 transform）。
 */
export function calcSnapTarget(
  offset: number,
  itemWidth: number,
  opts?: { velocityPxPerMs?: number },
): number {
  if (!Number.isFinite(offset) || itemWidth <= 0) return 0
  const velocity = opts?.velocityPxPerMs ?? 0
  const ratio = offset / itemWidth
  const currentPage = Math.round(ratio)
  const frac = ratio - currentPage // ∈ [-0.5, 0.5)
  let targetPage = currentPage
  if (Math.abs(frac) >= SNAP_THRESHOLD_RATIO) {
    targetPage = currentPage + Math.sign(frac)
  } else if (Number.isFinite(velocity) && Math.abs(velocity) >= FLING_VELOCITY_PX_PER_MS) {
    targetPage = currentPage + Math.sign(velocity)
  }
  // Math.round(-0.32) === -0 → targetPage 为 -0 时返回 -0 会污染 transform（同 clampOffset 的正零归一化惯例）
  return targetPage === 0 ? 0 : targetPage * itemWidth
}

/**
 * 松手吸附到最近页：`round(offset / itemWidth) * itemWidth`。
 * 教程语义：`Math.round(offset / itemWidth) * itemWidth`（offset 为负，向下取整到最近整页）。
 * ⚠️ ADR-0118 后轮播已改用 calcSnapTarget（1/3 阈值 + fling）；本函数保留为教程原义 oracle 对照，
 * 不再被轮播调用。
 * 非法输入（offset 非有限 / itemWidth <= 0）返回 0（避免 NaN 污染 transform）。
 */
export function calcNearestPage(offset: number, itemWidth: number): number {
  if (!Number.isFinite(offset) || itemWidth <= 0) return 0
  return Math.round(offset / itemWidth) * itemWidth
}

/**
 * 边界钳制：上界 0，下界 `-(dataLength - 1) * itemWidth`（教程 `updateOffset` 的 clamp）。
 * dataLength 或 itemWidth 非法返回 0；单条（dataLength=1）上下界均为 0（无滑动空间）。
 */
export function clampOffset(offset: number, dataLength: number, itemWidth: number): number {
  if (!Number.isFinite(offset) || dataLength <= 0 || itemWidth <= 0) return 0
  const upperBound = 0
  // 单条（dataLength <= 1）下界收敛到 0（正零），避免 Math.min(0, -0) 产生 -0 污染 transform
  const lowerBound = dataLength <= 1 ? 0 : -(dataLength - 1) * itemWidth
  return Math.min(upperBound, Math.max(lowerBound, offset))
}
