import type { Component } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { createIntersectionObserver } from "@solid-primitives/intersection-observer";
import {
  addBookmark,
  deleteBookmark,
  followUser,
  unfollowUser,
  downloadAndExtractUgoira,
  streamUgoiraFrames,
  loadDetail,
  type UgoiraFrame,
} from "../api/illust";
import { ApiErrorType, type ApiError } from "../api/types";
import type { PixivIllust } from "../api/types";
import ErrorDisplay from "../components/ErrorDisplay";
import ImageViewer from "../components/ImageViewer";
import UgoiraViewer from "../components/UgoiraViewer";
import LazyDetailImage from "../components/LazyDetailImage";
import PixivImage from "../components/PixivImage";
import PageTransition from "../components/PageTransition";
import HeartBurstEffect from "../components/HeartBurstEffect";
import { ugoiraMode, detailQuality, showDetailStairs } from "../stores/settingsStore";
import { blockUser, isBlocked } from "../stores/blockStore";
import { recordVisit } from "../stores/historyStore";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";
import { sanitizeHtml } from "../utils/html";
import { scrollToTop } from "../utils/scrollToTop";
import ReportSheet from "../components/ReportSheet";
import IllustTags from "../components/IllustTags";
import CommentOverlay from "../components/CommentOverlay";
import IllustActionMenu from "../components/IllustActionMenu";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import IllustDetailSkeleton from "../components/skeletons/IllustDetailSkeleton";
import DetailHeader from "../components/illust/DetailHeader";
import DetailCard from "../components/illust/DetailCard";
import BottomActionBar from "../components/illust/BottomActionBar";

