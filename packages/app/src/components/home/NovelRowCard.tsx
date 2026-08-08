/**
 * NovelRowCard — 小说单列行卡（首页 L5 布局正式版）。
 *
 * 视觉：左 56px 圆角封面缩略 + 「系列」徽标；右 标题 / 作者 / ★收藏·字数。
 * A2 规范（ADR-0074）：Large 圆角、NeutralBackground1 底、1px NeutralStroke1 边框、
 * 无阴影、hover 背景高亮、active 轻微缩放。
 * 可访问性：role="button" + tabIndex=0 + Enter 键触发 onClick。
 */
import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { PixivNovel } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";

interface NovelRowCardProps {
  /** 小说数据 */
  novel: PixivNovel;
  /** 点击 / 回车回调 */
  onClick: () => void;
}

const NovelRowCard: Component<NovelRowCardProps> = (props) => {
  // 封面 URL：优先大图，依次回退中图、方形缩略图
  const cover = () =>
    props.novel.image_urls.large ??
    props.novel.image_urls.medium ??
    props.novel.image_urls.square_medium;

  return (
    <div
      class="flex cursor-pointer items-center gap-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] p-[var(--spacingHorizontalM)] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      {/* 封面缩略图 + 系列徽标 */}
      <div class="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
        <img
          src={resolveImageUrl(cover())}
          alt={props.novel.title}
          class="h-full w-full object-cover"
          loading="lazy"
        />
        <Show when={props.novel.series}>
          <span
            class="absolute left-[var(--strokeWidthThin)] top-[var(--strokeWidthThin)] rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalXXS)] font-bold [font-size:var(--fontSizeBase100)]"
            style={{
              background: "var(--colorBrandBackground)",
              color: "var(--colorNeutralForegroundOnBrand)",
            }}
          >
            系列
          </span>
        </Show>
      </div>

      {/* 标题 / 作者 / 统计 */}
      <div class="min-w-0 flex-1">
        <p class="truncate text-[var(--colorNeutralForeground1)] font-semibold leading-[var(--lineHeightBase300)] [font-size:var(--fontSizeBase300)]">
          {props.novel.title}
        </p>
        <p class="mt-[var(--spacingVerticalXXS)] truncate text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
          {props.novel.user.name}
        </p>
        <p class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
          ★{props.novel.total_bookmarks.toLocaleString()} ·{" "}
          {(props.novel.text_length / 1000).toFixed(1)}k 字
        </p>
      </div>
    </div>
  );
};

export default NovelRowCard;
