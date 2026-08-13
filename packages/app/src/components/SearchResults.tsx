import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import type { SearchResultItem, ApiError, PixivIllust, PixivNovel } from "@/api/types";
import ImageCard from "@/components/ImageCard";
import NovelCard from "@/components/NovelCard";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorDisplay from "@/components/ErrorDisplay";
import InlineRetryBar from "@/components/ui/InlineRetryBar";
import FluentIcon from "@/components/ui/FluentIcon";
import { createSentinel } from "@/primitives/visibility";

interface Props {
  results: SearchResultItem[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onIllustClick: (id: number) => void;
  onNovelClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
  onRefresh: () => Promise<void> | void;
  error?: ApiError | null;
  /** 是否为分页（加载更多）失败。true 时保留已加载结果，仅显示内联重试条 */
  paginationError?: boolean;
}

const SearchResults: Component<Props> = (props) => {
  // 全量错误（首载失败）：无已加载结果时整体替换为 ErrorDisplay，整页重刷恢复
  const isFullError = () =>
    props.error != null && !(props.paginationError && props.results.length > 0);
  // 分页错误（加载更多失败）：保留已加载结果，仅底部显示内联重试条
  const isPaginationError = () =>
    props.error != null && props.paginationError && props.results.length > 0;

  // 哨兵自动分页：滚动到底部时自动触发 onLoadMore；分页错误时暂停，避免无退避自动重试
  const { attach: sentinelAttach } = createSentinel({
    enabled: () => props.hasMore && !props.loading && !(props.error && props.paginationError),
    onTrigger: () => props.onLoadMore(),
  });

  return (
    <div>
      <Show when={isFullError()}>
        <ErrorDisplay error={props.error!} onRetry={props.onRefresh} />
      </Show>

      {/* 非全量错误（无错误或分页错误）时渲染结果列表区块 */}
      <Show when={!isFullError()}>
        {/* Results list */}
        <div class="flex flex-col gap-[var(--spacingVerticalM)]">
          <For each={props.results}>
            {(item) => (
              <Show
                when={item.type === "illust"}
                fallback={
                  <NovelCard
                    novel={item.entity as PixivNovel}
                    onClick={() => props.onNovelClick(item.entity.id)}
                    onAuthorClick={props.onAuthorClick}
                  />
                }
              >
                <ImageCard
                  illust={item.entity as PixivIllust}
                  onClick={() => props.onIllustClick(item.entity.id)}
                  onAuthorClick={props.onAuthorClick}
                />
              </Show>
            )}
          </For>
        </div>

        {/* Loading indicator */}
        <Show when={props.loading}>
          <div class="py-[var(--spacingVerticalXXL)]">
            <LoadingSpinner text="加载中..." />
          </div>
        </Show>

        {/* 分页失败内联重试条：在列表之后、哨兵之前显示，只重试失败页 */}
        <Show when={isPaginationError()}>
          <InlineRetryBar message="加载更多失败" onRetry={props.onLoadMore} />
        </Show>

        {/* Sentinel for auto-load more (IntersectionObserver) */}
        <Show when={props.hasMore && props.results.length > 0}>
          <div ref={sentinelAttach} class="h-1" />
        </Show>

        {/* End indicator — hasMore 为 false 且非加载中时显示 */}
        <Show when={!props.loading && !props.hasMore && props.results.length > 0}>
          <div class="flex items-center gap-3 py-[var(--spacingVerticalXXL)]" role="separator">
            <span class="flex-1 h-[var(--strokeWidthThin)] bg-[var(--colorNeutralStroke2)]" />
            <span class="text-[var(--colorNeutralForeground4)] [font-size:var(--fontSizeBase200)] flex-shrink-0">
              没有更多了
            </span>
            <span class="flex-1 h-[var(--strokeWidthThin)] bg-[var(--colorNeutralStroke2)]" />
          </div>
        </Show>

        {/* Empty state — 仅首载失败时由 ErrorDisplay 承担错误展示，故仍需 !props.error */}
        <Show when={!props.loading && props.results.length === 0 && !props.hasMore && !props.error}>
          <div class="flex flex-col items-center gap-[var(--spacingVerticalL)] py-[var(--spacingVerticalXXL)] text-center mt-8">
            <span class="text-[var(--colorNeutralForeground4)]">
              <FluentIcon name="search" size={48} />
            </span>
            <div class="flex flex-col gap-[var(--spacingVerticalXS)]">
              <p class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase300)] font-medium">
                没有找到相关作品
              </p>
              <p class="text-[var(--colorNeutralForeground4)] [font-size:var(--fontSizeBase200)]">
                试试其他关键词或调整筛选条件
              </p>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default SearchResults;
