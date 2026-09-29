# Fluent Shimmer Loading — Design Spec

> **⚠️ 存档文档（archive）**：本文描述的是**已下线**的形态。WebView 客户端的运行时已随
> [#610](https://github.com/a1121611810/Pictelio/issues/610) 下线，其**源码、构建配置、依赖与专属测试**
> 已随 [ADR-0203](adr/ADR-0203-webview-client-source-removal.md) 整包删除。
> 本文正文**一字未改**，保留供决策史参考；其中的路径、命令与文件清单**均已失效**，勿照抄执行。
> 当前形态见 [glossary-webview-client-removal](adr/glossary-webview-client-removal.md)。

## Overview

Replace the current `LoadingSpinner` component with a Fluent Design 2–aligned shimmer/sweep loading indicator. No separate spinner or progress ring — the loading state is communicated entirely through a subtle brand-colored sheen sweeping across the Pictelio logo badge.

## Motivation

Previous iterations tried a circular spinner below the logo, a rounded-rect ring around it, and a pulse animation — none felt sufficiently Fluent. The Shimmer approach is cleaner, more minimal, and matches the pattern Microsoft 365 apps use for branded loading states.

## Visual Design

```
┌──────────────────────────┐
│                          │
│      ┌──────────┐        │
│      │  ✦ 扫光  │        │   Pictelio logo (white rounded badge)
│      │  ────→   │        │   with diagonal brand-color shimmer
│      └──────────┘        │
│                          │
│       加载中...          │   optional caption text (12px, --colorNeutralForegroundDisabled)
│                          │
└──────────────────────────┘
```

### Logo

- The existing Pictelio logo SVG (white rounded-rect badge + blue bird/feather icon)
- Rendered at three sizes:

| Size | Logo px |
|------|---------|
| sm   | 64      |
| md   | 80      |
| lg   | 96      |

- Subtle drop shadow (`feDropShadow`) on the white badge for depth

### Shimmer Effect

A diagonal gradient overlay that sweeps across the logo badge area by translating across the badge (implementation uses `transform: translateX(-100%→+100%)` on a full-size overlay clipped to the badge shape, as `background-position` animation proved unreliable):

| Property | Value |
|----------|-------|
| Angle | 110° (top-left to bottom-right diagonal) |
| Gradient | `transparent → brandStroke1@12%(light)/18%(dark) → transparent` |
| Animation | `transform: translateX(-100%) → translateX(+100%)` |
| Duration | `var(--durationSlower)` (400ms) |
| Easing | `var(--curveEasyEase)` (`cubic-bezier(0.33,0,0.67,1)`) |
| Repeat | infinite |

The shimmer is rendered as a CSS `linear-gradient` on an absolutely-positioned `<div>` that covers the logo badge area. The gradient is defined as a CSS class (`.shimmer-gradient`) in `base.css` with separate light (12%) and dark (18%) opacity values for proper theme adaptation. The `border-radius` matches the badge's `rx="44"` (scaled proportionally: `calc(44 / 168 * 100%)`) so the shimmer stays within the rounded corners.

### Theme Adaptation

| Theme | Shimmer color |
|-------|--------------|
| Light | `--colorBrandStroke1` (#2b579a) @ 12% opacity |
| Dark  | `--colorBrandStroke1` (#5a9fd4) @ 18% opacity |

### Text

- Optional caption below the logo (e.g. "加载中...")
- Font: `--fontSizeBase200` (12px)
- Color: `--colorNeutralForegroundDisabled`

## Component API

Unchanged from current `LoadingSpinner`:

```tsx
interface Props {
  size?: "sm" | "md" | "lg";   // controls logo dimensions
  text?: string;                  // optional caption
}
```

## Implementation

### Files to modify

1. **`src/styles/base.css`** — Add `fluent-shimmer-sweep` keyframe animation, remove unused keyframes
2. **`src/components/LoadingSpinner.tsx`** — Rewrite to:
   - Remove the Fluent circular spinner SVG
   - Remove logo pulse animation
   - Add shimmer overlay div on top of logo badge
   - Keep static logo + optional text layout
3. No other files — same API, same imports

### Animation CSS

```css
@keyframes fluent-shimmer-sweep {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
```

(matches the existing `fluent-shimmer` keyframe pattern in the project)

### Component structure

```tsx
<div class="flex flex-col items-center justify-center py-12 gap-3"
     style="animation: fluent-scale-enter ...">
  <!-- Logo with shimmer overlay -->
  <div class="relative" style="width/badge dimensions">
    <!-- Base logo SVG -->
    <svg class="absolute inset-0">...</svg>
    <!-- Shimmer overlay (matches badge shape, clipped by border-radius) -->
    <div class="absolute overflow-hidden"
         style="left: calc(12/192*100%); top: calc(12/192*100%);
                width: calc(168/192*100%); height: calc(168/192*100%);
                border-radius: calc(44/168*100%)">
      <div class="shimmer-gradient"
           style="animation: fluent-shimmer-sweep var(--durationSlower) var(--curveEasyEase) infinite" />
    </div>
  </div>
  {props.text && <p>...</p>}
</div>
```

## Sizing calculation

Logo viewBox is 192×192. The white badge occupies `[12, 12, 168, 168]` with `rx=44`.

To match the shimmer overlay precisely:
- The shimmer clip div is sized to the badge area (87.5% of container = 168/192)
- `border-radius` set to `calc(44 / 168 * 100%)` to match badge corners proportionally (the badge is 168×168, so rx=44 is relative to 168, not the full 192 viewBox)
- Overflow hidden to clip the shimmer to the badge shape

## Migrating from current implementation

- Remove the circular spinner SVG (track + active arc circles)
- Remove the `fluent-spinner-dash` keyframe usage
- Remove the `spin` animation from the spinner SVG
- Add shimmer overlay structure
- Keep the entrance animation (`fluent-scale-enter`) on the container
- Keep the logo SVG unchanged

## Files referenced

- `packages/app/src/components/LoadingSpinner.tsx`
- `packages/app/src/styles/base.css`
