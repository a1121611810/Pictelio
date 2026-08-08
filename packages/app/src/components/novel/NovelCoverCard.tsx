import type { Component } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { PixivNovel } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import PixivImage from "../PixivImage";
import SearchableTag from "../SearchableTag";

interface NovelCoverCardProps {
  novel: PixivNovel;
  onAuthorClick: () => void;
  onSeriesClick: () => void;
  onCommentsClick: () => void;
  onTitleRef: (el: HTMLHeadingElement) => void;
}

/**
 * 封面信息区 A2 卡片（用户定稿）：
 * 默认紧凑横条（左缩略右信息）；展开为 hero 卡（16:9 封面通边 + 下方完整信息区）。
 * 切换：卡片底部中间半嵌箭头按钮（一半在模块外，SVG chevron 旋转 180°）。
 * 动画：双行独立折叠——收起=compact 行完整（hero 行 0 高+全透明不可见），
 * 展开=compact 行折叠消失（0 高+全透明）、hero 行完整；max-height+opacity 过渡。
 */
const NovelCoverCard: Component<NovelCoverCardProps> = (props) => {
  const n = () => props.novel;
  const [expanded, setExpanded] = createSignal(false);

  let compactEl: HTMLDivElement | undefined;
  let heroEl: HTMLDivElement | undefined;
  // 经验兜底：测量失败（图片未加载等）时保证内容不被裁剪
  let compactH = 120;
  let heroH = 480;

  function measure() {
    if (compactEl?.offsetHeight) compactH = compactEl.offsetHeight;
    if (heroEl?.offsetHeight) heroH = heroEl.offsetHeight;
  }

  onMount(() => {
    // 初始测量 + 内容变化（字体加载/换行/图片加载）后 ResizeObserver 重测
    requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    if (compactEl) ro.observe(compactEl);
    if (heroEl) ro.observe(heroEl);
    onCleanup(() => ro.disconnect());
  });

  // ── compact 形态（左缩略右信息）──
  const compactForm = (
    <div class="flex items-center gap-4 px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)]">
      <PixivImage
        src={resolveImageUrl(n().image_urls.large)}
        alt={n().title}
        width={240}
        height={180}
        loading="eager"
        class="w-24 h-20 rounded-[var(--borderRadiusMedium)] object-cover flex-shrink-0"
      />
      <div class="min-w-0 flex-1">
        <h1
          ref={props.onTitleRef}
          class="[font-size:var(--fontSizeBase400)] font-bold text-[var(--colorNeutralForeground1)] leading-tight mb-1 truncate"
        >
          {n().title}
        </h1>
        <button
          class="[font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] hover:underline bg-transparent border-none p-0 cursor-pointer"
          onClick={() => props.onAuthorClick()}
        >
          @{n().user.name}
        </button>
        <NovelStats novel={n()} onCommentsClick={props.onCommentsClick} />
      </div>
    </div>
  );

  // ── hero 形态（封面通边 + 下方完整信息区）──
  const heroForm = (
    <div>
      <div class="relative w-full aspect-[16/9] rounded-t-[var(--borderRadiusXLarge)] overflow-hidden">
        <PixivImage
          src={resolveImageUrl(n().image_urls.large)}
          alt={n().title}
          width={1200}
          height={675}
          loading="eager"
          class="w-full h-full object-cover"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[var(--colorNeutralBackground1)] to-transparent" />
      </div>
      <div class="px-[var(--spacingHorizontalL)] pb-[var(--spacingVerticalL)] -mt-6 relative z-1">
        <h1 class="[font-size:var(--fontSizeBase500)] font-bold text-[var(--colorNeutralForeground1)] leading-tight mb-1">
          {n().title}
        </h1>
        <button
          class="[font-size:var(--fontSizeBase200)] text-[var(--colorBrandForeground1)] hover:underline bg-transparent border-none p-0 cursor-pointer"
          onClick={() => props.onAuthorClick()}
        >
          @{n().user.name}
        </button>
        <Show when={n().series?.id}>
          <button
            class="[font-size:var(--fontSizeBase100)] text-[var(--colorBrandForeground1)] mt-1 bg-transparent border-none p-0 cursor-pointer hover:underline"
            onClick={() => props.onSeriesClick()}
            aria-label={`打开系列目录：${n().series?.title ?? ""}`}
          >
            系列：{n().series?.title}
          </button>
        </Show>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <For each={n().tags}>
            {(tag) => (
              <SearchableTag
                name={tag.name}
                translatedName={tag.translated_name}
                class="[font-size:var(--fontSizeBase100)] px-[var(--spacingHorizontalXS)] py-[var(--spacingVerticalXXS)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2Hover)]"
              />
            )}
          </For>
        </div>
        <NovelStats novel={n()} onCommentsClick={props.onCommentsClick} />
      </div>
    </div>
  );

  return (
    <Show when={n()}>
      <div>
        {/* 双行独立折叠：收起=compact 完整（hero 不可见）；展开=compact 折叠、hero 完整 */}
        <div
          class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)]"
          style={{ overflow: "visible" }}
        >
          <div
            style={{
              "max-height": expanded() ? "0px" : `${compactH + 4}px`,
              opacity: expanded() ? 0 : 1,
              transition:
                "max-height var(--durationGentle) var(--curveEasyEase), opacity var(--durationFast) var(--curveEasyEase)",
              overflow: "hidden",
            }}
          >
            <div ref={compactEl}>{compactForm}</div>
          </div>
          <div
            style={{
              "max-height": expanded() ? `${heroH + 4}px` : "0px",
              opacity: expanded() ? 1 : 0,
              transition:
                "max-height var(--durationGentle) var(--curveEasyEase), opacity var(--durationFast) var(--curveEasyEase)",
              overflow: "hidden",
              "pointer-events": expanded() ? "auto" : "none",
            }}
          >
            <div ref={heroEl}>{heroForm}</div>
          </div>
        </div>

        {/* 半嵌箭头按钮：一半在卡片内一半在模块外 */}
        <div class="relative z-10 flex justify-center" style={{ "margin-top": "-1.25rem" }}>
          <button
            type="button"
            class="w-10 h-10 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] shadow-[var(--elevation4)] flex items-center justify-center text-[var(--colorNeutralForeground2)] hover:text-[var(--colorBrandForeground1)] hover:border-[var(--colorBrandStroke1)] active:scale-90 transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] appearance-none outline-none cursor-pointer focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded() ? "收起封面" : "展开封面"}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              style={{
                transform: expanded() ? "rotate(180deg)" : "none",
                transition: "transform var(--durationGentle) var(--curveEasyEase)",
              }}
              aria-hidden="true"
            >
              <path
                d="M5.22 8.47a.75.75 0 0 1 1.06 0L12 14.19l5.72-5.72a.75.75 0 1 1 1.06 1.06l-6.25 6.25a.75.75 0 0 1-1.06 0L5.22 9.53a.75.75 0 0 1 0-1.06z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
    </Show>
  );
};

/** 小说统计行（字数/收藏/评论/浏览） */
const NovelStats: Component<{ novel: PixivNovel; onCommentsClick: () => void }> = (props) => {
  const n = () => props.novel;
  return (
    <Show when={n()}>
      <div class="flex items-center gap-3 mt-2 text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
        <span>📖 {n().text_length.toLocaleString()}字</span>
        <span>⭐ {n().total_bookmarks}</span>
        <Show when={n().total_comments != null}>
          <span
            class="flex items-center gap-1 cursor-pointer hover:text-[var(--colorBrandForeground1)] transition-colors"
            onClick={() => props.onCommentsClick()}
          >
            💬 {n().total_comments}
          </span>
        </Show>
        <Show when={n().total_view != null}>
          <span>👁 {n().total_view}</span>
        </Show>
      </div>
    </Show>
  );
};

export default NovelCoverCard;
