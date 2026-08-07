---
type: Concept
title: Feed & Browsing
description: The illust and novel browsing system — recommended/following feeds with virtual scrolling, three layout modes, pull-to-refresh, R18 filtering, search, bookmarks, browsing history, and user profiles.
tags: [feed, browsing, virtual-scroll, pixiv, masonry, waterfall]
---

# Feed & Browsing

The feed and browsing system covers the primary user experience: discovering and viewing Pixiv illusts and novels.

## Feed Architecture

Two feed content types are rendered inside the consolidated **HomePage** (`/packages/app/src/routes/HomePage.tsx`) at the `/home` route. Navigation between all four tabs — recommended, follow, bookmarks, and history — is handled by **NavBar** (`/packages/app/src/components/NavBar.tsx`), which maps every tab to `/home` and uses in-page CSS display toggling via `currentTab()` (no router-level navigation between tabs). The standalone `/bookmarks` and `/history` routes were removed; bookmarks and history are now HomePage sub-components only.

| Feed | Route | Component | Store(s) |
|------|-------|-----------|----------|
| Recommended (illusts) | `/home` (tab: recommended) | `RecommendedFeed` | `recommendedStore.ts` (new split store) |
| Follow (illusts) | `/home` (tab: follow) | `FollowFeed` | `followStore.ts` (new split store) |
| Bookmarks (illusts/novels) | `/home` (tab: bookmarks) | `BookmarksFeed` | `bookmarkStore.ts` (delegates to `IllustBookmarks`/`NovelBookmarks`) |
| History | `/home` (tab: history) | `HistoryFeed` | `historyStore.ts` (TanStack DB, localStorage) |
| Novel Feed (recommended) | `/home` (tab: recommended, novel mode) | `NovelFeedPage tab="recommended"` (embedded fallback) | `novelStore.ts` (legacy) |
| Novel Feed (follow) | `/home` (tab: follow, novel mode) | `NovelFeedPage tab="follow"` (embedded fallback) | `novelStore.ts` (legacy) |

> **Illust stores — integrated (v3.21.x):** The illust feed split is now live. `RecommendedFeed` and `FollowFeed` import directly from the new split stores (`recommendedStore.ts` and `followStore.ts`). The legacy `feedStore.ts` remains in the codebase but is no longer imported by any route component. Shared helpers (`dedupIllusts`, `nextPageOrLoad`) live in `feedHelpers.ts`.

> **Novel store split — integrated:** The monolithic `novelStore.ts` has been split and the split stores are now **imported by route components**. `NovelRecommendedFeed` and `NovelFollowFeed` import directly from `novelRecommendedStore.ts` and `novelFollowStore.ts`. `NovelBookmarks` imports from `novelBookmarkStore.ts`. The legacy `novelStore.ts` has been **deleted**. Shared helpers (`adaptNovelResponse`, `dedupNovels`) live in `novelHelpers.ts`.

### HomePage (Consolidated Home)

`/packages/app/src/routes/HomePage.tsx` — The single home page at `/home` replacing the old separate `/recommended`, `/following`, `/bookmarks`, and `/history` routes:

- **Shared sticky header** with user avatar, app title, and content-type toggle (illust / novel)
- **Content type switching** toggles between illust feeds and novel feeds via `contentType()` from `uiStore` — **hidden on the history tab** (`currentTab() !== "history"`) since browsing history is text-based timeline. Switching dispatches a `contentTypeChanged` custom event and executes a **scroll-to-top with race-condition guard**: the old feed unmount shrinks document height, causing the browser to clamp `scrollY` to a non-zero intermediate value. The fix (`setContentType` in `uiStore.ts`) dispatches a synthetic `scroll` event to cancel `@solidjs/router`'s pending `scrollRestoration` restore, then uses `setTimeout(0)` → `scrollToTop()` to reset after Solid's reactive DOM switch completes.
- **Tab panels** use CSS `display` toggling (`currentTab() === "recommended" ? "block" : "none"`) — at most **2 feed components** are mounted at a time (LRU eviction via `isDomActive()`, commit `fcb2c6f`). When switching to a previously evicted tab, its component remounts and re-fetches data. Non-active tabs are unmounted to save memory.
  - **Bookmarks tab:** Renders `BookmarksFeed` (`/packages/app/src/components/BookmarksFeed.tsx`), which delegates to `IllustBookmarks` (illust mode) or `NovelBookmarks` (novel mode) based on `contentType()`
  - **History tab:** Renders `HistoryFeed` (`/packages/app/src/components/HistoryFeed.tsx`), a full browsing history timeline with inline search and date-range filtering, backed by `useLiveQuery` from TanStack DB
