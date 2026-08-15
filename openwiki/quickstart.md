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
| Styling | UnoCSS 66.7 + Microsoft Fluent Design System 2 + A2 cardization (Win11 correction, ADR-0074) |
| Routing | @solidjs/router 1.0 |
| Data Fetching | @tanstack/solid-query 5.101 |
| Local DB | @tanstack/solid-db 0.2 (IndexedDB) |
| Mobile Runtime | Capacitor 8.5 (Android target) |
| Package Manager | pnpm 11.9 |
| Monorepo Packages | `pictelio-app` (SPA), `pictelio-website` (Astro landing page, GitHub Pages), `pictelio-app-lynx` (vue-lynx MVP), `@pictelio/update-check` (shared update-check logic), `@pictelio/ugoira` |

## Documentation Map

### Architecture

- **[Architecture Overview](/openwiki/architecture/overview.md)** — Monorepo layout, build tooling, Fluent Design, CSS architecture, SolidJS + TanStack ecosystem, boot sequence, and [app-lynx client](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client) (vue-lynx, Tailwind, hand-rolled router)
- **[API Layer & Authentication](/openwiki/architecture/api-layer.md)** — Pixiv API client, dual-mode transport (Web fetch vs CapacitorHttp), OAuth flows, token storage, 401 retry with Promise queue, GET deduplication
- **[Image Loading Pipeline](/openwiki/architecture/image-pipeline.md)** — Three-layer cache (LRU keys → browser cache → Android disk), image host selection (race/weighted/fastest-ip/single), WebView proxy interception, Web Worker measurement

### Domains & Workflows

- **[Feed & Browsing](/openwiki/domain/feed-and-browsing.md)** — C-shell home page (`SideNavShell` + single-column L5 layout) backed by six feed stores, unified `FeedList` with pull-to-refresh + adaptive tags, secondary virtualized feeds, search, bookmarks, browsing history, R18 filtering (SolidJS) / overlay masking (app-lynx), age confirmation gate
- **[Novel Reader](/openwiki/domain/novel-reader.md)** — Novel detail with virtualized text layout, in-text search with highlighting, reading progress, series sheet, novel feed with three layout modes, Pretext library integration, AI translation (BYOK DeepSeek, chunked pipeline + LRU cache + R18 grading)

### Integrations

- **[Android Native & Build](/openwiki/integrations/android-native.md)** — Four native Capacitor plugins (AuthPlugin, ImageCachePlugin, OAuthPlugin, PixivApiPlugin), Android Keystore token encryption, WebView config, Gradle build pipeline, release signing, version sync

### Testing & Operations

- **[Testing Strategy](/openwiki/testing/overview.md)** — Two test tiers (unit + agent-browser E2E), Playwright/browser-component migration completed (ADR-0034, ADR-0035), file naming conventions, test helpers, CI workflows

## Development Quick Start

