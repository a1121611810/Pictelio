import type { Component } from "solid-js";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import PageTransition from "@/components/PageTransition";

/** Skeleton loading placeholder for the illust detail page.
 *  Mirrors the layout structure of IllustDetail.tsx without hardcoded colors —
 *  all visual tokens come from Fluent CSS custom properties. */
const IllustDetailSkeleton: Component = () => (
  <PageTransition>
    <div class="min-h-screen">
      {/* Sticky header */}
      <div class="sticky top-0 z-10 bg-[var(--colorNeutralBackground1)] flex items-center justify-between px-4 h-12 border-b border-[var(--colorNeutralStroke2)]">
        <div class="flex items-center gap-3">
          {/* Back button placeholder */}
          <SkeletonShimmer class="w-8 h-8 rounded-[var(--borderRadiusMedium)]" />
          {/* Title placeholder */}
          <SkeletonShimmer class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)] w-32" />
        </div>
        {/* More menu placeholder */}
        <SkeletonShimmer class="w-8 h-8 rounded-[var(--borderRadiusCircular)]" />
      </div>

      {/* Image area — 16:9 aspect ratio */}
      <SkeletonShimmer class="w-full" style={{ "aspect-ratio": "16 / 9" }} />

      {/* Info section */}
      <div class="px-4 py-4 space-y-4">
        {/* User row */}
        <div class="flex items-center gap-3">
          {/* Avatar */}
          <SkeletonShimmer class="w-10 h-10 rounded-[var(--borderRadiusCircular)] flex-shrink-0" />
          {/* Name + account */}
          <div class="flex flex-col gap-1">
            <SkeletonShimmer class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)] w-24" />
            <SkeletonShimmer class="h-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusSmall)] w-16" />
          </div>
          {/* Follow button */}
          <SkeletonShimmer class="h-8 rounded-[var(--borderRadiusMedium)] w-16 ml-auto" />
        </div>

        {/* Stats row */}
        <div class="flex gap-4">
          <SkeletonShimmer class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)] w-14" />
          <SkeletonShimmer class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)] w-14" />
          <SkeletonShimmer class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)] w-14" />
        </div>

        {/* Bookmark button */}
        <SkeletonShimmer class="h-8 rounded-[var(--borderRadiusMedium)] w-20" />

        {/* Tags area */}
        <div class="flex flex-wrap gap-2">
          <SkeletonShimmer class="h-7 rounded-[var(--borderRadiusLarge)] w-16" />
          <SkeletonShimmer class="h-7 rounded-[var(--borderRadiusLarge)] w-20" />
          <SkeletonShimmer class="h-7 rounded-[var(--borderRadiusLarge)] w-14" />
          <SkeletonShimmer class="h-7 rounded-[var(--borderRadiusLarge)] w-24" />
          <SkeletonShimmer class="h-7 rounded-[var(--borderRadiusLarge)] w-18" />
          <SkeletonShimmer class="h-7 rounded-[var(--borderRadiusLarge)] w-12" />
        </div>

        {/* Description lines */}
        <div class="space-y-2">
          <SkeletonShimmer class="h-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusSmall)] w-full" />
          <SkeletonShimmer class="h-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusSmall)] w-11/12" />
          <SkeletonShimmer class="h-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusSmall)] w-3/4" />
          <SkeletonShimmer class="h-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusSmall)] w-5/6" />
          <SkeletonShimmer class="h-[var(--spacingVerticalXS)] rounded-[var(--borderRadiusSmall)] w-2/3" />
        </div>
      </div>
    </div>
  </PageTransition>
);

export default IllustDetailSkeleton;
