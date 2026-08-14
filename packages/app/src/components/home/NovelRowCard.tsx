/**
 * NovelRowCard — 小说单列行卡（首页 L5 布局正式版）。
 *
 * 视觉：左 56px 圆角封面缩略 + 「系列」徽标；右 标题 / 作者 / ★收藏·字数。
 * A2 规范（ADR-0074）：Large 圆角、NeutralBackground1 底、1px NeutralStroke1 边框、
 * 无阴影、hover 背景高亮、active 轻微缩放。
 * 可访问性：role="button" + tabIndex=0 + Enter 键触发 onClick。
 *
 * 标签（A 已定稿）：封面上 AI/R-18 badge + 底部通栏标签行（AdaptiveTags 动态显示 +「+N」折叠）。
 * 落选变体（B/C/none 标签模式）已归档 throwaway，见 git 历史。
 */
import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { PixivNovel } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import AdaptiveTags from "@/components/home/AdaptiveTags";

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
  // 内容标签：过滤 R-18/R-18G（分级已由图上的 R-18 badge 表达，避免重复）
  const contentTags = () => props.novel.tags.filter((t) => t.name !== "R-18" && t.name !== "R-18G");

  return (
    <div
      data-testid="novel-card"
      class="cursor-pointer rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] p-[var(--spacingHorizontalM)] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      {/* 第一行：封面缩略图 + 标题 / 作者 / 统计 */}
      <div class="flex items-center gap-[var(--spacingHorizontalM)]">
        {/* 封面缩略图（AI 左上 + R-18 分级右上；系列徽标移到标题行，避免 56px 封面徽标重叠） */}
        <div class="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
          <img
            src={resolveImageUrl(cover())}
            alt={props.novel.title}
            class="h-full w-full object-cover"
            loading="lazy"
          />
          {/* AI 生成 badge（左上；novel_ai_type>1 才显示） */}
          <Show when={props.novel.novel_ai_type != null && props.novel.novel_ai_type > 1}>
            <span
              class="absolute left-[var(--strokeWidthThin)] top-[var(--strokeWidthThin)] rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalXXS)] font-bold [font-size:var(--fontSizeBase100)]"
              style={{
                background: "var(--colorNeutralBackground2)",
                color: "var(--colorNeutralForeground1)",
              }}
            >
              AI
            </span>
          </Show>
          {/* R-18 分级 badge（安全标识必需） */}
          <Show when={props.novel.x_restrict === 1 || props.novel.x_restrict === 2}>
            <span
              class="absolute right-[var(--strokeWidthThin)] top-[var(--strokeWidthThin)] rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalXXS)] font-bold [font-size:var(--fontSizeBase100)]"
              style={{
                background:
                  props.novel.x_restrict === 2
                    ? "var(--colorStatusWarningBackground1)"
                    : "var(--colorStatusDangerBackground1)",
                color: "var(--colorNeutralForegroundOnBrand)",
              }}
            >
              {props.novel.x_restrict === 2 ? "R-18G" : "R-18"}
            </span>
          </Show>
        </div>

        {/* 标题（系列徽标内联前置）/ 作者 / 统计（标签行在卡片底部通栏） */}
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-[var(--spacingHorizontalXXS)]">
            {/* 系列徽标：56px 封面放不下两个徽标（会与 R-18 重叠），移到标题行 */}
            <Show when={props.novel.series}>
              <span
                class="flex-shrink-0 rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalXXS)] font-bold [font-size:var(--fontSizeBase100)]"
                style={{
                  background: "var(--colorBrandBackground)",
                  color: "var(--colorNeutralForegroundOnBrand)",
                }}
              >
                系列
              </span>
            </Show>
            <p
              data-testid="novel-title"
              class="truncate text-[var(--colorNeutralForeground1)] font-semibold leading-[var(--lineHeightBase300)] [font-size:var(--fontSizeBase300)]"
            >
              {props.novel.title}
            </p>
          </div>
          <p class="mt-[var(--spacingVerticalXXS)] truncate text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
            {props.novel.user.name}
          </p>
          <p class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
            ★{props.novel.total_bookmarks.toLocaleString()} ·{" "}
            {(props.novel.text_length / 1000).toFixed(1)}k 字
          </p>
        </div>
      </div>

      {/* 标签通栏（A 定稿）：独占行卡底部全宽，AdaptiveTags 动态显示 +「+N」折叠 */}
      <Show when={contentTags().length > 0}>
        <AdaptiveTags tags={contentTags()} onOverflowClick={props.onClick} />
      </Show>
    </div>
  );
};

export default NovelRowCard;
