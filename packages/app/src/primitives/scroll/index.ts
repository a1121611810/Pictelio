/**
 * scroll — 统一滚动原语入口
 *
 * 合并了 createScrollDirection、createScrolledPast、createScrollDrivenVisibility
 * 为 createScrollBehavior。保持向下兼容。
 */

export { createScrollBehavior } from "./createScrollBehavior";
export type { ScrollBehaviorConfig, ScrollBehaviorResult } from "./createScrollBehavior";

// 保持独立引用的原语（服务不同抽象层次）
export { createScrollRestore, scrollRestoreGlobal } from "../createScrollRestore";
export type {
  ScrollRestoreState,
  ScrollRestoreAPI,
  ScrollRestoreOptions,
} from "../createScrollRestore";
export { createVirtualScrollRestore } from "../createVirtualScrollRestore";
export type {
  VirtualScrollRestoreOptions,
  VirtualScrollRestoreAPI,
} from "../createVirtualScrollRestore";
export { createFeedScrollStore } from "../createFeedScrollStore";
