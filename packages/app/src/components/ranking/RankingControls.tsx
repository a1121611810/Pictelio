/**
 * RankingControls — 榜单维度 chips + 日期回看行（spec docs/specs/ranking.md §5.3；#515）。
 *
 * - 维度：7 档 FilterChip（共享过滤 chip，aria-pressed 语义；非导航 tab），窄屏 flex-wrap 换行
 * - 日期：‹ / 日期文本 / 今日标记 / › + 原生日历（input[type=date]，与 SearchFilterSheet 同先例）
 * - 「今日」时 › 禁用（不请求未来日期）；日期文本用共享 formatRankingDate，不依赖 Intl
 */
import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { RANK_MODES, formatRankingDate, jstToday, type RankModeId } from "@pictelio/ranking-core";
import FilterChip from "@/components/ui/FilterChip";
import FluentIcon from "@/components/ui/FluentIcon";
import { t } from "@/i18n";

interface RankingControlsProps {
  mode: RankModeId;
  /** null = 今日 */
  date: string | null;
  onSelectMode: (mode: RankModeId) => void;
  onShiftDay: (delta: number) => void;
  onPickDate: (iso: string) => void;
}

const RankingControls: Component<RankingControlsProps> = (props) => {
  const effectiveDate = () => props.date ?? jstToday();
  const isToday = () => props.date === null || props.date === jstToday();
  const dateText = () => t("ranking.dateLong", { ...formatRankingDate(effectiveDate()) });

  const navBtn =
    "flex h-10 w-10 flex-none cursor-pointer items-center justify-center appearance-none rounded-[var(--borderRadiusCircular)] border-none text-[var(--colorNeutralForeground2)] outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div>
      {/* 维度 chip 行：过滤语义（role=group + aria-pressed），窄屏换行展示、不横向滚动 */}
      <div
        class="flex flex-wrap gap-2 px-4 pt-3"
        role="group"
        aria-label={t("ranking.modeListAria")}
      >
        <For each={RANK_MODES}>
          {(m) => (
            <FilterChip
              label={t(m.labelKey)}
              active={props.mode === m.id}
              onClick={() => props.onSelectMode(m.id)}
            />
          )}
        </For>
      </div>

      {/* 日期回看行 */}
      <div class="flex flex-wrap items-center justify-center gap-2 px-4 py-2">
        <button
          type="button"
          aria-label={t("ranking.prevDayAria")}
          class={navBtn}
          onClick={() => props.onShiftDay(-1)}
        >
          <FluentIcon name="chevronLeft" size={16} />
        </button>
        <span class="flex items-center gap-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
          {dateText()}
          <Show when={isToday()}>
            <span class="rounded-[var(--borderRadiusCircular)] bg-[var(--colorBrandBackground2)] px-2 py-0.5 font-semibold text-[var(--colorBrandForeground1)] [font-size:var(--fontSizeBase100)]">
              {t("ranking.today")}
            </span>
          </Show>
        </span>
        <button
          type="button"
          aria-label={t("ranking.nextDayAria")}
          class={navBtn}
          disabled={isToday()}
          onClick={() => props.onShiftDay(1)}
        >
          <FluentIcon name="chevronRight" size={16} />
        </button>
        <input
          type="date"
          class="date-input h-10"
          value={effectiveDate()}
          max={jstToday()}
          aria-label={t("ranking.controls.pickDateAria")}
          onInput={(e) => props.onPickDate(e.currentTarget.value)}
        />
      </div>
    </div>
  );
};

export default RankingControls;
