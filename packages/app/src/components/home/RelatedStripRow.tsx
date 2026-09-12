/**
 * RelatedStripRow — 相关作品注入行（spec docs/specs/related-injection.md）。
 *
 * 渲染在锚点卡片正下方：标题行（「相关作品」+ 收起按钮）+ 横向滚动缩略图。
 * loading 态渲染 shimmer 占位（先渲染后加载硬约束：行随锚点立即占位）。
 * 行内点击进详情但不记录新锚点（防循环注入，由调用方的 onNavigate 保证）。
 */
import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import type { RelatedRow } from "@/stores/relatedInjectionStore";
import { RELATED_ROW_SIZE } from "@/stores/relatedInjectionStore";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import type { PixivIllust } from "@/api/types";

interface RelatedStripRowProps {
  row: RelatedRow;
  /** 缩略图点击（进详情；调用方不得在此记录新锚点） */
  onNavigate: (illustId: number) => void;
  /** 收起：移除该行 */
  onDismiss: () => void;
}

/** 缩略图取值（square_medium 优先，与列表卡降级链一致） */
const thumb = (il: PixivIllust) =>
  il.image_urls.square_medium || il.image_urls.medium || il.image_urls.large;

const RelatedStripRow: Component<RelatedStripRowProps> = (props) => {
  return (
    <div
      data-testid="related-strip-row"
      class="rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground2)] px-[var(--spacingHorizontalS)] py-[var(--spacingVerticalS)]"
    >
      {/* 标题行 */}
      <div class="flex items-center justify-between">
        <p class="[font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]">
          相关作品
          <Show when={!props.row.loading}>
            <span class="ml-1 font-normal text-[var(--colorNeutralForeground3)]">
              {props.row.items.length}/{RELATED_ROW_SIZE}
            </span>
          </Show>
        </p>
        <button
          type="button"
          aria-label="收起相关作品"
          onClick={props.onDismiss}
          class="flex h-8 w-8 items-center justify-center rounded-[var(--borderRadiusCircular)] text-[var(--colorNeutralForeground3)] transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4.397 4.553l.073-.084a.75.75 0 0 1 .977-.073l.084.073L12 10.94l6.47-6.47a.75.75 0 0 1 1.06 1.06L13.06 12l6.47 6.47a.75.75 0 0 1 .073.977l-.073.084a.75.75 0 0 1-.977.073l-.084-.073L12 13.06l-6.47 6.47a.75.75 0 0 1-1.06-1.06L10.94 12l-6.47-6.47a.75.75 0 0 1-.073-.977z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      {/* 横向缩略图 / loading 占位 */}
      <Show
        when={!props.row.loading}
        fallback={
          <div class="mt-2 flex gap-2 overflow-hidden" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonShimmer
                class="h-20 w-20 flex-shrink-0 rounded-[var(--borderRadiusMedium)]"
                style={{ "animation-delay": `${i * 80}ms` }}
              />
            ))}
          </div>
        }
      >
        <div class="mt-2 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="相关作品列表">
          <For each={props.row.items}>
            {(il) => (
              <button
                type="button"
                role="listitem"
                aria-label={`查看相关作品：${il.title}`}
                onClick={() => props.onNavigate(il.id)}
                class="w-20 flex-shrink-0 cursor-pointer rounded-[var(--borderRadiusMedium)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              >
                <img
                  src={thumb(il)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="h-20 w-20 rounded-[var(--borderRadiusMedium)] object-cover select-none"
                />
                <p class="mt-1 truncate text-left [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground2)]">
                  {il.title}
                </p>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default RelatedStripRow;
