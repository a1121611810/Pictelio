import { For, Show, type Component } from "solid-js";
import type { SearchResultItem, ApiError, PixivIllust, PixivNovel } from "@/api/types";
import ImageCard from "@/components/ImageCard";
import NovelCard from "@/components/NovelCard";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorDisplay from "@/components/ErrorDisplay";
import FluentIcon from "@/components/ui/FluentIcon";

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
}

const SearchResults: Component<Props> = (props) => {
  return (
    <div>
      <Show when={props.error}>
        <ErrorDisplay error={props.error!} onRetry={props.onRefresh} />
      </Show>

      <Show when={!props.error}>
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

        {/* Load more or end indicator */}
        <Show when={!props.loading}>
          <Show when={props.hasMore && props.results.length > 0}>
            <div class="flex justify-center py-[var(--spacingVerticalXL)]">
              <button
                class="px-[var(--spacingHorizontalXXL)] py-[var(--spacingVerticalM)] min-h-11 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] text-sm font-semibold hover:bg-[var(--colorBrandBackgroundHover)] active:scale-[0.98] transition-all duration-[var(--durationFast)] focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:outline-offset-1"
                onClick={props.onLoadMore}
              >
                加载更多
              </button>
            </div>
          </Show>

          <Show when={!props.hasMore && props.results.length > 0}>
            <div class="flex items-center gap-3 py-[var(--spacingVerticalXXL)]" role="separator">
              <span class="flex-1 h-[var(--strokeWidthThin)] bg-[var(--colorNeutralStroke2)]" />
              <span class="text-[var(--colorNeutralForeground4)] [font-size:var(--fontSizeBase200)] flex-shrink-0">
                没有更多了
              </span>
              <span class="flex-1 h-[var(--strokeWidthThin)] bg-[var(--colorNeutralStroke2)]" />
            </div>
          </Show>
        </Show>

        {/* Empty state */}
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
