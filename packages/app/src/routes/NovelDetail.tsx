import type { Accessor, Component, JSX } from "solid-js";
import PixivImage from "../components/PixivImage";
import ImageViewer from "@/components/ImageViewer";
import NovelDetailSkeleton from "../components/skeletons/NovelDetailSkeleton";
import FluentIcon from "../components/ui/FluentIcon";
import NovelSearchBar from "../components/NovelSearchBar";
import NovelCoverHeader from "../components/NovelCoverHeader";
import NovelFooterNav from "../components/NovelFooterNav";
import { NOVEL_INTERACTIVE_MARGIN } from "../primitives/rootMargins";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import { createScrollPosition } from "@solid-primitives/scroll";
import { createVisibilityObserver } from "@solid-primitives/intersection-observer";
import { createNovelSearch } from "../primitives/createNovelSearch";
import { createNovelVirtualLayout } from "../primitives/createNovelVirtualLayout";
import type { PixivNovel, SeriesNavigation } from "@/api/types";
import type { NovelImagesMap } from "@/api/novel";
import { getEntry, peekEntry, loadNovelEntry, type NovelCacheEntry } from "@/stores/novelCache";
import {
  readerStyle,
  fontSize,
  fontWeight,
  fontFamily,
  lineHeight,
} from "../stores/readerSettingsStore";
import {
  parseNovelBlocks,
  buildSearchText,
  getImageBlocks,
  selectInlineImageUrl,
} from "../utils/novelBlocks";
import type { NovelBlock, TextBlock, ImageBlock } from "../utils/novelBlocks";
import { loadNovelImageDimensions, type NovelImageDimensions } from "../utils/novelImageDimensions";
import ReaderSettingsSheet from "../components/ReaderSettingsSheet";
import SeriesSheet from "../components/SeriesSheet";
import PageTransition from "../components/PageTransition";
import CommentOverlay from "../components/CommentOverlay";
import { type ApiError } from "../api/types";
import ErrorDisplay from "../components/ErrorDisplay";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";
import { scrollToTop } from "../utils/scrollToTop";
import { toApiError } from "../api/client";
import { recordVisit } from "../stores/historyStore";


// ── Scroll-driven hide/show constants ──
const BOTTOM_THRESHOLD = 80;

interface NovelProgress {
  paragraphIndex: number;
  charIndex: number;
  progress: number;
}

interface NovelImageBlockProps {
  block: ImageBlock;
  containerWidth: Accessor<number>;
  dimensions: Accessor<NovelImageDimensions>;
  style?: Record<string, string>;
  onClick: () => void;
}