```bash
# Prerequisites: Node.js ≥22.22.2, pnpm 11.9, Android Studio, JDK 21, Android SDK

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
| 0044 | Glass Tab visual language — Liquid Glass A+ tier design for all tab controls (GlassTabBar, NavBar capsule, pointer-follow highlight); see [ADR-0044](/docs/adr/ADR-0044-glass-tab-visual-language.md) and [spec](/docs/specs/glass-tab-visual-language.md) |
| 0044 (lynx units) | app-lynx responsive unit selection — fontSize uses `rpx`, width/spacing/padding uses `vw`; see [ADR-0044](/docs/adr/ADR-0044-lynx-responsive-units.md) and [glossary](/docs/adr/glossary-lynx-units.md) |
| 0045 | app-lynx scrolltolower infinite-loading fix — web-core mis-trigger, root-caused to `scrolltolower` event firing when list is empty/short |
| 0046 | app-lynx Tailwind CSS migration — spacing=vw, fontSize=rpx, Fluent semantic color palette via `@lynx-js/tailwind-preset`; all 6 pages migrated (Login → Me, T2–T8) |
| 0047 | app-lynx automated visual verification — CDP + Vivaldi persistent profile; recursive shadowRoot/iframe traversal to penetrate lynx-view render boundary; `Input.insertText` for login (vue-lynx v-model unresponsive to native events); 6-page Tailwind utility verification matrix |
| 0048 | app-lynx recommended card layout — `Recommended.vue` waterfall cards use `aspect-[1/1]` containers + `aspectFill` (not `widthFix`), list-engine column width (not `w-full`), list `gap` attributes (not margin); detail page `IllustDetail.vue` extends pattern with dynamic `aspect-ratio` from API `width/height`; shimmer skeleton screen for list and detail loading states (global `@keyframes shimmer` + `SkeletonCard.vue`) |
| 0049 | app-lynx back without reload — `App.vue` `<KeepAlive>` caches list/static page instances (recommended/novels/me) so returning from detail doesn't remount or refetch; `router.ts` navigation history stack with replace semantics for login routes; component `defineOptions({ name })` for KeepAlive `include` matching |
| 0050 | app-lynx login persistence — web-core uses IndexedDB for `refresh_token` persistence (Worker environment, no localStorage); `tokenStorage.ts` wrapper with save/load/clear; `authStore.restoreToken()` now actually restores from IndexedDB; native LynxView (#41) will use Lynx Native Module aligned with main project `@aparajita` Keystore storage for cross-client login sharing |
| 0051 | ~~app-lynx R18/R18G content filtering~~ **Superseded (issue #91)** — original ADR introduced `filterByRestrict()` to hide R18/R18G items from feeds; replaced by overlay-mask approach (`isRestricted()` + `RestrictOverlay.vue`) because filtering caused blank screens when all items were restricted. IndexedDB KV layer and Me page toggles remain active. |
| 0052 | app-lynx illust bookmark — `addBookmark`/`deleteBookmark` API in `illust.ts` (POST `/v2/illust/bookmark/add` + `/v1/illust/bookmark/delete`, default `restrict: public`); reusable `BookmarkButton.vue` component with local state, `@tap.stop` bubble prevention, and optimistic count ±1; integrated into `IllustDetail.vue` (detail page) and `Recommended.vue` (feed cards) |
| 0053 | Lynx NativeModule contract — `NativeModules` dual-channel detection (bare global + globalThis), callback no-null contract, native-mode absolute URL rewriting, access_token Java heap isolation via `PictelioAuth`/`PictelioApi` modules |
| 0054 | Image pipeline unified core — `PixivImageLoader` shared by webview + Lynx clients (single URL rewrite, disk cache, OkHttp pool, per-URL locking); thin adapters (`MainActivity.interceptImage` + `PictelioImageService`) |
| 0055 | vue-lynx native render compat — text/`list-item` root `@tap` fix (wrap in `<view>`), scroll-view `aspectRatio`/`minHeight` collapse fix (fixed-height container), XElement `<input>` behavior registration, `item-key` String enforcement, `super.onCreate` ordering |
| 0056 | lynx list number prop binding — list number-type attributes (`span-count`, `lower-threshold-item-count`, etc.) must use v-bind number binding (`:span-count="2"`); static strings silently rejected by native layout engine (single-column fallback, no error). Web-core's `parseFloat` mask hides the issue in dev preview |
| 0057 | Android emulator verification on macOS 26.5.2 — HVF acceleration broken in emulator 37.1.11; adopted android-34 google_apis image + 720p + 3GB RAM + Quickboot snapshots (<10s boot vs 45min for android-36.1 TCG); documented in [glossary-emulator-verification](/docs/adr/glossary-emulator-verification.md) |
| 0061 | Android emulator E2E gate — Appium + WebdriverIO infrastructure for on-device testing on fixed AVDs (pictelio_ui/pictelio_low); covers APK build→install→Activity assertion→WebView context switch; accessibility-label contract for Lynx element targeting |
| 0062 | Single-engine client switch hiding — webview/lynx-only APKs hide the engine-switch UI (dead function); full APK retains switch; new `ClientInfoPlugin` (Capacitor) + `PictelioAppModule.getClientKinds()` (Lynx) expose `BuildConfig.CLIENT_KINDS` per-flavor |
| 0064 | Engine-switch experience fix — confirmation dialog replaced with info page (`/client-switch` route with engine diff, warnings, synchronous loading mask, and error-to-failure mapping); R8 `*$$PropsSetter`/`*$$PropsHolder` keep rules preventing release-build white-screen on Lynx launch (38 annotation-generated classes, `Class.newInstance()` reflection, error 990200); `LynxActivity` render-error fallback page with "Back to WebView" exit; build-time R8 mapping assertion; supported by [glossary-client-switch](/docs/adr/glossary-client-switch.md) |
| 0064 (lynx feed tabs) | app-lynx feed tabs gateway — global tabs unified to 推荐/插画/小说/我的 (`navTabs.ts` single source of truth), new `/illusts` page + `IllustList.vue`, `createMixFeed` mixed feed (illust 4:1 novel), novel body via `requestRaw` native gateway, `RestrictOverlay` inline mask mode; see [glossary-app-lynx-feed-tabs-gateway](/docs/adr/glossary-app-lynx-feed-tabs-gateway.md) |
| — | [glossary-app-lynx-native](/docs/adr/glossary-app-lynx-native.md) — Unified terminology for lynx native integration (dual client, NativeModule contract, image pipeline, render compat, automated verification) |
| 0065 | Update-check architecture — shared `@pictelio/update-check` package + dual-client policy (webview soft update vs lynx forced update); version.json manifest; see [glossary-update-check](/docs/adr/glossary-update-check.md) |
| 0065 (release upload) | Per-asset release upload — APK upload split per-package with panel, failure isolation, idempotent retry (`release-panel.mjs`/`release-uploader.mjs`) |
| 0066 | app-lynx system back bridge — illust detail / back-navigation native bridge fixes |
| 0067 | Node release uploader — native Node uploader (2.1× `gh` throughput) + proxy-path detection (`proxy-probe.mjs`, `upload-release-assets.mjs`) |
| 0068 | Update dialog sizing — 85vh max + content-area adaptive scroll + full changelog (cap raised 200→5000 chars, #173/#174) |
| 0069 | Cardized settings & personal center — A2 card grouping for `/settings` + `/me` |
| 0070 | Home A2 cardization — `/home` top bar, feed cards, page background unified to A2 |
| 0071 | Illust detail A2 — `/illust` top bar, image showcase, info cards |
| 0072 | Novel detail A2 — `/novel` header + `NovelCoverCard` + bottom nav (body text deliberately not carded) |
| 0073 | Home content A2 unification — radius/state unified across all 7 content domains |
| 0074 | A2 Win11 correction — 8px radius + 1px border + no shadow (Fluent 2 spec) |
| 0075 | Home C shell + L5 fixed layout — `SideNavShell` side nav + single-column illust 16:10 / novel row / history row cards; layout-mode setting removed |
| 0076 | Home pull-to-refresh — `createPullToRefresh` primitive + A1 overlay for six feed panels |
| 0077 | Novel FastScroller — draggable `createFastScrollbar` + chapter preview bubble |
| 0078 | Feed list unification — `FeedList` container + `refreshing` vs `loadingMore` split (fixes pagination-triggered skeleton flash) |
| 0079 | Tool trigger protocol — CodeGraph/OpenWiki forced routing for AI tool invocations (see [AGENTS.md](/AGENTS.md)); research in [codegraph-vs-openwiki](/docs/research/codegraph-vs-openwiki.md) |
| 0080 | Dependency upgrade analysis — jsdom 30 (Node floor → ≥22.22.2), Capacitor 8.5, agent-browser 0.34, plus holds (TS 7, tailwind 4, lynx toolchain); see [glossary-dependency-upgrade](/docs/adr/glossary-dependency-upgrade.md) |
| 0081 | Search pagination native 4xx fix — `rewriteUrl` strips the Pixiv host from absolute `next_url` (double-domain URL → 404), fixing Android pagination for all feeds; `executeSearch` same-param re-entrancy guard fixes the first-search empty-result race; see [glossary-search-pagination](/docs/adr/glossary-search-pagination.md) |
| 0082 | Feed pagination inline retry — store-level `paginationError` signal + `InlineRetryBar` separate pagination failure (keep results + bottom retry) from first-load failure (full-page `ErrorDisplay`); sentinel pause prevents no-backoff retry loops |
| 0083 | Dead code cleanup — removes 20 dead files (legacy home feed components, 4 superseded skeletons, ADR-0023 scroll primitives, dead-route panels, unwired scripts), 9 unused exports, the `@capacitor/device` dependency, and 3 unused assets; ~50 export-only types/constants de-exported (symbols kept); see [glossary-dead-code-cleanup](/docs/adr/glossary-dead-code-cleanup.md) and [analysis](/docs/research/dead-code-analysis.md) |
| 0084 | E2E testing localization & CI simplification — CI `test` job removed (CI keeps only `pnpm check:all` + `pnpm lint:all`); unit tests and agent-browser E2E run locally; `PIXIV_REFRESH_TOKEN` never in CI; E2E drift guarded by the `.husky/pre-push` static anchor validation ([`check-e2e-anchors.mjs`](/packages/app/scripts/check-e2e-anchors.mjs)) + manual browser runs |
| 0085 | AI assertion repositioning — 63 of 64 broad `aiAssert` calls converted to deterministic `evaluate` + `expect` DOM assertions (LLM calls 64 → 1); `assertion.ts` retained for the single true semantic judgment (s48) |

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

The repository has been actively refactored through **v4.10.0**. Key themes in recent commits:

- **Store migration:** All list stores migrated from hand-written `createStore` patterns to the `createTQFeedStore` factory wrapping TanStack Query's `createInfiniteQuery` (ADR-0016, ADR-0022). This eliminated 200-300 lines of boilerplate.
- **Feed store split + legacy cleanup:** The monolithic `feedStore.ts` (illusts) and `novelStore.ts` (novels) have been split into dedicated per-tab stores using the same factory. `recommendedStore.ts` and `followStore.ts` (with `novelRecommendedStore.ts`, `novelFollowStore.ts`, and `novelBookmarkStore.ts`) now power the home page feed panels directly via `IllustFeedPanel`/`NovelFeedPanel` — the standalone `RecommendedFeed`/`FollowFeed` components and `NovelRecommendedFeed`/`NovelFollowFeed` route panels were later **deleted** in the ADR-0083 dead-code cleanup. Both legacy monolithic stores and their tests have been **deleted** (commit `b30366f`). Shared helpers extracted to `feedHelpers.ts` and `novelHelpers.ts`.
- **Scroll restoration consolidation:** Custom scroll restoration primitives (`createScrollRestore`, `createVirtualScrollRestore`, `createFeedScrollStore`) have been **deleted** — `@solidjs/router`'s built-in `<Router scrollRestoration>` prop now handles scroll position save/restore via sessionStorage. Login and age-confirmation pages clear `sessionStorage.removeItem("solid-router:scroll")` to prevent stale position restoration after auth flow. Per-tab scroll state within `/home` is no longer saved or restored.
- **Image pipeline:** Periodic GC with context-aware eviction for the L1 image cache; L1 key set migrated to Set-based `LRUSet` (ADR-0030, ADR-0014).
- **Ugoira (animated illust):** In-place playback with percentage loading progress indicator; list card aspect ratio changed to 1:1 square for consistency.
- **Testing:** Playwright E2E and Vitest browser component tests fully migrated to agent-browser (AI-driven) E2E + unit tests (ADR-0034, ADR-0035); Playwright and `@vitest/browser-playwright` dependencies removed; ~40 test files consolidated into 2 tiers
- **OAuth:** Transport layer deduplication between `auth.ts` and `pkceAuth.ts` (ADR-0028); loginUrl lambda capture fix for iOS.
- **Author navigation:** Full coverage of third-party username click → personal center (ADR-0032).
- **Update dialog fix:** Startup update dialog migrated from `<fluent-dialog>` (invisible on dynamic creation) to a pure CSS fixed overlay. `autoCheckUpdate` default changed to `true` (ADR-0033). The check itself runs in `updateService.ts` `checkForUpdate()` — called at startup from `__root.tsx` and manually from `SettingsAccount.tsx` — which fetches `packages/website/version.json` (written by `packages/app/scripts/release.mjs` during `pnpm release` with `version`/`url`/`changelog` fields). The release link is parsed from the `url` field, with `release_url` kept as a future-compat fallback (previously only `release_url` was read, which the generated JSON never contains, leaving the link empty).
- **PixivApiPlugin gateway (v3.18.0, ADR-0037):** All Pixiv API traffic unified through a single Java Capacitor plugin. `access_token` removed from JS heap entirely — stored in a Java `volatile` field. Image prefetching writes directly to disk, zero bytes into JS heap. 401 auto-refresh moved from JS Promise queue to Java `synchronized` lock. Old `PictelioHttpPlugin` and `PictelioHttp.ts` deleted; `client.ts` simplified by ~120 lines. **Security:** `access_token` is only present in JS during DEV mode (`import.meta.env.DEV` dead-code eliminated by Oxc minifier in production builds). OAuth credentials exist only in compiled Java bytecode (`OAuthConfig` auto-generated from `credentials.json5`).
- **Immediate navigation (v3.20.0, ADR-0038):** Router loaders no longer await network I/O. Pages render chrome + skeleton screens instantly and load data in the component via `onMount`/`createEffect`. Dedicated `*Skeleton` components match each data route's layout — now only `IllustDetailSkeleton` and `NovelDetailSkeleton` remain after the ADR-0083 dead-code cleanup removed `FeedSkeleton`/`GridSkeleton`/`ListSkeleton`/`ProfileSkeleton`. Redundant loader→hydration indirection removed from IllustDetail and NovelDetail.
- **Splash bridge refactor (v3.21.0):** Splash Screen dismiss migrated from direct AndroidX `core-splashscreen` API to JS-controlled via `AuthPlugin.hideSplash()` Capacitor bridge. `splashBridge.ts` calls the existing AuthPlugin (not `@capacitor/splash-screen`), which sets an `AtomicBoolean` in `MainActivity` to trigger `SplashScreen.setKeepOnScreenCondition`. See [Android Native & Build](/openwiki/integrations/android-native.md#splash-screen-js-bridge).
- **Rolldown + Oxc minifier (v3.18.0):** Production bundler switched from Vite/terser to Rolldown with Rust-based Oxc minifier. Build comments updated across codebase.
- **Token storage security hardening (v3.21.6, ADR-0003):** `secureStorage.ts` rewritten into a `restore/save/clear` deep module with backup-integrity marker + native memory sync; `PixivApiPlugin.setRefreshToken` → `syncToken` (memory-only, no disk writes); backup XML rules now exclude the real ciphertext file names (`WSSecureStorageSharedPreferences.xml` + `PictelioPrefs.xml`); new `backupRulesConsistency.test.ts` guards against drift. Grounded in `docs/research/android-token-storage.md` — see [API Layer & Authentication](/openwiki/architecture/api-layer.md#token-persistence--backup-integrity).
- **Novel AI translation (S1–S7, complete):** BYOK DeepSeek translation shipped in seven stacked milestones — S1 minimal closed loop (BYOK key + single-block translation + 原文/译文 toggle); S2 chunked pipeline (≤2000-char paragraph-boundary chunks, first-screen priority ordering, ≤3-way concurrency with exponential-backoff retries, AbortController cancel, progressive injection); S3 LRU 200-chapter IndexedDB cache with source-hash invalidation; S4 failure handling + 断点续翻 (〔未翻译〕 markers, retry-failed without re-billing); S5 R18/R18G sensitive-content grading (client-side gate — nothing sent when blocked — with two-level confirmation); S6 settings completion (default quality tier + thinking toggle); S7 per-page temporary tier switch (doesn't pollute the global default). New `api/translate.ts` (OpenAI-compatible `/chat/completions`, dual fetch/CapacitorHttp transport), `createNovelTranslator`, `translationStore`, `translationCache`, `detectLanguage`, `prompts`; `db.ts` bumped to v2 for the `translations` store. Spec: `docs/specs/novel-ai-translation.md`; see [Novel Reader](/openwiki/domain/novel-reader.md#ai-translation).
- **E2E suite stability (Issue #19, 19/42 → 42/42):** `createLoggedInDriver` rebuilt as a 4-phase looped login wait with 3 launch retries; `navigateSpa()` bypasses the startup-navigation override; white-screen guards (`waitForPageContent`/`waitForSelector`) and `clickReliable` `scopeSelector` added; daemon cleanup switched to lsof-based precise kill. See [Testing Strategy](/openwiki/testing/overview.md).
- **Lynx native integration (ADR-0053, 0054, 0055, 0056):** App-lynx brownfield integration inside the main Android app (`MainActivity` routing gate → `LynxActivity`). NativeModule access_token isolation (ADR-0053) — `PictelioApi`/`PictelioAuth` LynxModules forward API/OAuth through Java, access_token stays in Java heap (JS zero-knowledge), callback no-null contract. Unified image pipeline (ADR-0054) — `PixivImageLoader` shared core with per-URL locking serves both webview proxy and Lynx `PictelioImageService`, dual client share `pictelio-images` cache directory. Native render compat (ADR-0055) — text/`list-item` tap wrapped in `<view>`, scroll-view aspectRatio patched with fixed-height containers, XElement behaviors registered, `item-key` String enforced, `super.onCreate` ordering fixed. Number prop binding contract (ADR-0056) — list number-type attributes must use v-bind (`:span-count="2"`); static strings silently rejected by native layout engine (single-column fallback), masked by web-core's loose `parseFloat`. Automated verification via [`lynx-flow-check.sh`](/packages/app-lynx/scripts/lynx-flow-check.sh) (full-process device flow with resolution-adaptive screenshot analysis). See [Architecture Overview > app-lynx](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client) and [Android Native & Build](/openwiki/integrations/android-native.md).
- **Me page scroll fix (issue #90):** The Me settings page was restructured from a flat `<view>` to a `flex flex-col` layout with fixed header + `<scroll-view>` for content overflow. Content sections were reorganized into semantic groups (account, client, content, animation playback, logout) with bottom padding. The `lynx-flow-check.sh` flow verification gained a step 8 for settings-page scroll regression and resolution-adaptive coordinate scaling (no longer hardcoded 1080x2400).
- **app-lynx R18 overlay + skeleton (issue #91):** The `filterByRestrict` approach (ADR-0051) caused blank screens on novel feeds where all items were R18/R18G — replaced with full-list rendering + `RestrictOverlay` glass mask (`isRestricted()` in `settingsStore.ts`). Glass tokens (`--glassBg`/`--glassBlur`/`--glassSaturate`/`--glassBorder`) added to `tokens.css`. Spec: `docs/specs/app-lynx-r18-overlay-skeleton.md`.
- **A2 cardization + C-shell home (ADR-0069 → ADR-0078):** The main app's settings, personal center, home, illust detail, and novel detail pages were unified under an "A2" card visual language, then corrected to the Win11/Fluent 2 spec (8px radius + 1px border + no shadow, ADR-0074). `/home` was rebuilt as a C shell — `SideNavShell` left icon rail + single-column fixed L5 layout (`IllustSingleCard` 16:10 big image / `NovelRowCard` 56px rows / `HistoryRowCard`) — with the bottom `NavBar` and masonry/grid layout-mode switcher removed from the home page. A unified `FeedList` (ADR-0078) adds pull-to-refresh (ADR-0076), infinite-scroll sentinel, and `AdaptiveTags` chip truncation. See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md).
- **Novel reader polish:** `createFastScrollbar` draggable overlay scrollbar with chapter-preview bubble (ADR-0077); novel text marker rendering (chapter titles / `jump` links / inline decoration, commit `c39202b`); reader settings auto font-size via the new [`viewportWidth`](/packages/app/src/primitives/viewportWidth.ts) primitive.
- **Update check (ADR-0065):** A new shared [`@pictelio/update-check`](/packages/update-check/) package centralizes version comparison + `version.json` fetch, consumed by both clients with different policies — webview soft update (dismissible `StartupUpdateDialog`, 85vh max per ADR-0068) vs lynx forced update (`UpdatePage` with `backBehavior: 'exit'`). Native HTTP goes through `PictelioAppModule.httpGet`; the disable switch is dev-only.
- **Release pipeline (ADR-0065-per-asset, ADR-0067):** Per-asset APK upload with failure isolation + idempotent retry; a native Node uploader (2.1× `gh` throughput) with `PICTELIO_UPLOADER=gh` fallback; proxy-path probe; changelog truncation cap raised 200→5000 chars.
- **app-lynx feed tabs + M3 + error/comment/update (ADR-0064):** Global tabs refactored to 推荐/插画/小说/我的 (`navTabs.ts` single source of truth) with a new `/illusts` `IllustList` page; `Recommended.vue` migrated to a `createMixFeed` mixed feed (illust 4:1 novel); novel body switched to a `requestRaw` native gateway; a full error-presentation module + `/error` session-expiry page, a comment bottom-sheet module, and an M3 component alignment (FAB/chips/dialogs/switch) landed.
- **Tool trigger protocol + dependency upgrade (ADR-0079, ADR-0080):** `AGENTS.md` now forces AI tool invocations through CodeGraph/OpenWiki routing; a dependency-upgrade analysis greenlights jsdom 30 (with a Node floor bump to ≥22.22.2) plus Capacitor 8.5 / agent-browser 0.34, while holding TypeScript 7, tailwindcss 4, and the lynx toolchain.
- **Search & feed pagination reliability (ADR-0081, ADR-0082):** Android pagination 4xx was root-caused to `next_url` absolute-URL double-domain concatenation and fixed by `rewriteUrl` normalization in `client.ts` (one fix covering search/recommended/bookmarks/user-works/novel pagination), and first-search empty results to a same-param re-entrancy race fixed by an `executeSearch` guard. A follow-up (ADR-0082) separates pagination failure from first-load failure with a store-level `paginationError` signal and a bottom-of-list `InlineRetryBar`, and pauses infinite-scroll sentinels after a pagination error to prevent no-backoff retry loops. See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md).
- **Dead code cleanup (ADR-0083):** A whole-repo audit ([analysis](/docs/research/dead-code-analysis.md)) found 16 zero-reference files, 4 dead-reference-chain route panels, 9 unused exports, 1 unused dependency, 8 unwired scripts, and ~50 export-only types/constants — all already eliminated from the production bundle by tree-shaking (zero runtime impact), so the cost was maintenance and doc drift. Deleted: legacy home feed components (`RecommendedFeed`/`FollowFeed`/`BookmarksFeed`/`HistoryFeed`/`CollapsedHeader`/`AgeGate`), four superseded skeletons (`FeedSkeleton`/`GridSkeleton`/`ListSkeleton`/`ProfileSkeleton`), the scroll primitives ADR-0023 had ordered deleted (`createScrollDirection`/`createScrolledPast`/`createScrollDrivenVisibility`/`scroll/index.ts`), `measureText`/`createNovelLoader`, dead-route panels (`IllustBookmarks`/`NovelBookmarks`/`NovelFollowFeed`/`NovelRecommendedFeed`), eight unwired scripts (incl. `release-github.mjs` and lynx `e2e-first-frame.mjs`/`e2e-me-scroll.mjs`), the `@capacitor/device` dependency, and three unused logo assets. See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md) and [Novel Reader](/openwiki/domain/novel-reader.md).

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
