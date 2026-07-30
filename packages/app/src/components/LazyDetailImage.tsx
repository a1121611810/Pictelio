import type { Component } from "solid-js";
import { onCleanup } from "solid-js";
import PixivImage from "./PixivImage";
import { createEverVisible } from "@/primitives/visibility";
import { LAZY_LOAD_MARGIN } from "../primitives/rootMargins";
import { loadImage } from "../utils/imageLoader";

/** 预加载窗口：可见页 + 当前页后 N 页 — OkHttp 10 并发安全 */
const PRELOAD_WINDOW = 6 as const;

/** prefetch 失败时重试次数和间隔 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

interface Props {
  /** 用户设定质量的图片 URL（medium / large） */
  src: string;
  pageIndex: number;
  totalPages: number;
  width: number;
  height: number;
  onClick: () => void;
  /** 父组件跟踪的当前可见页码，用于精准控制预加载数量 */
  visiblePage?: number;
}

/**
 * 详情页多图懒加载组件：
 *
 * 双重可见性检测：
 * 1. preloaded() — visiblePage 驱动，提前预加载（pageIndex <= visiblePage + PRELOAD_WINDOW）
 * 2. ioVisible() — 本地 IntersectionObserver，元素进入视口时独立触发
 *
 * 两者 OR 关系：任一条件满足即触发 loadImage 预下载到磁盘缓存。
 * cacheReady 为 true 后才渲染 PixivImage，确保 shouldInterceptRequest 能命中磁盘缓存。
 *
 * 无 visiblePage 时退回到 IntersectionObserver 兜底。
 */
const LazyDetailImage: Component<Props> = (props) => {
  const [ref, setRef] = createSignal<HTMLDivElement>();
  // cacheReadyFor 存已就绪的图片 URL，空串表示未就绪
  // 用 URL 而非 boolean 可消除竞态：旧 loadImage 的 finally 不会错误标记新 src
  const [cacheReadyFor, setCacheReadyFor] = createSignal("");
  const [retryTrigger, setRetryTrigger] = createSignal(0);

  const preloaded = createMemo(() => {
    const vp = props.visiblePage;
    return vp !== undefined && props.pageIndex <= vp + PRELOAD_WINDOW;
  });
  const ioVisible = createEverVisible({
    rootMargin: LAZY_LOAD_MARGIN,
  })(() => ref());

  const shouldLoad = createMemo(() => preloaded() || ioVisible());

  // 预加载到 Java 磁盘缓存：shouldLoad 为 true 时（即将进入视口），
  // 调用 loadImage() 走 Native prefetchImage（OkHttp + 连接池），
  // 完成后设 cacheReady 为 true，触发 PixivImage 渲染。
  // loadImage 内部有 inflight dedup，同一 URL 重复调用只发一次请求。

  // 1. src 变化时重置 cacheReadyFor 和 retryTrigger，确保跨插图导航时从骨架屏重新开始
  createEffect(() => {
    props.src;
    setCacheReadyFor("");
    setRetryTrigger(0);
  });

  // 2. cacheReadyFor 不是当前 src 且 shouldLoad 为 true 时触发 loadImage
  createEffect(() => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    const src = props.src;
    const attempt = retryTrigger();
    if (shouldLoad() && src && cacheReadyFor() !== src) {
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      onCleanup(() => {
        if (retryTimer) clearTimeout(retryTimer);
      });

      const LOAD_TIMEOUT = 12_000;
      const loadWithTimeout = Promise.race([
        loadImage(src),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error("loadImage timeout")), LOAD_TIMEOUT);
          onCleanup(() => clearTimeout(t));
        }),
      ]);

      loadWithTimeout
        .then(() => {
          if (!cancelled && props.src === src) {
            setCacheReadyFor(src);
          }
        })
        .catch(() => {
          if (!cancelled && props.src === src) {
            if (attempt < MAX_RETRIES) {
              retryTimer = setTimeout(() => {
                if (!cancelled) setRetryTrigger(attempt + 1);
              }, RETRY_DELAY_MS);
            } else {
              // 所有重试均失败，仍标记就绪让 PixivImage 渲染，
              // shouldInterceptRequest 通过 OkHttp 兜底下载
              setCacheReadyFor(src);
            }
          }
        });
    }
  });

  const canDisplayImage = createMemo(
    () => props.src && cacheReadyFor() === props.src && shouldLoad(),
  );

  return (
    <div
      ref={setRef}
      class="relative cursor-pointer"
      data-page-index={props.pageIndex}
      onClick={props.onClick}
    >
      {canDisplayImage() ? (
        <div class="relative">
          <PixivImage
            src={props.src}
            alt={`page ${props.pageIndex + 1}`}
            class="w-full object-contain"
          />
          <span
            class="absolute top-2 left-2 px-2 py-0.5 rounded-[var(--borderRadiusSmall)] text-[var(--colorImageBadgeForeground)]"
            style={{ "background-color": "var(--colorImageBadgeBackground)" }}
          >
            <span style={{ "font-size": "var(--fontSizeBase100)" }}>
              {props.pageIndex + 1} / {props.totalPages}
            </span>
          </span>
        </div>
      ) : (
        <div
          style={{
            "aspect-ratio": `${props.width} / ${props.height}`,
            background: "var(--colorNeutralBackground2)",
            "border-radius": "var(--borderRadiusMedium)",
          }}
        />
      )}
    </div>
  );
};

export default LazyDetailImage;
