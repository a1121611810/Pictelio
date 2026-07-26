import type { Component } from "solid-js";
import type { PixivNovel } from "../api/types";
import { resolveImageUrl } from "../utils/imageLoader";
import IllustTags from "./IllustTags";

interface Props {
  novel: PixivNovel;
  isActive?: boolean;
  ref?: (el: HTMLElement) => void;
  onClick: (id: number) => void;
}

const SeriesSheetItem: Component<Props> = (props) => {
  const merged = mergeProps({ isActive: false }, props);

  return (
    <div
      ref={merged.ref}
      class="flex items-center gap-3 px-5 py-2.5 cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:-outline-offset-2"
      classList={{
        "bg-[var(--colorBrandBackground2)]": merged.isActive,
      }}
      onClick={() => merged.onClick(merged.novel.id)}
      role="button"
      tabIndex={0}
      aria-label={merged.isActive ? `当前章节：${merged.novel.title}` : merged.novel.title}
      onKeyDown={(e) => e.key === "Enter" && merged.onClick(merged.novel.id)}
    >
      {/* Active indicator */}
      <Show when={merged.isActive}>
        <div class="w-1 h-14 flex-shrink-0 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandForeground1)]" />
      </Show>

      {/* Cover — 64x64 */}
      <div class="w-16 h-16 flex-shrink-0 rounded-[var(--borderRadiusSmall)] overflow-hidden bg-[var(--colorNeutralBackground2)]">
        <img
          src={resolveImageUrl(props.novel.image_urls.square_medium)}
          alt={props.novel.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      {/* Info */}
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <p
          class="[font-size:var(--fontSizeBase200)] font-semibold line-clamp-2 leading-tight"
          classList={{
            "text-[var(--colorBrandForeground1)]": merged.isActive,
            "text-[var(--colorNeutralForeground1)]": !merged.isActive,
          }}
        >
          {props.novel.title}
        </p>
        <p class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)] flex items-center gap-1">
          <span>📖 {props.novel.text_length.toLocaleString()}字</span>
        </p>
        {/* 标签 */}
        <div class="mt-1">
          <IllustTags tags={props.novel.tags} size="small" class="gap-1" />
        </div>
      </div>
    </div>
  );
};

export default SeriesSheetItem;
