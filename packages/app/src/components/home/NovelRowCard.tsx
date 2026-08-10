/**
 * NovelRowCard — 小说单列行卡（首页 L5 布局正式版）。
 *
 * 视觉：左 56px 圆角封面缩略 + 「系列」徽标；右 标题 / 作者 / ★收藏·字数。
 * A2 规范（ADR-0074）：Large 圆角、NeutralBackground1 底、1px NeutralStroke1 边框、
 * 无阴影、hover 背景高亮、active 轻微缩放。
 * 可访问性：role="button" + tabIndex=0 + Enter 键触发 onClick。
 *
 * 标签布局变体（?novelTags=，UI 原型）：
 *  - fullwidth（默认，已选 T1）：标签独占行卡底部通栏（动态显示 +「+N」折叠，不被封面/徽标遮挡）
 *  - truncate：信息区内单行 CSS 截断（无渐变遮罩/徽标，尽量多显示标签文本）
 *  - count：封面右下「N tags」计数徽标，信息区不显示标签文本
 */
import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { PixivNovel } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import AdaptiveTags from "@/components/home/AdaptiveTags";
import type { LabelMode } from "./labelMode";

interface NovelRowCardProps {
  /** 小说数据 */
  novel: PixivNovel;
  /** 点击 / 回车回调 */
  onClick: () => void;
  /** 标签显示模式（默认 none = 仅保留系列徽标） */
  labelMode?: LabelMode;
  /** 标签布局变体（默认 fullwidth） */
  tagLayout?: "fullwidth" | "truncate" | "count";
}

/** 小说卡标签布局变体（?novelTags=） */
export type NovelTagLayout = NonNullable<NovelRowCardProps["tagLayout"]>;

const NovelRowCard: Component<NovelRowCardProps> = (props) => {
  const mode = () => props.labelMode ?? "none";
  const layout = () => props.tagLayout ?? "fullwidth";
  // 封面 URL：优先大图，依次回退中图、方形缩略图
  const cover = () =>
    props.novel.image_urls.large ??
    props.novel.image_urls.medium ??
    props.novel.image_urls.square_medium;
  // 内容标签：过滤 R-18/R-18G（分级已由图上的 R-18 badge 表达，避免重复）
  const contentTags = () => props.novel.tags.filter((t) => t.name !== "R-18" && t.name !== "R-18G");

  return (
    <div
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
        {/* 封面缩略图（AI 左上 + R-18 分级右上 + count 变体右下；系列徽标移到标题行，避免 56px 封面徽标重叠） */}
        <div class="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
          <img
            src={resolveImageUrl(cover())}
            alt={props.novel.title}
            class="h-full w-full object-cover"
            loading="lazy"
          />
          {/* AI 生成 badge（左上；所有标签模式显示，对齐插画卡语义：novel_ai_type>1 才显示） */}
          <Show
            when={
              mode() !== "none" &&
              props.novel.novel_ai_type != null &&
              props.novel.novel_ai_type > 1
            }
          >
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
          {/* R-18 分级 badge（labelMode 非 none 时显示，安全标识必需） */}
          <Show
            when={
              mode() !== "none" && (props.novel.x_restrict === 1 || props.novel.x_restrict === 2)
            }
          >
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
          {/* count 变体：封面右下「N tags」计数（信息区不再显示标签文本） */}
          <Show when={mode() !== "none" && layout() === "count" && contentTags().length > 0}>
            <span
              class="absolute bottom-[var(--strokeWidthThin)] right-[var(--strokeWidthThin)] rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalXXS)] [font-size:var(--fontSizeBase100)]"
              style={{
                background: "color-mix(in srgb, var(--colorNeutralBackground1) 80%, transparent)",
                color: "var(--colorNeutralForeground1)",
              }}
            >
              {contentTags().length} tags
            </span>
          </Show>
        </div>

        {/* 标题（系列徽标内联前置）/ 作者 / 统计（fullwidth 变体：标签行移到下方通栏） */}
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
            <p class="truncate text-[var(--colorNeutralForeground1)] font-semibold leading-[var(--lineHeightBase300)] [font-size:var(--fontSizeBase300)]">
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
          {/* truncate 变体：信息区内单行截断（无遮罩/徽标，尽量多显示） */}
          <Show when={mode() !== "none" && layout() === "truncate" && contentTags().length > 0}>
            <p class="mt-[var(--spacingVerticalXS)] truncate text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase100)]">
              {contentTags()
                .map((t) => t.name)
                .join(" · ")}
            </p>
          </Show>
        </div>
      </div>

      {/* fullwidth 变体：标签独占行卡底部通栏（全宽自适应，不被封面/徽标遮挡） */}
      <Show when={mode() !== "none" && layout() === "fullwidth" && contentTags().length > 0}>
        <AdaptiveTags tags={contentTags()} onOverflowClick={props.onClick} />
      </Show>
    </div>
  );
};

export default NovelRowCard;
