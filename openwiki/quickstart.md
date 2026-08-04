---
type: Quickstart
title: Pictelio — OpenWiki Quickstart
description: Entrypoint for the Pictelio repository documentation. Pictelio is a third-party Pixiv illustration browser with two rendering clients — a SolidJS SPA (Capacitor Android) and a vue-lynx MVP (ReactLynx runtime).
tags: [pictelio, pixiv, solidjs, capacitor, android, vue-lynx]
---

# Pictelio Documentation

**Pictelio** (repo name `pixivizer`) is a third-party [Pixiv](https://www.pixiv.net) illustration browser with two rendering clients:

- **[`pictelio-app`](/packages/app/)** — SolidJS SPA, packaged as a native Android app via [Capacitor](https://capacitorjs.com/) (primary client)
- **[`pictelio-app-lynx`](/packages/app-lynx/)** — vue-lynx MVP on the [ReactLynx](https://lynxjs.org/) runtime (parallel client, pre-alpha)

This wiki helps humans and agents understand the architecture, workflows, integrations, and test strategy.

## Quick Facts

| Attribute | Value |
|-----------|-------|
| Framework | SolidJS 1.9 |
| Language | TypeScript 6.0 (strict) |
| Bundler | Rolldown (production) via vite-plus; Vite dev server |
| Styling | UnoCSS 66.7 + Microsoft Fluent Design System 2 |
| Routing | @solidjs/router 1.0 |
| Data Fetching | @tanstack/solid-query 5.101 |
| Local DB | @tanstack/solid-db 0.2 (IndexedDB) |
| Mobile Runtime | Capacitor 8.4 (Android target) |
| Package Manager | pnpm 11.9 |
| Monorepo Packages | `pictelio-app` (SPA), `pictelio-website` (Astro landing page, GitHub Pages), `pictelio-app-lynx` (vue-lynx MVP) |

## Documentation Map

### Architecture

- **[Architecture Overview](/openwiki/architecture/overview.md)** — Monorepo layout, build tooling, Fluent Design, CSS architecture, SolidJS + TanStack ecosystem, boot sequence, and [app-lynx client](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client) (vue-lynx, Tailwind, hand-rolled router)
- **[API Layer & Authentication](/openwiki/architecture/api-layer.md)** — Pixiv API client, dual-mode transport (Web fetch vs CapacitorHttp), OAuth flows, token storage, 401 retry with Promise queue, GET deduplication
- **[Image Loading Pipeline](/openwiki/architecture/image-pipeline.md)** — Three-layer cache (LRU keys → browser cache → Android disk), image host selection (race/weighted/fastest-ip/single), WebView proxy interception, Web Worker measurement

### Domains & Workflows

- **[Feed & Browsing](/openwiki/domain/feed-and-browsing.md)** — Recommended/following feeds, virtual scrolling with pull-to-refresh, masonry/column/grid layout modes, search, bookmarks, browsing history, R18 filtering, age confirmation gate
- **[Novel Reader](/openwiki/domain/novel-reader.md)** — Novel detail with virtualized text layout, in-text search with highlighting, reading progress, series sheet, novel feed with three layout modes, Pretext library integration, AI translation (BYOK DeepSeek, chunked pipeline + LRU cache + R18 grading)

### Integrations

- **[Android Native & Build](/openwiki/integrations/android-native.md)** — Four native Capacitor plugins (AuthPlugin, ImageCachePlugin, OAuthPlugin, PixivApiPlugin), Android Keystore token encryption, WebView config, Gradle build pipeline, release signing, version sync

### Testing & Operations

- **[Testing Strategy](/openwiki/testing/overview.md)** — Two test tiers (unit + agent-browser E2E), Playwright/browser-component migration completed (ADR-0034, ADR-0035), file naming conventions, test helpers, CI workflows

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
| 0003 (backup security) | refresh_token backup protection — three-layer defense; reuses ADR number 0003 (`0003-backup-security-three-layer-defense.md`, v3.21.6) |
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
| 0034 | Migrate Playwright E2E tests to agent-browser (AI-driven E2E) |
| 0035 | Migrate browser component tests to unit + agent-browser E2E |
| 0036 | Error tuple pattern replaces try-catch across all layers (tryAsync/trySync) |
| 0037 | PixivApiPlugin gateway — native-only Pixiv API, access_token hidden from JS heap |
| 0038 | Immediate navigation — render first, load data later; shallow loaders + skeleton screens |
| 0039 | Detail image cache-ready rendering — two-phase preload with URL-keyed cacheReadyFor signal; eliminates HttpURLConnection fallback race for multi-page illusts |
| 0040 | Splash lifecycle evolution: ADR-0040 introduced scale+fade exit animation; removed in `fa2015c` (v3.21.7); **reintroduced** with 120ms scale+fade + loading-triggered 350ms dismiss delay to ensure skeleton paint before splash exit |
| 0041 | Token barrier — `tokenReady` Promise blocks API requests before auth init completes; `authPermanentFailure` prevents request avalanche on token failure |
| 0042 | Demand query — `createTQFeedStore` default `enabled: false` defers all store queries to explicit `ensureLoaded` calls; skeleton renders before first fetch |
| 0043 | Skeleton rendering guarantee — `setTimeout(0)` replaces `requestAnimationFrame` in feed `onMount` to ensure skeleton paints before data load |
| 0044 | app-lynx responsive unit selection — fontSize uses `rpx`, width/spacing/padding uses `vw`; backed by [glossary-lynx-units](/docs/adr/glossary-lynx-units.md) |
| 0045 | app-lynx scrolltolower infinite-loading fix — web-core mis-trigger, root-caused to `scrolltolower` event firing when list is empty/short |
| 0046 | app-lynx Tailwind CSS migration — spacing=vw, fontSize=rpx, Fluent semantic color palette via `@lynx-js/tailwind-preset`; all 6 pages migrated (Login → Me, T2–T8) |
| 0047 | app-lynx automated visual verification — CDP + Vivaldi persistent profile; recursive shadowRoot/iframe traversal to penetrate lynx-view render boundary; `Input.insertText` for login (vue-lynx v-model unresponsive to native events); 6-page Tailwind utility verification matrix |
| 0048 | app-lynx recommended card layout — `Recommended.vue` waterfall cards use `aspect-[1/1]` containers + `aspectFill` (not `widthFix`), list-engine column width (not `w-full`), list `gap` attributes (not margin); detail page `IllustDetail.vue` extends pattern with dynamic `aspect-ratio` from API `width/height`; shimmer skeleton screen for list and detail loading states (global `@keyframes shimmer` + `SkeletonCard.vue`) |
| 0049 | app-lynx back without reload — `App.vue` `<KeepAlive>` caches list/static page instances (recommended/novels/me) so returning from detail doesn't remount or refetch; `router.ts` navigation history stack with replace semantics for login routes; component `defineOptions({ name })` for KeepAlive `include` matching |
| 0050 | app-lynx login persistence — web-core uses IndexedDB for `refresh_token` persistence (Worker environment, no localStorage); `tokenStorage.ts` wrapper with save/load/clear; `authStore.restoreToken()` now actually restores from IndexedDB; native LynxView (#41) will use Lynx Native Module aligned with main project `@aparajita` Keystore storage for cross-client login sharing |
| 0051 | app-lynx R18/R18G content filtering — generic IndexedDB KV layer (`idbKV.ts`, DB version 2) replaces inline IndexedDB code; `tokenStorage.ts` refactored to thin wrapper over `idbKV`; new `settingsStore.ts` with `showR18`/`showR18G` switches (default false, persisted via IndexedDB KV) and `filterByRestrict()`; two Fluent-style toggle switches on Me page; feed filtering applied in `Recommended.vue` and `NovelList.vue` first page + pagination; `initRouter` calls `loadSettings()` on startup |
| 0052 | app-lynx illust bookmark — `addBookmark`/`deleteBookmark` API in `illust.ts` (POST `/v2/illust/bookmark/add` + `/v1/illust/bookmark/delete`, default `restrict: public`); reusable `BookmarkButton.vue` component with local state, `@tap.stop` bubble prevention, and optimistic count ±1; integrated into `IllustDetail.vue` (detail page) and `Recommended.vue` (feed cards) |
| 0053 | Lynx NativeModule contract — `NativeModules` dual-channel detection (bare global + globalThis), callback no-null contract, native-mode absolute URL rewriting, access_token Java heap isolation via `PictelioAuth`/`PictelioApi` modules |
| 0054 | Image pipeline unified core — `PixivImageLoader` shared by webview + Lynx clients (single URL rewrite, disk cache, OkHttp pool, per-URL locking); thin adapters (`MainActivity.interceptImage` + `PictelioImageService`) |
| 0055 | vue-lynx native render compat — text/`list-item` root `@tap` fix (wrap in `<view>`), scroll-view `aspectRatio`/`minHeight` collapse fix (fixed-height container), XElement `<input>` behavior registration, `item-key` String enforcement, `super.onCreate` ordering |
| 0056 | lynx list number prop binding — list number-type attributes (`span-count`, `lower-threshold-item-count`, etc.) must use v-bind number binding (`:span-count="2"`); static strings silently rejected by native layout engine (single-column fallback, no error). Web-core's `parseFloat` mask hides the issue in dev preview |
| 0057 | Android emulator verification on macOS 26.5.2 — HVF acceleration broken in emulator 37.1.11; adopted android-34 google_apis image + 720p + 3GB RAM + Quickboot snapshots (<10s boot vs 45min for android-36.1 TCG); documented in [glossary-emulator-verification](/docs/adr/glossary-emulator-verification.md) |
| — | [glossary-app-lynx-native](/docs/adr/glossary-app-lynx-native.md) — Unified terminology for lynx native integration (dual client, NativeModule contract, image pipeline, render compat, automated verification) |

## Key Source Files

| Purpose | Path |
|---------|------|
| App entry | `/packages/app/src/main.tsx` |
| Router definition | `/packages/app/src/router.tsx` |
| Root layout | `/packages/app/src/routes/__root.tsx` |
| Pixiv API client | `/packages/app/src/api/client.ts` |
| Auth store | `/packages/app/src/stores/authStore.ts` |
| Token persistence (secure storage) | `/packages/app/src/utils/secureStorage.ts` |
| Native Pixiv API bridge | `/packages/app/src/native/PixivApi.ts` |
| Feed virtualizer | `/packages/app/src/primitives/createFeedVirtualizer.ts` |
| Feed store factory | `/packages/app/src/stores/shared/createTQFeedStore.ts` |
| Recommended feed store | `/packages/app/src/stores/recommendedStore.ts` |
| Follow feed store | `/packages/app/src/stores/followStore.ts` |
| Feed helpers (dedup, pagination) | `/packages/app/src/stores/shared/feedHelpers.ts` |
| Novel recommended store | `/packages/app/src/stores/novelRecommendedStore.ts` |
| Novel follow store | `/packages/app/src/stores/novelFollowStore.ts` |
| Novel bookmark store | `/packages/app/src/stores/novelBookmarkStore.ts` |
| Novel feed helpers | `/packages/app/src/stores/shared/novelHelpers.ts` |

## Available Scripts

All commands are run from the monorepo root:

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | TypeScript check + Vite build |
| `pnpm test` | Vitest unit tests |
| `pnpm test:agent-browser` | AI-driven agent-browser E2E tests |
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
- **`husky`** pre-commit hook (`.husky/pre-commit`) — Automatically runs `pnpm openwiki:update` when `src/`, `packages/`, `AGENTS.md`, or `CLAUDE.md` change, then stages any updated `openwiki/` files (eliminates dirty subsequent commits)
- **`husky`** commit-msg hook (`.husky/commit-msg`) — Runs `commitlint` on the message

The **CLAUDE.md** file at the repository root contains agent-specific instructions including OpenWiki maintenance rules and a commitment to run `pnpm openwiki:update` before committing source changes.

A scheduled **OpenWiki GitHub Actions workflow** (`.github/workflows/openwiki-update.yml`) refreshes the repository wiki on a recurring basis, as a fallback guard if the pre-commit hook is bypassed.

## Repo Evolution (Recent History)

The repository has been actively refactored through v3.17.x. Key themes in recent commits:

- **Store migration:** All list stores migrated from hand-written `createStore` patterns to the `createTQFeedStore` factory wrapping TanStack Query's `createInfiniteQuery` (ADR-0016, ADR-0022). This eliminated 200-300 lines of boilerplate.
- **Feed store split + legacy cleanup:** The monolithic `feedStore.ts` (illusts) and `novelStore.ts` (novels) have been split into dedicated per-tab stores using the same factory. `recommendedStore.ts` and `followStore.ts` power the new `RecommendedFeed` and `FollowFeed` components inside the consolidated `HomePage` at `/home`. `novelRecommendedStore.ts`, `novelFollowStore.ts`, and `novelBookmarkStore.ts` are now also **integrated** — `NovelRecommendedFeed` and `NovelFollowFeed` import directly from split stores. Both legacy monolithic stores and their tests have been **deleted** (commit `b30366f`). Shared helpers extracted to `feedHelpers.ts` and `novelHelpers.ts`.
- **Scroll restoration consolidation:** Custom scroll restoration primitives (`createScrollRestore`, `createVirtualScrollRestore`, `createFeedScrollStore`) have been **deleted** — `@solidjs/router`'s built-in `<Router scrollRestoration>` prop now handles scroll position save/restore via sessionStorage. Login and age-confirmation pages clear `sessionStorage.removeItem("solid-router:scroll")` to prevent stale position restoration after auth flow. Per-tab scroll state within `/home` is no longer saved or restored.
- **Image pipeline:** Periodic GC with context-aware eviction for the L1 image cache; L1 key set migrated to Set-based `LRUSet` (ADR-0030, ADR-0014).
- **Ugoira (animated illust):** In-place playback with percentage loading progress indicator; list card aspect ratio changed to 1:1 square for consistency.
- **Testing:** Playwright E2E and Vitest browser component tests fully migrated to agent-browser (AI-driven) E2E + unit tests (ADR-0034, ADR-0035); Playwright and `@vitest/browser-playwright` dependencies removed; ~40 test files consolidated into 2 tiers
- **OAuth:** Transport layer deduplication between `auth.ts` and `pkceAuth.ts` (ADR-0028); loginUrl lambda capture fix for iOS.
- **Author navigation:** Full coverage of third-party username click → personal center (ADR-0032).
- **Update dialog fix:** Startup update dialog migrated from `<fluent-dialog>` (invisible on dynamic creation) to a pure CSS fixed overlay. `autoCheckUpdate` default changed to `true` (ADR-0033). The check itself runs in `updateService.ts` `checkForUpdate()` — called at startup from `__root.tsx` and manually from `SettingsAccount.tsx` — which fetches `packages/website/version.json` (written by `packages/app/scripts/release.mjs` during `pnpm release` with `version`/`url`/`changelog` fields). The release link is parsed from the `url` field, with `release_url` kept as a future-compat fallback (previously only `release_url` was read, which the generated JSON never contains, leaving the link empty).
- **PixivApiPlugin gateway (v3.18.0, ADR-0037):** All Pixiv API traffic unified through a single Java Capacitor plugin. `access_token` removed from JS heap entirely — stored in a Java `volatile` field. Image prefetching writes directly to disk, zero bytes into JS heap. 401 auto-refresh moved from JS Promise queue to Java `synchronized` lock. Old `PictelioHttpPlugin` and `PictelioHttp.ts` deleted; `client.ts` simplified by ~120 lines. **Security:** `access_token` is only present in JS during DEV mode (`import.meta.env.DEV` dead-code eliminated by Oxc minifier in production builds). OAuth credentials exist only in compiled Java bytecode (`OAuthConfig` auto-generated from `credentials.json5`).
- **Immediate navigation (v3.20.0, ADR-0038):** Router loaders no longer await network I/O. Pages render chrome + skeleton screens instantly and load data in the component via `onMount`/`createEffect`. Six `*Skeleton` components match each data route's layout. Redundant loader→hydration indirection removed from IllustDetail and NovelDetail.
- **Splash bridge refactor (v3.21.0):** Splash Screen dismiss migrated from direct AndroidX `core-splashscreen` API to JS-controlled via `AuthPlugin.hideSplash()` Capacitor bridge. `splashBridge.ts` calls the existing AuthPlugin (not `@capacitor/splash-screen`), which sets an `AtomicBoolean` in `MainActivity` to trigger `SplashScreen.setKeepOnScreenCondition`. See [Android Native & Build](/openwiki/integrations/android-native.md#splash-screen-js-bridge).
- **Rolldown + Oxc minifier (v3.18.0):** Production bundler switched from Vite/terser to Rolldown with Rust-based Oxc minifier. Build comments updated across codebase.
- **Token storage security hardening (v3.21.6, ADR-0003):** `secureStorage.ts` rewritten into a `restore/save/clear` deep module with backup-integrity marker + native memory sync; `PixivApiPlugin.setRefreshToken` → `syncToken` (memory-only, no disk writes); backup XML rules now exclude the real ciphertext file names (`WSSecureStorageSharedPreferences.xml` + `PictelioPrefs.xml`); new `backupRulesConsistency.test.ts` guards against drift. Grounded in `docs/research/android-token-storage.md` — see [API Layer & Authentication](/openwiki/architecture/api-layer.md#token-persistence--backup-integrity).
- **Novel AI translation (S1–S7, complete):** BYOK DeepSeek translation shipped in seven stacked milestones — S1 minimal closed loop (BYOK key + single-block translation + 原文/译文 toggle); S2 chunked pipeline (≤2000-char paragraph-boundary chunks, first-screen priority ordering, ≤3-way concurrency with exponential-backoff retries, AbortController cancel, progressive injection); S3 LRU 200-chapter IndexedDB cache with source-hash invalidation; S4 failure handling + 断点续翻 (〔未翻译〕 markers, retry-failed without re-billing); S5 R18/R18G sensitive-content grading (client-side gate — nothing sent when blocked — with two-level confirmation); S6 settings completion (default quality tier + thinking toggle); S7 per-page temporary tier switch (doesn't pollute the global default). New `api/translate.ts` (OpenAI-compatible `/chat/completions`, dual fetch/CapacitorHttp transport), `createNovelTranslator`, `translationStore`, `translationCache`, `detectLanguage`, `prompts`; `db.ts` bumped to v2 for the `translations` store. Spec: `docs/specs/novel-ai-translation.md`; see [Novel Reader](/openwiki/domain/novel-reader.md#ai-translation).
- **E2E suite stability (Issue #19, 19/42 → 42/42):** `createLoggedInDriver` rebuilt as a 4-phase looped login wait with 3 launch retries; `navigateSpa()` bypasses the startup-navigation override; white-screen guards (`waitForPageContent`/`waitForSelector`) and `clickReliable` `scopeSelector` added; daemon cleanup switched to lsof-based precise kill. See [Testing Strategy](/openwiki/testing/overview.md).
- **Lynx native integration (ADR-0053, 0054, 0055, 0056):** App-lynx brownfield integration inside the main Android app (`MainActivity` routing gate → `LynxActivity`). NativeModule access_token isolation (ADR-0053) — `PictelioApi`/`PictelioAuth` LynxModules forward API/OAuth through Java, access_token stays in Java heap (JS zero-knowledge), callback no-null contract. Unified image pipeline (ADR-0054) — `PixivImageLoader` shared core with per-URL locking serves both webview proxy and Lynx `PictelioImageService`, dual client share `pictelio-images` cache directory. Native render compat (ADR-0055) — text/`list-item` tap wrapped in `<view>`, scroll-view aspectRatio patched with fixed-height containers, XElement behaviors registered, `item-key` String enforced, `super.onCreate` ordering fixed. Number prop binding contract (ADR-0056) — list number-type attributes must use v-bind (`:span-count="2"`); static strings silently rejected by native layout engine (single-column fallback), masked by web-core's loose `parseFloat`. Automated verification via [`lynx-flow-check.sh`](/packages/app-lynx/scripts/lynx-flow-check.sh) (full-process device flow with resolution-adaptive screenshot analysis) and [`e2e-me-scroll.mjs`](/packages/app-lynx/scripts/e2e-me-scroll.mjs) (CDP E2E regression). See [Architecture Overview > app-lynx](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client) and [Android Native & Build](/openwiki/integrations/android-native.md).
- **Me page scroll fix (issue #90):** The Me settings page was restructured from a flat `<view>` to a `flex flex-col` layout with fixed header + `<scroll-view>` for content overflow. Content sections were reorganized into semantic groups (account, client, content, animation playback, logout) with bottom padding. The `lynx-flow-check.sh` flow verification gained a step 8 for settings-page scroll regression and resolution-adaptive coordinate scaling (no longer hardcoded 1080x2400).

## Backlog

The following areas are either already well-documented in existing docs or too narrow for a dedicated wiki page:

- **Cross-platform migration research** — Nine new feasibility reports in `docs/research/` evaluating replacing the Capacitor WebView client: `lynx-migration-feasibility.md` (entrypoint) plus `lynx-pure-engine-analysis.md`, `vue-lynx-deep-dive.md`, `vue-lynx-production-readiness.md`, `vue-lynx-masonry-feasibility.md`, `vue-lynx-benchmark-ifr.md` (IFR benchmark analysis, 32-device runs, IFR rejected for app-lynx), `taro-migration-feasibility.md`, `tauri-migration-feasibility.md`, and `uniapp-x-migration-feasibility.md`. Research only — no code changes or framework decision yet; revisit when a migration is actually scheduled.
- **Image loading pipeline deep-dive** — 40KB+ doc at `/docs/image-loading-pipeline.md` covers timing, diagrams, and optimization matrix. The [wiki page](/openwiki/architecture/image-pipeline.md) links there.
- **Website package** (`/packages/website/`) — Astro 7 landing page with full redesign (migrated from VitePress in v3.18.0). Dark-first theme with light toggle, cursor glow effect, CSP headers, Open Graph metadata. Low project-specific complexity.
- **Fluent Design token reference** — Covered in `AGENTS.md` and `/packages/app/src/styles/tokens.css`.
- **Comment system design** — Documented at `/docs/comment-system-design.md`. Structurally simple and stable.
- **Individual store deep-dives** — Stores are well-structured and self-documenting; document if refactoring is needed.
- **ImageHostSettings page internals** — Large route page (23K+ lines); covered by image pipeline docs.
- **Settings pages sub-components** — Covered by ADR-0018; straightforward settings to component mapping.
- `/docs/superpowers/` — Superpowers documentation plugin system (plugin-specific, not core app logic).
