---
type: Plan
title: Dead Code Cleanup (ADR-0083) docs update plan
description: Docs impact plan for ADR-0083 dead-code cleanup — which wiki pages to edit and why.
---

# Update Plan — ADR-0083 dead code cleanup

## Evidence

- `docs/adr/ADR-0083-dead-code-cleanup.md` (new, accepted 2026-08-14)
- `docs/adr/glossary-dead-code-cleanup.md` (new)
- `docs/research/dead-code-analysis.md` (new)
- Working-tree `git status`: mass deletions of components/primitives/routes/scripts/assets + `@capacitor/device` removal
- Verified current source tree: `packages/app/src/{components,primitives,routes,scripts}` after cleanup

## Facts to reflect

- Deleted components: RecommendedFeed, FollowFeed, BookmarksFeed, HistoryFeed, CollapsedHeader, AgeGate
- Deleted skeletons: FeedSkeleton, GridSkeleton, ListSkeleton, ProfileSkeleton (only IllustDetailSkeleton + NovelDetailSkeleton remain)
- Deleted primitives: createScrollDirection, createScrolledPast, createScrollDrivenVisibility, scroll/index.ts, measureText, createNovelLoader
- Deleted routes: IllustBookmarks, NovelBookmarks, NovelFollowFeed, NovelRecommendedFeed
- Deleted scripts: capture-real/screenshots/website-screenshots, check-props-setter-mapping, cleanup-auto-imports, generate-screenshots, release-github, lynx e2e-first-frame/e2e-me-scroll
- Reading progress now handled inline in NovelDetail via novelProgressFactory (localStorage)
- Text measurement now inline in createNovelTextLayout (Canvas measureText), not a separate measureText.ts primitive
- Secondary virtualized feeds now only UserWorksFeed (uses VirtualFeed + NovelVirtualFeed)
- Home feed panels (IllustFeedPanel/NovelFeedPanel) backed directly by the six stores

## Pages to edit

1. quickstart.md — ADR table (+0083), fix "Feed store split" bullet, fix "Immediate navigation" skeleton count, drop e2e-me-scroll ref, add Repo Evolution bullet
2. domain/feed-and-browsing.md — line 103 GlassTabBar/RecommendedFeed/FollowFeed; line 120 secondary feeds; line 152 paginationError threading list; line 182 BookmarksFeed; line 225 HistoryFeed; Key Source Files rows 263/264/268/269
3. domain/novel-reader.md — reading progress bullet + mermaid diagram; remove measureText subsection; line 191 secondary routes; Key Source Files rows (createNovelLoader, measureText)
4. architecture/overview.md — line 317 skeleton list; line 348 cleanup-auto-imports.mjs note
5. testing/overview.md — remove e2e-first-frame.mjs + e2e-me-scroll.mjs bullets
6. integrations/android-native.md — remove release-github.mjs + capture-screenshots.mjs rows

## Relationships (source -> meaning -> target)

- ADR-0083 -> supersedes ADR-0023 un-executed deletion step -> scroll primitives removal
- ADR-0083 -> removes legacy of -> ADR-0075 C-shell (old feed components)
- HomePage/IllustFeedPanel/NovelFeedPanel -> renders -> six feed stores (RecommendedFeed/FollowFeed components removed)
- NovelDetail -> owns reading progress -> novelProgressFactory (not createNovelLoader)
- createNovelTextLayout -> measures text inline -> Canvas measureText (measureText.ts removed)
