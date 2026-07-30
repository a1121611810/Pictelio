/**
 * scroll — 统一滚动原语入口
 *
 * 合并了 createScrollDirection、createScrolledPast、createScrollDrivenVisibility
 * 为 createScrollBehavior。保持向下兼容。
 */

export { createScrollBehavior } from "./createScrollBehavior";
export type { ScrollBehaviorConfig, ScrollBehaviorResult } from "./createScrollBehavior";
