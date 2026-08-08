/**
 * IllustSingleCard — 插画单列大图卡（首页 L5 布局正式版）。
 *
 * 视觉：全宽封面（**按原图比例**，宽高比 = illust.width/height，异常值回退 16:10）
 * + 卡内信息行（标题 / 作者 + 右侧 ★收藏）。
 * A2 规范（ADR-0074）：XLarge 圆角、NeutralBackground1 底、1px NeutralStroke1 边框、
 * 无阴影、hover 背景高亮、active 轻微缩放。
 * 可访问性：role="button" + tabIndex=0 + Enter 键触发 onClick。
 */
import type { Component } from "solid-js";
import type { PixivIllust } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";

interface IllustSingleCardProps {
  /** 插画数据 */
  illust: PixivIllust;
  /** 点击 / 回车回调 */
  onClick: () => void;
}

const IllustSingleCard: Component<IllustSingleCardProps> = (props) => {
  // 封面 URL：优先大图，回退中图
  const cover = () => props.illust.image_urls.large ?? props.illust.image_urls.medium;
  // 原图宽高比（width/height 可能异常，回退 16:10）
  const ratio = () => {
    const w = props.illust.width;
    const h = props.illust.height;
    return w > 0 && h > 0 ? `${w} / ${h}` : "16 / 10";
  };

  return (
    <div
      class="cursor-pointer overflow-hidden rounded-[var(--borderRadiusXLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      {/* 封面：按原图比例（aspect-ratio = width/height，超高长图自然拉高） */}
      <div class="relative bg-[var(--colorNeutralBackground2)]" style={{ "aspect-ratio": ratio() }}>
        <img
          src={resolveImageUrl(cover())}
          alt={props.illust.title}
          class="h-full w-full object-cover"
          loading="lazy"
        />
      </div>

      {/* 信息行：标题 / 作者 + 收藏数 */}
      <div class="flex items-center justify-between gap-[var(--spacingHorizontalM)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalM)]">
        <div class="min-w-0">
          <p class="truncate text-[var(--colorNeutralForeground1)] font-semibold leading-[var(--lineHeightBase300)] [font-size:var(--fontSizeBase300)]">
            {props.illust.title}
          </p>
          <p class="mt-[var(--spacingVerticalXXS)] truncate text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
            {props.illust.user.name}
          </p>
        </div>
        <p class="flex-none text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
          ★{props.illust.total_bookmarks.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default IllustSingleCard;
