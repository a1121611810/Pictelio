import type { Component } from "solid-js";
import { checkImageCache, resolveImageUrl } from "../utils/imageLoader";

interface PixivImageProps {
  src: string;
  alt?: string;
  class?: string;
  style?: string | Record<string, string | number>;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  draggable?: boolean;
  onClick?: (e: MouseEvent) => void;
  onLoad?: (e: Event) => void;
  /** 是否隐藏组件自带的 loading 占位骨架，由调用方自行管理 loading 状态 */
  hideLoadingPlaceholder?: boolean;
}

const PixivImage: Component<PixivImageProps> = (props) => {
  // 同步检查 LRU 缓存：命中则直接使用持久 Blob URL，浏览器瞬间识别
  let syncBlobUrl: string | null = null;
  if (props.src) {
    const cachedUrl = checkImageCache(props.src);
    if (cachedUrl) {
      // 持久 Blob URL，缓存管理生命周期
      syncBlobUrl = cachedUrl;
    }
  }

  const [displayUrl, _setDisplayUrl] = createSignal(
    syncBlobUrl || (props.src ? resolveImageUrl(props.src) : ""),
  );
  const [failed, setFailed] = createSignal(false);

  // Compute aspect ratio from width/height to prevent layout shift (CLS)
  const aspectRatio = props.width && props.height ? `${props.width} / ${props.height}` : undefined;

  function handleError(e: Event) {
    const img = e.target as HTMLImageElement;
    console.error(`[PixivImage] <img> onError: ${img.src}`);
    setFailed(true);
  }

  // Shared style for all states — preserves aspect ratio to prevent CLS
  const sizingStyle = aspectRatio ? { "aspect-ratio": aspectRatio } : {};

  return (
    <>
      {displayUrl() && !failed() ? (
        // decoding="async"：异步解码，避免图片解码阻塞在主线程帧内
        <img
          src={displayUrl()}
          alt={props.alt || ""}
          class={props.class || ""}
          style={sizingStyle}
          loading={props.loading || "lazy"}
          decoding="async"
          draggable={props.draggable}
          onClick={props.onClick}
          onLoad={props.onLoad}
          onError={handleError}
        />
      ) : failed() ? (
        <div
          class={`bg-[var(--colorNeutralBackground2)] flex flex-col items-center justify-center gap-1 ${props.class || ""}`}
          style={{ ...sizingStyle, ...(typeof props.style === "object" ? props.style : {}) }}
        >
          <span class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
            ⚠
          </span>
          <span class="text-[var(--colorNeutralForegroundDisabled)] [font-size:var(--fontSizeBase100)]">
            加载失败
          </span>
        </div>
      ) : props.hideLoadingPlaceholder ? null : (
        <div
          class={`flex flex-col items-center justify-center gap-1.5 ${props.class || ""}`}
          style={{
            "aspect-ratio": aspectRatio,
            background:
              "linear-gradient(90deg, var(--colorNeutralBackground2) 25%, var(--colorNeutralBackground1) 50%, var(--colorNeutralBackground2) 75%)",
            "background-size": "200% 100%",
            animation: "fluent-shimmer var(--durationSlower) var(--curveEasyEase) infinite",
          }}
        >
          <span class="spinner w-4 h-4" />
          <span class="text-[var(--colorNeutralForegroundDisabled)] [font-size:var(--fontSizeBase100)]">
            加载中...
          </span>
        </div>
      )}
    </>
  );
};

export default PixivImage;