const NovelImageBlock: Component<NovelImageBlockProps> = (props) => {
  const dim = createMemo(() => props.dimensions()[props.block.imageId]);
  const aspectRatio = createMemo(() => {
    const d = dim();
    if (d && d.width > 0 && d.height > 0) {
      return `${d.width} / ${d.height}`;
    }
    return "16 / 9";
  });

  function handleClick() {
    if (dim()) {
      props.onClick();
    }
  }

  return (
    <figure
      class="novel-image-block overflow-hidden m-0"
      classList={{ "cursor-pointer": dim() !== null && dim() !== undefined }}
      style={{ "aspect-ratio": aspectRatio() }}
      onClick={handleClick}
    >
      <Switch>
        <Match when={dim() === undefined}>
          <div
            class="w-full h-full flex flex-col items-center justify-center gap-1.5"
            style={{
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
        </Match>
        <Match when={dim() === null}>
          <div
            class="w-full h-full flex flex-col items-center justify-center gap-1"
            style={{ "background-color": "var(--colorNeutralBackground2)" }}
          >
            <span class="text-[var(--colorNeutralForeground3)] text-xs">⚠</span>
            <span class="text-[var(--colorNeutralForegroundDisabled)] [font-size:var(--fontSizeBase100)]">
              图片加载失败
            </span>
          </div>
        </Match>
        <Match when={dim()}>
          {(d) => (
            <PixivImage
              src={selectInlineImageUrl(props.block.urls, props.containerWidth())}
              alt={`内嵌图片 ${props.block.imageId}`}
              width={d().width}
              height={d().height}
              loading="lazy"
              class="w-full h-full object-cover"
            />
          )}
        </Match>
      </Switch>
    </figure>
  );
};

function parseProgress(raw: string | null): NovelProgress | null {
  if (!raw) {
    return null;
  }
  const [parseErr, parsed] = trySync(() => JSON.parse(raw) as unknown);
  if (!parseErr && typeof parsed === "object" && parsed !== null) {
    const p = parsed as Record<string, unknown>;
    if (
      Number.isInteger(p.paragraphIndex) &&
      Number.isInteger(p.charIndex) &&
      (p.paragraphIndex as number) >= 0 &&
      (p.charIndex as number) >= 0
    ) {
      return {
        paragraphIndex: p.paragraphIndex as number,
        charIndex: p.charIndex as number,
        progress: typeof p.progress === "number" ? p.progress : 0,
      };
    }
  }
  return null;
}

function resetNovelProgress(id: number) {
  localStorage.setItem(
    `novel_progress_${id}`,
    JSON.stringify({ paragraphIndex: 0, charIndex: 0, progress: 0 }),
  );
}

function isTextBlock(block: NovelBlock): block is TextBlock {
  return block.type === "text";
}

function isImageBlock(block: NovelBlock): block is ImageBlock {
  return block.type === "image";
}

interface NovelContentBlockProps {
  block: Accessor<NovelBlock>;
  imageBlockList: Accessor<ImageBlock[]>;
  imageDimensions: Accessor<NovelImageDimensions>;
  containerWidth: Accessor<number>;
  fontSize: Accessor<number>;
  paragraphHeight: number | undefined;
  onImageClick: (index: number) => void;
  renderParagraph: (paragraphIndex: number, text: string) => JSX.Element;
}

const NovelContentBlock: Component<NovelContentBlockProps> = (props) => {
  const block = props.block();

  if (isTextBlock(block)) {
    const minH = props.paragraphHeight;
    return (
      <p
        class="novel-text-paragraph"
        style={{
          "text-indent": `${props.fontSize() * 2}px`,
          ...(minH != null ? { "min-height": `${minH}px` } : {}),
        }}
      >
        {props.renderParagraph(block.index, block.text)}
      </p>
    );
  }

  if (isImageBlock(block)) {
    const imageIndex = props.imageBlockList().findIndex((b) => b.imageId === block.imageId);
    return (
      <NovelImageBlock
        block={block}
        containerWidth={props.containerWidth}
        dimensions={props.imageDimensions}
        style={{}}
        onClick={() => props.onImageClick(imageIndex)}
      />
    );
  }
};

const NovelDetail: Component = () => {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      void navigate({ to: "/home", resetScroll: false });
    }
  }

  // 系列内切换只更新内部小说 ID，不 navigate，避免污染浏览器历史栈。
  // 入口 URL 对应的 params.id 作为初始值，后续章节/目录跳转都通过这里。
  let skipRestoreProgress = false;

  const [currentNovelId, setCurrentNovelId] = createSignal(Number(params().id));
  const novelId = currentNovelId;

  function switchNovel(id: number) {
    skipRestoreProgress = true;
    setCurrentNovelId(id);
  }

  // URL 参数变化时同步内部小说 ID（外部链接/前进后退），系列内切换不触发此效果。
  createEffect(() => {
    const paramId = Number(params().id);
    if (paramId && paramId !== currentNovelId()) {
      setCurrentNovelId(paramId);
    }
  });

  const [novelData, setNovelData] = createSignal<PixivNovel | null>(null);
  const [novelHtml, setNovelHtml] = createSignal<string | null>(null);
  const [novelImages, setNovelImages] = createSignal<NovelImagesMap>({});
  const [novelNav, setNovelNav] = createSignal<SeriesNavigation | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<ApiError | null>(null);

  function applyEntry(entry: NovelCacheEntry) {
    batch(() => {
      setNovelData(entry.detail);
      setNovelHtml(entry.text);
      setNovelImages(entry.images ?? {});
      setNovelNav(entry.nav);
      setDetailLoading(false);
      setDetailError(null);
    });
    recordVisit(entry.detail, "novel");
  }

  let loadGeneration = 0;

  async function loadNovelById(id: number, generation: number) {
    if (!id) {
      return;
    }
    const cached = peekEntry(id);
    if (cached) {
      if (loadGeneration !== generation) return;
      applyEntry(cached);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    const [novelErr] = await tryAsync((async () => {
      const dbEntry = await getEntry(id);
      if (dbEntry) {
        if (loadGeneration !== generation) return;
        applyEntry(dbEntry);
        return;
      }
      const entry = await loadNovelEntry(id);
      if (loadGeneration !== generation) return;
      applyEntry(entry);
    })());
    if (novelErr) {
      if (loadGeneration !== generation) return;
      setDetailError(toApiError(novelErr));
      setDetailLoading(false);
    }
  }

  // 组件内加载小说数据：currentNovelId 变化时自动请求（首次加载 + 系列内切换）
  createEffect(() => {
    const id = currentNovelId();
    if (!id) {
      return;
    }
    // 已加载该 ID 的数据时跳过
    if (novelData()?.id === id) {
      return;
    }
    const gen = ++loadGeneration;
    void loadNovelById(id, gen);
  });

  const [imageDimensions, setImageDimensions] = createSignal<NovelImageDimensions>({});
  const [footerHidden, setFooterHidden] = createSignal(false);

  // 小说 ID 变化或图片映射重置时，清空已计算的内嵌图尺寸
  createEffect(() => {
    novelImages();
    setImageDimensions({});
  });

  // 加载出错时允许下次恢复阅读进度
  createEffect(() => {
    if (detailError()) {
      skipRestoreProgress = false;
    }
  });

  // 小说正文加载完成后恢复阅读进度
  createEffect(() => {
    const html = novelHtml();
    if (html && html.length > 0) {
      requestAnimationFrame(() => restoreProgress());
    }
  });

  // 获取到图片映射后，预加载每张内嵌图的真实尺寸
  createEffect(() => {
    const images = novelImages();
    const ids = Object.keys(images);
    if (ids.length === 0) {
      return;
    }

    let cancelled = false;
    loadNovelImageDimensions(images).then((dimensions) => {
      if (!cancelled) {
        setImageDimensions(dimensions);
      }
    });

    onCleanup(() => {
      cancelled = true;
    });
  });

  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [showComments, setShowComments] = createSignal(false);
  const [seriesOpen, setSeriesOpen] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [textContainerWidth, setTextContainerWidth] = createSignal(0);

  const blocks = createMemo<NovelBlock[]>(() => {
    return parseNovelBlocks(novelHtml() ?? "", novelImages());
  });

  const searchText = createMemo(() => buildSearchText(blocks()));

  const virtualLayout = createNovelVirtualLayout({
    blocks,
    containerWidth: textContainerWidth,
    settings: () => ({
      fontSize: fontSize(),
      fontWeight: fontWeight(),
      fontFamily: fontFamily(),
      fontColor: "",
      lineHeight: lineHeight(),
      bgColor: "",
    }),
    imageDimensions,
    containerRef: () => {},
    novelId,
    useWindowScroll: true,
  });

  // 将 pretext 计算的段落高度注入 block 对象——数组引用变化后 <For> 自动重 render。
  const blocksWithHeights = createMemo(() => {
    const layout = virtualLayout.layoutResult();
    const h: Record<number, number> = {};
    for (const p of layout.paragraphs) {
      h[p.index] = p.height;
    }
    // oxlint-disable-next-line no-map-spread -- blocks are immutable; we need shallow copies to trigger <For> re-render
    return blocks().map((b) => ({
      ...b,
      ph: b.type === "text" ? h[(b as TextBlock).index] : undefined,
    }));
  });

  const search = createNovelSearch(searchText, { debounceMs: 150 });

  function renderParagraphWithHighlights(paragraphIndex: number, text: string): JSX.Element {
    const matches = search.getMatchesForParagraph(paragraphIndex);
    const activeIndex = search.activeIndex();
    const allMatches = search.matches();
    const activeMatch =
      activeIndex >= 0 && activeIndex < allMatches.length ? allMatches[activeIndex] : null;

    if (matches.length === 0) {
      return <>{text}</>;
    }

    const nodes: JSX.Element[] = [];
    let lastEnd = 0;

    for (const match of matches) {
      if (match.start > lastEnd) {
        nodes.push(text.slice(lastEnd, match.start));
      }
      const isActive =
        activeMatch != null &&
        match.paragraphIndex === activeMatch.paragraphIndex &&
        match.start === activeMatch.start &&
        match.end === activeMatch.end;
      nodes.push(
        <mark class="novel-search-match" classList={{ "novel-search-match-active": isActive }}>
          {text.slice(match.start, match.end)}
        </mark>,
      );
      lastEnd = match.end;
    }

    if (lastEnd < text.length) {
      nodes.push(text.slice(lastEnd));
    }

    return <>{nodes}</>;
  }

  // ── 阅读进度持久化 ──
  let progressSaveTimer: ReturnType<typeof setTimeout> | undefined;
  function saveProgress() {
    if (progressSaveTimer) {
      clearTimeout(progressSaveTimer);
    }
    progressSaveTimer = setTimeout(() => {
      const current = virtualLayout.currentCharIndex();
      const layout = virtualLayout.layoutResult();
      const layoutParagraphs = layout.paragraphs;
      const totalChars = layoutParagraphs.reduce(
        (sum, p) =>
          sum + p.lineRanges.reduce((lineSum, line) => lineSum + (line.end - line.start), 0),
        0,
      );
      const currentOffset =
        layoutParagraphs
          .slice(0, current.paragraphIndex)
          .reduce(
            (sum, p) =>
              sum + p.lineRanges.reduce((lineSum, line) => lineSum + (line.end - line.start), 0),
            0,
          ) + current.charIndex;
      const progress = totalChars > 0 ? currentOffset / totalChars : 0;
      localStorage.setItem(
        `novel_progress_${novelId()}`,
        JSON.stringify({
          paragraphIndex: current.paragraphIndex,
          charIndex: current.charIndex,
          progress,
        }),
      );
    }, 500);
  }

  function restoreProgress() {
    if (skipRestoreProgress) {
      skipRestoreProgress = false;
      return;
    }
    const saved = parseProgress(localStorage.getItem(`novel_progress_${novelId()}`));
    if (!saved) {
      return;
    }
    const layout = virtualLayout.layoutResult();
    const layoutParagraphs = layout.paragraphs;
    if (saved.paragraphIndex >= layoutParagraphs.length) {
      return;
    }
    const paragraph = layoutParagraphs[saved.paragraphIndex];
    if (!paragraph) {
      return;
    }
    const maxCharIndex =
      paragraph.lineRanges[paragraph.lineRanges.length - 1]?.end ?? paragraph.height;
    if (saved.charIndex > maxCharIndex) {
      return;
    }
    virtualLayout.scrollToCharIndex(saved.paragraphIndex, saved.charIndex);
  }

  // 滚动停止 500ms 后保存阅读进度
  createEffect(() => {
    virtualLayout.currentCharIndex();
    saveProgress();
  });

  function onTextContainerRef(el: HTMLElement) {
    if (!el) {
      return;
    }
    setTextContainerWidth(el.clientWidth);
    virtualLayout.containerRef(el);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTextContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);

    onCleanup(() => ro.disconnect());
  }

  // 将阅读设置面板状态注册到 overlay 栈
  createEffect(() => {
    if (settingsOpen()) {
      pushOverlay("readerSettingsSheet", () => setSettingsOpen(false));
      onCleanup(() => {
        popOverlay("readerSettingsSheet");
      });
    }
  });

  // 将系列目录面板状态注册到 overlay 栈
  createEffect(() => {
    if (seriesOpen()) {
      pushOverlay("seriesSheet", () => setSeriesOpen(false));
      onCleanup(() => {
        popOverlay("seriesSheet");
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

  // ── Scroll-driven bottom toolbar hide/show ──
  const { direction: scrollDirection, reset: resetScrollDirection } = createScrollBehavior({
    directionThreshold: 30,
    accumulate: true,
  });
  const scroll = createScrollPosition();
  createEffect(() => {
    const y = scroll.y;
    const atBottom =
      window.innerHeight + y >= document.documentElement.scrollHeight - BOTTOM_THRESHOLD;
    if (atBottom) {
      setFooterHidden(false);
      return;
    }
    const d = scrollDirection();
    if (d === "down") setFooterHidden(true);
    else if (d === "up") setFooterHidden(false);
  });

  function openSearch() {
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    search.clearSearch();
  }

  // 切换小说时自动关闭搜索、清空高亮，并滚动到页面顶部，重置底部栏显隐状态
  createEffect(() => {
    currentNovelId();
    closeSearch();
    scrollToTop();
    setFooterHidden(false);
    untrack(() => resetScrollDirection());
  });

  const [titleEl, setTitleEl] = createSignal<HTMLHeadingElement | undefined>();
  const titleVisible = createVisibilityObserver({ rootMargin: NOVEL_INTERACTIVE_MARGIN })(() =>
    titleEl(),
  );
  const showHeaderTitle = createMemo(() => !titleVisible());
  const [imageViewerOpen, setImageViewerOpen] = createSignal(false);
  const [imageViewerIndex, setImageViewerIndex] = createSignal(0);

  // 将图片查看器状态注册到 overlay 栈
  createEffect(() => {
    if (imageViewerOpen()) {
      pushOverlay("viewer", () => setImageViewerOpen(false));
      onCleanup(() => {
        popOverlay("viewer");
      });
    }
  });

  const imageBlockList = createMemo(() => getImageBlocks(blocks()));
  const imageViewerUrls = createMemo(() => imageBlockList().map((block) => block.urls.original));

  return (
    <PageTransition>
      <div class="min-h-screen bg-[var(--colorNeutralBackground2)]">
        {/* ── Top navigation bar ── */}
        <header
          class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-2"
          onDblClick={() => {
            resetNovelProgress(novelId());
            scrollToTop();
          }}
        >
          <button
            type="button"
            aria-label="返回"
            class="flex items-center justify-center rounded-[var(--borderRadiusSmall)] bg-transparent border-none cursor-pointer text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all w-8 h-8 p-0 min-w-8"
            on:click={() => handleBack()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
            </svg>
          </button>
          <Show
            when={searchOpen()}
            fallback={
              <h1 class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] flex items-center gap-1 min-w-0 flex-1">
                <span class="whitespace-nowrap flex-shrink-0">小说</span>
                <span
                  class="truncate text-[var(--colorNeutralForeground2)]"
                  classList={{ "opacity-0": !showHeaderTitle(), "opacity-100": showHeaderTitle() }}
                  style="transition:opacity var(--durationFast) var(--curveEasyEase)"
                >
                  《{novelData()?.title ?? ""}》
                </span>
              </h1>
            }
          >
            <div onDblClick={(e) => e.stopPropagation()}>
              <NovelSearchBar
                query={search.query}
                setQuery={search.setQuery}
                matchCount={search.matchCount}
                activeIndex={search.activeIndex}
                onPrev={search.prevMatch}
                onNext={search.nextMatch}
                onClose={closeSearch}
              />
            </div>
          </Show>
          <Show when={!searchOpen() && !detailLoading()}>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusSmall)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
              onClick={openSearch}
              aria-label="搜索"
              title="搜索"
            >
              <FluentIcon name="search" size={20} />
            </button>
          </Show>
        </header>

        {/* ── Loading state：全页骨架屏 ── */}
        <Show when={detailLoading() && !novelData()}>
          <NovelDetailSkeleton />
        </Show>

        {/* ── Error state ── */}
        <Show when={detailError()}>
          <ErrorDisplay error={detailError()!} onRetry={() => window.location.reload()} />
        </Show>

        {/* ── Content ── */}
        <Show when={novelData()}>
          {(novel) => (
            <>
              <NovelCoverHeader
                novel={novel()}
                onAuthorClick={() => void navigate({ to: `/user/${novel().user.id}` })}
                onSeriesClick={() => setSeriesOpen(true)}
                onCommentsClick={() => setShowComments(true)}
                onTitleRef={setTitleEl}
              />

              {/* ── Text content ── */}
              <div class="px-4 py-6 max-w-2xl mx-auto pb-[64px]">
                <Show when={novelHtml()}>
                  <div
                    class="novel-text"
                    ref={onTextContainerRef}
                    style={{
                      ...readerStyle(),
                    }}
                  >
                    {/* 虚拟滚动：只渲染视口 ±5 段内的块，上下用撑杆占位保持滚动条正确 */}
                    {(() => {
                      const all = blocksWithHeights();
                      const vis = virtualLayout.visibleBlocks();
                      if (vis.length === 0 || all.length === 0) {
                        return null;
                      }
                      const first = virtualLayout.getBlockLayout(vis[0]);
                      const last = virtualLayout.getBlockLayout(vis[vis.length - 1]);
                      const topH = first?.offset ?? 0;
                      const bottomH = last
                        ? virtualLayout.totalHeight() - (last.offset + last.height)
                        : 0;
                      return (
                        <>
                          <div style={{ height: `${Math.max(0, topH)}px` }} aria-hidden="true" />
                          <For each={vis}>
                            {(idx) => {
                              const block = all[idx];
                              if (!block) {
                                return null;
                              }
                              return (
                                <NovelContentBlock
                                  block={() => block}
                                  imageBlockList={imageBlockList}
                                  imageDimensions={imageDimensions}
                                  containerWidth={textContainerWidth}
                                  fontSize={fontSize}
                                  paragraphHeight={block.ph}
                                  onImageClick={(imageIndex) => {
                                    setImageViewerIndex(imageIndex);
                                    setImageViewerOpen(true);
                                  }}
                                  renderParagraph={renderParagraphWithHighlights}
                                />
                              );
                            }}
                          </For>
                          <div style={{ height: `${Math.max(0, bottomH)}px` }} aria-hidden="true" />
                        </>
                      );
                    })()}
                  </div>
                </Show>
                <Show when={detailLoading() && !novelHtml()}>
                  <div class="space-y-3 animate-pulse">
                    {Array.from({ length: 6 }).map(() => (
                      <div class="h-4 bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusSmall)]" />
                    ))}
                  </div>
                </Show>
              </div>

              <NovelFooterNav
                novel={novel()}
                novelNav={novelNav()}
                footerHidden={footerHidden()}
                onPrevChapter={(id) => switchNovel(id)}
                onNextChapter={(id) => switchNovel(id)}
                onOpenSeries={() => setSeriesOpen(true)}
                onOpenSettings={() => setSettingsOpen(true)}
              />

              <ReaderSettingsSheet isOpen={settingsOpen()} onClose={() => setSettingsOpen(false)} />

              <Show when={novel().series?.id}>
                <SeriesSheet
                  seriesId={novel().series!.id}
                  seriesTitle={novel().series!.title}
                  authorName={novel().user.name}
                  authorId={novel().user.id}
                  isOpen={seriesOpen()}
                  onClose={() => setSeriesOpen(false)}
                  onNovelSelect={(id) => switchNovel(id)}
                  onAuthorClick={() => void navigate({ to: `/user/${novel().user.id}` })}
                  activeNovelId={currentNovelId()}
                />
              </Show>

              <Show when={imageViewerOpen() && imageViewerUrls().length > 0}>
                <ImageViewer
                  imageUrls={imageViewerUrls()}
                  initialPage={imageViewerIndex()}
                  onClose={() => setImageViewerOpen(false)}
                />
              </Show>

              <CommentOverlay
                type="novel"
                targetId={novel().id}
                isOpen={showComments()}
                onClose={() => setShowComments(false)}
              />

              {/* ── Close the Show fragment ── */}
            </>
          )}
        </Show>
      </div>
    </PageTransition>
  );
};

export default NovelDetail;
