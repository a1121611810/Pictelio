/**
 * RankingRowCard — 榜单行卡（spec docs/specs/ranking.md §5.3）。
 *
 * 布局：左侧名次（前 3 名品牌色强调）+ 56px 方缩略图 + 标题 / 作者 + ★收藏数。
 * A2 规范 + Fluent 令牌；hover / active / focus-visible 三态齐全；触控目标 ≥40px。
 * 缩略图经 resolveImageUrl 走项目图片代理路径（不直连 CDN）。
 */
import type { Component } from "solid-js";
import type { PixivIllust } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import { t } from "../../i18n";

/**
 * 行卡缩略图原始 URL（降档链 square_medium → large → medium）。
 * 单点导出：榜单页 FeedList 的 prefetchUrl 必须与本卡展示取值逐字一致（预热 key = 展示 src）。
 */
export function rankingCover(illust: PixivIllust): string {
  return illust.image_urls.square_medium || illust.image_urls.large || illust.image_urls.medium;
}

interface RankingRowCardProps {
  /** 名次（offset + index + 1；服务端不返回） */
  rank: number;
  illust: PixivIllust;
  onClick: () => void;
}

const RankingRowCard: Component<RankingRowCardProps> = (props) => {
  return (
    <div
      data-testid="ranking-row"
      role="button"
      tabindex={0}
      aria-label={t("ranking.page.rowAria", { rank: props.rank, title: props.illust.title })}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
      class="flex min-h-[40px] cursor-pointer items-center gap-[var(--spacingHorizontalM)] border-b border-[var(--colorNeutralStroke2)] px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
    >
      <span
        data-testid="ranking-rank"
        class={[
          "w-8 flex-none text-center font-semibold [font-size:var(--fontSizeBase400)]",
          {
            "text-[var(--colorBrandForeground1)]": props.rank <= 3,
            "text-[var(--colorNeutralForeground3)]": props.rank > 3,
          },
        ]}
      >
        {props.rank}
      </span>
      <img
        src={resolveImageUrl(rankingCover(props.illust))}
        alt=""
        loading="lazy"
        decoding="async"
        class="h-14 w-14 flex-none rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground3)] object-cover select-none"
      />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)]">
          {props.illust.title}
        </span>
        <span class="block truncate text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
          {props.illust.user.name}
        </span>
      </span>
      <span class="flex-none text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
        {t("ranking.page.bookmarks", { count: props.illust.total_bookmarks.toLocaleString() })}
      </span>
    </div>
  );
};

export default RankingRowCard;
