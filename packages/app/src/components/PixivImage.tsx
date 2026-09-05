import type { Component } from "solid-js";
import { createProgressiveImage } from "../primitives/createProgressiveImage";
import { checkImageCache, resolveImageUrl } from "../utils/imageLoader";

interface PixivImageProps {
  src: string;
  /** 渐进加载缩略图（**原始 CDN URL**，内部走 loadImage 预取，传代理路径会让原生 prefetch 拒绝）；
   *  传入才启用渐进双 img wrapper 分支，未传时 DOM 与旧版逐字节一致 */
  thumbSrc?: string;
  /** 渐进分支双 img 的 object-fit（封面裁切 cover / 完整显示 contain） */
  objectFit?: "cover" | "contain";
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

/** 渐进 wrapper 的 props（PixivImageProps 子集，thumbSrc 收窄为必传） */
interface ProgressivePixivImageProps extends Omit<
  PixivImageProps,
  "thumbSrc" | "hideLoadingPlaceholder"
> {
  thumbSrc: string;
}

/**
 * 渐进双 img wrapper（spec webview-perf-round2 §2.4，仅传 thumbSrc 时挂载）：
 * thumb=absolute 底层（aria-hidden + pointer-events-none，不参与语义与交互），
 * full=主层 relative（到位前不挂载，防白帧）；full 绘制完成（主 img load）后 thumb 层卸载，
 * 回收双层常驻的合成/解码成本（B1，issue #358），full 失败时保留兜底；
 * 双失败时渲染与旧版一致的失败 UI。
 */
const ProgressivePixivImage: Component<ProgressivePixivImageProps> = (p) => {
  const progressive = createProgressiveImage({
    fullUrl: () => p.src,
    thumbUrl: () => p.thumbSrc,
  });

  // Compute aspect ratio from width/height to prevent layout shift (CLS) — 与旧版同规则
  const aspectRatio = p.width && p.height ? `${p.width} / ${p.height}` : undefined;
  const sizingStyle = aspectRatio ? { "aspect-ratio": aspectRatio } : {};
  const objectFitStyle = p.objectFit ? { "object-fit": p.objectFit } : {};

  // 条件必须写在 JSX 内（Solid 组件体只执行一次，顶层三元读取 signal 无响应性）
  return (
    <>
      {progressive.failed() ? (
        <div
          class={`bg-[var(--colorNeutralBackground2)] flex flex-col items-center justify-center gap-1 ${p.class || ""}`}
          style={{ ...sizingStyle, ...(typeof p.style === "object" ? p.style : {}) }}
        >
          <span class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
            ⚠
          </span>
          <span class="text-[var(--colorNeutralForegroundDisabled)] [font-size:var(--fontSizeBase100)]">
            加载失败
          </span>
        </div>
      ) : (
        // overflow-hidden（S3）：裁剪收敛在 wrapper——调用方外框带圆角（如 NovelCoverCard compact）
        // 而本组件不带圆角 class，缺裁剪时 thumb/full 会溢出圆角；一处收敛所有调用方，
        // hero 分支外层已有 overflow-hidden 不受影响
        <div class={`relative overflow-hidden ${p.class || ""}`} style={sizingStyle}>
          {progressive.thumbSrc() && (
            <img
              src={progressive.thumbSrc()}
              alt=""
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 h-full w-full select-none"
              style={objectFitStyle}
              loading="eager"
              decoding="async"
              onError={progressive.onThumbError}
            />
          )}
          {progressive.displaySrc() && (
            <img
              src={progressive.displaySrc()}
              alt={p.alt || ""}
              class="relative h-full w-full"
              style={objectFitStyle}
              loading={p.loading || "lazy"}
              decoding="async"
              draggable={p.draggable}
              onClick={p.onClick}
              onLoad={(e) => {
                // 先接原语 onDisplayLoad（full 绘制就绪 → thumbSrc 收窄为空串卸载 thumb 层），
                // 再转发调用方回调——props.onLoad 语义不变；未传时跳过（NovelCoverCard 等调用方）
                progressive.onDisplayLoad(e);
                p.onLoad?.(e);
              }}
              onError={progressive.onDisplayError}
            />
          )}
        </div>
      )}
    </>
  );
};

const PixivImage: Component<PixivImageProps> = (props) => {
  // 渐进分支：仅当传入 thumbSrc 时走双 img wrapper；未传时保持旧路径 DOM 逐字节不变（回归保护）
  if (props.thumbSrc) {
    // 显式传 narrowed 后的 thumbSrc（spread 里的 thumbSrc?: string 无法满足必传约束）
    return <ProgressivePixivImage {...props} thumbSrc={props.thumbSrc} />;
  }

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
