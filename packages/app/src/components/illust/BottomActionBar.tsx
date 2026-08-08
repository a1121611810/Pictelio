import type { Component } from "solid-js";
import PixivImage from "../PixivImage";

interface BottomActionBarProps {
  /** 作者名（超出一行省略号截断） */
  name: string;
  avatarUrl: string;
  isBookmarked: boolean;
  bookmarking: boolean;
  onBookmarkPointerDown: (e: PointerEvent) => void;
  onBookmarkPointerUp: (e: PointerEvent) => void;
  onComments: () => void;
  totalComments?: number;
}

/**
 * 详情页底部固定操作条（用户定稿：A 布局 + C 的动态操作条）。
 *
 * 显示逻辑（由 IllustDetail 控制）：页面滚动到信息区（用户/作品信息）
 * 进入视口后隐藏（信息区内已有收藏/评论入口，避免重复）；否则常驻。
 *
 * 内容：左 = 作者头像 + 名字（truncate 省略号）；右 = 收藏（长按私藏）+ 评论。
 * A2 卡片条：圆角 2XLarge + elevation8 + 细边框，悬浮于页面底部。
 */
const BottomActionBar: Component<BottomActionBarProps> = (props) => {
  return (
    <div class="fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none">
      <div class="pointer-events-auto w-full max-w-md rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation4)] border border-[var(--colorNeutralStroke2)] px-[var(--spacingHorizontalL)] h-14 flex items-center gap-3">
        {/* 左：头像 + 名字（truncate） */}
        <div class="flex items-center gap-2.5 min-w-0 flex-shrink">
          <PixivImage
            src={props.avatarUrl}
            alt={props.name}
            width={36}
            height={36}
            class="w-9 h-9 rounded-[var(--borderRadiusCircular)] object-cover flex-shrink-0"
          />
          <span class="min-w-0 truncate [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
            {props.name}
          </span>
        </div>

        {/* 右：收藏 + 评论 */}
        <div class="flex items-center gap-2 ml-auto flex-shrink-0">
          <button
            type="button"
            class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium transition-all active:scale-95 select-none appearance-none border-none outline-none cursor-pointer ${
              props.isBookmarked
                ? "bg-[var(--colorStatusDangerBackground2)] text-[var(--colorStatusDangerForeground1)]"
                : "bg-[var(--colorBrandStroke2)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorBrandBackground)] hover:text-[var(--colorNeutralForegroundOnBrand)]"
            }`}
            onPointerDown={props.onBookmarkPointerDown}
            onPointerUp={props.onBookmarkPointerUp}
            onPointerLeave={props.onBookmarkPointerUp}
            disabled={props.bookmarking}
            aria-label={props.isBookmarked ? "取消收藏" : "收藏"}
          >
            {props.isBookmarked ? "♥ 已收藏" : "♡ 收藏"}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] hover:bg-[var(--colorBrandBackgroundHover)] active:scale-95 transition-all select-none appearance-none border-none outline-none cursor-pointer"
            onClick={props.onComments}
          >
            💬 评论
            {props.totalComments !== undefined ? ` ${props.totalComments.toLocaleString()}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BottomActionBar;
