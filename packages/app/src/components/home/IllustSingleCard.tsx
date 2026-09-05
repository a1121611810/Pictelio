/**
 * IllustSingleCard — 插画单列大图卡（首页 L5 布局正式版）。
 *
 * 视觉：全宽封面（**按原图比例**，宽高比 = illust.width/height，异常值回退 16:10）
 * + 卡内信息行（标题 / 作者 + 右侧 ★收藏）。
 * A2 规范（ADR-0074）：XLarge 圆角、NeutralBackground1 底、1px NeutralStroke1 边框、
 * 无阴影、hover 背景高亮、active 轻微缩放。
 * 可访问性：role="button" + tabIndex=0 + Enter 键触发 onClick。
 *
 * 标签（A 已定稿，full）：图上 R-18/R-18G/AI 分级标 + 右上类型角标（动图/多图，ADR-0113）+ 文案 chip 动态显示
 * （AdaptiveTags 能放几个放几个 +「+N」折叠，可点搜索）。
 * 落选变体（B 一行截断 / C 仅分级 badge / none）已归档 throwaway，见 git 历史。
 */
import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { PixivIllust } from "@/api/types";
import { createProgressiveImage } from "@/primitives/createProgressiveImage";
import AdaptiveTags from "@/components/home/AdaptiveTags";
import IllustTypeBadge from "@/components/IllustTypeBadge";
import SkeletonShimmer from "@/components/SkeletonShimmer";

interface IllustSingleCardProps {
  /** 插画数据 */
  illust: PixivIllust;
  /** 点击 / 回车回调 */
  onClick: () => void;
}

const IllustSingleCard: Component<IllustSingleCardProps> = (props) => {
  // 渐进封面（spec webview-perf-round2 §2.2）：full 优先大图回退中图，thumb 恒为中图
  // （medium/large 同源等比互切零纵横比跳变；预载经 loadImage 与 FeedList 预取合流）
  const cover = createProgressiveImage({
    fullUrl: () => props.illust.image_urls.large ?? props.illust.image_urls.medium,
    thumbUrl: () => props.illust.image_urls.medium,
  });
  // 内容标签：过滤 R-18/R-18G（分级已由图上的 R-18 badge 表达，避免重复）
  const contentTags = () =>
    props.illust.tags.filter((t) => t.name !== "R-18" && t.name !== "R-18G");
  // 原图宽高比（width/height 可能异常，回退 16:10）
  const ratio = () => {
    const w = props.illust.width;
    const h = props.illust.height;
    return w > 0 && h > 0 ? `${w} / ${h}` : "16 / 10";
  };

  return (
    <div
      data-testid="illust-card"
      class="cursor-pointer overflow-hidden rounded-[var(--borderRadiusXLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      {/* 封面：按原图比例（aspect-ratio = width/height，超高长图自然拉高）+ 双层渐进 img */}
      <div class="relative bg-[var(--colorNeutralBackground2)]" style={{ "aspect-ratio": ratio() }}>
        {/* 底层：thumb=medium 占位（aria-hidden + pointer-events-none，不参与语义与交互；
            full 绘制完成（主 img load）后原语收窄 thumbSrc 为空串，本层从 DOM 卸载，
            回收双层常驻的合成/解码成本（B1，issue #358）；full 失败时保留兜底，thumb 失败时由原语卸载。
            decoding="async"（Standards，与 PixivImage 双层一致）：异步解码，防 thumb 解码阻塞主线程帧
            FT-2（#365 P4）：thumb 绘制前由 SkeletonShimmer 渐进占位——封面区不再是纯色块，
            与 thumb 同生命周期（full 绘制完成后随 thumb 层一并卸载，无常驻动画成本） */}
        <Show when={cover.thumbSrc()}>
          <SkeletonShimmer class="absolute inset-0" />
          <img
            src={cover.thumbSrc()}
            alt=""
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 h-full w-full object-cover select-none"
            decoding="async"
            onError={cover.onThumbError}
          />
        </Show>
        {/* 主层：full（large??medium）到位前不挂载（防白帧），挂载后覆盖 thumb；
            onLoad 接原语 onDisplayLoad = 绘制就绪信号（触发 thumb 层卸载） */}
        <Show when={cover.displaySrc()}>
          <img
            src={cover.displaySrc()}
            alt={props.illust.title}
            class="relative h-full w-full object-cover"
            loading="lazy"
            onLoad={cover.onDisplayLoad}
            onError={cover.onDisplayError}
          />
        </Show>
        {/* 图上角标（A 定稿）：左上 R-18/R-18G/AI + 右上动图 */}
        <div class="absolute left-[var(--spacingHorizontalXS)] top-[var(--spacingVerticalXS)] z-10 flex items-center gap-[var(--spacingHorizontalXXS)] pointer-events-none select-none">
          {props.illust.x_restrict === 1 && (
            <fluent-badge appearance="filled" color="danger">
              R-18
            </fluent-badge>
          )}
          {props.illust.x_restrict === 2 && (
            <fluent-badge appearance="filled" color="warning">
              R-18G
            </fluent-badge>
          )}
          <Show when={props.illust.illust_ai_type != null && props.illust.illust_ai_type > 1}>
            <fluent-badge appearance="filled">
              {props.illust.illust_ai_type === 2 ? "AI" : "AI辅助"}
            </fluent-badge>
          </Show>
        </div>
        {/* 右上：类型角标（动图/多图，ADR-0113 公共组件） */}
        <IllustTypeBadge illust={props.illust} />
      </div>

      {/* 信息行：标题 / 作者 + 收藏数（标签组单独一行，不嵌在左侧模块内） */}
      <div class="flex items-center justify-between gap-[var(--spacingHorizontalM)] px-[var(--spacingHorizontalL)] pt-[var(--spacingVerticalM)]">
        <div class="min-w-0">
          <p
            data-testid="illust-title"
            class="truncate text-[var(--colorNeutralForeground1)] font-semibold leading-[var(--lineHeightBase300)] [font-size:var(--fontSizeBase300)]"
          >
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

      {/* 标签组：单独一行通栏（A 定稿：AdaptiveTags 动态显示 +「+N」折叠） */}
      <div class="px-[var(--spacingHorizontalL)] pb-[var(--spacingVerticalM)]">
        <AdaptiveTags tags={contentTags()} onOverflowClick={props.onClick} />
      </div>
    </div>
  );
};

export default IllustSingleCard;