const IllustDetail: Component = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [illust, setIllust] = createSignal<PixivIllust | null>(null);
  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [viewerStartPage, setViewerStartPage] = createSignal(0);
  const [currentVisiblePage, setCurrentVisiblePage] = createSignal(0);
  const BACK_TO_TOP_THRESHOLD = 300;
  const showBackToTop = createScrollBehavior({ hideOnScrollDown: false }).scrolledPast(
    BACK_TO_TOP_THRESHOLD,
  );

  // ── 底部操作条显隐（用户定稿）：信息区（作者/作品信息）进入视口即隐藏 ──
  const [bottomBarVisible, setBottomBarVisible] = createSignal(true);
  let infoSentinelEl: HTMLDivElement | undefined;
  let infoObserver: IntersectionObserver | undefined;

  function setInfoSentinel(el: HTMLDivElement | undefined) {
    infoSentinelEl = el;
    if (el) {
      infoObserver?.observe(el);
    } else {
      infoObserver?.disconnect();
    }
  }

  onMount(() => {
    infoObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setBottomBarVisible(!entry.isIntersecting);
        }
      },
      { threshold: 0 },
    );
    if (infoSentinelEl) {
      infoObserver.observe(infoSentinelEl);
    }
    onCleanup(() => infoObserver?.disconnect());
  });
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<ApiError | null>(null);
  const [bookmarking, setBookmarking] = createSignal(false);
  const [bookmarkBurstTrigger, setBookmarkBurstTrigger] = createSignal(0);
  const [ugoiraCoverHeight, setUgoiraCoverHeight] = createSignal(0);
  const [ugoiraProgress, setUgoiraProgress] = createSignal(-1); // -1=未开始, 0-100=进度, 100=已就绪, -2=失败
  const [ugoiraFrames, setUgoiraFrames] = createSignal<UgoiraFrame[]>([]);
  const [ugoiraReady, setUgoiraReady] = createSignal(false);
  /** ADR-0127 渐进模式：流式取帧是否已结束（列表不再增长） */
  const [ugoiraStreamingDone, setUgoiraStreamingDone] = createSignal(false);
  let ugoiraBlobUrls: string[] = [];
  let ugoiraAbort: AbortController | null = null;
  const [isFollowed, setIsFollowed] = createSignal(false);
  const [following, setFollowing] = createSignal(false);
  const [showReportSheet, setShowReportSheet] = createSignal(false);
  const [showActionMenu, setShowActionMenu] = createSignal(false);
  const [showComments, setShowComments] = createSignal(false);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  const [pageRefs, setPageRefs] = createSignal<Map<number, HTMLElement>>(new Map());
  const pageElements = createMemo(() => Array.from(pageRefs().values()));
  const isBlockedAuthor = createMemo(() => {
    const i = illust();
    return i ? isBlocked(i.user.id) : false;
  });

  async function toggleFollow() {
    const i = illust();
    if (!i || following()) {
      return;
    }
    const prev = isFollowed();
    setIsFollowed(!prev);
    setFollowing(true);
    const [followErr] = await tryAsync(
      (async () => {
        if (prev) {
          await unfollowUser(i.user.id);
        } else {
          await followUser(i.user.id);
        }
        setIllust({ ...i, user: { ...i.user, is_followed: !prev } });
      })(),
    );
    setFollowing(false);
    if (followErr) {
      setIsFollowed(prev);
    }
  }

  async function handleBlockAuthor() {
    const i = illust();
    if (!i) {
      return;
    }
    setShowActionMenu(false);
    if (isBlocked(i.user.id)) {
      setToastMessage("该作者已被屏蔽");
      return;
    }
    if (!window.confirm("确定要屏蔽该作者吗？屏蔽后其作品将不再显示在推荐和关注列表中。")) {
      return;
    }
    await blockUser(i.user.id);
    setToastMessage("已屏蔽该作者");
  }

  function openReport() {
    setShowActionMenu(false);
    setShowReportSheet(true);
  }

  // Auto-hide toast message
  createEffect(() => {
    if (toastMessage()) {
      const timer = setTimeout(() => setToastMessage(null), 2500);
      onCleanup(() => clearTimeout(timer));
    }
  });

  function measureCoverContent(e: Event) {
    const img = e.target as HTMLImageElement;
    if (img.naturalHeight === 0) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return;
    }
    ctx.drawImage(img, 0, 0);
    const midX = Math.floor(img.naturalWidth / 2);
    for (let y = img.naturalHeight - 1; y >= 0; y--) {
      const p = ctx.getImageData(midX, y, 1, 1).data;
      if ((p[0] + p[1] + p[2]) / 3 > 15) {
        setUgoiraCoverHeight(y + 2);
        return;
      }
    }
  }

  /** 在后台加载 ugoira ZIP 并解压帧，返回进度百分比信号 */
  async function startUgoiraLoad(illustId: number) {
    setUgoiraProgress(0);
    setUgoiraReady(false);
    setUgoiraFrames([]);
    setUgoiraStreamingDone(false);
    // 清理旧 blob URL 与旧下载
    for (const url of ugoiraBlobUrls) {
      URL.revokeObjectURL(url);
    }
    ugoiraBlobUrls = [];
    ugoiraAbort?.abort();
    ugoiraAbort = new AbortController();

    const [ugoiraErr] = await tryAsync(
      (async () => {
        if (ugoiraMode() === "fflate") {
          // ADR-0127：渐进播放——首帧就绪即播（ugoiraReady），后续帧就绪追加；
          // 进度环仍显示下载字节 %（streamUgoiraFrames 内部按 content-length 折算）
          await streamUgoiraFrames(
            illustId,
            (url, delay, index, total) => {
              ugoiraBlobUrls.push(url);
              setUgoiraFrames((prev) => [...prev, { url, delay }]);
              if (index === 0) {
                setUgoiraReady(true);
              }
              if (index === total - 1) {
                setUgoiraStreamingDone(true);
              }
            },
            (pct) => setUgoiraProgress(pct),
            ugoiraAbort!.signal,
          );
          setUgoiraProgress(100);
        } else {
          // range 模式（含 ADR-0126 降级 fflate 全量）：全帧就绪才播（现状语义）
          const result = await downloadAndExtractUgoira(
            illustId,
            (pct) => setUgoiraProgress(pct),
            "range",
          );
          ugoiraBlobUrls = result.blobUrls;
          setUgoiraFrames(result.frames);
          setUgoiraReady(true);
          setUgoiraProgress(100);
        }
      })(),
    );
    if (ugoiraErr) {
      console.error("[IllustDetail] Ugoira load failed:", ugoiraErr);
      // 渐进模式错误路径：已就绪帧 blob 一并释放（回到封面 + 错误态）
      for (const url of ugoiraBlobUrls) {
        URL.revokeObjectURL(url);
      }
      ugoiraBlobUrls = [];
      setUgoiraFrames([]);
      setUgoiraReady(false);
      setUgoiraProgress(-2);
    }
  }

  onCleanup(() => {
    ugoiraAbort?.abort();
    for (const url of ugoiraBlobUrls) {
      URL.revokeObjectURL(url);
    }
  });

  let longPressTimer: ReturnType<typeof setTimeout>;

  async function toggleBookmark(privateBookmark = false) {
    const i = illust();
    if (!i || bookmarking()) {
      return;
    }
    setBookmarking(true);
    const [bookmarkErr] = await tryAsync(
      (async () => {
        if (i.is_bookmarked) {
          await deleteBookmark(i.id);
        } else {
          await addBookmark(i.id, privateBookmark ? "private" : "public");
        }
        setIllust({
          ...i,
          is_bookmarked: !i.is_bookmarked,
          total_bookmarks: i.is_bookmarked ? i.total_bookmarks - 1 : i.total_bookmarks + 1,
        });

        if (!i.is_bookmarked) {
          setBookmarkBurstTrigger((n) => n + 1);
        }
      })(),
    );
    setBookmarking(false);
    if (bookmarkErr) {
      console.error("Bookmark toggle failed:", bookmarkErr);
    }
  }

  function onBookmarkPointerDown(_e: PointerEvent) {
    longPressTimer = setTimeout(() => {
      // Private
      toggleBookmark(true);
      longPressTimer = 0 as any;
    }, 500);
  }

  function onBookmarkPointerUp(_e: PointerEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0 as any;
      // Public
      toggleBookmark(false);
    }
  }

  // Guard flag — suppress IntersectionObserver during programmatic scrollToPage
  let ignorePageObserver = false;
  // 打开查看器前保存滚动位置，关闭后恢复
  let savedScrollBeforeViewer = 0;
  let viewerMaskRemover: (() => void) | null = null;

  createIntersectionObserver(
    pageElements,
    (entries) => {
      let maxIndex = -1;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (!Number.isNaN(idx) && idx > maxIndex) {
            maxIndex = idx;
          }
        }
      }
      if (maxIndex >= 0 && !ignorePageObserver) {
        setCurrentVisiblePage(maxIndex);
      }
    },
    { threshold: [0] },
  );

  // 组件卸载时确保移除即时注入的过渡遮罩，避免 DOM 泄漏
  onCleanup(() => {
    viewerMaskRemover?.();
    viewerMaskRemover = null;
  });

  // Open/close viewer; registered with overlay stack for back-button handling
  function openViewer(startPage = 0) {
    savedScrollBeforeViewer = window.scrollY;

    // 立即注入全屏黑底 + 旋转动画 + 0%，不等 Solid 调度
    const mask = document.createElement("div");
    mask.id = "viewer-transition-mask";
    Object.assign(mask.style, {
      position: "fixed",
      inset: "0",
      zIndex: "49",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      gap: "var(--spacingVerticalL)",
    });
    // 用 CSS 变量继承主题背景色
    mask.style.setProperty("background-color", "var(--colorOverlayBackground)");
    mask.innerHTML = `
      <div style="width:48px;height:48px;border-radius:50%;
                  border:var(--strokeWidthThick) solid transparent;border-top-color:var(--colorOverlayForeground);
                  animation:spin 1s linear infinite"></div>
      <span style="color:var(--colorOverlayForeground);
                   font-size:var(--fontSizeHero800);
                   font-weight:600">0%</span>
    `;
    document.body.appendChild(mask);
    viewerMaskRemover = () => mask.remove();

    setViewerStartPage(startPage);
    setViewerOpen(true);
  }

  function closeViewer() {
    setViewerOpen(false);
  }

  // 查看器关闭后：移除即时遮罩 + 恢复滚动位置
  createEffect(() => {
    if (!viewerOpen() && !loading() && illust()) {
      requestAnimationFrame(() => {
        // 移除即时注入的过渡遮罩
        viewerMaskRemover?.();
        viewerMaskRemover = null;

        // 恢复之前保存的滚动位置
        window.scrollTo(0, savedScrollBeforeViewer);
      });
    }
  });

  // 将查看器状态注册到 overlay 栈，供系统返回手势统一处理
  createEffect(() => {
    if (viewerOpen()) {
      pushOverlay("viewer", closeViewer);
      onCleanup(() => {
        popOverlay("viewer");
      });
    }
  });

  // 将评论面板状态注册到 overlay 栈
  createEffect(() => {
    if (showComments()) {
      pushOverlay("commentSheet", () => setShowComments(false));
      onCleanup(() => {
        popOverlay("commentSheet");
      });
    }
  });

  // 将举报面板状态注册到 overlay 栈
  createEffect(() => {
    if (showReportSheet()) {
      pushOverlay("reportSheet", () => setShowReportSheet(false));
      onCleanup(() => {
        popOverlay("reportSheet");
      });
    }
  });

  // 组件内加载数据：先渲染骨架屏，params 变化时自动重新请求
  createEffect(() => {
    const id = Number(params.id);
    if (!id) return;

    // 清理旧请求，避免竞态条件
    let cancelled = false;
    const controller = new AbortController();
    onCleanup(() => {
      cancelled = true;
      controller.abort();
    });

    setLoading(true);
    setError(null);
    setIllust(null);

    loadDetail(id, controller.signal)
      .then((res) => {
        if (cancelled) return;
        const i = res.illust;
        setIllust(i);
        setPageRefs(new Map());
        recordVisit(i, "illust");
        setIsFollowed(i.user.is_followed ?? false);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError({ type: ApiErrorType.UNKNOWN, message: err?.message ?? "加载失败" });
        setLoading(false);
      });
  });

  /** Parse Pixiv internal caption links and navigate in-app */
  function handleCaptionClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName !== "A") {
      return;
    }
    const href = target.getAttribute("href");
    if (!href) {
      return;
    }

    // pixiv://users/123456 → /user/123456
    const pixivProtocol = href.match(/^pixiv:\/\/users\/(\d+)/u);
    if (pixivProtocol) {
      e.preventDefault();
      void navigate(`/user/${pixivProtocol[1]}`);
      return;
    }
    // pixiv://illusts/12345678 → /illust/12345678
    const illustProtocol = href.match(/^pixiv:\/\/illusts\/(\d+)/u);
    if (illustProtocol) {
      e.preventDefault();
      void navigate(`/illust/${illustProtocol[1]}`);
      return;
    }
    // https://www.pixiv.net/(en/)?users/123456 → /user/123456
    const webUser = href.match(/pixiv\.net\/(?:en\/)?users\/(\d+)/u);
    if (webUser) {
      e.preventDefault();
      void navigate(`/user/${webUser[1]}`);
      return;
    }
    // https://www.pixiv.net/(en/)?artworks/12345678 → /illust/12345678
    const webArtwork = href.match(/pixiv\.net\/(?:en\/)?artworks\/(\d+)/u);
    if (webArtwork) {
      e.preventDefault();
      void navigate(`/illust/${webArtwork[1]}`);
      return;
    }
    // External links (fanbox, twitter, etc.) — let browser handle
  }

  function coverUrl(): string {
    const i = illust();
    if (!i) {
      return "";
    }
    const q = detailQuality();
    if (q === "medium") {
      return i.image_urls.medium;
    }
    if (q === "large") {
      return i.image_urls.large;
    }
    // Original: use original_image_url if available, fallback to large
    return i.meta_single_page?.original_image_url ?? i.image_urls.large;
  }

  const imageUrls = () => {
    const i = illust();
    if (!i) {
      return [];
    }
    const q = detailQuality();
    if (i.page_count > 1) {
      // 多图：按用户设定质量取 URL，同时 api 返回的 meta_pages 还含 original
      return i.meta_pages.map((p) => (q === "medium" ? p.image_urls.medium : p.image_urls.large));
    }
    // 单图
    if (q === "original") {
      return [i.meta_single_page.original_image_url ?? i.image_urls.large];
    }
    if (q === "medium") {
      return [i.image_urls.medium];
    }
    return [i.image_urls.large];
  };

  /** 原图 URL 列表，用于全屏查看器 */
  const originalImageUrls = () => {
    const i = illust();
    if (!i) {
      return [];
    }
    if (i.page_count > 1) {
      return i.meta_pages.map((p) => p.image_urls.original ?? p.image_urls.large);
    }
    return [i.meta_single_page.original_image_url ?? i.image_urls.large];
  };

  function scrollToPage(index: number) {
    setCurrentVisiblePage(index);
    ignorePageObserver = true;
    setTimeout(() => {
      ignorePageObserver = false;
    }, 600);
    const el = document.querySelector(`[data-page-index="${index}"]`);
    // Block: "center" ensures the clicked page is centered in the viewport,
    // Which is more accurate than "start" when pages are shorter than screen height.
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <PageTransition>
      <div class="page">
        {loading() && !illust() && <IllustDetailSkeleton />}

        {error() && !illust() && (
          <ErrorDisplay error={error()!} onRetry={() => window.location.reload()} />
        )}

        {illust() && !viewerOpen() && isBlockedAuthor() && (
          <div class="flex flex-col items-center justify-center h-screen gap-4 px-6">
            <p class="text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase300)]">
              该作者已被屏蔽
            </p>
            <fluent-button appearance="secondary" on:click={() => window.history.back()}>
              返回
            </fluent-button>
          </div>
        )}

        {illust() && !viewerOpen() && !isBlockedAuthor() && (
          <>
            {/* App bar header — A2 卡片式（ADR-0071） */}
            <DetailHeader
              title={illust()!.title}
              onBack={() => window.history.back()}
              onMore={() => setShowActionMenu((v) => !v)}
            />

            <div class="relative w-full">
              <IllustActionMenu
                isOpen={showActionMenu()}
                onReport={openReport}
                onBlock={handleBlockAuthor}
                onClose={() => setShowActionMenu(false)}
              />
            </div>

            {/* Toast confirmation */}
            <Show when={toastMessage()}>
              <fluent-message-bar
                intent="success"
                style="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none"
              >
                {toastMessage()}
              </fluent-message-bar>
            </Show>

            {/* Images — A2 卡片化（ADR-0071）：多图竖排卡片；单图封面卡片 */}
            {illust()!.page_count > 1 ? (
              <div class="px-4 mt-4 flex flex-col" style={{ gap: "var(--spacingVerticalL)" }}>
                {illust()!.meta_pages.map((page, i) => {
                  const q = detailQuality();
                  const src = q === "medium" ? page.image_urls.medium : page.image_urls.large;
                  return (
                    <div
                      class="rounded-[var(--borderRadiusXLarge)] overflow-hidden border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] cursor-pointer"
                      ref={(el) => {
                        setPageRefs((prev) => {
                          const next = new Map(prev);
                          if (el) {
                            next.set(i, el);
                          } else {
                            next.delete(i);
                          }
                          return next;
                        });
                      }}
                      data-page-index={i}
                    >
                      <LazyDetailImage
                        src={src}
                        pageIndex={i}
                        totalPages={illust()!.page_count}
                        onClick={() => openViewer(i)}
                        visiblePage={currentVisiblePage()}
                        width={illust()!.width}
                        height={illust()!.height}
                      />
                    </div>
                  );
                })}
              </div>
            ) : illust()!.type === "ugoira" ? (
              <div class="relative bg-[var(--colorNeutralBackground2)] border-b border-[var(--colorNeutralStroke2)] w-full">
                {!ugoiraReady() ? (
                  <div
                    style={{
                      "aspect-ratio": `${illust()!.width} / ${ugoiraCoverHeight() || illust()!.height}`,
                    }}
                    class="overflow-hidden w-full"
                  >
                    <PixivImage
                      src={coverUrl()}
                      alt={illust()!.title}
                      width={illust()!.width}
                      height={illust()!.height}
                      loading="eager"
                      class="w-full h-full object-cover object-top"
                      onLoad={measureCoverContent}
                    />

                    {/* 未开始 → 播放按钮 */}
                    {ugoiraProgress() === -1 && (
                      <div
                        class="absolute inset-0 flex items-center justify-center transition-colors duration-[var(--durationFast)] bg-[var(--colorOverlayBackground)]/20 hover:bg-[var(--colorOverlayBackground)]/30"
                        onClick={() => startUgoiraLoad(illust()!.id)}
                      >
                        <div class="w-16 h-16 rounded-full bg-[var(--colorNeutralBackground1)]/90 flex items-center justify-center shadow-[var(--elevation4)]">
                          <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M6.5 4.5L18.5 12L6.5 19.5V4.5Z"
                              fill="currentColor"
                              class="text-[var(--colorNeutralForeground1)]"
                            />
                          </svg>
                        </div>
                      </div>
                    )}

                    {/* 加载中 → 百分比进度 */}
                    {ugoiraProgress() >= 0 && !ugoiraReady() && (
                      <div class="absolute inset-0 flex items-center justify-center bg-[var(--colorOverlayBackground)]/30 pointer-events-none">
                        <div class="flex flex-col items-center gap-2">
                          {/* 圆形进度环 */}
                          <svg width="56" height="56" viewBox="0 0 56 56">
                            <circle
                              cx="28"
                              cy="28"
                              r="24"
                              fill="none"
                              stroke="var(--colorNeutralStroke2)"
                              stroke-width="4"
                            />
                            <circle
                              cx="28"
                              cy="28"
                              r="24"
                              fill="none"
                              stroke="var(--colorBrandForeground1)"
                              stroke-width="4"
                              stroke-linecap="round"
                              stroke-dasharray={`${2 * Math.PI * 24}`}
                              stroke-dashoffset={`${2 * Math.PI * 24 * (1 - Math.max(0, Math.min(ugoiraProgress(), 100)) / 100)}`}
                              transform="rotate(-90 28 28)"
                              style="transition: stroke-dashoffset var(--durationNormal) cubic-bezier(0.33,0,0.67,1)"
                            />
                          </svg>
                          <span class="text-[var(--colorNeutralForeground1)] font-semibold [font-size:var(--fontSizeBase200)] bg-[var(--colorNeutralBackground1)]/80 px-2.5 py-0.5 rounded-[var(--borderRadiusCircular)]">
                            {ugoiraProgress()}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 加载失败 → 重试按钮 */}
                    {ugoiraProgress() === -2 && (
                      <div
                        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--colorOverlayBackground)]/30 cursor-pointer"
                        onClick={() => startUgoiraLoad(illust()!.id)}
                      >
                        <span class="text-[var(--colorStatusDangerForeground1)] [font-size:var(--fontSizeBase300)]">
                          加载失败
                        </span>
                        <span class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] underline">
                          点击重试
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <UgoiraViewer
                    illustId={illust()!.id}
                    coverUrl={coverUrl()}
                    aspectRatio={`${illust()!.width} / ${ugoiraCoverHeight() || illust()!.height}`}
                    onClose={() => setUgoiraReady(false)}
                    inline
                    preloadedFrames={ugoiraFrames()}
                    streaming={
                      ugoiraMode() === "fflate"
                        ? {
                            frames: () => ugoiraFrames(),
                            done: () => ugoiraStreamingDone(),
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <div
                class="rounded-[var(--borderRadiusXLarge)] overflow-hidden border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] cursor-pointer"
                onClick={() => openViewer(0)}
              >
                <PixivImage
                  src={coverUrl()}
                  alt={illust()!.title}
                  width={illust()!.width}
                  height={illust()!.height}
                  loading="eager"
                  class="w-full object-contain cursor-pointer"
                />
              </div>
            )}

            {/* Info section — A2 分区多卡（ADR-0071）；sentinel 控制底部操作条显隐 */}
            <div ref={setInfoSentinel} class="px-4 mt-4 space-y-3">
              {/* 作者卡 */}
              <DetailCard>
                <div class="flex items-center gap-3">
                  <PixivImage
                    src={illust()!.user.profile_image_urls.medium ?? ""}
                    alt={illust()!.user.name}
                    width={40}
                    height={40}
                    class="w-10 h-10 rounded-[var(--borderRadiusCircular)] object-cover ring-[var(--strokeWidthThin)] ring-[var(--colorNeutralStroke1)]"
                  />
                  <div class="min-w-0">
                    <p class="text-[var(--colorNeutralForeground1)] font-semibold [font-size:var(--fontSizeBase300)] truncate leading-snug">
                      {illust()!.user.name}
                    </p>
                    <p class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)] truncate leading-snug">
                      @{illust()!.user.account}
                    </p>
                  </div>
                  <button
                    class="inline-flex items-center justify-center gap-[var(--spacingHorizontalXS)] rounded-[var(--borderRadiusMedium)] font-semibold [font-size:var(--fontSizeBase200)] [line-height:var(--lineHeightBase200)] min-h-8 px-[var(--spacingHorizontalM)] border transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.97] select-none appearance-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] flex-shrink-0 ml-auto"
                    classList={{
                      "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] border-[var(--colorBrandBackground)] hover:bg-[var(--colorBrandBackgroundHover)] active:bg-[var(--colorBrandBackgroundPressed)]":
                        !isFollowed(),
                      "bg-transparent text-[var(--colorNeutralForeground2)] border-[var(--colorNeutralStroke2)] hover:text-[var(--colorStatusDangerForeground1)] hover:border-[var(--colorStatusDangerForeground1)]":
                        isFollowed(),
                    }}
                    onClick={toggleFollow}
                    disabled={following()}
                    aria-label={isFollowed() ? "取消关注" : "关注"}
                  >
                    {following() ? "…" : isFollowed() ? "已关注" : "关注"}
                  </button>
                </div>
              </DetailCard>

              {/* 统计 + 收藏卡 */}
              <DetailCard>
                <div class="flex items-center justify-between gap-2">
                  <div class="flex gap-4 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                    <span class="flex items-center gap-1">
                      <span>♡</span>
                      <span>{illust()!.total_bookmarks}</span>
                    </span>
                    {illust()!.total_view !== undefined && (
                      <span class="flex items-center gap-1">
                        <span>👁</span>
                        <span>{illust()!.total_view}</span>
                      </span>
                    )}
                    {illust()!.total_comments !== undefined && (
                      <span
                        class="flex items-center gap-1 cursor-pointer hover:text-[var(--colorBrandForeground1)] transition-colors"
                        onClick={() => setShowComments(true)}
                      >
                        <span>💬</span>
                        <span>{illust()!.total_comments}</span>
                      </span>
                    )}
                    {illust()!.page_count > 1 && (
                      <span class="flex items-center gap-1">
                        <span>📄</span>
                        <span>{illust()!.page_count}P</span>
                      </span>
                    )}
                  </div>
                  <div class="relative inline-flex flex-shrink-0">
                    <button
                      class={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] text-[var(--fontSizeBase200)] font-medium transition-all active:scale-95 select-none ${
                        illust()!.is_bookmarked
                          ? "bg-[var(--colorStatusDangerBackground2)] text-[var(--colorStatusDangerForeground1)]"
                          : "bg-[var(--colorBrandStroke2)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorBrandBackground)] hover:text-[var(--colorNeutralForegroundOnBrand)]"
                      }`}
                      onPointerDown={onBookmarkPointerDown}
                      onPointerUp={onBookmarkPointerUp}
                      onPointerLeave={() => {
                        if (longPressTimer) {
                          clearTimeout(longPressTimer);
                          longPressTimer = 0 as any;
                        }
                      }}
                      disabled={bookmarking()}
                    >
                      {illust()!.is_bookmarked ? "♥ 已收藏" : "♡ 收藏"}
                    </button>
                    <HeartBurstEffect trigger={bookmarkBurstTrigger} />
                  </div>
                </div>
              </DetailCard>

              {/* 标签 + 说明卡 */}
              <DetailCard>
                <IllustTags tags={illust()!.tags} size="medium" />
                {illust()!.caption && (
                  <p
                    class="mt-3 [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)] leading-relaxed whitespace-pre-wrap"
                    innerHTML={sanitizeHtml(illust()!.caption ?? "")}
                    onClick={handleCaptionClick}
                  />
                )}
              </DetailCard>
            </div>

            {/* Viewer hint — only for single page non-ugoira */}
            {illust()!.page_count === 1 && illust()!.type !== "ugoira" && (
              <div class="px-4 pb-8">
                <p class="text-center text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
                  点击图片查看原图 · 双指缩放 · 左右滑动翻页
                </p>
              </div>
            )}

            {/* ── Multi-page: back-to-top FAB ── */}
            {illust()!.page_count > 1 && (
              <button
                class="rounded-[var(--borderRadiusCircular)] w-10 h-10 flex items-center justify-center text-[var(--colorOverlayForeground)] text-lg transition-all duration-[var(--durationFast)] bg-[var(--colorOverlaySurface)] backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)] hover:bg-[var(--colorOverlaySurfaceHover)] active:bg-[var(--colorOverlaySurfaceHover)] active:scale-90 focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2),0_0_0_calc(var(--strokeWidthThick)+var(--strokeWidthThin))_var(--colorStrokeFocus1)]"
                style={{
                  position: "fixed",
                  bottom: "calc(var(--spacingVerticalXXL) + 64px)",
                  right: "var(--spacingHorizontalL)",
                  opacity: showBackToTop() ? 1 : 0,
                  "pointer-events": showBackToTop() ? "auto" : "none",
                  "z-index": "20",
                }}
                onClick={() => {
                  setCurrentVisiblePage(0);
                  ignorePageObserver = true;
                  setTimeout(() => {
                    ignorePageObserver = false;
                  }, 600);
                  scrollToTop();
                }}
                aria-label="回顶"
              >
                ↑
              </button>
            )}

            {/* ── Multi-page: staircase (right-side page strip) ── */}
            {illust()!.page_count > 1 && showDetailStairs() && (
              <nav
                class="backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)] rounded-[var(--borderRadiusXLarge)] flex flex-col items-center z-20"
                style={{
                  "background-color": "transparent",
                  position: "fixed",
                  top: "50%",
                  right: "var(--spacingHorizontalS)",
                  transform: "translateY(-50%)",
                  gap: "var(--spacingVerticalXXS)",
                  padding: "var(--spacingVerticalS) var(--spacingHorizontalXS)",
                  "max-height": imageUrls().length > 20 ? "60vh" : "none",
                  "overflow-y": imageUrls().length > 20 ? "auto" : "visible",
                }}
                aria-label="页面导航"
              >
                {imageUrls().map((_, i) => (
                  <button
                    class="flex items-center justify-center rounded-[var(--borderRadiusCircular)] [font-size:var(--fontSizeBase200)] font-medium transition-all duration-[var(--durationFast)] min-w-9 min-h-9"
                    classList={{
                      "bg-[var(--colorNeutralBackground1Selected)] text-[var(--colorNeutralForeground1)] font-semibold":
                        i === currentVisiblePage(),
                      "text-[var(--colorOverlayForeground)] opacity-[0.85] hover:opacity-100":
                        i !== currentVisiblePage(),
                    }}
                    style={{
                      "text-shadow":
                        i !== currentVisiblePage() ? "var(--textShadowDefault)" : "none",
                    }}
                    onClick={() => scrollToPage(i)}
                    aria-label={`第 ${i + 1} 页`}
                    aria-current={i === currentVisiblePage() ? "true" : undefined}
                  >
                    {i + 1}
                  </button>
                ))}
              </nav>
            )}
          </>
        )}

        {/* 底部固定操作条 — 信息区未进入视口时显示（用户定稿） */}
        <Show when={illust() && !viewerOpen() && bottomBarVisible()}>
          <BottomActionBar
            name={illust()!.user.name}
            avatarUrl={illust()!.user.profile_image_urls.medium ?? ""}
            isBookmarked={illust()!.is_bookmarked}
            bookmarking={bookmarking()}
            onBookmarkPointerDown={onBookmarkPointerDown}
            onBookmarkPointerUp={onBookmarkPointerUp}
            onComments={() => setShowComments(true)}
            totalComments={illust()!.total_comments}
          />
        </Show>

        {viewerOpen() && illust()!.type !== "ugoira" && (
          <ImageViewer
            imageUrls={originalImageUrls()}
            previewUrls={imageUrls()}
            initialPage={viewerStartPage()}
            onClose={closeViewer}
          />
        )}

        <ReportSheet
          illustId={illust()?.id ?? 0}
          isOpen={showReportSheet()}
          onClose={() => setShowReportSheet(false)}
        />
        <CommentOverlay
          type="illust"
          targetId={illust()!.id}
          isOpen={showComments()}
          onClose={() => setShowComments(false)}
        />
      </div>
    </PageTransition>
  );
};

export default IllustDetail;
