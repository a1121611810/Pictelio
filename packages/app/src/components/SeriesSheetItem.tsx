import type { Component } from "solid-js";
import { mergeProps, Show } from "solid-js";
import type { PixivNovel } from "../api/types";
import { resolveImageUrl } from "../utils/imageLoader";
import IllustTags from "./IllustTags";

interface Props {
  novel: PixivNovel;
  isActive?: boolean;
  ref?: (el: HTMLElement) => void;
  onClick: (id: number) => void;
}

/**
 * 系列目录行项目（A2 深化）：
 * 圆角行 + hover 反馈；选中态 = 淡品牌圆角背景 + 圆角胶囊指示条 + 右侧「当前」徽标
 * + 品牌色标题；封面 56×56（Medium 圆角）。
 */
const SeriesSheetItem: Component<Props> = (props) => {
  const merged = mergeProps({ isActive: false }, props);

  return (
    <div
      ref={merged.ref}
      class="flex items-center gap-3 px-3 py-3 rounded-[var(--borderRadiusMedium)] cursor-pointer active:scale-[0.98] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:-outline-offset-2"
      classList={{
        "bg-[var(--colorBrandBackground2)]": merged.isActive,
        "hover:bg-[var(--colorNeutralBackground2)]": !merged.isActive,
      }}
      onClick={() => merged.onClick(merged.novel.id)}
      role="button"
      tabIndex={0}
      aria-label={merged.isActive ? `当前章节：${merged.novel.title}` : merged.novel.title}
      onKeyDown={(e) => e.key === "Enter" && merged.onClick(merged.novel.id)}
    >
      {/* Active indicator — 圆角胶囊指示条 */}
      <Show when={merged.isActive}>
        <div class="w-1.5 h-12 flex-shrink-0 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandForeground1)]" />
      </Show>

      {/* Cover — 56×56（A2：Medium 圆角） */}
      <div class="w-14 h-14 flex-shrink-0 rounded-[var(--borderRadiusMedium)] overflow-hidden bg-[var(--colorNeutralBackground2)]">
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

      {/* 当前章节徽标 */}
      <Show when={merged.isActive}>
        <span class="flex-shrink-0 px-2 py-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandForeground1)] text-[var(--colorNeutralForegroundOnBrand)] [font-size:var(--fontSizeBase100)] font-semibold whitespace-nowrap">
          当前
        </span>
      </Show>
    </div>
  );
};

export default SeriesSheetItem;
