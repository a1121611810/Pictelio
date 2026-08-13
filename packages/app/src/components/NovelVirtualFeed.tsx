import type { Component } from "solid-js";
import { createFeedVirtualizer } from "../primitives/createFeedVirtualizer";
import NovelCard, { NovelCoverCard } from "./NovelCard";
import NovelTextListCard from "./NovelTextListCard";
import SkeletonCard from "./SkeletonCard";
import LoadingSpinner from "./LoadingSpinner";
import ErrorDisplay from "./ErrorDisplay";
import PullIndicator from "./PullIndicator";
import InlineRetryBar from "./ui/InlineRetryBar";
import type { PixivNovel, ApiError } from "../api/types";
import type { NovelLayoutMode } from "../stores/settingsStore";

const GAP = 12;

interface Props {
  novels: PixivNovel[];
  loading: boolean;
  error: ApiError | null;
  /** 当前错误是否来自分页（fetchNextPage）。为 true 时不显示上方 ErrorDisplay，改为列表底部内联重试条 */
  paginationError?: boolean;
  hasMore: boolean;
  onNovelClick: (id: number) => void;
  onLoadMore: () => void;
  onRefresh: () => Promise<void> | void;
  onSeriesClick?: (seriesId: number) => void;
  onAuthorClick?: (userId: number) => void;
  layoutMode?: NovelLayoutMode;
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const COVER_HEIGHT = 128;
const CARD_VERTICAL_PADDING = 24;

const NovelVirtualFeed: Component<Props> = (props) => {
  const mode = () => props.layoutMode ?? "list";

  const columnCount = createMemo(() => (mode() === "coverWall" ? 2 : 1));

  const estimateSize = (index: number): number => {
    if (!props.novels[index]) return 100;
    const m = mode();
    if (m === "textList") return 120;
    if (m === "coverWall") return 450; // 初始估计，measureElement 纠正
    return Math.max(COVER_HEIGHT + CARD_VERTICAL_PADDING, 160);
  };

  const feedVirtualizer = createFeedVirtualizer<PixivNovel>({
    items: () => props.novels,
    loading: () => props.loading,
    error: () => props.error,
    paginationError: () => props.paginationError === true,
    hasMore: () => props.hasMore,
    onLoadMore: () => props.onLoadMore(),
    onRefresh: () => Promise.resolve(props.onRefresh()),
    lanes: columnCount,
    estimateSize,
    getItemKey: (i) => props.novels[i]?.id ?? i,
    laneAssignmentMode: mode() === "coverWall" ? "measured" : "estimate",
  });

  const columnWidth = createMemo(() => {
    const cw = feedVirtualizer.containerWidth();
    const cc = columnCount();
    return cw > 0 ? (cw - GAP * (cc - 1)) / cc : 150;
  });

  const {
    containerRef,
    sentinelAttach,
    virtualItems,
    totalSize,
    pullPhase,
    pullDistance,
    measureElement,
  } = feedVirtualizer;

  return (
    <div ref={containerRef} class="px-3">
      <PullIndicator
        zone={pullPhase()}
        distance={pullDistance()}
        refreshThreshold={60}
        settingsThreshold={120}
      />

      {props.error && !props.paginationError && (
        <ErrorDisplay error={props.error} onRetry={() => props.onRefresh()} />
      )}

      {props.loading &&
        props.novels.length === 0 &&
        pullPhase() !== "refreshing" &&
        mode() !== "textList" && (
          <div class="flex flex-col gap-3">
            {Array.from({ length: 3 }).map(() => (
              <SkeletonCard width={feedVirtualizer.containerWidth() || 400} height={140} />
            ))}
          </div>
        )}

      {props.loading &&
        props.novels.length === 0 &&
        pullPhase() !== "refreshing" &&
        mode() === "textList" && (
          <div class="flex flex-col gap-4">
            {Array.from({ length: 6 }).map(() => (
              <div class="h-20 bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusLarge)] animate-pulse" />
            ))}
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
            const novel = props.novels[vItem.index];
            if (!novel) return null;
            return (
              <div
                ref={(el) => {
                  if (el) {
                    el.setAttribute("data-index", String(vItem.index));
                    measureElement(el);
                  }
                }}
                data-index={vItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: `${(vItem.lane ?? 0) * (columnWidth() + GAP)}px`,
                  width: mode() === "coverWall" ? `${columnWidth()}px` : "100%",
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                {mode() === "textList" ? (
                  <NovelTextListCard
                    novel={novel}
                    onClick={props.onNovelClick}
                    onAuthorClick={props.onAuthorClick}
                    onSeriesClick={props.onSeriesClick}
                  />
                ) : mode() === "coverWall" ? (
                  <NovelCoverCard
                    novel={novel}
                    onClick={props.onNovelClick}
                    onAuthorClick={props.onAuthorClick}
                    onSeriesClick={props.onSeriesClick}
                  />
                ) : (
                  <NovelCard
                    novel={novel}
                    onClick={props.onNovelClick}
                    onAuthorClick={props.onAuthorClick}
                    onSeriesClick={props.onSeriesClick}
                  />
                )}
              </div>
            );
          }}
        </For>
      </div>

      {props.loading && props.novels.length > 0 && pullPhase() !== "refreshing" && (
        <LoadingSpinner text="加载中..." />
      )}

      {!props.hasMore && props.novels.length > 0 && (
        <p class="text-[var(--colorNeutralForeground3)] text-center py-4 [font-size:var(--fontSizeBase200)]">
          已经到底了
        </p>
      )}

      {props.novels.length === 0 && !props.loading && !props.error && (
        <p class="text-[var(--colorNeutralForeground2)] text-center py-16 [font-size:var(--fontSizeBase300)]">
          暂无小说
        </p>
      )}

      {/* 分页失败：保留已加载结果，在列表底部显示内联重试条（textList / coverWall 通用插入点） */}
      <Show when={props.error && props.paginationError && props.novels.length > 0}>
        <InlineRetryBar message="加载更多失败" onRetry={props.onLoadMore} />
      </Show>

      <div ref={sentinelAttach} class="h-1" />
    </div>
  );
};

export default NovelVirtualFeed;
