import { type Component, createSignal, For } from "solid-js";
import type { PixivNovel } from "../api/types";
import { addBookmark, deleteBookmark } from "../api/novel";
import HeartIcon from "./ui/HeartIcon";
import HeartBurstEffect from "./HeartBurstEffect";
import IllustTags from "./IllustTags";
import SearchableTag from "./SearchableTag";
import { resolveImageUrl } from "../utils/imageLoader";

interface Props {
  novel: PixivNovel;
  onClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
  onSeriesClick?: (seriesId: number) => void;
}

const NovelCard: Component<Props> = (props) => {
  const [bookmarked, setBookmarked] = createSignal(props.novel.is_bookmarked);
  const [bookmarkBurstTrigger, setBookmarkBurstTrigger] = createSignal(0);
  const [privateHint, setPrivateHint] = createSignal(false);
  let hintTimer: ReturnType<typeof setTimeout>;

  const showPrivateToast = () => {
    setPrivateHint(true);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setPrivateHint(false), 1500);
  };

  const toggleBookmark = async (e: MouseEvent, privateBookmark = false) => {
    e.stopPropagation();
    try {
      if (bookmarked()) {
        await deleteBookmark(props.novel.id);
        setBookmarked(false);
      } else {
        await addBookmark(props.novel.id, privateBookmark ? "private" : "public");
        setBookmarked(true);
        setBookmarkBurstTrigger((n) => n + 1);
        if (privateBookmark) {
          showPrivateToast();
        }
      }
    } catch {
      /* Silently fail */
    }
  };

  let longPressTimer: ReturnType<typeof setTimeout>;

  const onPointerDown = (e: PointerEvent) => {
    longPressTimer = setTimeout(() => {
      toggleBookmark(e as any, true);
      longPressTimer = 0 as any;
    }, 500);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0 as any;
      toggleBookmark(e as any, false);
    }
  };

  return (
    <div
      class="surface-card cursor-pointer active:scale-[0.98]"
      onClick={() => props.onClick(props.novel.id)}
    >
      <div class="flex gap-[var(--spacingHorizontalM)] p-[var(--spacingHorizontalM)]">
        {/* Cover image — responsive square (clamp 80px–128px) */}
        <div class="relative w-[clamp(80px,20vw,128px)] aspect-square flex-shrink-0 rounded-[var(--borderRadiusSmall)] overflow-hidden">
          <img
            src={resolveImageUrl(props.novel.image_urls.square_medium)}
            alt={props.novel.title}
            class="w-full h-full object-cover"
            loading="lazy"
          />
          {/* Badge group — 左上角 */}
          <div class="absolute top-[var(--spacingVerticalXXS)] left-[var(--spacingHorizontalXXS)] flex items-center gap-[var(--spacingHorizontalXXS)] pointer-events-none z-1">
            {props.novel.x_restrict > 0 && (
              <fluent-badge
                appearance="filled"
                color={props.novel.x_restrict === 1 ? "danger" : "warning"}
              >
                {props.novel.x_restrict === 1 ? "R-18" : "R-18G"}
              </fluent-badge>
            )}
            {props.novel.novel_ai_type != null && props.novel.novel_ai_type > 1 && (
              <fluent-badge appearance="filled">
                {props.novel.novel_ai_type === 2 ? "AI" : "AI辅助"}
              </fluent-badge>
            )}
          </div>
        </div>

        {/* Info area */}
        <div class="flex-1 min-w-0 flex flex-col gap-[var(--spacingVerticalXS)]">
          <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] line-clamp-3 leading-tight">
            {props.novel.title}
          </p>
          <button
            class="bg-transparent border-none p-0 cursor-pointer text-[var(--colorNeutralForeground2)] hover:text-[var(--colorBrandForeground1)] hover:underline truncate text-left min-h-[40px] flex items-center active:scale-[0.98] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
            onClick={(e) => {
              e.stopPropagation();
              props.onAuthorClick?.(props.novel.user.id);
            }}
          >
            @{props.novel.user.name}
          </button>
          <div class="flex items-center gap-[var(--spacingHorizontalS)] text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
            <span>{props.novel.total_bookmarks}</span>
            {props.novel.page_count > 1 && (
              <span class="flex items-center gap-[var(--spacingHorizontalXXS)]">
                <span aria-hidden="true">·</span>
                <span>{props.novel.page_count}p</span>
              </span>
            )}
          </div>
          <IllustTags tags={props.novel.tags} size="small" class="max-h-[54px] overflow-hidden" />
          <div class="flex items-center gap-[var(--spacingHorizontalS)] text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
            <span>{props.novel.text_length.toLocaleString()}字</span>
            {props.novel.series?.title && (
              <button
                class="inline-flex items-center bg-transparent border-none p-0 cursor-pointer text-[var(--colorBrandForeground1)] hover:text-[var(--colorBrandForegroundLinkHover)] [font-size:var(--fontSizeBase100)]"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSeriesClick?.(props.novel.series!.id!);
                }}
                aria-label={`查看系列: ${props.novel.series.title}`}
              >
                <span aria-hidden="true">·</span>
                <span class="ml-[var(--spacingHorizontalXXS)] truncate max-w-[100px]">
                  {props.novel.series.title}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Bookmark button */}
        <div class="flex-shrink-0 self-start">
          <button
            class="min-w-10 min-h-10 flex items-center justify-center rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralBackground2)] text-sm transition-all active:scale-90 select-none border-none cursor-pointer hover:bg-[var(--colorNeutralBackground3)]"
            classList={{
              "text-[var(--colorStatusDangerForeground1)]": bookmarked(),
              "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorStatusDangerBackground1)]":
                !bookmarked(),
            }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = 0 as any;
              }
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={bookmarked() ? "取消收藏" : "收藏"}
          >
            <HeartIcon filled={bookmarked()} size={16} />
          </button>
          <HeartBurstEffect trigger={bookmarkBurstTrigger} size={80} particleCount={6} />
        </div>
      </div>

      {/* Private bookmark toast */}
      {privateHint() && (
        <div class="absolute inset-0 flex items-center justify-center bg-[var(--colorOverlayBackground)] rounded-[var(--borderRadiusMedium)] pointer-events-none z-10">
          <span class="text-[var(--colorOverlayForeground)] [font-size:var(--fontSizeBase200)] font-medium">
            已私密收藏
          </span>
        </div>
      )}
    </div>
  );
};

