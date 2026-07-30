import type { Component } from "solid-js";

interface Props {
  class?: string;
  classList?: Record<string, boolean | undefined>;
  style?: string | Record<string, string | number>;
}

/** 共享 shimmer 占位骨架 — 用于 SkeletonCard、ImageCard、GridCard 的列表图片区域。
 *  使用 Fluent Design 背景色与 --durationUltraSlow / --curveEasyEase 动画令牌。 */
const SkeletonShimmer: Component<Props> = (props) => (
  <div
    class={props.class || ""}
    classList={props.classList}
    style={{
      background:
        "linear-gradient(90deg, var(--colorNeutralBackground2) 25%, var(--colorNeutralBackground1) 50%, var(--colorNeutralBackground2) 75%)",
      "background-size": "200% 100%",
      animation: "fluent-shimmer var(--durationUltraSlow) var(--curveEasyEase) infinite",
      ...(typeof props.style === "object" ? props.style : {}),
    }}
  />
);

export default SkeletonShimmer;
