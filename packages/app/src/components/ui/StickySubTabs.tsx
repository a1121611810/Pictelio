import type { Component, JSX } from "solid-js";

interface StickySubTabsProps {
  /**
   * 上方滚动 header 是否可见（TS 层必填；运行时未传按 undefined 容错 = 不可见）。
   * - 可见：子标签停靠 header 下方（sticky top-16，视觉 y=64px）
   * - 隐藏：transform 上移 64px（-translate-y-16，与 header 高度 64px 耦合），
   *   视觉贴顶 y=0，与 header 的 translate 移出动画同机制同步，消除空隙
   */
  headerVisible: boolean;
  /** 额外类（内边距等）；sticky / 停靠点 / 动画由本组件统一管理 */
  class?: string;
  children: JSX.Element;
}

/**
 * 滚动 header 下方的 sticky 子标签容器（深模块，见 ADR-0044 配套约定）。
 *
 * 背景：HomePage 的 header 是 sticky top-0 + translate 向上移出（滚动驱动
 * 显隐）。曾尝试「header 隐藏时把子标签停靠点切到 top-0」——失败，因为
 * sticky 元素的 top 受流位置约束：header 的 sticky 占位永不释放，子标签
 * 流位置下限是 64px（top-0 的锁定点低于流位置，sticky 永不锁定到 y=0，
 * 顶部留 64px 空隙）；且移动 WebView 对 sticky 的 top 变化不走 transition。
 *
 * 正确做法：停靠点保持 top-16（可达，对应 A2 卡片式 header 高度 64px），
 * header 隐藏时用 transform 视觉上移 64px——transform 不受 sticky 流位置
 * 约束，且与 header 的 translate 同为合成层动画（同 duration/curve 令牌），
 * 两段动画完全同步。
 */
const StickySubTabs: Component<StickySubTabsProps> = (props) => (
  <div
    class={`sticky top-16 z-10 bg-[var(--colorNeutralBackground3)] transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)] ${props.class ?? ""}`}
    classList={{
      "translate-y-0": props.headerVisible,
      "-translate-y-16": !props.headerVisible,
    }}
  >
    {props.children}
  </div>
);

export default StickySubTabs;
