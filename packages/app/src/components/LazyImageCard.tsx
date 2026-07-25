import { createSignal, type Component } from "solid-js";
import ImageCard from "./ImageCard";
import SkeletonCard from "./SkeletonCard";
import type { PixivIllust } from "../api/types";
import { LAZY_LOAD_MARGIN } from "../primitives/rootMargins";
import { createEverVisible } from "@/primitives/visibility";
import { parsePixivUrlDimensions } from "../utils/imageLoader";

interface Props {
  illust: PixivIllust;
  onClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
}

/**
 * 从 illust 数据中提取骨架屏所需的宽高。
 * 优先使用 API 返回的 width/height，缺失时从主图 URL 解析。
 * 动图固定返回 1:1 正方形。
 */
function getSkeletonDimensions(illust: PixivIllust): { width: number; height: number } | null {
  if (illust.type === "ugoira") {
    return { width: 1, height: 1 };
  }
  if (illust.width > 0 && illust.height > 0) {
    return { width: illust.width, height: illust.height };
  }
  // URL fallback: 从主图 URL 解析尺寸
  const urls = [illust.image_urls.large, illust.image_urls.medium];
  for (const url of urls) {
    if (url) {
      const dims = parsePixivUrlDimensions(url);
      if (dims) {
        return dims;
      }
    }
  }
  return null;
}

/**
 * 轻量虚拟化卡片：首次进入视口才渲染 ImageCard，之前用 SkeletonCard 占位。
 * SkeletonCard 使用正确的 aspect-ratio（从 API 数据或 URL 解析），
 * 避免 skeleton→image 切换时 CSS columns 布局回流。
 * 一旦变为可见则永久渲染（不回溯销毁），避免滚动抖动。
 */
const LazyImageCard: Component<Props> = (props) => {
  const [ref, setRef] = createSignal<HTMLDivElement>();
  const everVisible = createEverVisible({ rootMargin: LAZY_LOAD_MARGIN })(() => ref());

  const skeletonDims = getSkeletonDimensions(props.illust);

  return (
    <div ref={setRef}>
      {everVisible() ? (
        <ImageCard
          illust={props.illust}
          onClick={props.onClick}
          onAuthorClick={props.onAuthorClick}
        />
      ) : (
        <SkeletonCard width={skeletonDims?.width} height={skeletonDims?.height} />
      )}
    </div>
  );
};

export default LazyImageCard;
