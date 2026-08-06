// ─── 插画详情图片高度计算（spec：详情比例显示） ───
// 原生 LynxView 在 scroll-view 内不支持动态 aspect-ratio style（ADR-0055 §2），
// 详情大图改用显式 vw 高度：容器宽度铺满视口（100vw），高度按原图宽高比换算。
// 显式高度模式已验证可用（issue #138 的 height="48.4vw" 先例）。

/**
 * 按原图宽高比计算详情页图片容器高度（vw 字符串），返回 `${(height / width) * 100}vw`。
 * width/height 缺失、非正数、非有限值时回退 `fallbackVw`（默认 100，即原 1:1 容器）。
 * 不封顶：与 webview client 一致（webview 端详情大图无 max-height，用户已确认）。
 */
export function detailImageHeightVw(
  width: number | undefined | null,
  height: number | undefined | null,
  fallbackVw = 100,
): string {
  const valid = (n: number | undefined | null): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0
  if (!valid(width) || !valid(height)) {
    return `${fallbackVw}vw`
  }
  return `${(height / width) * 100}vw`
}
