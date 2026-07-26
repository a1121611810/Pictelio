---
type: Quickstart
title: Pictelio — OpenWiki Quickstart
description: Entrypoint for the Pictelio repository documentation. Pictelio is a third-party Pixiv illustration browser built with SolidJS, packaged as a native Android app with Capacitor.
tags: [pictelio, pixiv, solidjs, capacitor, android]
---

# Pictelio Documentation

**Pictelio** (repo name `pixivizer`) is a third-party [Pixiv](https://www.pixiv.net) illustration browser built with [SolidJS](https://www.solidjs.com/) and packaged as a native Android app via [Capacitor](https://capacitorjs.com/).

This wiki helps humans and agents understand the architecture, workflows, integrations, and test strategy.

## Quick Facts

| Attribute | Value |
|-----------|-------|
| Framework | SolidJS 1.9 |
| Language | TypeScript 6.0 (strict) |
| Bundler | Vite 8.1 via vite-plus |
| Styling | UnoCSS 66.7 + Microsoft Fluent Design System 2 |
| Routing | @tanstack/solid-router 1.170 |
| Data Fetching | @tanstack/solid-query 5.101 |
| Local DB | @tanstack/solid-db 0.2 (IndexedDB) |
| Mobile Runtime | Capacitor 8.4 (Android target) |
| Package Manager | pnpm 11.9 |
| Monorepo Packages | `pictelio-app` (SPA), `pictelio-website` (VitePress landing page) |

## Documentation Map

### Architecture

- **[Architecture Overview](/openwiki/architecture/overview.md)** — Monorepo layout, build tooling, Fluent Design, CSS architecture, SolidJS + TanStack ecosystem, boot sequence
- **[API Layer & Authentication](/openwiki/architecture/api-layer.md)** — Pixiv API client, dual-mode transport (Web fetch vs CapacitorHttp), OAuth flows, token storage, 401 retry with Promise queue, GET deduplication
- **[Image Loading Pipeline](/openwiki/architecture/image-pipeline.md)** — Three-layer cache (LRU keys → browser cache → Android disk), image host selection (race/weighted/fastest-ip/single), WebView proxy interception, Web Worker measurement

### Domains & Workflows

- **[Feed & Browsing](/openwiki/domain/feed-and-browsing.md)** — Recommended/following feeds, virtual scrolling with pull-to-refresh, masonry/column/grid layout modes, search, bookmarks, browsing history, R18 filtering, age confirmation gate
- **[Novel Reader](/openwiki/domain/novel-reader.md)** — Novel detail with virtualized text layout, in-text search with highlighting, reading progress, series sheet, novel feed with three layout modes, Pretext library integration

### Integrations

- **[Android Native & Build](/openwiki/integrations/android-native.md)** — Four native Capacitor plugins (AuthPlugin, PictelioHttp, ImageCache, OAuthPlugin), Android Keystore token encryption, WebView config, Gradle build pipeline, release signing, version sync

### Testing & Operations

- **[Testing Strategy](/openwiki/testing/overview.md)** — Four test layers (unit/browser/agent-browser/e2e), file naming conventions, test helpers, CI workflows

## Development Quick Start

```bash
# Prerequisites: Node.js 20.19+, pnpm 11.9, Android Studio, JDK 21, Android SDK

# Install dependencies
pnpm install

# Start Vite dev server (port 5173)
pnpm dev

# Android debug build (full pipeline)
pnpm build:android

# One-command Android dev with hot reload
pnpm dev:android
```

> **Proxy note:** Web dev uses Vite proxy for Pixiv API. The app reads `https_proxy` / `HTTP_PROXY` env vars, defaulting to `http://127.0.0.1:10808`. Set before `pnpm dev`.

## Key ADRs

Architecture Decision Records live in `/docs/adr/`. Notable ones:

| ADR | Topic |
|-----|-------|
| 0001 | ProGuard keep strategy for native plugins |
| 0002 | SSRF URL whitelist for WebView proxy |
| 0003 | Image cache three-layer design |
| 0004 | 401 concurrent retry with Promise queue |
| 0006 | TanStack Query adoption |
| 0007 | TanStack DB for browsing history |
| 0014 | LRU key-set migration for L1 cache |
| 0016 | TanStack Query phase 2 (feed/novel stores) |
| 0022 | Complete store migration to TQ factory |
| 0025 | Cleanup comment system |
| 0028 | OAuth transport deduplication |
| 0030 | Image cache periodic GC |
| 0032 | Author click navigation (unified prop chain) |
| 0033 | Startup update dialog: pure CSS overlay replaces Fluent dialog |

## Key Source Files

| Purpose | Path |
|---------|------|
| App entry | `/packages/app/src/main.tsx` |
| Router definition | `/packages/app/src/router.tsx` |
| Root layout | `/packages/app/src/routes/__root.tsx` |
| Pixiv API client | `/packages/app/src/api/client.ts` |
| Auth store | `/packages/app/src/stores/authStore.ts` |
| Feed virtualizer | `/packages/app/src/primitives/createFeedVirtualizer.ts` |
| Feed store factory | `/packages/app/src/stores/shared/createTQFeedStore.ts` |

## Available Scripts

All commands are run from the monorepo root:

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | TypeScript check + Vite build |
| `pnpm test` | Vitest unit tests |
| `pnpm test:browser` | Vitest browser tests (Playwright) |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm test:agent-browser` | AI-driven agent-browser tests |
| `pnpm lint` | oxlint code check |
| `pnpm fmt` | oxfmt code formatting |
| `pnpm build:android` | Full Android debug build chain |
| `pnpm build:android:release` | Signed release APK |
| `pnpm dev:android` | One-command Android dev with hot reload |
| `pnpm release` | Full release pipeline to GitHub Releases |
| `pnpm openwiki:update` | Regenerate OpenWiki documentation from source |

## Tooling & Commit Standards

The project enforces [Conventional Commits](https://www.conventionalcommits.org/) via:

- **`commitlint`** (`.commitlintrc.json`) — Validates commit message format against allowed types (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`) with max 72-char header
- **`husky`** pre-commit hook (`.husky/pre-commit`) — Automatically runs `pnpm openwiki:update` when `src/`, `packages/`, `AGENTS.md`, or `CLAUDE.md` change
- **`husky`** commit-msg hook (`.husky/commit-msg`) — Runs `commitlint` on the message

