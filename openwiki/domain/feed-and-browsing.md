---
type: Concept
title: Feed & Browsing
description: The illust and novel browsing system — recommended/following feeds with virtual scrolling, three layout modes, pull-to-refresh, R18 filtering, search, bookmarks, browsing history, and user profiles.
tags: [feed, browsing, virtual-scroll, pixiv, masonry, waterfall]
---

# Feed & Browsing

The feed and browsing system covers the primary user experience: discovering and viewing Pixiv illusts and novels.

## Feed Architecture

Two main feed types are defined in `/packages/app/src/routes/` and backed by stores in `/packages/app/src/stores/`:

| Feed | Route | Component | Store |
|------|-------|-----------|-------|
| Recommended | `/recommended` | `TabFeedPage tab="recommended"` | `feedStore.ts` |
| Following | `/following` | `TabFeedPage tab="follow"` | `feedStore.ts` |
| Novel Feed | `/novel-feed` | `NovelFeedPage` | `novelStore.ts` |

### TabFeedPage

`/packages/app/src/routes/TabFeedPage.tsx` — The shared feed page with sub-tab support:
- **Recommended sub-tabs:** mixed / illust / manga
- **Follow sub-tabs:** all / public / private
- **Data loaded in `onMount`** (not via router loader): `ensureLoaded(signal)` with AbortController for cancel-on-unmount
- Per-tab scroll state restoration via `scrollKey`
- R18 filter reactivity via `r18Handler` closure
- Shows `FeedSkeleton` while no data is available (ADR-0038 immediate navigation pattern)

### Feed Store Factory

Both feed stores now use `createTQFeedStore` (`/packages/app/src/stores/shared/createTQFeedStore.ts`), a shared factory that provides:
- TanStack Query-based data fetching with pagination
- Illust deduplication (`dedupIllusts` by illust ID)
- R18/R18G content filtering
- Scroll state save/restore (`saveFeedScrollState` / `getFeedScrollState`)
- Sub-tab adapter functions converting between feed-store and factory naming conventions

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    TFP[TabFeedPage] --> FS[feedStore]
    FS --> TQ[createTQFeedStore]
    TQ --> QC[queryClient.ts]
    QC --> API[api/client.ts]
    API --> P[Pixiv API]
    TFP --> VF[VirtualFeed]
    VF --> IC[ImageCard<br/>GridCard]
    VF --> CFV[createFeedVirtualizer]
```

## Virtual Scrolling

`/packages/app/src/primitives/createFeedVirtualizer.ts` — The core virtualizer for efficient rendering of large illust lists. It:
- Manages a virtual window of visible items
- Coordinates pull-to-refresh, infinite scroll, and scroll restoration
- Supports three layout modes (waterfall, single, grid)
- Works with `createVirtualScrollRestore` for scroll position memory

**`VirtualFeed`** (`/packages/app/src/components/VirtualFeed.tsx`) is the reusable component accepting 16 props:
- `illusts`, `loading`, `error`, `hasMore` — data state
- `onIllustClick`, `onAuthorClick`, `onLoadMore`, `onRefresh` — callbacks
- `layoutMode` — `waterfall` | `single` | `grid`
- `scrollKey`, `initialScrollState`, `onScrollStateChange` — scroll restoration
- `emptyText`, `skipAnimation`, `suppressHeaderVisibility`, `onNavigateToSettings`

## Layout Modes

| Mode | Columns | Card Component | Description |
|------|---------|----------------|-------------|
| `waterfall` | 2 | `ImageCard` | Masonry layout with variable-height cards |
| `single` | 1 | `ImageCard` | Single-column scroll, largest thumbnails |
| `grid` | 3 | `GridCard` | Uniform grid with compact cards |

`ImageCard` (`/packages/app/src/components/ImageCard.tsx`) handles image loading with skeleton shimmer, author info, bookmark button, and follow/unfollow. `GridCard` is a compact variant.

## R18 Filtering & Age Confirmation

`/packages/app/src/utils/r18Filter.ts` — Filters illusts and novels by `xRestrict` values:
- `xRestrict = 0` — Safe
- `xRestrict = 1` — R18 (adult content)
- `xRestrict = 2` — R18G (extreme content)

User settings control visibility of each tier. An **AgeConfirmation** gate (`/packages/app/src/routes/AgeConfirmation.tsx`) appears on first launch, requiring the user to confirm they are 18+.

## Search

`/packages/app/src/routes/Search.tsx` — Dedicated search page for illusts and novels. Backed by:
- `/packages/app/src/api/search.ts` — API search endpoints
- `/packages/app/src/stores/searchStore.ts` — Search state (query, history, results)

## Bookmarks

`/packages/app/src/routes/Bookmarks.tsx` — Displays user's saved illusts and novels. Sub-pages:
- `/packages/app/src/routes/IllustBookmarks.tsx` — Illust bookmark list
- `/packages/app/src/routes/NovelBookmarks.tsx` — Novel bookmark list

Bookmark state is managed by `/packages/app/src/stores/bookmarkStore.ts`, which integrates with the Pixiv API and drive, also a `bookmarkStore` that toggles bookmarks with optimistic UI updates.

## Author Click Navigation

Per [ADR-0032](/docs/adr/ADR-0032-author-click-navigation.md), all card components now support clicking a third-party username to navigate to that user's personal center (`/user/${userId}`). The feature uses a uniform `onAuthorClick` prop chain:

```
Route Page (navigate) → VirtualFeed (prop pass-through)
  → LazyImageCard/ImageCard/GridCard (prop pass-through)
  → button onClick → e.stopPropagation() → onAuthorClick(user.id)
