import { createScrollPosition } from "@solid-primitives/scroll";

/**
 * 位置阈值原语：响应式判定 window.scrollY > threshold。
 *
 * 纯位置驱动的 UI 显隐（回顶按钮、PersonalCenter header 折叠）统一使用，
 * 不再手写 scroll 监听（见 docs/adr/0013-scroll-primitives-unification.md）。
 * 初始状态在创建时即正确（含以滚动位置恢复打开的页面）。
 */
export function createScrolledPast(threshold: number) {
  const scroll = createScrollPosition();
  return createMemo(() => scroll.y > threshold);
}