The **CLAUDE.md** file at the repository root contains agent-specific instructions including OpenWiki maintenance rules and a commitment to run `pnpm openwiki:update` before committing source changes.

A scheduled **OpenWiki GitHub Actions workflow** (`.github/workflows/openwiki-update.yml`) refreshes the repository wiki on a recurring basis, as a fallback guard if the pre-commit hook is bypassed.

## Repo Evolution (Recent History)

The repository has been actively refactored through v3.17.x. Key themes in recent commits:

- **Store migration:** All list stores migrated from hand-written `createStore` patterns to the `createTQFeedStore` factory wrapping TanStack Query's `createInfiniteQuery` (ADR-0016, ADR-0022). This eliminated 200-300 lines of boilerplate.
- **Scroll primitives unification:** Scroll restoration, scroll direction, and scroll-driven visibility were extracted into shared factories. Virtual scroll restoration now uses explicit `window.scrollTo` with ResizeObserver retry, not Virtualizer internals (ADR-0010, ADR-0013, ADR-0023, ADR-0031).
- **Image pipeline:** Periodic GC with context-aware eviction for the L1 image cache; L1 key set migrated to Set-based `LRUSet` (ADR-0030, ADR-0014).
- **Ugoira (animated illust):** In-place playback with percentage loading progress indicator; list card aspect ratio changed to 1:1 square for consistency.
- **Testing:** AI-driven agent-browser E2E framework added; flaky tests stabilized with DOM-based navigation and button clicks.
- **OAuth:** Transport layer deduplication between `auth.ts` and `pkceAuth.ts` (ADR-0028); loginUrl lambda capture fix for iOS.
- **Author navigation:** Full coverage of third-party username click → personal center (ADR-0032).
- **Update dialog fix:** Startup update dialog migrated from `<fluent-dialog>` (invisible on dynamic creation) to a pure CSS fixed overlay. `autoCheckUpdate` default changed to `true` (ADR-0033).

## Backlog

The following areas are either already well-documented in existing docs or too narrow for a dedicated wiki page:

- **Image loading pipeline deep-dive** — 40KB+ doc at `/docs/image-loading-pipeline.md` covers timing, diagrams, and optimization matrix. The [wiki page](/openwiki/architecture/image-pipeline.md) links there.
- **Website package** (`/packages/website/`) — Standard VitePress landing page, low project-specific complexity.
- **Fluent Design token reference** — Covered in `AGENTS.md` and `/packages/app/src/styles/tokens.css`.
- **Comment system design** — Documented at `/docs/comment-system-design.md`. Structurally simple and stable.
- **Individual store deep-dives** — Stores are well-structured and self-documenting; document if refactoring is needed.
- **ImageHostSettings page internals** — Large route page (23K+ lines); covered by image pipeline docs.
- **Settings pages sub-components** — Covered by ADR-0018; straightforward settings to component mapping.
- `/docs/superpowers/` — Superpowers documentation plugin system (plugin-specific, not core app logic).
