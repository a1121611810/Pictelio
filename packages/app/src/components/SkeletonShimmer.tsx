import type { Component } from "solid-js";

interface Props {
  class?: string;
  classList?: Record<string, boolean | undefined>;
  style?: string | Record<string, string | number>;
}

/** 共享 shimmer 占位骨架 — 用于 SkeletonCard、ImageCard、GridCard 的列表图片区域。
 *  使用 Fluent Design 背景色与 --durationUltraSlow / --curveEasyEase 动画令牌。
 *
 *  实现说明（#366）：扫光层动画走 transform（fluent-shimmer-sweep，合成器线程驱动），
 *  主线程长任务（数据解析/整批渲染）期间动画照常流动；不再用 background-position
 *  （paint 属性，主线程驱动，长任务即冻结）。 */
const SkeletonShimmer: Component<Props> = (props) => (
  <div
    data-testid="skeleton-shimmer"
    class={props.class || ""}
    classList={props.classList}
    style={{
      position: "relative",
      overflow: "hidden",
      background: "var(--colorNeutralBackground2)",
      ...(typeof props.style === "object" ? props.style : {}),
    }}
  >
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "0",
        bottom: "0",
        left: "0",
        width: "200%",
        "will-change": "transform",
        background:
          "linear-gradient(90deg, transparent 25%, var(--colorNeutralBackground1) 50%, transparent 75%)",
        animation: "fluent-shimmer-sweep var(--durationUltraSlow) var(--curveEasyEase) infinite",
      }}
    />
  </div>
);

export default SkeletonShimmer;
