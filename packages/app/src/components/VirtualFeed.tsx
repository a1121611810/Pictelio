import type { Component } from "solid-js";
import ImageCard from "./ImageCard";
import LazyImageCard from "./LazyImageCard";
import SkeletonCard from "./SkeletonCard";
import GridCard from "./GridCard";
import PullIndicator from "./PullIndicator";
import ErrorDisplay from "./ErrorDisplay";
import type { PixivIllust, ApiError } from "../api/types";
import type { LayoutMode } from "../primitives/types";
import { createFeedVirtualizer } from "../primitives/createFeedVirtualizer";
import { loadImage, checkImageCache } from "../utils/imageLoader";
import { isImageHostEnabled } from "../stores/imageHostStore";
import { imageCachePrefetch } from "../stores/settingsStore";
import { scrollRestoreGlobal } from "../primitives/createScrollRestore";
import type { ScrollRestoreState } from "../primitives/createScrollRestore";
import { createVirtualScrollRestore } from "../primitives/createVirtualScrollRestore";

interface Props {
  illusts: PixivIllust[];
  loading: boolean;
  error: ApiError | null;
  hasMore: boolean;
  onIllustClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
  onLoadMore: () => void;
  onRefresh: () => Promise<void> | void;
  onNavigateToSettings?: () => void;
  emptyText?: string;
  skipAnimation?: boolean;
  layoutMode?: LayoutMode;
  scrollKey?: string;
  initialScrollState?: ScrollRestoreState;
  onScrollStateChange?: (state: ScrollRestoreState) => void;
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const LAYOUT_COLUMNS: Record<LayoutMode, number> = {
  waterfall: 2,
  single: 1,
  grid: 3,
};

const GAP = 12;
const VERTICAL_GAP = 12;
const CARD_INFO_HEIGHT = 140;
const PULL_THRESHOLD_SETTINGS = 120;
const SKELETON_ITEM_HEIGHT = 300;

const VirtualFeed: Component<Props> = (props) => {
  const layoutMode = createMemo(() => props.layoutMode ?? "waterfall");
  const columnCount = createMemo(() => LAYOUT_COLUMNS[layoutMode()]);

  // 标记是否已发起过数据加载（用于抑制首次渲染时的空状态）
  let loadAttempted = false;
  createEffect(() => {
    if (props.loading || props.error || props.illusts.length > 0) {
      loadAttempted = true;
    }
  });

  const estimateSize = (index: number) => {
    const ill = props.illusts[index];
    if (!ill) return 200;
    const mode = layoutMode();
    if (mode === "grid") return 200 + CARD_INFO_HEIGHT;
    // 动图卡片固定 1:1 正方形，其余用图片原始宽高比
    const aspectRatio = ill.type === "ugoira" ? 1 : ill.height > 0 ? ill.width / ill.height : 1;
    return cw() / aspectRatio + CARD_INFO_HEIGHT;
  };

  // ── Scroll restoration ──
  let feedVirtualizer!: ReturnType<typeof createFeedVirtualizer<PixivIllust>>;

  const scrollRestore = createVirtualScrollRestore({
    getVirtualizer: () => feedVirtualizer.getVirtualizer(),
    getState: () =>
      props.scrollKey
        ? (scrollRestoreGlobal.getVirtual(props.scrollKey) ?? undefined)
        : props.initialScrollState,
    saveState: (state) => {
      if (props.scrollKey) {
        scrollRestoreGlobal.saveVirtual(props.scrollKey, state);
      } else {
        props.onScrollStateChange?.(state);
      }
    },
  });

  feedVirtualizer = createFeedVirtualizer<PixivIllust>({
    items: () => props.illusts,
    loading: () => props.loading,
    error: () => props.error,
    hasMore: () => props.hasMore,
    onLoadMore: () => props.onLoadMore(),
    onRefresh: () => Promise.resolve(props.onRefresh()),
    lanes: columnCount,
    estimateSize,
    getItemKey: (i) => props.illusts[i]?.id ?? i,
    emptyText: props.emptyText,
    settingsThreshold: PULL_THRESHOLD_SETTINGS,
    onNavigateToSettings: props.onNavigateToSettings,
    scrollRestore: {
      initialOffset: scrollRestore.initialOffset ?? 0,
      initialMeasurementsCache: scrollRestore.initialMeasurementsCache,
    },
    onReady: () => {
      scrollRestore.restoreScroll();
    },
    suppressHeaderVisibility: (d) => props.suppressHeaderVisibility?.(d),
  });

  const cw = createMemo(() => {
    const cc = columnCount();
    const cww = feedVirtualizer.containerWidth();
    return cww > 0 ? (cww - GAP * (cc - 1)) / cc : 150;
  });

  const { containerRef, sentinelAttach, virtualItems, totalSize, pullDistance, pullPhase } =
    feedVirtualizer;

  // ── Skeleton layout for initial loading state ──
  const skeletonCount = createMemo(() => {
    const cc = columnCount();
    const rows = Math.ceil(window.innerHeight / SKELETON_ITEM_HEIGHT) + 1;
    return cc * rows;
  });

  function skeletonStyle(i: number) {
    const cc = columnCount();
    const col = i % cc;
    const row = Math.floor(i / cc);
    return {
      position: "absolute" as const,
      top: `${row * (SKELETON_ITEM_HEIGHT + VERTICAL_GAP)}px`,
      left: `${col * (cw() + GAP)}px`,
      width: `${cw()}px`,
      height: `${SKELETON_ITEM_HEIGHT}px`,
    };
  }

  // ── Scroll prediction: prefetch images just outside visible window ──
  createEffect(() => {
    const items = virtualItems();
    if (items.length === 0) return;
    if (isImageHostEnabled()) return;
    if (!imageCachePrefetch()) return;
    const illustsList = props.illusts;
    const lastIdx = items[items.length - 1].index;
    const preloadEnd = Math.min(lastIdx + 10, illustsList.length);
    for (let i = lastIdx + 1; i < preloadEnd; i++) {
      const ill = illustsList[i];
      if (!ill) break;
      const url = ill.image_urls.medium || ill.image_urls.large;
      if (url && !checkImageCache(url)) {
        void tryAsync(loadImage(url));
      }
    }
  });

  return (
    <div ref={containerRef} class="px-3">
      <PullIndicator
        zone={pullPhase()}
        distance={pullDistance()}
        refreshThreshold={60}
        settingsThreshold={PULL_THRESHOLD_SETTINGS}
      />

      {props.error && <ErrorDisplay error={props.error} onRetry={() => props.onRefresh()} />}

      {(props.loading || !loadAttempted) &&
        props.illusts.length === 0 &&
        pullPhase() !== "refreshing" && (
          <div class="px-3">
            <div
              style={{
                position: "relative",
                width: "100%",
                height: `${skeletonCount() > 0 ? Math.ceil(skeletonCount() / columnCount()) * (SKELETON_ITEM_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP : 1}px`,
              }}
            >
              <For each={Array.from({ length: skeletonCount() })}>
                {(_item, i) => (
                  <div style={skeletonStyle(i())}>
                    <SkeletonCard width={400} height={SKELETON_ITEM_HEIGHT} />
                  </div>
                )}
              </For>
            </div>
          </div>
        )}

      <div
        style={{
          position: "relative",
          width: "100%",
          height: `${totalSize() || 1}px`,
        }}
      >
        <For each={virtualItems()}>
          {(vItem) => {
            const illust = props.illusts[vItem.index];
            if (!illust) return null;
            return (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: `${(vItem.lane ?? 0) * (cw() + GAP)}px`,
                  width: `${cw()}px`,
                  height: `${vItem.size}px`,
                  transform: `translateY(${vItem.start}px)`,
                }}
                class="surface-card"
              >
                {layoutMode() === "grid" ? (
                  <GridCard
                    illust={illust}
                    onClick={props.onIllustClick}
                    onAuthorClick={props.onAuthorClick}
                  />
                ) : vItem.index < 4 ? (
                  <ImageCard
                    illust={illust}
                    onClick={props.onIllustClick}
                    onAuthorClick={props.onAuthorClick}
                  />
                ) : (
                  <LazyImageCard
                    illust={illust}
                    onClick={props.onIllustClick}
                    onAuthorClick={props.onAuthorClick}
                  />
                )}
              </div>
            );
          }}
        </For>
      </div>

      {!props.hasMore && props.illusts.length > 0 && (
        <p class="text-[var(--colorNeutralForeground3)] text-center py-4 [font-size:var(--fontSizeBase200)]">
          已经到底了
        </p>
      )}

      {props.illusts.length === 0 && !props.loading && !props.error && loadAttempted && (
        <p class="text-[var(--colorNeutralForeground2)] text-center py-16 [font-size:var(--fontSizeBase300)]">
          {props.emptyText ?? "暂无新作品"}
        </p>
      )}

      <div ref={sentinelAttach} class="h-1" />
    </div>
  );
};

export default VirtualFeed;