- **Data loaded in `onMount`** (not via router loader): each feed component calls `ensureLoaded(signal)` with AbortController for cancel-on-unmount
- **Splash dismiss:** Simple `onMount` → `markContentReady()`. The skeleton guarantee is now provided by **ADR-0042** (`createTQFeedStore` queries default `enabled: false`) and **ADR-0043** (`setTimeout(0)` defers data load to ensure skeleton paints before first fetch), rather than by delaying splash exit.
- **No per-tab scroll preservation** — the custom scroll restoration system (`createScrollRestore`, `createVirtualScrollRestore`, `createFeedScrollStore`) has been deleted. Cross-navigation scroll restore is handled by `@solidjs/router`'s `<Router scrollRestoration>` prop, which uses sessionStorage keyed by history depth. Tab switches within `/home` do not restore scroll position.
- **Persistent scroll restoration** — A user-facing toggle ("持久化滚动恢复", default OFF) in Settings → Appearance, backed by `persistScrollRestoration` in `uiStore.ts`. When **OFF** (default): cold start clears `sessionStorage["solid-router:scroll"]`, force-scrolls to top, and monitors for Chromium browser-level scroll restoration (a 5s event listener that re-scrolls to top if scrollY > 0). TanStack Virtual `scrollAdjustment` is disabled to prevent image-loading from pushing the list down. When **ON**: scroll position persists across app restarts and `scrollAdjustment` anchors the feed during async image loads. Turning the toggle on navigates to `/scroll-restoration-confirm` for a second confirmation page (variant B: bottom-fixed action bar, thumb-reachable design).

### Feed Store Factory

All feed stores use `createTQFeedStore` (`/packages/app/src/stores/shared/createTQFeedStore.ts`), a shared factory that provides:
- TanStack Query-based data fetching with pagination
- Illust deduplication (`dedupIllusts` by illust ID)
- R18/R18G content filtering
- Sub-tab adapter functions converting between feed-store and factory naming conventions

**Concrete store instances (illusts):**

| Store | File | Sub-tabs | Tab adapter needed? |
|-------|------|----------|---------------------|
| Recommended (active) | `recommendedStore.ts` | mixed/illust/manga | Yes (mixed → factory "all") |
| Follow (active) | `followStore.ts` | all/public/private | No (maps 1:1) |
| Legacy monolithic | `feedStore.ts` | — | **Deleted** (commit `b30366f`) |

**Concrete store instances (novels):**

| Store | File | Sub-tabs | Tab adapter needed? |
|-------|------|----------|---------------------|
| Recommended (active) | `novelRecommendedStore.ts` | (single) | No |
| Follow (active) | `novelFollowStore.ts` | all/public/private | No (maps 1:1) |
| Bookmarks (active) | `novelBookmarkStore.ts` | (single with restrict) | No |
| Legacy monolithic | `novelStore.ts` | — | **Deleted** (commit `b30366f`) |

Shared helpers migrated from `feedStore.ts` to `feedHelpers.ts`:

- **`dedupIllusts`** — Deduplicates illusts by `illust.id`. Used by the factory's `dedupFn` option in merge-all mode.
- **`nextPageOrLoad`** — Routes paginated API calls: if `pageParam` is set, calls `apiClient.get(nextUrl)`; otherwise calls the initial loader function. Both paths normalize the response to `{ items, next_url }`.

Shared helpers migrated from `novelStore.ts` to `novelHelpers.ts`:

- **`adaptNovelResponse`** — Novel-specific pagination adapter that normalizes `{ novels, next_url }` API responses to `{ items, next_url }`. Works like `nextPageOrLoad` from `feedHelpers.ts` but handles the `novels` key used by novel API endpoints.
- **`dedupNovels`** — Deduplicates novels by `novel.id`. Used by the factory's `dedupFn` option in merge mode (e.g. `novelFollowStore`'s all/private merge).

```mermaid
flowchart LR
    HP[HomePage /home] --> RF[RecommendedFeed]
    HP --> FF[FollowFeed]
    RF --> RS[recommendedStore]
    FF --> FS[followStore]
    RS --> TQ[createTQFeedStore]
    FS --> TQ
    TQ --> QC[queryClient.ts]
    QC --> API[api/client.ts]
    API --> P[Pixiv API]
    RF --> VF[VirtualFeed]
    FF --> VF
    VF --> IC[ImageCard / GridCard]
    VF --> CFV[createFeedVirtualizer]
```

### Sub-Tab Navigation (GlassTabBar)

Sub-tab selection across feeds uses the **GlassTabBar** component (`/packages/app/src/components/ui/GlassTabBar.tsx`), a frosted-glass segmented control with pointer-follow highlight and keyboard navigation ([ADR-0044](/docs/adr/ADR-0044-glass-tab-visual-language.md)). It replaces the earlier ad-hoc button-row implementations in all feed components:

