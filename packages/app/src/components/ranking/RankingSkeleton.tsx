import type { Component } from "solid-js";
import { For } from "solid-js";
import SkeletonShimmer from "@/components/SkeletonShimmer";

/** 榜单页首载骨架：与 RankingRowCard 同构的行占位（内容到达时布局不跳动）。 */
const RankingSkeleton: Component = () => (
  <div class="flex flex-col" aria-hidden="true">
    <For each={Array.from({ length: 8 })}>
      {() => (
        <div class="flex items-center gap-[var(--spacingHorizontalM)] border-b border-[var(--colorNeutralStroke2)] px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)]">
          <SkeletonShimmer class="h-6 w-6 flex-none rounded-[var(--borderRadiusSmall)]" />
          <SkeletonShimmer class="h-14 w-14 flex-none rounded-[var(--borderRadiusMedium)]" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <SkeletonShimmer class="h-4 w-3/4 rounded-[var(--borderRadiusSmall)]" />
            <SkeletonShimmer class="h-3 w-1/2 rounded-[var(--borderRadiusSmall)]" />
          </div>
        </div>
      )}
    </For>
  </div>
);

export default RankingSkeleton;
