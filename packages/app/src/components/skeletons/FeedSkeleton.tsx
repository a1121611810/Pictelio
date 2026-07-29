import type { Component } from "solid-js";
import SkeletonCard from "@/components/SkeletonCard";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import PageTransition from "@/components/PageTransition";

/** Skeleton placeholder matching TabFeedPage layout.
 *  Shows a sticky header shimmer (app title + segmented toggle) and
 *  6 SkeletonCards in 2 columns with varying aspect ratios. */
const FeedSkeleton: Component = () => (
  <PageTransition>
    <div class="pb-16">
      {/* Sticky header shimmer */}
      <header
        class="sticky top-0 z-20 surface-appbar h-12 flex items-center justify-between px-4"
        aria-hidden="true"
      >
        {/* App title shimmer */}
        <SkeletonShimmer class="h-5 w-24 rounded-[var(--borderRadiusSmall)]" />
        {/* Segmented toggle shimmer */}
        <div class="flex items-center bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusSmall)] p-0.5 gap-0.5">
          <SkeletonShimmer class="h-7 w-12 rounded-[var(--borderRadiusSmall)]" />
          <SkeletonShimmer class="h-7 w-12 rounded-[var(--borderRadiusSmall)]" />
        </div>
      </header>

      {/* 6 skeleton cards in 2 columns with varying heights */}
      <div class="columns-2 gap-3 px-3">
        <SkeletonCard width={1} height={1} />
        <SkeletonCard width={3} height={4} />
        <SkeletonCard width={4} height={3} />
        <SkeletonCard width={2} height={3} />
        <SkeletonCard width={1} height={1} />
        <SkeletonCard width={4} height={5} />
      </div>
    </div>
  </PageTransition>
);

export default FeedSkeleton;
