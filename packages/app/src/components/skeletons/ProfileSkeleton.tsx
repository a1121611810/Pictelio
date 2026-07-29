import type { Component } from "solid-js";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import PageTransition from "@/components/PageTransition";

/** Skeleton placeholder for PersonalCenter page.
 *  Mirrors the actual page layout: sticky header (back + search bar),
 *  user info card (avatar circle + name), and 5 menu items (icon + text + chevron).
 *  Uses Fluent Design tokens exclusively for spacing, sizing, and color. */
const ProfileSkeleton: Component = () => (
  <PageTransition>
    <div
      style={{
        "min-height": "100vh",
        background: "var(--pageCardBg)",
      }}
    >
      {/* 顶部栏：返回按钮 + 搜索入口 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding:
            "var(--spacingVerticalM) var(--spacingHorizontalL)",
        }}
      >
        {/* Back button placeholder */}
        <SkeletonShimmer
          style={{
            width: "40px",
            height: "40px",
            "border-radius": "var(--borderRadiusCircular)",
            "flex-shrink": "0",
          }}
        />
        {/* Search bar placeholder */}
        <SkeletonShimmer
          style={{
            width: "80px",
            height: "32px",
            "border-radius": "var(--borderRadiusCircular)",
          }}
        />
      </div>

      {/* 用户信息卡片 */}
      <div
        style={{
          padding: "0 var(--spacingHorizontalL)",
          "margin-top": "var(--spacingVerticalL)",
        }}
      >
        <div
          style={{
            background: "var(--pageCardSurface)",
            "border-radius": "var(--pageCardRadius)",
            padding:
              "var(--spacingVerticalL) var(--spacingHorizontalXL)",
            display: "flex",
            "align-items": "center",
            gap: "var(--spacingHorizontalL)",
            "box-shadow": "var(--pageCardShadow)",
          }}
        >
          {/* Avatar circle */}
          <SkeletonShimmer
            style={{
              width: "56px",
              height: "56px",
              "border-radius": "var(--borderRadiusCircular)",
              "flex-shrink": "0",
            }}
          />
          {/* User name */}
          <SkeletonShimmer
            style={{
              height: "var(--spacingVerticalXXL)",
              "border-radius": "var(--borderRadiusSmall)",
              width: "120px",
            }}
          />
        </div>
      </div>

      {/* 功能菜单卡片组 */}
      <div
        style={{
          padding: "0 var(--spacingHorizontalL)",
          "margin-top": "var(--spacingVerticalL)",
        }}
      >
        <div
          style={{
            background: "var(--pageCardSurface)",
            "border-radius": "var(--pageCardRadius)",
            "box-shadow": "var(--pageCardShadow)",
          }}
        >
          {/* 5 menu items: 我的作品, 我的收藏, 我的关注, 我的粉丝, 设置 */}
          {["我的作品", "我的收藏", "我的关注", "我的粉丝", "设置"].map(
            (_label, i) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  padding:
                    "var(--spacingVerticalL) var(--spacingHorizontalXL)",
                  gap: "var(--spacingHorizontalM)",
                  ...(i < 4
                    ? {
                        "border-bottom":
                          "1px solid var(--pageCardBorder)",
                      }
                    : {}),
                }}
              >
                {/* Icon placeholder */}
                <SkeletonShimmer
                  style={{
                    width: "22px",
                    height: "22px",
                    "border-radius": "var(--borderRadiusSmall)",
                    "flex-shrink": "0",
                  }}
                />
                {/* Label placeholder */}
                <SkeletonShimmer
                  style={{
                    flex: "1",
                    height: "var(--spacingVerticalL)",
                    "border-radius": "var(--borderRadiusSmall)",
                    "max-width": "100px",
                  }}
                />
                {/* Chevron placeholder */}
                <SkeletonShimmer
                  style={{
                    width: "16px",
                    height: "16px",
                    "border-radius": "var(--borderRadiusSmall)",
                    "flex-shrink": "0",
                  }}
                />
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  </PageTransition>
);

export default ProfileSkeleton;
