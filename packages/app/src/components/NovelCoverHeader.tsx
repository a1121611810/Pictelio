import type { Component } from "solid-js";
import type { PixivNovel } from "@/api/types";
import { resolveImageUrl } from "../utils/imageLoader";
import PixivImage from "./PixivImage";
import SearchableTag from "./SearchableTag";

// ── 小说封面区域：封面图、标题、作者、系列、标签、统计 ──

interface NovelCoverHeaderProps {
  novel: PixivNovel;
  onAuthorClick: () => void;
  onSeriesClick: () => void;
  onCommentsClick: () => void;
  onTitleRef?: (el: HTMLHeadingElement) => void;
}

const NovelCoverHeader: Component<NovelCoverHeaderProps> = (props) => {
  function handleTitleRef(el: HTMLHeadingElement) {
    props.onTitleRef?.(el);
  }

  return (
    <div class="bg-[var(--colorNeutralBackground1)]">
      <div class="relative w-full aspect-[16/9] max-h-64 overflow-hidden">
        <PixivImage
          src={resolveImageUrl(props.novel.image_urls.large)}
          alt={props.novel.title}
          width={1200}
          height={675}
          loading="eager"
          class="w-full h-full object-cover"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[var(--colorNeutralBackground1)] to-transparent" />
      </div>

      <div class="px-4 pb-4 -mt-8 relative z-1">
        <h1
          ref={handleTitleRef}
          class="[font-size:var(--fontSizeBase500)] font-bold text-[var(--colorNeutralForeground1)] leading-tight mb-1"
        >
          {props.novel.title}
        </h1>
        <button
          class="[font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] hover:underline bg-transparent border-none p-0 cursor-pointer"
          onClick={() => props.onAuthorClick()}
        >
          @{props.novel.user.name}
        </button>

        <Show when={props.novel.series?.id}>
          <button
            class="[font-size:var(--fontSizeBase100)] text-[var(--colorBrandForeground1)] mt-1 bg-transparent border-none p-0 cursor-pointer hover:underline focus-visible:outline focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:-outline-offset-2"
            onClick={() => props.onSeriesClick()}
            aria-label={`打开系列目录：${props.novel.series?.title ?? ""}`}
          >
            系列：{props.novel.series?.title}
          </button>
        </Show>

        {/* Tags */}
        <div class="flex flex-wrap gap-1.5 mt-2">
          <For each={props.novel.tags}>
            {(tag) => (
              <SearchableTag
                name={tag.name}
                translatedName={tag.translated_name}
                class="[font-size:var(--fontSizeBase100)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusSmall)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2Hover)]"
              />
            )}
          </For>
        </div>

        {/* Stats row */}
        <div class="flex items-center gap-3 mt-2 text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
          <span>📖 {props.novel.text_length.toLocaleString()}字</span>
          <span>⭐ {props.novel.total_bookmarks}</span>
          <Show when={props.novel.total_comments != null}>
            <span
              class="flex items-center gap-1 cursor-pointer hover:text-[var(--colorBrandForeground1)] transition-colors"
              onClick={() => props.onCommentsClick()}
            >
              💬 {props.novel.total_comments}
            </span>
          </Show>
          <Show when={props.novel.total_view != null}>
            <span>👁 {props.novel.total_view}</span>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default NovelCoverHeader;