| Component | Route / Location | GlassTabBar Tabs | Purpose |
|-----------|-----------------|------------------|---------|
| `HomePage` | `/home` header | 插画 / 小说 | Content-type toggle (hidden on history tab) |
| `RecommendedFeed` | `/home` (recommended tab) | 综合 / 插画 / 漫画 | Recommended illust sub-tab filter |
| `FollowFeed` | `/home` (follow tab) | 全部 / 公开 / 非公开 | Follow illust visibility filter |
| `NovelFollowFeed` | `/home` (follow tab, novel mode) | 全部 / 公开 / 非公开 | Follow novel visibility filter |
| `UserIllusts` | `/user/:id/illusts` | 插画 / 漫画 / 小说 | User works segment switch |

GlassTabBar supports two variants: **`segmented`** (all current usages — full-width equal segments) and **`capsule`** (default — pill-shaped with pointer-follow highlight). The pointer highlight effect is provided by the shared **`usePointerHighlight`** hook (`/packages/app/src/primitives/usePointerHighlight.ts`), which is also used by **NavBar** for its glass capsule visual. The hook tracks `pointermove`/`pointerleave` coordinates on the container and honors `prefers-reduced-motion: reduce` (no highlight layer when set).

ARIA compliance: `role="tablist"` container with `role="tab"` buttons, `aria-selected` on the active tab, roving `tabindex` (only the active tab is focusable), and ArrowLeft/ArrowRight keyboard navigation that stops at endpoints (no wrap).

## Virtual Scrolling

`/packages/app/src/primitives/createFeedVirtualizer.ts` — The core virtualizer for efficient rendering of large illust lists. It:
- Manages a virtual window of visible items
- Coordinates pull-to-refresh and infinite scroll
- Supports three layout modes (waterfall, single, grid)
- **Scroll restoration** is handled by `@solidjs/router`'s built-in `<Router scrollRestoration>` prop, backed by sessionStorage. The custom `createScrollRestore`, `createVirtualScrollRestore`, and `createFeedScrollStore` primitives have been **deleted** (working tree, commit `b30366f`). Scroll restoration is now automatic at the router level for cross-navigation — the virtualizer does not manage its own scroll position memory or retry logic. Per-tab scroll state within `/home` is no longer saved or restored. On login and age-confirmation, `sessionStorage.removeItem("solid-router:scroll")` clears the router's scroll cache to prevent stale position restoration after auth flow.

**`VirtualFeed`** (`/packages/app/src/components/VirtualFeed.tsx`) is the reusable component accepting props:
- `illusts`, `loading`, `error`, `hasMore` — data state
- `onIllustClick`, `onAuthorClick`, `onLoadMore`, `onRefresh` — callbacks
- `layoutMode` — `waterfall` | `single` | `grid`
- `emptyText`, `skipAnimation`, `onNavigateToSettings`

**Empty-state & skeleton fix (`loadAttempted`, v3.21.6+):** VirtualFeed tracks a component-level `loadAttempted` boolean that becomes `true` once `loading`, `error`, or `illusts.length > 0` is observed.
- The "暂无新作品" empty-text message only renders when `loadAttempted` is `true` — preventing an empty-state flash before the first data load completes.
- The skeleton `<div>` now renders when either `loading` is `true` **or** `loadAttempted` is `false` (commit `fa2015c`). This ensures the skeleton fills the viewport even in the brief window before TanStack Query begins its first fetch — when `loading` is still `false` and no data or error has been observed. Previously this gap could show a blank area.

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

**app-lynx equivalent:** [`settingsStore.ts`](/packages/app-lynx/src/stores/settingsStore.ts) provides `showR18`/`showR18G` switches (default `false`, persisted via IndexedDB KV) and `isRestricted(item)` — a pure reactive function that drives a glass overlay (`RestrictOverlay.vue`) instead of removing items from the list. All feed pages render the full list; restricted entries show an R-18 / R-18G badge with "该内容已在设置中隐藏" and no click-through. Toggling a switch in settings makes the overlay disappear instantly without re-fetching. `filterByRestrict` has been deleted. Also adds `SkeletonNovel.vue` for novel list/detail loading states. Switches live on the Me page. Spec: [app-lynx R18 overlay + skeleton](/docs/specs/app-lynx-r18-overlay-skeleton.md), originating from [ADR-0051](/docs/adr/ADR-0051-lynx-r18-filter.md).

## Search

`/packages/app/src/routes/Search.tsx` — Dedicated search page for illusts and novels with a back button in the search bar. Backed by:
- `/packages/app/src/api/search.ts` — API search endpoints
- `/packages/app/src/stores/searchStore.ts` — Search state (query, history, results)

