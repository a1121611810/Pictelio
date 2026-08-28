// 自研 swipe 轮播的纯数学函数（ADR-0115 / spec: app-lynx-recommended-carousel §3.1）。
// 无依赖、纯 TS，node 可测（与 createMixFeed / mergeByTime 同「深模块可测」惯例）。
// oracle = vue-lynx 教程《商品详情页图片轮播》语义：吸附最近页（round）+ 边界钳制（上 0 下 -max）。

/**
 * 松手吸附到最近页：`round(offset / itemWidth) * itemWidth`。
 * 教程语义：`Math.round(offset / itemWidth) * itemWidth`（offset 为负，向下取整到最近整页）。
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
