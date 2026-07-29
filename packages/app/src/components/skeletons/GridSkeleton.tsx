import type { Component } from "solid-js";
import SkeletonShimmer from "@/components/SkeletonShimmer";

/** Skeleton placeholder for the user illusts grid page.
 *  Matches the layout of UserIllusts: sticky header (back + title),
 *  3 segmented tab shimmers, and a 3-column grid of 9 square cells. */
const GridSkeleton: Component = () => (
  <div class="pb-16">
    {/* Sticky header — back button + title */}
    <header class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-3">
      <SkeletonShimmer class="w-8 h-8 rounded-[var(--borderRadiusMedium)] shrink-0" />
      <SkeletonShimmer class="h-5 rounded-[var(--borderRadiusSmall)] w-40" />
    </header>

    {/* Segmented tab shimmers — 3 tabs */}
    <div class="px-4 py-3">
      <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1">
        <SkeletonShimmer class="flex-1 h-8 rounded-[var(--borderRadiusSmall)]" />
        <SkeletonShimmer class="flex-1 h-8 rounded-[var(--borderRadiusSmall)]" />
        <SkeletonShimmer class="flex-1 h-8 rounded-[var(--borderRadiusSmall)]" />
      </div>
    </div>

    {/* 3-column grid — 9 cells, 1/1 aspect-ratio */}
    <div class="grid grid-cols-3 gap-px bg-[var(--colorNeutralStroke1)]">
      {Array.from({ length: 9 }).map(() => (
        <SkeletonShimmer style={{ "aspect-ratio": "1 / 1" }} class="w-full" />
      ))}
    </div>
  </div>
);

export default GridSkeleton;