**Popular sort routing:** When `sort=popular_desc` is selected, the search API routes to Pixiv's `/v1/search/popular-preview/illust` or `/v1/search/popular-preview/novel` endpoints instead of the standard `/v1/search/illust` or `/v1/search/novel` endpoints. These popular-preview endpoints return a single un-paginated page of popular results in that category without the `sort` parameter — the `popular_desc` sort mode is implicit in the endpoint choice.

**Auto-load via sentinel:** `SearchResults` (`/packages/app/src/components/SearchResults.tsx`) uses an IntersectionObserver sentinel (`createSentinel`) placed at the bottom of the results list. When the sentinel scrolls into view and `hasMore` is true, `onLoadMore` fires automatically — replacing the earlier manual "Load more" button UX. An end-of-results separator ("没有更多了") appears when `hasMore` becomes false.

## Bookmarks

Bookmarks is no longer a standalone route. The **bookmarks tab** inside `/home` renders `BookmarksFeed` (`/packages/app/src/components/BookmarksFeed.tsx`), which delegates to:
- `/packages/app/src/routes/IllustBookmarks.tsx` — Illust bookmark list (when `contentType() === "illust"`)
- `/packages/app/src/routes/NovelBookmarks.tsx` — Novel bookmark list (when `contentType() === "novel"`)

These sub-pages are still full route components but are embedded inside `HomePage` rather than mounted at their own route. The `PersonalCenter` "My Bookmarks" link now navigates to `/home` with `setCurrentTab("bookmarks")`.

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

**History tab:** The history tab inside `/home` renders `HistoryFeed` (`/packages/app/src/components/HistoryFeed.tsx`), a full browsing history timeline with:
- **Timeline view:** Entries grouped by date headers, sorted oldest-first within each day
- **Inline search:** Debounced 300ms search input with highlighted match `<mark>` elements
- **Date-range filtering:** Start/end date inputs with memoized timestamp conversion
- **Clear all:** Confirmation dialog before clearing all history
- **Author click navigation:** Author names are clickable per [ADR-0032](/docs/adr/ADR-0032-author-click-navigation.md); old entries without `authorId` degrade gracefully to plain text
- **R18/R18G filtering:** Respects user's adult content settings and filters out entries exceeding those thresholds
- **Virtual scroll:** Offloaded to `useLiveQuery` with conditional `where` clauses — the content-type toggle is hidden on the history tab since browsing history is a single text-based timeline

The `contentType()` toggle from `uiStore` is hidden on the history tab (`<Show when={currentTab() !== "history"}>` in `HomePage.tsx`) — history is displayed as a single unified timeline regardless of content type.

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
| Home page (consolidated) | `/packages/app/src/routes/HomePage.tsx` |
| Recommended feed component | `/packages/app/src/components/RecommendedFeed.tsx` |
| Follow feed component | `/packages/app/src/components/FollowFeed.tsx` |
| Recommended store | `/packages/app/src/stores/recommendedStore.ts` |
| Follow store | `/packages/app/src/stores/followStore.ts` |
| TQ feed store factory | `/packages/app/src/stores/shared/createTQFeedStore.ts` |
| Feed helpers | `/packages/app/src/stores/shared/feedHelpers.ts` |
| Virtual feed component | `/packages/app/src/components/VirtualFeed.tsx` |
| Feed virtualizer | `/packages/app/src/primitives/createFeedVirtualizer.ts` |
| Image card | `/packages/app/src/components/ImageCard.tsx` |
| Grid card | `/packages/app/src/components/GridCard.tsx` |
| Nav bar (tab router) | `/packages/app/src/components/NavBar.tsx` |
| Bookmarks feed component | `/packages/app/src/components/BookmarksFeed.tsx` |
| History feed component | `/packages/app/src/components/HistoryFeed.tsx` |
| Search page | `/packages/app/src/routes/Search.tsx` |
| Search store | `/packages/app/src/stores/searchStore.ts` |
| History store | `/packages/app/src/stores/historyStore.ts` |
| Novel recommended feed component | `/packages/app/src/routes/NovelRecommendedFeed.tsx` |
| Novel follow feed component | `/packages/app/src/routes/NovelFollowFeed.tsx` |
| Bookmark store | `/packages/app/src/stores/bookmarkStore.ts` |
| R18 filter utility | `/packages/app/src/utils/r18Filter.ts` |
| Age confirmation | `/packages/app/src/routes/AgeConfirmation.tsx` |
| Block/report store | `/packages/app/src/stores/blockStore.ts` |
| User illusts | `/packages/app/src/routes/UserIllusts.tsx` |
| Follow list page | `/packages/app/src/routes/FollowListPage.tsx` |
| Personal center | `/packages/app/src/routes/PersonalCenter.tsx` |
