import SkeletonShimmer from "@/components/SkeletonShimmer";

/** Skeleton placeholder for the Follow List page.
 *  Shows a surface-card with header (back arrow + title) and 6 user rows,
 *  each with avatar circle, two text lines, and a follow button. */
const ListSkeleton = () => (
  <div class="surface-card flex flex-col gap-3 p-4">
    {/* Header: back button + title */}
    <div class="flex items-center gap-3 mb-2">
      <SkeletonShimmer
        class="shrink-0"
        style={{
          width: "var(--spacingHorizontalXXL)",
          height: "var(--spacingVerticalXXL)",
          "border-radius": "var(--borderRadiusMedium)",
        }}
      />
      <SkeletonShimmer
        class="h-[var(--spacingVerticalL)] rounded-[var(--borderRadiusSmall)]"
        style={{ width: "clamp(80px, 30vw, 160px)" }}
      />
    </div>

    {/* 6 user rows */}
    {Array.from({ length: 6 }).map(() => (
      <div class="flex items-center gap-3 py-2">
        {/* Avatar circle */}
        <SkeletonShimmer
          class="shrink-0"
          style={{
            width: "var(--spacingVerticalXXL)",
            height: "var(--spacingVerticalXXL)",
            "border-radius": "50%",
          }}
        />
        {/* Two text lines */}
        <div class="flex flex-col gap-1.5 flex-1 min-w-0">
          <SkeletonShimmer
            class="h-[var(--spacingVerticalM)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "clamp(60px, 25vw, 120px)" }}
          />
          <SkeletonShimmer
            class="h-[var(--spacingVerticalS)] rounded-[var(--borderRadiusSmall)]"
            style={{ width: "clamp(80px, 35vw, 180px)" }}
          />
        </div>
        {/* Follow button */}
        <SkeletonShimmer
          class="shrink-0 rounded-[var(--borderRadiusMedium)]"
          style={{
            width: "var(--spacingHorizontalXXXL)",
            height: "var(--spacingVerticalL)",
          }}
        />
      </div>
    ))}
  </div>
);

export default ListSkeleton;
