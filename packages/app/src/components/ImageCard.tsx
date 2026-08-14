import type { Component } from "solid-js";
import type { PixivIllust } from "../api/types";
import { listQuality } from "../stores/settingsStore";
import PixivImage from "./PixivImage";
import HeartBurstEffect from "./HeartBurstEffect";
import HeartIcon from "./ui/HeartIcon";
import IllustTags from "./IllustTags";
import SkeletonShimmer from "./SkeletonShimmer";
import { resolveImageUrl } from "../utils/imageLoader";
import { useCardInteractions } from "../primitives/useCardInteractions";

function resolveUrl(illust: PixivIllust): string {
  const q = listQuality();
  if (q === "medium") {
    return illust.image_urls.medium;
  }
  if (q === "large") {
    return illust.image_urls.large;
  }
  // Original: use original_image_url if available, otherwise fallback to large
  return illust.meta_single_page?.original_image_url ?? illust.image_urls.large;
}

interface Props {
  illust: PixivIllust;
  onClick: (id: number) => void;
  onAuthorClick?: (userId: number) => void;
}

const ImageCard: Component<Props> = (props) => {
  const img = () => resolveUrl(props.illust);
  const w = () => props.illust.width;
  const h = () => props.illust.height;
  const isUgoira = () => props.illust.type === "ugoira";
  const {
    bookmarked,
    isFollowed,
    following,
    toggleFollow,
    bookmarkBurstTrigger,
    privateHint,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
  } = useCardInteractions(props.illust);
  const [thumbLoaded, setThumbLoaded] = createSignal(false);
  const [mainLoaded, setMainLoaded] = createSignal(false);

  return (
    <div
      data-testid="illust-card"
      class="image-card surface-card"
      onClick={() => props.onClick(props.illust.id)}
    >
      <div class="relative overflow-hidden">
        {/* Skeleton overlay — 缩略图加载完成后淡出 */}
        <SkeletonShimmer
          class="absolute inset-0 z-0 pointer-events-none rounded-[var(--borderRadiusMedium)] transition-opacity duration-[var(--durationUltraSlow)] ease-[var(--curveEasyEase)]"
          classList={{ "opacity-0": thumbLoaded() }}
        />
        {/* Blur-up thumbnail */}
        <img
          src={resolveImageUrl(props.illust.image_urls.square_medium)}
          alt=""
          class="absolute inset-0 w-full h-full object-cover blur-lg scale-110 pointer-events-none transition-opacity duration-[var(--durationUltraSlow)] ease-[var(--curveEasyEase)] z-1"
          classList={{ "opacity-0": mainLoaded() }}
          onLoad={() => setThumbLoaded(true)}
          onError={() => setThumbLoaded(true)}
        />
        {isUgoira() ? (
          <div style={{ "aspect-ratio": "1 / 1" }} class="overflow-hidden z-2 relative">
            <PixivImage
              src={img()}
              alt={props.illust.title}
              width={w()}
              height={h()}
              loading="lazy"
              class="w-full h-full object-cover object-top"
              onLoad={() => setMainLoaded(true)}
              hideLoadingPlaceholder
            />
          </div>
        ) : (
          <PixivImage
            src={img()}
            alt={props.illust.title}
            width={w()}
            height={h()}
            loading="lazy"
            class="w-full h-auto block relative z-2"
            onLoad={() => setMainLoaded(true)}
            hideLoadingPlaceholder
          />
        )}
        {isUgoira() && (
          <div class="absolute top-[var(--spacingVerticalXS)] right-[var(--spacingHorizontalXS)] z-10">
            <fluent-badge appearance="filled">动图</fluent-badge>
          </div>
        )}
        {/* Badge group — 左上角 */}
        <div class="absolute top-[var(--spacingVerticalXS)] left-[var(--spacingHorizontalXS)] flex items-center gap-[var(--spacingHorizontalXXS)] pointer-events-none select-none z-10">
          {props.illust.x_restrict === 1 && (
            <fluent-badge appearance="filled" color="danger">
              R-18
            </fluent-badge>
          )}
          {props.illust.x_restrict === 2 && (
            <fluent-badge appearance="filled" color="warning">
              R-18G
            </fluent-badge>
          )}
          {props.illust.illust_ai_type != null && props.illust.illust_ai_type > 1 && (
            <fluent-badge appearance="filled">
              {props.illust.illust_ai_type === 2 ? "AI" : "AI辅助"}
            </fluent-badge>
          )}
        </div>
        {props.illust.page_count > 1 && (
          <div class="absolute bottom-[var(--spacingVerticalXS)] left-[var(--spacingHorizontalXS)] z-10">
            <fluent-badge appearance="subtle">{props.illust.page_count}p</fluent-badge>
          </div>
        )}
        {/* Bookmark heart — 右下角 */}
        <div class="absolute bottom-[var(--spacingVerticalXS)] right-[var(--spacingHorizontalXS)]">
          <button
            class="min-w-10 min-h-10 flex items-center justify-center rounded-full bg-[var(--colorOverlaySurface)] backdrop-blur-sm text-sm transition-all active:scale-90 select-none border-none cursor-pointer"
            classList={{
              "text-[var(--colorStatusDangerForeground1)]": bookmarked(),
              "text-[var(--colorNeutralForegroundOnBrand)] hover:text-[var(--colorStatusDangerBackground1)]":
                !bookmarked(),
            }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onClick={(e) => e.stopPropagation()}
            aria-label={bookmarked() ? "取消收藏" : "收藏"}
          >
            <HeartIcon filled={bookmarked()} size={16} />
          </button>
          <HeartBurstEffect trigger={bookmarkBurstTrigger} size={80} particleCount={6} />
        </div>
        {privateHint() && (
          <div class="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none z-10">
            <span class="text-white [font-size:var(--fontSizeBase200)] font-medium">
              已私密收藏
            </span>
          </div>
        )}
      </div>
      {/* Info area — A2 宽松 padding（ADR-0070） */}
      <div class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)]">
        <p
          data-testid="illust-title"
          class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)] truncate"
        >
          {props.illust.title}
        </p>
        <p class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground2)] truncate mt-[var(--spacingVerticalXXS)] flex items-baseline gap-[var(--spacingHorizontalXS)]">
          <button
            class="bg-transparent border-none p-0 cursor-pointer text-[var(--colorNeutralForeground2)] hover:text-[var(--colorBrandForeground1)] hover:underline truncate min-h-[40px] flex items-center active:scale-[0.98] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
            onClick={(e) => {
              e.stopPropagation();
              props.onAuthorClick?.(props.illust.user.id);
            }}
          >
            @{props.illust.user.name}
          </button>
          <span class="text-[var(--colorNeutralForegroundDisabled)] flex-shrink-0 select-none">
            ·
          </span>
          <button
            class="inline-flex items-center min-h-[40px] font-semibold [font-size:var(--fontSizeBase100)] cursor-pointer select-none transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.95] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] appearance-none border-none bg-transparent p-0 flex-shrink-0"
            classList={{
              "text-[var(--colorBrandForeground1)] hover:text-[var(--colorBrandForegroundLinkHover)]":
                !isFollowed(),
              "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorStatusDangerForeground1)]":
                isFollowed(),
            }}
            onClick={(e) => toggleFollow(e)}
            disabled={following()}
            aria-label={isFollowed() ? "取消关注" : "关注"}
          >
            {following() ? "关注中…" : isFollowed() ? "已关注" : "关注"}
          </button>
        </p>
        <div class="mt-[var(--spacingVerticalXS)] max-h-[54px] overflow-hidden">
          <IllustTags tags={props.illust.tags} size="small" />
        </div>
      </div>
    </div>
  );
};

export default ImageCard;
