import type { Component } from "solid-js";
import { Show, createEffect, createSignal, onCleanup, onSettled, untrack } from "solid-js";
import { tryAsync } from "../utils/tryAsync";
import { checkImageCache, loadImage, loadImageWithProgress } from "../utils/imageLoader";
import { t } from "../i18n";

interface Props {
  imageUrls: string[];
  /** 预览图 URL 列表（与 imageUrls 一一对应），用于打开时从 LRU 缓存取模糊占位图 */
  previewUrls?: string[];
  initialPage?: number;
  onClose?: () => void;
  /** 保存当前页（spec image-save-download；缺省 = 不显示保存按钮）。resolve true=成功 */
  onSavePage?: (page: number) => Promise<boolean>;
  /** 批量保存进行中：禁用（而非卸载）保存按钮——内联 ✓/✗ 反馈保持可达，且屏蔽与批次并发 */
  saveBusy?: boolean;
}

/** 邻页预取候选（FT-4 #367）：当前页的前后一页，跳过已发起/已加载的。
 *  纯函数便于单测：首页无前邻、末页无后邻、单页无候选。 */
export function neighborPages(
  currentPage: number,
  total: number,
  skip: (i: number) => boolean,
): number[] {
  const out: number[] = [];
  for (const i of [currentPage - 1, currentPage + 1]) {
    if (i >= 0 && i < total && !skip(i)) out.push(i);
  }
  return out;
}

const ImageViewer: Component<Props> = (props) => {
  const [scale, setScale] = createSignal(1);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  // 一次性初始页（untrack：组件体顶层响应式读在 2.0 dev 下警告）
  const initialPage = untrack(() => props.initialPage ?? 0);
  const [currentPage, setCurrentPage] = createSignal(initialPage);
  const [animating, setAnimating] = createSignal(false);

  // ── 保存当前页（spec image-save-download §5）──
  // 查看器内无 toast 通道：状态内联在保存按钮上（idle → saving → done 1.2s / failed 2s）
  const [saveStatus, setSaveStatus] = createSignal<"idle" | "saving" | "done" | "failed">("idle");
  let saveResetTimer: ReturnType<typeof setTimeout> | undefined;
  const handleSaveCurrentPage = async () => {
    if (!props.onSavePage || saveStatus() === "saving" || props.saveBusy) {
      return;
    }
    setSaveStatus("saving");
    const page = currentPage();
    const ok = await props.onSavePage(page);
    setSaveStatus(ok ? "done" : "failed");
    clearTimeout(saveResetTimer);
    saveResetTimer = setTimeout(() => setSaveStatus("idle"), ok ? 1200 : 2000);
  };

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

  // ── 预览图异步加载（FT-4 #367）──
  // 未进 LRU 缓存的页，先下小图（快）→ 翻页即有 blur-up 可看，替代纯黑等待
  const [loadedPreviews, setLoadedPreviews] = createSignal<Record<number, string>>({});
  const loadingPreviews = new Set<number>();
  const previewFor = (i: number): string | undefined => previewBlobUrl(i) ?? loadedPreviews()[i];
  const loadPreview = (i: number) => {
    if (previewFor(i) !== undefined) return;
    const url = props.previewUrls?.[i];
    if (!url || loadingPreviews.has(i)) return;
    loadingPreviews.add(i);
    loadImage(url)
      .then((result) => {
        if (result.url) setLoadedPreviews((prev) => ({ ...prev, [i]: result.url }));
      })
      .catch(() => {
        // 预览失败不影响主图加载路径，静默回退纯 spinner
      });
  };

  // 页面变化时，若未加载则触发下载（Solid 2.0 拆分：compute 提取快照，apply 触发副作用）
  createEffect(
    () => ({ page: currentPage(), loaded: loadedUrls()[currentPage()] }),
    (s) => {
      // 已加载
      if (s.loaded !== undefined) {
        return;
      }
      // 已发起
      if (loadingStarted.has(s.page)) {
        return;
      }
      loadingStarted.add(s.page);
      startLoad(s.page);
      // 等待期可见性（FT-4）：并行拉小图，翻到即有模糊占位而非黑屏
      loadPreview(s.page);
    },
  );

  // ── 邻页预取（FT-4 #367）──
  // 当前页加载完成后预取前后一页原图：翻页时多数情况直接命中已加载，消除「翻页 → 2s 黑屏」
  createEffect(
    () => ({
      page: currentPage(),
      loaded: loadedUrls()[currentPage()],
      total: props.imageUrls.length,
    }),
    (s) => {
      if (s.loaded === undefined) return;
      for (const n of neighborPages(s.page, s.total, (i) => loadingStarted.has(i))) {
        loadingStarted.add(n);
        startLoad(n);
      }
    },
  );

  // 初始页在挂载时立即发起加载（进度已在初始化时设为 0，不等 createEffect）
  onSettled(() => {
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
    // 局部快照：2.0 批量更新下 set 后同步读返回旧值，捏合/单指滑动的互斥判断统一走快照
    const curScale = scale();

    if (touches.length === 2 && curScale >= 1) {
      e.preventDefault();
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = dist / lastDist;
      lastDist = dist;

      const newScale = Math.max(1, Math.min(5, curScale * delta));
      setScale(newScale);
    } else if (touches.length === 1 && curScale === 1) {
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
    clearTimeout(saveResetTimer);
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
          const pb = previewFor(i);
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

              {/* Layer 3: 加载进度遮罩（仅未完成时显示；FT-4：放大 spinner + 页码文案，等待期明确可感知） */}
              <Show when={progress !== undefined && progress < 100 && progress >= 0}>
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-3"
                  style={{ "background-color": "rgba(0, 0, 0, 0.3)" }}
                >
                  <div
                    class="w-16 h-16 rounded-[var(--borderRadiusCircular)] border-[3px] border-transparent border-t-[var(--colorOverlayForeground)]"
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
                  <span
                    class="text-[var(--colorOverlayForeground)]"
                    style={{ "font-size": "var(--fontSizeBase200)" }}
                  >
                    {t("imageViewer.loadingPage", {
                      current: i + 1,
                      total: props.imageUrls.length,
                    })}
                  </span>
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

      {/* 保存当前页（与左上关闭镜像；状态内联：转圈 / ✓ / ✗） */}
      <Show when={props.onSavePage}>
        <button
          class="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorOverlaySurface)] text-[var(--colorOverlayForeground)] appearance-none border-none cursor-pointer disabled:cursor-default focus-visible:outline focus-visible:outline-[var(--colorStrokeFocus2)]"
          onClick={handleSaveCurrentPage}
          disabled={saveStatus() === "saving" || props.saveBusy}
          aria-label={t("imageViewer.savePageAria")}
        >
          <Show when={saveStatus() === "saving"}>
            <span
              class="w-5 h-5 rounded-[var(--borderRadiusCircular)] border-2 border-transparent border-t-[var(--colorOverlayForeground)]"
              style={{ animation: "spin 1s linear infinite" }}
            />
          </Show>
          <Show when={saveStatus() === "done"}>
            <span class="text-[var(--colorStatusSuccessForeground1)]">✓</span>
          </Show>
          <Show when={saveStatus() === "failed"}>
            <span class="text-[var(--colorStatusDangerForeground1)]">✗</span>
          </Show>
          <Show when={saveStatus() === "idle"}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 0 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"
                fill="currentColor"
              />
            </svg>
          </Show>
        </button>
      </Show>
    </div>
  );
};

export default ImageViewer;
