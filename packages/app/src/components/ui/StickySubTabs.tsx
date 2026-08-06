import type { Component, JSX } from "solid-js";

interface StickySubTabsProps {
  /**
   * 上方滚动 header 是否可见。
   * - 可见：停靠其下（top-12，48px，header 高度）
   * - 隐藏：占满顶部（top-0），消除 header 平移移出后留下的空隙
   * 停靠点切换与 header 的 translate 动画同 duration/curve 令牌，无缝衔接。
   */
  headerVisible: boolean;
  /** 额外类（内边距等）；sticky / 停靠点 / 动画由本组件统一管理 */
  class?: string;
  children: JSX.Element;
}

/**
 * 滚动 header 下方的 sticky 子标签容器（深模块，见 ADR-0044 配套约定）。
 *
 * 背景：HomePage 的 header 是 sticky + translate 向上移出（滚动驱动显隐），
 * 但 header 移出只是视觉位移，文档流占位不释放；若子标签停靠点写死 top-12，
 * header 消失后顶部会留 48px 空隙（"卡在半空"）。
 * 本组件把「停靠点随 header 显隐联动」收敛为单一接口：调用方只需告知
 * headerVisible，停靠点切换 + 过渡动画 + 玻璃容器令牌全部封装在实现内。
 */
const StickySubTabs: Component<StickySubTabsProps> = (props) => (
  <div
    class={`sticky z-10 surface-appbar transition-[top] duration-[var(--durationNormal)] ease-[var(--curveEasyEase)] ${props.class ?? ""}`}
    classList={{
      "top-0": !props.headerVisible,
      "top-12": props.headerVisible,
    }}
  >
    {props.children}
  </div>
);

export default StickySubTabs;