/** 小说封面墙卡片 — 封面在上，文字信息在下，2列排布 */
export const NovelCoverCard: Component<Props> = (props) => {
  const [bookmarked, setBookmarked] = createSignal(props.novel.is_bookmarked);
  const [bookmarkBurstTrigger, setBookmarkBurstTrigger] = createSignal(0);
  const [privateHint, setPrivateHint] = createSignal(false);
  let hintTimer: ReturnType<typeof setTimeout>;

  const showPrivateToast = () => {
    setPrivateHint(true);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setPrivateHint(false), 1500);
  };

  const toggleBookmark = async (e: MouseEvent, privateBookmark = false) => {
    e.stopPropagation();
    try {
      if (bookmarked()) {
        await deleteBookmark(props.novel.id);
        setBookmarked(false);
      } else {
        await addBookmark(props.novel.id, privateBookmark ? "private" : "public");
        setBookmarked(true);
        setBookmarkBurstTrigger((n) => n + 1);
        if (privateBookmark) {
          showPrivateToast();
        }
      }
    } catch {
      /* Silently fail */
    }
  };

  let longPressTimer: ReturnType<typeof setTimeout>;

  const onPointerDown = (e: PointerEvent) => {
    longPressTimer = setTimeout(() => {
      toggleBookmark(e as any, true);
      longPressTimer = 0 as any;
    }, 500);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0 as any;
      toggleBookmark(e as any, false);
    }
  };

  const tags = () => {
    const t = props.novel.tags;
    const visible = t.slice(0, 2);
    const overflow = t.length - 2;
    return { visible, overflow };
  };

  return (
    <div
      class="relative surface-card cursor-pointer active:scale-[0.98] flex flex-col h-full"
      onClick={() => props.onClick(props.novel.id)}
    >
      {/* Cover image — square, fills card width */}
      <div class="relative w-full aspect-square rounded-[var(--borderRadiusSmall)] overflow-hidden">
        <img
          src={resolveImageUrl(props.novel.image_urls.square_medium)}
          alt={props.novel.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
        {/* Badge group — 左上角 */}
        <div class="absolute top-[var(--spacingVerticalXXS)] left-[var(--spacingHorizontalXXS)] flex items-center gap-[var(--spacingHorizontalXXS)] pointer-events-none z-1">
          {props.novel.x_restrict > 0 && (
            <fluent-badge
              appearance="filled"
              color={props.novel.x_restrict === 1 ? "danger" : "warning"}
            >
              {props.novel.x_restrict === 1 ? "R-18" : "R-18G"}
            </fluent-badge>
          )}
          {props.novel.novel_ai_type != null && props.novel.novel_ai_type > 1 && (
            <fluent-badge appearance="filled">
              {props.novel.novel_ai_type === 2 ? "AI" : "AI辅助"}
            </fluent-badge>
          )}
        </div>
        {/* Bookmark button — 右下角 */}
        <div class="absolute bottom-[var(--spacingVerticalXS)] right-[var(--spacingHorizontalXS)] z-1">
          <button
            class="min-w-10 min-h-10 flex items-center justify-center rounded-full bg-[var(--colorOverlaySurface)] backdrop-blur-sm text-sm transition-all active:scale-90 select-none border-none cursor-pointer"
            classList={{
              "text-[var(--colorStatusDangerForeground1)]": bookmarked(),
              "text-[var(--colorNeutralForegroundOnBrand)] hover:text-[var(--colorStatusDangerBackground1)]":
                !bookmarked(),
            }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = 0 as any;
              }
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={bookmarked() ? "取消收藏" : "收藏"}
          >
            <HeartIcon filled={bookmarked()} size={16} />
          </button>
          <HeartBurstEffect trigger={bookmarkBurstTrigger} size={60} particleCount={6} />
        </div>
      </div>

      {/* Info area — 封面下方 */}
      <div class="flex flex-col gap-[var(--spacingVerticalXS)] p-[var(--spacingHorizontalM)] flex-1 min-w-0">
        <p class="[font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] line-clamp-2 leading-tight">
          {props.novel.title}
        </p>
        <div class="flex items-center gap-[var(--spacingHorizontalXS)] text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
          <span>{props.novel.page_count || 1}p</span>
          <span aria-hidden="true">·</span>
          <span>{props.novel.total_bookmarks}</span>
        </div>
        <button
          class="bg-transparent border-none p-0 cursor-pointer text-[var(--colorBrandForeground1)] hover:underline truncate text-left min-h-[40px] flex items-center [font-size:var(--fontSizeBase200)] active:scale-[0.98] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
          onClick={(e) => {
            e.stopPropagation();
            props.onAuthorClick?.(props.novel.user.id);
          }}
        >
          @{props.novel.user.name}
        </button>
        <div class="flex items-center gap-[var(--spacingHorizontalXXS)] flex-wrap min-w-0 overflow-hidden">
          <For each={tags().visible}>
            {(tag) => (
              <SearchableTag
                name={tag.name}
                translatedName={tag.translated_name}
                class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] bg-[var(--colorNeutralBackground2)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] truncate max-w-[80px] hover:bg-[var(--colorNeutralBackground2Hover)]"
              />
            )}
          </For>
          {tags().overflow > 0 && (
            <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
              +{tags().overflow}
            </span>
          )}
        </div>
        {props.novel.series?.title && (
          <button
            class="self-start inline-flex items-center bg-transparent border-none p-0 cursor-pointer mt-[var(--spacingVerticalXXS)] w-full overflow-hidden text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase100)] hover:text-[var(--colorBrandForegroundLinkHover)]"
            onClick={(e) => {
              e.stopPropagation();
              props.onSeriesClick?.(props.novel.series!.id!);
            }}
            aria-label={`查看系列: ${props.novel.series.title}`}
          >
            <fluent-badge
              appearance="subtle"
              class="[font-size:var(--fontSizeBase100)] truncate max-w-full"
            >
              {props.novel.series.title}
            </fluent-badge>
          </button>
        )}
      </div>

      {/* Private bookmark toast */}
      {privateHint() && (
        <div class="absolute inset-0 flex items-center justify-center bg-[var(--colorOverlayBackground)] rounded-[var(--borderRadiusMedium)] pointer-events-none z-10">
          <span class="text-[var(--colorOverlayForeground)] [font-size:var(--fontSizeBase200)] font-medium">
            已私密收藏
          </span>
        </div>
      )}
    </div>
  );
};

export default NovelCard;
