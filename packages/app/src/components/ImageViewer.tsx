import type { Component } from "solid-js";
import { checkImageCache, loadImageWithProgress } from "../utils/imageLoader";

interface Props {
  imageUrls: string[];
  /** 预览图 URL 列表（与 imageUrls 一一对应），用于打开时从 LRU 缓存取模糊占位图 */
  previewUrls?: string[];
  initialPage?: number;
  onClose?: () => void;
}

const ImageViewer: Component<Props> = (props) => {
  const [scale, setScale] = createSignal(1);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const initialPage = props.initialPage ?? 0;
  const [currentPage, setCurrentPage] = createSignal(initialPage);
  const [animating, setAnimating] = createSignal(false);

  // ── 加载状态管理 ──
  // 初始页立即设为 0%，不等 createEffect，消除感知延迟
  const [progressMap, setProgressMap] = createSignal<Record<number, number>>({ [initialPage]: 0 });
  // 每页完成后的 Blob URL
  const [loadedUrls, setLoadedUrls] = createSignal<Record<number, string>>({});
  // 跟踪已发起加载的页面，避免重复请求
  const loadingStarted = new Set<number>();

  // 预览图 Blob URL：从 LRU 缓存同步读取
  const previewBlobUrl = (i: number): string | undefined => {
    const url = props.previewUrls?.[i];
    return url ? checkImageCache(url) : undefined;
  };

  // 页面变化时，若未加载则触发下载
  createEffect(() => {
    const page = currentPage();
    // 已加载
    if (loadedUrls()[page] !== undefined) {
      return;
    }
    // 已发起
    if (loadingStarted.has(page)) {
      return;
    }
    loadingStarted.add(page);
    startLoad(page);
  });

  // 初始页在挂载时立即发起加载（进度已在初始化时设为 0，不等 createEffect）
  onMount(() => {
    // 移除过渡遮罩，此时 ImageViewer 自身的 spinner + 0% 已在 DOM 中可见
    const mask = document.getElementById("viewer-transition-mask");
    mask?.remove();

    const page = currentPage();
    if (loadedUrls()[page] !== undefined) {
      return;
    }
    if (loadingStarted.has(page)) {
      return;
    }
    loadingStarted.add(page);
    startLoad(page);
  });

  async function startLoad(pageIndex: number) {
    const originalUrl = props.imageUrls[pageIndex];
    if (!originalUrl) {
      return;
    }

    setProgressMap((prev) => ({ ...prev, [pageIndex]: 0 }));

    const [err, result] = await tryAsync(
      loadImageWithProgress(originalUrl, (p) => {
        if (p.percent >= 0) {
          setProgressMap((prev) => ({ ...prev, [pageIndex]: p.percent }));
        }
      }),
    );

    if (err) {
      setProgressMap((prev) => ({ ...prev, [pageIndex]: -1 }));
    } else {
      setLoadedUrls((prev) => ({ ...prev, [pageIndex]: result.url }));
      setProgressMap((prev) => ({ ...prev, [pageIndex]: 100 }));
    }
  }

  let touchStart = { x: 0, y: 0, dist: 0, time: 0 };
  let lastDist = 0;

  const handleTouchStart = (e: TouchEvent) => {
    if (animating()) {
      return;
    }
    const touches = e.touches;
    touchStart.time = Date.now();

    if (touches.length === 1) {
      touchStart.x = touches[0].clientX;
      touchStart.y = touches[0].clientY;
    } else if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      touchStart.dist = Math.sqrt(dx * dx + dy * dy);
      lastDist = touchStart.dist;
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (animating()) {
      return;
    }
    const touches = e.touches;

    if (touches.length === 2 && scale() >= 1) {
      e.preventDefault();
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = dist / lastDist;
      lastDist = dist;

      const newScale = Math.max(1, Math.min(5, scale() * delta));
      setScale(newScale);
    } else if (touches.length === 1 && scale() === 1) {
      const deltaX = touches[0].clientX - touchStart.x;
      if (Math.abs(deltaX) > 50) {
        if (deltaX < 0 && currentPage() < props.imageUrls.length - 1) {
          setAnimating(true);
          setCurrentPage(currentPage() + 1);
          setTimeout(() => setAnimating(false), 200);
        } else if (deltaX > 0 && currentPage() > 0) {
          setAnimating(true);
          setCurrentPage(currentPage() - 1);
          setTimeout(() => setAnimating(false), 200);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (scale() < 1) {
      setScale(1);
    }
  };

  const handleDblClick = () => {
    if (scale() > 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  onCleanup(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  });

  return (
    <div
      class="fixed inset-0 z-50 touch-none select-none"
      style={{ "background-color": "var(--colorOverlayBackground)" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDblClick={handleDblClick}
    >
      <div
        class="flex h-full transition-transform duration-[var(--durationNormal)]"
        style={{
          transform: `translateX(-${currentPage() * 100}%)`,
        }}
      >
        {props.imageUrls.map((_url, i) => {
          const pb = previewBlobUrl(i);
          const progress = progressMap()[i];
          const loaded = loadedUrls()[i];

          return (
            <div class="min-w-full h-full flex items-center justify-center relative overflow-hidden">
              {/* Layer 1: 模糊预览图占位（从 LRU 缓存同步读取） */}
              <Show when={pb}>
                {(blobUrl) => (
                  <img
                    src={blobUrl()}
                    alt=""
                    class="absolute inset-0 w-full h-full object-contain"
                    style={{
                      filter: "blur(16px) brightness(0.6)",
                      transform: "scale(1.1)",
                      transition: `opacity var(--durationGentle) var(--curveEasyEase)`,
                      opacity: loaded ? 0 : 1,
                    }}
                  />
                )}
              </Show>

              {/* Layer 2: 原图（加载完成后淡入） */}
              <Show when={loaded}>
                <img
                  src={loaded!}
                  alt={`page ${i + 1}`}
                  class="relative max-w-full max-h-full object-contain"
                  style={{
                    animation: "fadeIn var(--durationGentle) var(--curveEasyEase) forwards",
                    transform:
                      i === currentPage()
                        ? `scale(${scale()}) translate(${position().x}px, ${position().y}px)`
                        : "none",
                  }}
                  draggable={false}
                />
              </Show>

              {/* Layer 3: 加载进度遮罩（仅未完成时显示） */}
              <Show when={progress !== undefined && progress < 100 && progress >= 0}>
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-3"
                  style={{ "background-color": "rgba(0, 0, 0, 0.3)" }}
                >
                  <div
                    class="w-12 h-12 rounded-[var(--borderRadiusCircular)] border-2 border-transparent border-t-[var(--colorOverlayForeground)]"
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                  <Show when={progress! > 0}>
                    <span
                      class="text-[var(--colorOverlayForeground)] font-semibold"
                      style={{ "font-size": "var(--fontSizeHero800)" }}
                    >
                      {progress}%
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          );
        })}
      </div>

      {/* 关闭按钮 */}
      <button
        class="absolute top-4 left-4 w-10 h-10 flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] text-[var(--colorOverlayForeground)] text-xl"
        onClick={props.onClose}
      >
        ←
      </button>
    </div>
  );
};

export default ImageViewer;
