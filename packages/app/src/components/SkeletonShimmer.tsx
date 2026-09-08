import type { JSX } from "@solidjs/web";
import type { Component } from "solid-js";

interface Props {
  /** Solid 2.0：codemod 后调用方传 class 数组/对象（classList→class 迁移），放宽为 ClassValue */
  class?: JSX.ClassValue;
  /** 旧 1.x classList 透传兼容（与 class 一样按 ClassValue 扁平化合并） */
  classList?: JSX.ClassValue;
  style?: string | Record<string, string | number>;
}

/** ClassValue 扁平化为字符串（定位契约需要 substring 匹配 absolute/fixed） */
function classToString(value: JSX.ClassValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (!value) return "";
  if (Array.isArray(value)) return value.map(classToString).filter(Boolean).join(" ");
  return Object.entries(value)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(" ");
}

/** 共享 shimmer 占位骨架 — 用于 SkeletonCard、ImageCard、GridCard 的列表图片区域。
 *  使用 Fluent Design 背景色与 --durationUltraSlow / --curveEasyEase 动画令牌。
 *
 *  实现说明（#366）：扫光层动画走 transform（fluent-shimmer-sweep，合成器线程驱动），
 *  主线程长任务（数据解析/整批渲染）期间动画照常流动；不再用 background-position
 *  （paint 属性，主线程驱动，长任务即冻结）。
 *
 *  定位契约：扫光层 absolute 锚定本组件，故外层必须是定位元素。消费方 class 已含
 *  absolute（ImageCard/GridCard/IllustSingleCard 的 overlay 用法）时尊重之；
 *  其余（SkeletonCard/各 skeleton 的流式块用法）补 position:relative 兜底。
 *  内联 position 会覆盖 class，因此必须按消费方意图二选一，不可无脑内联。 */
const SkeletonShimmer: Component<Props> = (props) => {
  const consumerClass = [classToString(props.class), classToString(props.classList)]
    .filter(Boolean)
    .join(" ");
  const consumerPositions =
    consumerClass.includes("absolute") ||
    consumerClass.includes("fixed") ||
    (typeof props.style === "object" && props.style != null && "position" in props.style) ||
    (typeof props.style === "string" && /position\s*:/.test(props.style));
  const outerStyle: Record<string, string | number> = {
    overflow: "hidden",
    background: "var(--colorNeutralBackground2)",
    ...(consumerPositions ? {} : { position: "relative" }),
    ...(typeof props.style === "object" ? props.style : {}),
  };
  return (
    <div
      data-testid="skeleton-shimmer"
      class={consumerClass}

      style={outerStyle}
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
};

export default SkeletonShimmer;