```

### Affected Components

| Component | Route / Usage | Change |
|-----------|--------------|--------|
| `ImageCard` | Feed (waterfall/single) | `onAuthorClick` prop, `@user.name` is now a clickable button |
| `GridCard` | Feed (grid mode) | Same pattern as ImageCard |
| `NovelCard` | Novel feed (list mode) | `onAuthorClick` prop added |
| `NovelCoverCard` | Novel feed (cover wall) | `onAuthorClick` prop added |
| `VirtualFeed` | All illust feeds | Passes `onAuthorClick` through to cards |
| `NovelVirtualFeed` | Novel feeds | Passes `onAuthorClick` through to cards |
| `SearchResults` | Search page | Author names are clickable |
| `UserWorksFeed` | User profile / illusts | Author names are clickable |
| `HistoryPage` / `HistoryEntry` | Browsing history | `authorId` field stored; old entries degrade gracefully to plain text |

### Key Implementation Details

- **`e.stopPropagation()`** prevents the click from bubbling to the card container, which would trigger navigation to the illust/novel detail page
- **Fluent-compliant touch targets:** all author buttons have `min-h-[40px]` for mobile usability
- **`historyStore`** now stores an optional `authorId` field for history entries; entries without it render as plain text

## Browsing History

`/packages/app/src/stores/historyStore.ts` — Persists history using **TanStack DB** with `localStorageCollectionOptions`:
- L1 = in-memory collection (TanStack DB)
- L2 = full serialization to localStorage (`pictelio-browsing-history`)
- Composite key: `${userId}_${type}_${id}` for user isolation
- Lazy expiry: entries older than 30 days cleared on write
- `historyVersion` signal acts as a non-reactive invalidation token

**`HistoryPage`** (`/packages/app/src/routes/HistoryPage.tsx`) displays grouped browsing history with clear-all support.

## User Pages

| Route | Component | Data |
|-------|-----------|------|
| `/user/:id` | `PersonalCenter` | User profile + recent illusts |
| `/user/:id/illusts` | `UserIllusts` | All illusts by user |
| `/user/:id/following` | `FollowListPage` | Who the user follows |
| `/user/:id/followers` | `FollowListPage` | User's followers |

User profile data is loaded via `/packages/app/src/primitives/useUserProfile.ts`. Follow/unfollow uses optimistic UI with rollback on error.

## Key Source Files

| Purpose | Path |
|---------|------|
| Feed page | `/packages/app/src/routes/Feed.tsx` |
| Tab feed page | `/packages/app/src/routes/TabFeedPage.tsx` |
| Feed store | `/packages/app/src/stores/feedStore.ts` |
| TQ feed store factory | `/packages/app/src/stores/shared/createTQFeedStore.ts` |
| Virtual feed component | `/packages/app/src/components/VirtualFeed.tsx` |
| Feed virtualizer | `/packages/app/src/primitives/createFeedVirtualizer.ts` |
| Image card | `/packages/app/src/components/ImageCard.tsx` |
| Grid card | `/packages/app/src/components/GridCard.tsx` |
| Search page | `/packages/app/src/routes/Search.tsx` |
| Search store | `/packages/app/src/stores/searchStore.ts` |
| History store | `/packages/app/src/stores/historyStore.ts` |
| History page | `/packages/app/src/routes/HistoryPage.tsx` |
| Bookmark store | `/packages/app/src/stores/bookmarkStore.ts` |
| R18 filter utility | `/packages/app/src/utils/r18Filter.ts` |
| Age confirmation | `/packages/app/src/routes/AgeConfirmation.tsx` |
| Block/report store | `/packages/app/src/stores/blockStore.ts` |
| User illusts | `/packages/app/src/routes/UserIllusts.tsx` |
| Follow list page | `/packages/app/src/routes/FollowListPage.tsx` |
| Personal center | `/packages/app/src/routes/PersonalCenter.tsx` |
