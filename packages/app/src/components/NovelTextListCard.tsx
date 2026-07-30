import type { Component } from "solid-js";
import type { PixivNovel } from "../api/types";
import { addBookmark, deleteBookmark } from "../api/novel";
import HeartBurstEffect from "./HeartBurstEffect";
import SearchableTag from "./SearchableTag";

interface Props {
  novel: PixivNovel;
  onClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
  onSeriesClick?: (seriesId: number) => void;
}

const NovelTextListCard: Component<Props> = (props) => {
  const [bookmarked, setBookmarked] = createSignal(props.novel.is_bookmarked);
  const [bookmarkBurstTrigger, setBookmarkBurstTrigger] = createSignal(0);

  const toggleBookmark = async (e: MouseEvent) => {
    e.stopPropagation();
    if (bookmarked()) {
      const [err] = await tryAsync(deleteBookmark(props.novel.id));
      if (!err) setBookmarked(false);
    } else {
      const [err] = await tryAsync(addBookmark(props.novel.id, "public"));
      if (!err) {
        setBookmarked(true);
        setBookmarkBurstTrigger((n) => n + 1);
      }
    }
  };

  const handleAuthorClick = (e: MouseEvent) => {
    e.stopPropagation();
    props.onAuthorClick?.(props.novel.user.id);
  };

  const handleSeriesClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.novel.series?.id) {
      props.onSeriesClick?.(props.novel.series.id);
    }
  };

  return (
    <div
      data-testid="novel-text-list-card"
      class="relative w-full px-4 py-3 rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] cursor-pointer active:bg-[var(--colorNeutralBackground1Pressed)] transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
      onClick={() => props.onClick(props.novel.id)}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <h3
            data-testid="novel-title"
            class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug line-clamp-2"
          >
            {props.novel.title}
          </h3>

          <div
            data-testid="novel-meta"
            class="mt-1 flex items-center gap-x-2 gap-y-1 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] overflow-hidden"
          >
            <button
              data-testid="novel-author"
              class="inline-block text-[var(--colorBrandForeground1)] hover:underline focus:outline-hidden focus-visible:underline truncate max-w-[50%]"
              onClick={handleAuthorClick}
              aria-label={`作者: ${props.novel.user.name}`}
            >
              @{props.novel.user.name}
            </button>
            <span class="flex-shrink-0">·</span>
            <span class="flex-shrink-0">{props.novel.text_length.toLocaleString()}字</span>
            <span class="flex-shrink-0">·</span>
            <span class="flex-shrink-0">⭐ {props.novel.total_bookmarks.toLocaleString()}</span>
          </div>

          <div class="mt-1.5 flex items-center gap-2 overflow-hidden">
            {props.novel.x_restrict > 0 && (
              <fluent-badge
                data-testid="novel-r18-badge"
                appearance="filled"
                color={props.novel.x_restrict === 1 ? "danger" : "warning"}
                class="[font-size:var(--fontSizeBase100)]"
              >
                {props.novel.x_restrict === 1 ? "R-18" : "R-18G"}
              </fluent-badge>
            )}
            {props.novel.novel_ai_type != null && props.novel.novel_ai_type > 1 && (
              <fluent-badge
                data-testid="novel-ai-badge"
                appearance="filled"
                class="[font-size:var(--fontSizeBase100)]"
              >
                {props.novel.novel_ai_type === 2 ? "AI" : "AI辅助"}
              </fluent-badge>
            )}
            {props.novel.series?.title && (
              <button
                data-testid="novel-series"
                class="inline-flex items-center focus:outline-hidden focus-visible:underline"
                onClick={handleSeriesClick}
                aria-label={`查看系列: ${props.novel.series.title}`}
              >
                <fluent-badge
                  appearance="subtle"
                  class="[font-size:var(--fontSizeBase100)] truncate max-w-[180px]"
                >
                  📖 {props.novel.series.title}
                </fluent-badge>
              </button>
            )}
          </div>

          <div
            data-testid="novel-tags"
            class="mt-2 flex flex-wrap gap-[var(--spacingHorizontalXXS)] overflow-hidden max-h-[36px]"
          >
            <For each={props.novel.tags}>
              {(tag) => (
                <SearchableTag
                  name={tag.name}
                  translatedName={tag.translated_name}
                  class="rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase100)] [line-height:var(--lineHeightBase100)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] hover:bg-[var(--colorNeutralBackground3Hover)]"
                />
              )}
            </For>
          </div>
        </div>

        <button
          class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--colorBrandStroke1)] active:scale-90 transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
          classList={{
            "text-[var(--colorPaletteRedForeground1)]": bookmarked(),
            "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorPaletteRedForeground1)]":
              !bookmarked(),
          }}
          onClick={toggleBookmark}
          aria-label={bookmarked() ? "取消收藏" : "收藏"}
        >
          {bookmarked() ? "♥" : "♡"}
        </button>
      </div>
      <HeartBurstEffect trigger={bookmarkBurstTrigger} size={60} particleCount={6} />
    </div>
  );
};

export default NovelTextListCard;
