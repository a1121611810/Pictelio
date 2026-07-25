import { type Component, createSignal } from "solid-js";
import type { PixivIllust } from "../api/types";
import { listQuality } from "../stores/settingsStore";
import PixivImage from "./PixivImage";
import HeartBurstEffect from "./HeartBurstEffect";
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
  return illust.meta_single_page?.original_image_url ?? illust.image_urls.large;
}

interface Props {
  illust: PixivIllust;
  onClick: (id: number) => void;
}

const GridCard: Component<Props> = (props) => {
  const img = () => resolveUrl(props.illust);
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
      class="image-card surface-card h-full flex flex-col cursor-pointer"
      onClick={() => props.onClick(props.illust.id)}
    >
      {/* Thumbnail — fixed height, object-cover cropped */}
      <div class="relative flex-1 overflow-hidden rounded-[var(--borderRadiusMedium)] min-h-0">
        {/* Skeleton overlay — 图片结构已渲染但缩略图尚未加载成功时占位 */}
        <SkeletonShimmer
          class="absolute inset-0 z-0 pointer-events-none transition-opacity duration-[var(--durationUltraSlow)] ease-[var(--curveEasyEase)]"
          classList={{ "opacity-0": thumbLoaded() }}
        />
        {/* Blur-up placeholder */}
        <img
          src={resolveImageUrl(props.illust.image_urls.square_medium)}
          alt=""
          class="absolute inset-0 w-full h-full object-cover blur-lg scale-110 pointer-events-none z-1 transition-opacity duration-[var(--durationUltraSlow)] ease-[var(--curveEasyEase)]"
          classList={{ "opacity-0": mainLoaded() }}
          onLoad={() => setThumbLoaded(true)}
          onError={() => setThumbLoaded(true)}
        />
        <PixivImage
          src={img()}
          alt={props.illust.title}
          width={props.illust.width}
          height={props.illust.height}
          loading="lazy"
          class="absolute inset-0 w-full h-full object-cover z-2"
          onLoad={() => setMainLoaded(true)}
          hideLoadingPlaceholder
        />
        {/* Badges — top-left */}
        <div class="absolute top-1 left-1 flex items-center gap-[var(--spacingHorizontalXXS)] pointer-events-none select-none z-10 flex-wrap">
          {props.illust.x_restrict === 1 && (
            <fluent-badge
              appearance="filled"
              color="danger"
              style="font-size:var(--fontSizeBase100)"
            >
              R-18
            </fluent-badge>
          )}
          {props.illust.x_restrict === 2 && (
            <fluent-badge
              appearance="filled"
              color="warning"
              style="font-size:var(--fontSizeBase100)"
            >
              R-18G
            </fluent-badge>
          )}
          {props.illust.illust_ai_type != null && props.illust.illust_ai_type > 1 && (
            <fluent-badge appearance="filled" style="font-size:var(--fontSizeBase100)">
              {props.illust.illust_ai_type === 2 ? "AI" : "AI辅"}
            </fluent-badge>
          )}
        </div>
        {/* Multi-page indicator */}
        {props.illust.page_count > 1 && (
          <div class="absolute bottom-1 left-1 z-10">
            <fluent-badge appearance="subtle" style="font-size:var(--fontSizeBase100)">
              📄 {props.illust.page_count}
            </fluent-badge>
          </div>
        )}
        {/* Bookmark heart — bottom-right */}
        <div class="absolute bottom-1 right-1">
          <button
            class="min-w-10 min-h-10 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-xs transition-all active:scale-90 select-none"
            classList={{
              "text-red-400": bookmarked(),
              "text-white/70 hover:text-red-300": !bookmarked(),
            }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onClick={(e) => e.stopPropagation()}
            aria-label={bookmarked() ? "取消收藏" : "收藏"}
          >
            {bookmarked() ? "♥" : "♡"}
          </button>
          <HeartBurstEffect trigger={bookmarkBurstTrigger} size={60} particleCount={4} />
        </div>
        {privateHint() && (
          <div class="absolute inset-0 flex items-center justify-center bg-black/60 rounded-[var(--borderRadiusMedium)] pointer-events-none z-10">
            <span class="text-white [font-size:var(--fontSizeBase100)] font-medium">已私密</span>
          </div>
        )}
      </div>
      {/* Info bar — matches ImageCard styling */}
      <div class="p-2.5">
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground1)] truncate font-semibold">
          {props.illust.title}
        </p>
        <p class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground2)] truncate mt-0.5 flex items-baseline gap-1">
          <span class="truncate">@{props.illust.user.name}</span>
          <span class="text-[var(--colorNeutralForegroundDisabled)] flex-shrink-0 select-none">
            ·
          </span>
          <button
            class="inline-flex items-center min-h-[40px] font-semibold [font-size:var(--fontSizeBase100)] cursor-pointer select-none transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.95] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] appearance-none border-none bg-transparent p-0 flex-shrink-0"
            classList={{
              "text-[var(--colorBrandForeground1)] hover:text-[var(--colorBrandForeground1Hover)]":
                !isFollowed(),
              "text-[var(--colorNeutralForeground3)] hover:text-[var(--colorStatusDangerForeground2)]":
                isFollowed(),
            }}
            onClick={toggleFollow}
            disabled={following()}
            aria-label={isFollowed() ? "取消关注" : "关注"}
          >
            {following() ? "…" : isFollowed() ? "已关注" : "关注"}
          </button>
        </p>
      </div>
    </div>
  );
};

export default GridCard;
