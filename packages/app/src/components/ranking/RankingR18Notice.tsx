import type { Component } from "solid-js";
import { t } from "@/i18n";

interface RankingR18NoticeProps {
  onRetry: () => void;
}

/** pixiv 网页端「浏览设置」（开启「显示 R-18 作品」） */
const R18_SETTINGS_URL = "https://www.pixiv.net/settings/viewing";

/**
 * R-18 / R-18G 榜单不可用时的可操作指引（spec docs/specs/ranking.md §5.7）。
 * 指向 pixiv 网页端设置，而不是通用错误文案；另提供本页重试。
 */
const RankingR18Notice: Component<RankingR18NoticeProps> = (props) => (
  <div class="flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
    <p class="font-semibold text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase400)]">
      {t("ranking.r18Notice.title")}
    </p>
    <p class="text-[var(--colorNeutralForeground2)] [font-size:var(--fontSizeBase200)]">
      {t("ranking.r18Notice.body")}
    </p>
    <div class="mt-3 flex items-center gap-2">
      <button
        type="button"
        class="flex h-10 cursor-pointer items-center rounded-[var(--borderRadiusCircular)] border-none bg-[var(--colorBrandBackground)] px-4 font-semibold text-[var(--colorNeutralForegroundOnBrand)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorBrandBackgroundHover)] active:scale-98 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
        onClick={() => window.open(R18_SETTINGS_URL, "_blank", "noopener,noreferrer")}
      >
        {t("ranking.r18Notice.action")}
      </button>
      <button
        type="button"
        class="flex h-10 cursor-pointer items-center rounded-[var(--borderRadiusCircular)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] px-4 text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 [font-size:var(--fontSizeBase200)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
        onClick={() => props.onRetry()}
      >
        {t("ranking.r18Notice.retry")}
      </button>
    </div>
  </div>
);

export default RankingR18Notice;
