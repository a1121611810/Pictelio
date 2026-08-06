// 骨架屏容器样式解析（issue #138 图片骨架屏修复 prefactor）
// 根因：原生 LynxView 下 <image> 的百分比高度（h-full）在「非显式 height」容器
// （aspect-ratio style + min-h）内解析为 0 → 图片不绘制。
// 修复模式：容器改用显式 height（vw）。height 有值则优先用它，否则回退到
// aspect-ratio + min-height 占位方案（web-core 预览场景仍依赖）。
export function resolveSkeletonStyle(
  height?: string,
  aspectRatio?: string,
  minH?: string,
): Record<string, string> {
  if (height) {
    return { height }
  }
  const style: Record<string, string> = {}
  if (aspectRatio) {
    style.aspectRatio = aspectRatio
  }
  if (minH) {
    style.minHeight = minH
  }
  return style
}
