import type { Component } from "solid-js";
import { deep } from "solid-js";
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
  loadUgoiraMetadata,
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
import {
  ugoiraMode,
  ugoiraDownloadFormat,
  detailQuality,
  showDetailStairs,
} from "../stores/settingsStore";
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
import PagePickerSheet from "../components/illust/PagePickerSheet";
import { originalPageUrls, buildImageTasks, buildUgoiraTask } from "../utils/galleryDownload";
import { enqueueDownloads } from "../stores/downloadStore";
import { goBack } from "../services/backTransitionService";
import { t } from "../i18n";

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

  // Solid 2.0：onSettled 内禁用 onCleanup（CLEANUP_IN_FORBIDDEN_SCOPE），清理改由返回值注册。
  onSettled(() => {
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
    return () => infoObserver?.disconnect();
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
      setToastMessage(t("illustDetail.blockedAuthor")); // i18n: set 时快照（瞬态）
      return;
    }
    if (!window.confirm(t("illustDetail.blockConfirm"))) {
      return;
    }
    await blockUser(i.user.id);
    setToastMessage(t("illustDetail.blockedDoneToast")); // i18n: set 时快照（瞬态）
  }

  function openReport() {
    setShowActionMenu(false);
    setShowReportSheet(true);
  }

  // Auto-hide toast message
  // Solid 2.0 拆分效应：compute 读 toastMessage，apply 段起定时器并以返回值注册清理。
  createEffect(
    () => toastMessage(),
    (toast) => {
      if (!toast) {
        return;
      }
      const timer = setTimeout(() => setToastMessage(null), 2500);
      return () => clearTimeout(timer);
    },
  );

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

  // Solid 2.0：createIntersectionObserver 移除回调参数，改为返回 [entries, isVisible]。
  // 用 deep() 深度跟踪 entries store（元素变化时库内部自行 observe/unobserve），
  // apply 段基于全部槽位的最新可见状态取最大可见页码（比旧实现逐批事件更稳定）。
  const [pageEntries] = createIntersectionObserver(pageElements, { threshold: [0] });
  createEffect(
    () => deep(pageEntries),
    (list) => {
      let maxIndex = -1;
      for (const entry of list) {
        if (entry?.isIntersecting) {
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
  // Solid 2.0 拆分效应：compute 提取快照，apply 段做 DOM 副作用。
  createEffect(
    () => ({ open: viewerOpen(), loading: loading(), has: illust() !== null }),
    ({ open, loading: loadingNow, has }) => {
      if (!open && !loadingNow && has) {
        requestAnimationFrame(() => {
          // 移除即时注入的过渡遮罩
          viewerMaskRemover?.();
          viewerMaskRemover = null;

          // 恢复之前保存的滚动位置
          window.scrollTo(0, savedScrollBeforeViewer);
        });
      }
    },
  );

  // 将查看器状态注册到 overlay 栈，供系统返回手势统一处理
  // Solid 2.0：拆分效应 + apply 返回 cleanup（原 onCleanup 在 effect 内已不可用）
  createEffect(
    () => viewerOpen(),
    (open) => {
      if (open) {
        pushOverlay("viewer", closeViewer);
        return () => popOverlay("viewer");
      }
    },
  );

  // 将评论面板状态注册到 overlay 栈
  createEffect(
    () => showComments(),
    (open) => {
      if (open) {
        pushOverlay("commentSheet", () => setShowComments(false));
        return () => popOverlay("commentSheet");
      }
    },
  );

  // 将举报面板状态注册到 overlay 栈
  createEffect(
    () => showReportSheet(),
    (open) => {
      if (open) {
        pushOverlay("reportSheet", () => setShowReportSheet(false));
        return () => popOverlay("reportSheet");
      }
    },
  );

  // 组件内加载数据：先渲染骨架屏，params 变化时自动重新请求
  // Solid 2.0 拆分效应：compute 读 params.id，apply 段发起请求（写 signal 合法），
  // 取消逻辑由 apply 返回的 cleanup 承担（重跑/卸载时中止旧请求，防竞态）。
  createEffect(
    () => Number(params.id),
    (id) => {
      if (!id) return;

      // 清理旧请求，避免竞态条件
      let cancelled = false;
      const controller = new AbortController();

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
          // i18n: set 时快照（瞬态）；字面量 fallback 抽 key（error.fallback.loadFailed zh 同文）
          setError({
            type: ApiErrorType.UNKNOWN,
            message: err?.message ?? t("error.fallback.loadFailed"),
          });
          setLoading(false);
        });

      return () => {
        cancelled = true;
        controller.abort();
      };
    },
  );

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

  /** 原图 URL 列表，用于全屏查看器与保存（语义见 galleryDownload.originalPageUrls） */
  const originalImageUrls = () => {
    const i = illust();
    if (!i) {
      return [];
    }
    return originalPageUrls(i);
  };

  // ── 保存到相册（spec docs/specs/image-save-download.md）──
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [saveStatus, setSaveStatus] = createSignal<string | null>(null);
  const [queuedNotice, setQueuedNotice] = createSignal<string | null>(null);
  let queuedNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  const [saveIntent, setSaveIntent] = createSignal<"success" | "warning">("success");
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined;

  function showSaveStatus(text: string, sticky = false, intent: "success" | "warning" = "success") {
    setSaveStatus(text);
    setSaveIntent(intent);
    clearTimeout(saveStatusTimer);
    if (!sticky) {
      saveStatusTimer = setTimeout(() => setSaveStatus(null), 2500);
    }
  }

  /** 入队提示（含「查看下载」跳转，spec docs/specs/download-manager.md §8） */
  function showQueuedNotice(count: number) {
    // i18n: set 时快照（瞬态）
    setQueuedNotice(t("illustDetail.queuedNotice", { count }));
    clearTimeout(queuedNoticeTimer);
    queuedNoticeTimer = setTimeout(() => setQueuedNotice(null), 4000);
  }

  /**
   * 保存入口改为入队（spec §8）：构造任务交给 downloadStore（下载页统一开始/暂停/停止/删除）。
   * 返回入队条数（0 = 无可用原图）。ugoira 不在本路径（T8 单独入队）。
   */
  function enqueuePages(pages: number[]): number {
    const i = illust();
    if (!i || i.type === "ugoira" || pages.length === 0) {
      return 0;
    }
    const drafts = buildImageTasks(i, pages);
    if (drafts.length === 0) {
      showSaveStatus(t("illustDetail.saveNoImages"), false, "warning"); // i18n: set 时快照（瞬态）
      return 0;
    }
    enqueueDownloads(drafts);
    showQueuedNotice(drafts.length);
    return drafts.length;
  }

  const [ugoiraQueuing, setUgoiraQueuing] = createSignal(false);

  /** ugoira 入队：先取元数据（官方 ZIP URL），再按全局格式（T13）入队（spec §5/§8）。 */
  async function enqueueUgoira() {
    const i = illust();
    if (!i || i.type !== "ugoira" || ugoiraQueuing()) {
      return;
    }
    setUgoiraQueuing(true);
    try {
      const meta = await loadUgoiraMetadata(i.id);
      const draft = buildUgoiraTask(i, meta.zip_urls.medium, ugoiraDownloadFormat(), meta.frames);
      enqueueDownloads([draft]);
      showQueuedNotice(1);
    } catch (e) {
      console.error("[IllustDetail] ugoira 元数据获取失败:", e);
      showSaveStatus(t("illustDetail.ugoiraMetaFailed"), false, "warning"); // i18n: set 时快照（瞬态）
    } finally {
      setUgoiraQueuing(false);
    }
  }

  /** 底部条入口：静态单页直存 / 多页开选页面板；ugoira 取元数据后入队 */
  function handleSaveEntry() {
    const i = illust();
    if (!i) {
      return;
    }
    if (i.type === "ugoira") {
      void enqueueUgoira();
      return;
    }
    if (i.page_count > 1) {
      setPickerOpen(true);
      return;
    }
    enqueuePages([0]);
  }

  /** 查看器保存当前页（按钮内联状态，toast 在查看器打开时隐藏） */
  async function handleViewerSave(page: number): Promise<boolean> {
    return enqueuePages([page]) === 1;
  }
  // 将选页面板注册到 overlay 栈，供系统返回手势统一处理
  createEffect(
    () => pickerOpen(),
    (open) => {
      if (open) {
        pushOverlay("pagePicker", () => setPickerOpen(false));
        return () => popOverlay("pagePicker");
      }
    },
  );

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
              {t("illustDetail.blockedAuthor")}
            </p>
            <fluent-button appearance="secondary" ref={fluentOn("click", () => goBack())}>
              {t("illustDetail.back")}
            </fluent-button>
          </div>
        )}

        {illust() && !viewerOpen() && !isBlockedAuthor() && (
          <>
            {/* App bar header — A2 卡片式（ADR-0071） */}
            <DetailHeader
              title={illust()!.title}
              onBack={() => goBack()}
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

            {/* 保存进度/结果状态（查看器打开时隐藏——查看器按钮自带内联状态） */}
            <Show when={saveStatus() && !viewerOpen()}>
              <fluent-message-bar
                intent={saveIntent()}
                style="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none"
              >
                {saveStatus()}
              </fluent-message-bar>
            </Show>

            {/* 入队提示 + 跳转下载页（spec §8） */}
            <Show when={queuedNotice() && !viewerOpen()}>
              <div class="fixed top-24 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] shadow-[var(--elevation2)]">
                <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground1)]">
                  {queuedNotice()}
                </span>
                <button
                  type="button"
                  class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorBrandForegroundLink)] bg-transparent border-none cursor-pointer appearance-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
                  onClick={() => void navigate("/downloads")}
                >
                  {t("illustDetail.viewDownloads")}
                </button>
              </div>
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
                          {t("error.fallback.loadFailed")}
                        </span>
                        <span class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] underline">
                          {t("illustDetail.tapRetry")}
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
                    class={[
                      "inline-flex items-center justify-center gap-[var(--spacingHorizontalXS)] rounded-[var(--borderRadiusMedium)] font-semibold [font-size:var(--fontSizeBase200)] [line-height:var(--lineHeightBase200)] min-h-8 px-[var(--spacingHorizontalM)] border transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.97] select-none appearance-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] flex-shrink-0 ml-auto",
                      {
                        "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] border-[var(--colorBrandBackground)] hover:bg-[var(--colorBrandBackgroundHover)] active:bg-[var(--colorBrandBackgroundPressed)]":
                          !isFollowed(),
                        "bg-transparent text-[var(--colorNeutralForeground2)] border-[var(--colorNeutralStroke2)] hover:text-[var(--colorStatusDangerForeground1)] hover:border-[var(--colorStatusDangerForeground1)]":
                          isFollowed(),
                      },
                    ]}

                    onClick={toggleFollow}
                    disabled={following()}
                    aria-label={isFollowed() ? t("illustDetail.unfollowAria") : t("illustDetail.followAria")}
                  >
                    {following() ? "…" : isFollowed() ? t("illustDetail.following") : t("illustDetail.follow")}
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
                      {illust()!.is_bookmarked ? t("illustDetail.bookmarked") : t("illustDetail.bookmark")}
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
                  {t("illustDetail.viewerHint")}
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
                aria-label={t("illustDetail.backToTopAria")}
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
                aria-label={t("illustDetail.pageNavAria")}
              >
                {imageUrls().map((_, i) => (
                  <button
                    class={[
                      "flex items-center justify-center rounded-[var(--borderRadiusCircular)] [font-size:var(--fontSizeBase200)] font-medium transition-all duration-[var(--durationFast)] min-w-9 min-h-9",
                      {
                        "bg-[var(--colorNeutralBackground1Selected)] text-[var(--colorNeutralForeground1)] font-semibold":
                          i === currentVisiblePage(),
                        "text-[var(--colorOverlayForeground)] opacity-[0.85] hover:opacity-100":
                          i !== currentVisiblePage(),
                      },
                    ]}

                    style={{
                      "text-shadow":
                        i !== currentVisiblePage() ? "var(--textShadowDefault)" : "none",
                    }}
                    onClick={() => scrollToPage(i)}
                    aria-label={t("illustDetail.pageN", { page: i + 1 })}
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
            onSave={handleSaveEntry}
            saving={false}
          />
        </Show>

        {viewerOpen() && illust()!.type !== "ugoira" && (
          <ImageViewer
            imageUrls={originalImageUrls()}
            previewUrls={imageUrls()}
            initialPage={viewerStartPage()}
            onClose={closeViewer}
            /* 恒传处理器 + saveBusy 禁用（非卸载）：批量并发期点击被挡，内联 ✓/✗ 反馈保持可达 */
            onSavePage={handleViewerSave}
            saveBusy={false}
          />
        )}

        <PagePickerSheet
          open={pickerOpen()}
          pageUrls={imageUrls()}
          busy={false}
          onClose={() => setPickerOpen(false)}
          onConfirm={(pages) => {
            setPickerOpen(false);
            enqueuePages(pages);
          }}
        />

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
