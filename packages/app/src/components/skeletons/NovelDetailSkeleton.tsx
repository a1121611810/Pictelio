import type { Component } from "solid-js";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import PageTransition from "@/components/PageTransition";

/** Skeleton placeholder for novel detail page.
 *  Matches NovelDetail layout: sticky header, cover header, text paragraphs,
 *  and footer nav bar. Uses Fluent Design tokens for all spacing and colors. */
const NovelDetailSkeleton: Component = () => (
  <PageTransition>
    <div
      class="min-h-screen"
      style={{ "background-color": "var(--colorNeutralBackground2)" }}
    >
      {/* ── Sticky header: back + title + search ── */}
      <header
        class="sticky top-0 z-20 flex h-12 items-center gap-2 px-4"
        style={{
          "background-color": "var(--colorNeutralBackground1)",
          "border-bottom": "1px solid var(--colorNeutralStroke2)",
        }}
      >
        {/* Back button */}
        <div
          class="flex h-8 w-8 min-w-8 items-center justify-center rounded-[var(--borderRadiusSmall)]"
          style={{ "background-color": "var(--colorNeutralBackground2)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
              fill="var(--colorNeutralForeground3)"
            />
          </svg>
        </div>

        {/* Title area */}
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <SkeletonShimmer
            class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "32px" }}
          />
          <SkeletonShimmer
            class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "80px" }}
          />
        </div>

        {/* Search icon placeholder */}
        <div
          class="flex h-8 w-8 items-center justify-center rounded-[var(--borderRadiusSmall)]"
          style={{ "background-color": "var(--colorNeutralBackground2)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M14.386 14.386l4.088 4.088a1 1 0 01-1.414 1.414l-4.088-4.088a6.5 6.5 0 111.414-1.414zM10 14.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z"
              fill="var(--colorNeutralForeground3)"
            />
          </svg>
        </div>
      </header>

      {/* ── Cover header shimmer block ── */}
      <div class="flex flex-col items-center px-4 pb-6 pt-6 text-center">
        {/* Cover image placeholder */}
        <SkeletonShimmer
          class="rounded-[var(--borderRadiusMedium)]"
          style={{
            width: "160px",
            "aspect-ratio": "3 / 4",
            "margin-bottom": "var(--spacingVerticalL)",
          }}
        />
        {/* Title line */}
        <SkeletonShimmer
          class="h-[var(--spacingVerticalXXL)] rounded-[var(--borderRadiusSmall)]"
          style={{ width: "200px", "margin-bottom": "var(--spacingVerticalS)" }}
        />
        {/* Author line */}
        <SkeletonShimmer
          class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
          style={{ width: "120px", "margin-bottom": "var(--spacingVerticalS)" }}
        />
        {/* Stats row: bookmarks, comments, series */}
        <div class="flex items-center justify-center gap-3">
          <SkeletonShimmer
            class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "60px" }}
          />
          <SkeletonShimmer
            class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "60px" }}
          />
          <SkeletonShimmer
            class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "60px" }}
          />
        </div>
      </div>

      {/* ── Text paragraphs (8 lines with varying widths) ── */}
      <div
        class="mx-auto max-w-2xl space-y-4 px-4 pb-24"
        style={{ "padding-bottom": "96px" }}
      >
        {[
          "100%",
          "100%",
          "85%",
          "100%",
          "70%",
          "100%",
          "90%",
          "55%",
        ].map((width) => (
          <SkeletonShimmer
            class="rounded-[var(--borderRadiusSmall)]"
            style={{
              height: "var(--spacingVerticalXXL)",
              width,
            }}
          />
        ))}
      </div>

      {/* ── Footer nav bar ── */}
      <footer
        class="fixed bottom-0 left-0 right-0 z-20 flex h-14 items-center justify-center gap-4 px-4"
        style={{
          "background-color": "var(--colorNeutralBackground1)",
          "border-top": "1px solid var(--colorNeutralStroke2)",
        }}
      >
        {/* Previous / settings / series / next */}
        <SkeletonShimmer
          class="rounded-[var(--borderRadiusSmall)]"
          style={{ width: "60px", height: "var(--spacingVerticalL)" }}
        />
        <SkeletonShimmer
          class="rounded-[var(--borderRadiusSmall)]"
          style={{ width: "40px", height: "var(--spacingVerticalL)" }}
        />
        <SkeletonShimmer
          class="rounded-[var(--borderRadiusSmall)]"
          style={{ width: "40px", height: "var(--spacingVerticalL)" }}
        />
        <SkeletonShimmer
          class="rounded-[var(--borderRadiusSmall)]"
          style={{ width: "60px", height: "var(--spacingVerticalL)" }}
        />
      </footer>
    </div>
  </PageTransition>
);

export default NovelDetailSkeleton;
