import type { Component } from "solid-js";
import SkeletonShimmer from "./SkeletonShimmer";

interface Props {
  /** 图片原始宽度（来自 API 或 URL 解析），用于设置正确的 aspect-ratio */
  width?: number;
  /** 图片原始高度 */
  height?: number;
}

/** Skeleton placeholder matching ImageCard layout.
 *  Uses existing fluent-shimmer animation + Fluent tokens.
 *  如果传入 width/height，使用正确的 aspect-ratio 避免布局回退；
 *  否则回退 1:1（初始加载无数据时）。 */
const SkeletonCard: Component<Props> = (props) => {
  const aspectRatio = props.width && props.height ? `${props.width} / ${props.height}` : "1 / 1";

  return (
    <div class="image-card break-inside-avoid mb-3 overflow-hidden">
      {/* Thumbnail area — 使用正确比例避免 skeleton→image 切换时 reflow */}
      <SkeletonShimmer class="w-full" style={{ "aspect-ratio": aspectRatio }} />
      {/* Text lines — padding 与 ImageCard info 区对齐（A2 宽松 L，ADR-0070） */}
      <div class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)] flex flex-col gap-1.5">
        <SkeletonShimmer class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)] w-3/4" />
        <SkeletonShimmer class="h-[var(--spacingVerticalXXL)] rounded-[var(--borderRadiusSmall)] w-1/2" />
      </div>
    </div>
  );
};

export default SkeletonCard;
