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
| Local DB | @tanstack/solid-db 0.2 (localStorage — browsing history) |
| Mobile Runtime | Capacitor 8.5 (Android target) |
| Package Manager | pnpm 11.9 |
| Monorepo Packages | `pictelio-app` (SPA), `pictelio-website` (Astro landing page, GitHub Pages), `pictelio-app-lynx` (vue-lynx MVP), `@pictelio/update-check` (shared update-check logic), `@pictelio/ugoira` |

## Documentation Map

### Architecture

- **[Architecture Overview](/openwiki/architecture/overview.md)** — Monorepo layout, build tooling, Fluent Design, CSS architecture, SolidJS + TanStack ecosystem, boot sequence, and [app-lynx client](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client) (vue-lynx, Tailwind, vue-router, Pinia state)
- **[API Layer & Authentication](/openwiki/architecture/api-layer.md)** — Pixiv API client, dual-mode transport (Web fetch vs CapacitorHttp), OAuth flows, token storage, 401 retry with Promise queue, GET deduplication
- **[Image Loading Pipeline](/openwiki/architecture/image-pipeline.md)** — Three-layer cache (LRU keys → browser cache → Android disk), image host selection (race/weighted/fastest-ip/single), WebView proxy interception, Web Worker measurement

### Domains & Workflows

- **[Feed & Browsing](/openwiki/domain/feed-and-browsing.md)** — C-shell home page (`SideNavShell` + single-column L5 layout) backed by six feed stores, unified `FeedList` with pull-to-refresh + adaptive tags, secondary virtualized feeds, search, bookmarks, browsing history, R18 filtering (SolidJS) / overlay masking (app-lynx, account-scoped settings)
- **[Novel Reader](/openwiki/domain/novel-reader.md)** — Novel detail with virtualized text layout, in-text search with highlighting, reading progress, series sheet, novel feed with three layout modes, Pretext library integration, AI translation (BYOK DeepSeek, chunked pipeline + LRU cache + R18 grading)

### Integrations

- **[Android Native & Build](/openwiki/integrations/android-native.md)** — Native Capacitor plugins (Auth, ImageCache, OAuth, PixivApi, ClientInfo, Ota), Android Keystore token encryption, WebView config, Gradle build pipeline, release signing, version sync, OTA web-bundle update

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
| 0006 | Keep `VirtualFeed` and `NovelVirtualFeed` separate (shared logic, distinct components) |
| 0007 | Split `NovelDetail.tsx` into sub-components |
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
| 0086 (lynx units) | app-lynx responsive unit selection — fontSize uses `rpx`, width/spacing/padding uses `vw`; see [ADR-0086](/docs/adr/ADR-0086-lynx-responsive-units.md) and [glossary](/docs/adr/glossary-lynx-units.md) |
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
| 0088 (lynx feed tabs) | app-lynx feed tabs gateway — global tabs unified to 推荐/插画/小说/我的 (`navTabs.ts` single source of truth), new `/illusts` page + `IllustList.vue`, `createMixFeed` mixed feed (illust 4:1 novel), novel body via `requestRaw` native gateway, `RestrictOverlay` inline mask mode; see [ADR-0088](/docs/adr/ADR-0088-app-lynx-feed-tabs-gateway.md) and [glossary-app-lynx-feed-tabs-gateway](/docs/adr/glossary-app-lynx-feed-tabs-gateway.md) |
| — | [glossary-app-lynx-native](/docs/adr/glossary-app-lynx-native.md) — Unified terminology for lynx native integration (dual client, NativeModule contract, image pipeline, render compat, automated verification) |
| 0089 | Update-check architecture — shared `@pictelio/update-check` package + dual-client policy (webview soft update vs lynx forced update); version.json manifest; see [ADR-0089](/docs/adr/ADR-0089-update-check-architecture.md) and [glossary-update-check](/docs/adr/glossary-update-check.md) |
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
| 0087 | FluentDialog body slot contract — all `<fluent-dialog>` content must project through `<fluent-dialog-body>`; the real `@fluentui/web-components@3` slots are `title` / default (body) / `action` (singular) — `actions`/`content` don't exist. Slot remapping is centralized in the `FluentDialog` wrapper (which also fixes the dynamic-`showModal` race via rAF readiness polling) |
| 0090 | Image cache three-layer user controls — A disk cache / B browser cache headers / C background prefetch as independent switches (new `/image-cache` route + disk-size cap slider), replacing the useless LRU-entry-count slider |
| 0091 | Extract `HeartIcon` shared component — dedupes the identical inline `HeartSvg` in `ImageCard`/`NovelCard` |
| 0092 | Extract `createPersistedSet` factory — dedupes blockStore/reportStore persistence boilerplate (Preferences + JSON round-trip) |
| 0093 | TanStack Query adoption — `@tanstack/solid-query` v5 replaces hand-written store patterns; `queryKeys.ts` factory, `createInfiniteQuery` + `select` flatMap, `normalizeQueryError`, defaults `staleTime 5min` / `gcTime 30min` / full-jitter retry |
| 0094 | TanStack DB browsing history — `@tanstack/solid-db` `localStorageCollectionOptions`, composite key `${userId}_${type}_${id}`, 30-day lazy expiry, `historyStore.ts` |
| 0095 | Split `IllustDetail.tsx` — extract `IllustActionMenu` |
| 0096 | Virtual scroll migration — self-built `createVirtualScroll`/`computeMasonryLayout`/`createScrollRestoration` replaced by `@tanstack/solid-virtual`; `createFeedVirtualizer`/`createNovelVirtualLayout` now wrap TanStack `Virtualizer` with snapshot-based scroll restoration |
| 0097 | code-review skill repo-localization + oracle check — `.agents/skills/code-review/SKILL.md` shadows the global skill; Spec axis enforces Oracle check (expectation provenance) + Test strength; `verify-agent-skills.mjs` pre-push gate; `passWithNoTests: false` + `expect-expect: error`; 6th test hard constraint |
| 0098 | Cross-engine consistency — fix app OAuth 400 `invalid_grant` string-form detection (align lynx); differential test suites + shared R18 truth-table fixture; fast-check property tests; `ApiErrorType` enum case unification; CI gates add `@pictelio/update-check` |
| 0099 | Disable local `openwiki:update` — doc sync fully moved to the daily CI workflow; agents must not run it locally or hand-edit `openwiki/` |
| 0100 | URL rewrite trusted-boundary fix — strict `=== base || startsWith(base + "/")` boundary (defeats pseudo-suffix domains like `app-api.pixiv.net.evil.com`); `shouldAttachAuth(rewrittenUrl)` + `isTrustedPixivHost` guard prevents `access_token` leaking to non-Pixiv hosts |
| 0101 | StrykerJS mutation pilot — local sensitivity gate for `@pictelio/ugoira` + `@pictelio/update-check` (`test:mutation`, not in CI); mutation score as a weak-assertion detector, never correctness evidence |
| 0102 | app-lynx task restore — full-package minimize→reopen always returned to 推荐 (native task-layer defect: `singleTask` `MainActivity` shell `finish()`s after routing so launcher re-delivery never hits a live instance and each reopen stacks a fresh `LynxActivity`); fixed with an `isTaskRoot` guard |
| 0103 | Account-scoped content settings — R18/R18G moved from device-level to account-level keys (`show_r18_${uid}` / `show_r18g_${uid}`) in shared `CapacitorStorage`, synced across clients on startup; age confirmation gate removed |
| 0104 | app-lynx pagination convergence — native `rewriteUrl` normalization (absolute `next_url` double-domain → 404, the ADR-0081 gap); 5 handwritten list pages migrated onto `createMixFeed`; `firstError`/`pageError` slot split + footer three-state |
| 0105 | Restricted novel card equal height — new `RestrictedNovelCard` with an explicit site-wide fixed height (list-item auto-height measurement collapses on LynxView) |
| 0106 | ~~app-lynx pull-to-refresh~~ **Superseded** — official `<refresh>` XElement route |
| 0107 | app-lynx refresh FAB — native `<refresh>` proved infeasible on device (SelectorQuery silently misses XElement, vue-lynx patch index bug, alpha dependency gap); refresh entry moved to an in-list FAB inside the `RefreshableList` deep module |
| 0108 | app-lynx refresh FAB spin — CSS keyframes rotation (native Lynx keyframe engine verified) as the visible-refresh signal |
| 0109 | ~~app-lynx back-to-top (threshold)~~ **Superseded** — `<list>` dispatches no per-frame scroll events |
| 0110 | app-lynx back-to-top (persistent) — always-visible back-to-top FAB; rebuild-to-top via `refreshEpoch++` list `:key` change |
| 0111 | app-lynx M3 FAB menu — refresh + back-to-top merged into an M3 FAB menu |
| 0112 | app-lynx bookmark animation — M3 state-layer ring + spring heart, optimistic trigger with silent rollback |
| 0113 | Work type badges (ugoira/multi-image) — unified icon corner badge (App) + in-stream badge row (Lynx) on all illust list cards |
| 0114 | app-lynx button pagination — replaces recommended infinite-scroll with replace-style FAB paging (epoch rebuild) after the `<list>` incremental-append rendering bug + no JS scroll interface; new `createPagedFeed` page-cache module |
| 0115 | app-lynx recommended → single-card carousel — immersive full-bleed swipe cards (self-built swipe via main-thread touch handlers + `display: linear`, not native `<swiper>`); T0-DIAG debug channel removed |
| 0116 | app-lynx `<script setup>` SFC no ES module `export` — rspack-vue-loader `resolveScript` nulls on `export { }`; export submodule helpers from pure TS modules instead |
| 0117 | app-lynx `CoverImage` deep module — unifies the duplicated "image three-state" (skeleton/image/fail+retry) state machine + template from `RecommendedCover` (full) and `SkeletonImage` (box) |
| 0118 | app-lynx carousel polish R2 — cover proportional display (aspectFill fallback for extra-tall), 1/3-width snap threshold + fling, cold-start immersive skeleton, ≤3 tag chip row |
| 0119 | app-lynx carousel scrim → page-level mask — real-device `<text>` inside non-first translateX'd flex-row children never renders; scrim lifted to a fixed page-level overlay keyed on `currentIndex` |
| 0120 | app-lynx global radial nav FAB — double-ring FAB (`createGlobalFab` deep module + `GlobalFab.vue`) replaces `NavigationBar` + per-page FABs; outer ring = 4 tabs, inner ring = page actions |
| 0121 | app-lynx radial FAB M3 sizing — 56dp outer circles (24dp icons / 12sp text), z-order `scrim < items < FAB`, outer sweep angle −100°→−88° overflow fix |
| 0122 | OTA web bundle (self-built switching) — web bundle OTA via Capacitor `setServerBasePath`/`setServerAssetPath` instead of `@capgo/capacitor-updater`; extends `@pictelio/update-check` + `version.json` with `minWebVersion`/`webBundle` dual coordinates; see [ADR-0122](/docs/adr/ADR-0122-ota-self-built-switching.md) and [spec](/docs/specs/ota-web-bundle.md) |
| 0123 | app-lynx FAB hit-testing fix — native LynxView ignores `pointer-events`, so GlobalFab's full-screen container swallowed all taps; fixed via (0,0) zero-size anchor + conditionally rendered interactive scrim; see [ADR-0123](/docs/adr/ADR-0123-app-lynx-fab-hit-testing-fix.md) and [glossary](/docs/adr/glossary-app-lynx-hit-testing.md) |
| 0124 | v4.22.1 R8 keep fix — `work-runtime`'s merged `InitializationProvider` crashed every release build on launch (`Room` `WorkDatabase_Impl` no-arg constructor stripped by R8, breaking `Class.forName` reflection); fixed with explicit member-spec keep rules (`-keep class * extends androidx.room.RoomDatabase { <init>(); }`) + a drift-guard consistency test; see [ADR-0124](/docs/adr/ADR-0124-r8-keep-room-generated-constructor.md) and [glossary](/docs/adr/glossary-r8-reflection-shrink-crash.md) |
| 0125 | lynx ugoira Java extract-to-disk — native mode writes frames via `PictelioApi.ugoiraExtract` (OkHttp zip → `ZipInputStream` → `cache/ugoira/<illustId>/frame_N`, `file://` URL list); `PictelioImageService` gains a `file://` branch; keeps frame bytes out of the JS heap (ADR-0037); see [ADR-0125](/docs/adr/ADR-0125-lynx-ugoira-unpacked-pipeline.md) |
| 0126 | ugoira playback fixes — lynx flicker fixed by `defer-src-invalidation` on `<image>` (new load clears the old frame); app `range` mode silently failed (interceptor breaks 206) → degrades to fflate with a warn; ugoira cache gains per-illust integrity check; see [ADR-0126](/docs/adr/ADR-0126-ugoira-flicker-and-range-fallback.md) |
| 0127 | app ugoira streaming playback — `@pictelio/ugoira` `createStreamFrameSource` + `streamUgoiraFrames` (fetch reader → `push` → frame-ready `onFrame` → blob URL) replaces full-download-then-play; first frame ≈2% download vs 100%; see [ADR-0127](/docs/adr/ADR-0127-ugoira-streaming-playback.md) |
| 0128 | lynx ugoira native streaming — `UgoiraStreamEngine` + `ugoiraExtractStream`/`Poll`/`Cancel` pull-mode state machine (Java streams zip → writes frames in batches); first batch ≈4.5–8.6% download; see [ADR-0128](/docs/adr/ADR-0128-ugoira-native-streaming-playback.md) |
| 0129 | app-lynx multi-image detail list — multi-image works rendered as a full-width continuous vertical list (no carousel, no button paging) with per-page ratio correction via `<image>` `@load` width/height; extends the `CoverImage` deep module; see [ADR-0129](/docs/adr/ADR-0129-app-lynx-detail-multi-image-list.md) and [spec](/docs/specs/app-lynx-detail-multi-image-list.md) |
| 0130 | Settings 8-card regroup — settings regrouped from 7 to 8 cards by function domain; new `SettingsUpdate.tsx` carries 更新与关于 (update/about); 清除图片缓存 moves to the image card; zero settings added/removed; see [ADR-0130](/docs/adr/ADR-0130-settings-8-card-regroup.md) |
| 0131 | app-lynx viewport size contract — `LynxActivity` records LynxView content-area size via `OnLayoutChangeListener`, exposed as `PictelioAppModule.getViewportSize(cb)`; `GlobalFab` bottom geometry now derives from content area (not full-screen `SystemInfo`) to fix the radial FAB clipping on gesture-nav devices; see [ADR-0131](/docs/adr/ADR-0131-app-lynx-viewport-size-contract.md) |
| 0132 | app-lynx global search — bottom-sheet command-palette search (`SearchSheet.vue`) opened from a FAB dual-form entry (tab pages = radial FAB inner search item; content pages = FAB default search); 300ms-debounced type-to-search, AbortController rotation, device-level `searchHistoryStore`; closes issue #60 gap #1; see [ADR-0132](/docs/adr/ADR-0132-app-lynx-global-search.md), [spec](/docs/specs/app-lynx-global-search.md), [glossary](/docs/adr/glossary-app-lynx-global-search.md) |
| 0133 | app-lynx tag tap search — tapping a tag chip opens the global search sheet prefilled with the raw `tag.name` and auto-searches; `openSearch(initialKeyword?)` + `resolveTagChips` contract upgrade; see [ADR-0133](/docs/adr/ADR-0133-app-lynx-tag-tap-search.md) |
| 0134 | app-lynx novel-list virtualization — novel detail body rendered as a `<list single>` (per-section rows) driven by a main-thread scroll signal; see [ADR-0134](/docs/adr/ADR-0134-app-lynx-novel-list-virtualization.md) |
| 0135 | app-lynx scroll indicator — a list scroll-indicator bar reusing the ADR-0134 scroll-signal surface; see [ADR-0135](/docs/adr/ADR-0135-app-lynx-scroll-indicator.md) |
| 0136 | benchNav — real-device test navigation hook (intent deep-link instead of injected tap), `BuildConfig.DEBUG`-separated; see [ADR-0136](/docs/adr/ADR-0136-app-lynx-bench-nav-hook.md) |
| 0137 | scroll-state UI test method — in-scroll sampling (concurrent screenshot) replaces "screenshot after scroll"; see [ADR-0137](/docs/adr/ADR-0137-app-lynx-scroll-ui-test-method.md) |
| 0138 | app-lynx routing → official vue-router (`createMemoryHistory`) — root-caused empty `RouterView` to kebab-case `<router-view>`; `router.ts` becomes a thin shim, `routerCore.ts` retained; global `beforeEach` guard + `meta.requiresAuth`; see [ADR-0138](/docs/adr/ADR-0138-app-lynx-vue-router.md) |
| 0139 | app-lynx state management → Pinia setup stores — 8 stores migrated, `stores/pinia.ts` single-instance seam, `setActivePinia` per-test isolation; see [ADR-0139](/docs/adr/ADR-0139-app-lynx-pinia-migration.md) and [glossary](/docs/adr/glossary-app-lynx-pinia.md) |
| 0140 | globalFab → Pinia (`useGlobalFabStore` replaces deleted `getGlobalFab()`), spike-validated; see [ADR-0140](/docs/adr/ADR-0140-globalfab-pinia-migration.md) |

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
- **`husky`** pre-commit hook (`.husky/pre-commit`) — A no-op placeholder: OpenWiki regeneration was moved off the commit critical path to the scheduled GitHub Actions workflow (see below), so commits are never blocked waiting on LLM generation
- **`husky`** commit-msg hook (`.husky/commit-msg`) — Runs `commitlint` on the message

**`CLAUDE.md`** is deprecated and deleted — `AGENTS.md` is the single agent-instruction carrier. Its OpenWiki maintenance rules now **forbid** local `pnpm openwiki:update` runs and hand-editing `openwiki/` files: the wiki is regenerated by CI alone.

A scheduled **OpenWiki GitHub Actions workflow** (`.github/workflows/openwiki-update.yml`) is the sole regeneration mechanism — it runs daily (`cron: "0 8 * * *"`) and on `workflow_dispatch`, removes the deprecated `CLAUDE.md`, then opens/updates an auto-merge PR (via a PAT) committing `openwiki/`, `AGENTS.md`, and the workflow itself.

A **CodeGraph MCP server** is registered in [`.mcp.json`](/.mcp.json) (`codegraph serve --mcp --path .`), exposing the static-analysis code graph (`.codegraph/codegraph.db`, SQLite) to AI tooling via `codegraph_explore` / `codegraph_trace` / `codegraph_impact` — the backend for the ADR-0079 tool trigger protocol. Transient CodeGraph data (database, daemon.pid, sockets, logs) is kept out of git by `.codegraph/.gitignore`.

## Repo Evolution (Recent History)

The repository has been actively refactored through **v4.30.0**. Key themes in recent commits:

- **Store migration:** All list stores migrated from hand-written `createStore` patterns to the `createTQFeedStore` factory wrapping TanStack Query's `createInfiniteQuery` (ADR-0016, ADR-0022). This eliminated 200-300 lines of boilerplate.
- **Feed store split + legacy cleanup:** The monolithic `feedStore.ts` (illusts) and `novelStore.ts` (novels) have been split into dedicated per-tab stores using the same factory. `recommendedStore.ts` and `followStore.ts` (with `novelRecommendedStore.ts`, `novelFollowStore.ts`, and `novelBookmarkStore.ts`) now power the home page feed panels directly via `IllustFeedPanel`/`NovelFeedPanel` — the standalone `RecommendedFeed`/`FollowFeed` components and `NovelRecommendedFeed`/`NovelFollowFeed` route panels were later **deleted** in the ADR-0083 dead-code cleanup. Both legacy monolithic stores and their tests have been **deleted** (commit `b30366f`). Shared helpers extracted to `feedHelpers.ts` and `novelHelpers.ts`.
- **Scroll restoration consolidation:** Custom scroll restoration primitives (`createScrollRestore`, `createVirtualScrollRestore`, `createFeedScrollStore`) have been **deleted** — `@solidjs/router`'s built-in `<Router scrollRestoration>` prop now handles scroll position save/restore via sessionStorage. Login and age-confirmation pages clear `sessionStorage.removeItem("solid-router:scroll")` to prevent stale position restoration after auth flow. Per-tab scroll state within `/home` is no longer saved or restored.
- **Image pipeline:** Periodic GC with context-aware eviction for the L1 image cache; L1 key set migrated to Set-based `LRUSet` (ADR-0030, ADR-0014).
- **Ugoira (animated illust):** In-place playback with percentage loading progress indicator; list card aspect ratio changed to 1:1 square for consistency.
- **Testing:** Playwright E2E and Vitest browser component tests fully migrated to agent-browser (AI-driven) E2E + unit tests (ADR-0034, ADR-0035); Playwright and `@vitest/browser-playwright` dependencies removed; ~40 test files consolidated into 2 tiers
- **OAuth:** Transport layer deduplication between `auth.ts` and `pkceAuth.ts` (ADR-0028); loginUrl lambda capture fix for iOS.
- **Author navigation:** Full coverage of third-party username click → personal center (ADR-0032).
- **Update dialog fix:** Startup update dialog migrated from `<fluent-dialog>` (invisible on dynamic creation) to a pure CSS fixed overlay. `autoCheckUpdate` default changed to `true` (ADR-0033). The check itself runs in `updateService.ts` `checkForUpdate()` — called at startup from `__root.tsx` and manually from `SettingsAccount.tsx` — which fetches `packages/website/version.json` (written by `packages/app/scripts/release.mjs` during `pnpm release` with `version`/`url`/`changelog` fields, plus the OTA `minWebVersion`/`webBundle` fields added in ADR-0122). The release link is parsed from the `url` field, with `release_url` kept as a future-compat fallback (previously only `release_url` was read, which the generated JSON never contains, leaving the link empty).
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
- **Update check (ADR-0089):** A new shared [`@pictelio/update-check`](/packages/update-check/) package centralizes version comparison + `version.json` fetch, consumed by both clients with different policies — webview soft update (dismissible `StartupUpdateDialog`, 85vh max per ADR-0068) vs lynx forced update (`UpdatePage` with `backBehavior: 'exit'`). Native HTTP goes through `PictelioAppModule.httpGet`; the disable switch is dev-only.
- **Release pipeline (ADR-0065-per-asset, ADR-0067):** Per-asset APK upload with failure isolation + idempotent retry; a native Node uploader (2.1× `gh` throughput) with `PICTELIO_UPLOADER=gh` fallback; proxy-path probe; changelog truncation cap raised 200→5000 chars.
- **app-lynx feed tabs + M3 + error/comment/update (ADR-0088):** Global tabs refactored to 推荐/插画/小说/我的 (`navTabs.ts` single source of truth) with a new `/illusts` `IllustList` page; `Recommended.vue` migrated to a `createMixFeed` mixed feed (illust 4:1 novel); novel body switched to a `requestRaw` native gateway; a full error-presentation module + `/error` session-expiry page, a comment bottom-sheet module, and an M3 component alignment (FAB/chips/dialogs/switch) landed.
- **Tool trigger protocol + dependency upgrade (ADR-0079, ADR-0080):** `AGENTS.md` now forces AI tool invocations through CodeGraph/OpenWiki routing; a dependency-upgrade analysis greenlights jsdom 30 (with a Node floor bump to ≥22.22.2) plus Capacitor 8.5 / agent-browser 0.34, while holding TypeScript 7, tailwindcss 4, and the lynx toolchain.
- **Search & feed pagination reliability (ADR-0081, ADR-0082):** Android pagination 4xx was root-caused to `next_url` absolute-URL double-domain concatenation and fixed by `rewriteUrl` normalization in `client.ts` (one fix covering search/recommended/bookmarks/user-works/novel pagination), and first-search empty results to a same-param re-entrancy race fixed by an `executeSearch` guard. A follow-up (ADR-0082) separates pagination failure from first-load failure with a store-level `paginationError` signal and a bottom-of-list `InlineRetryBar`, and pauses infinite-scroll sentinels after a pagination error to prevent no-backoff retry loops. See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md).
- **Dead code cleanup (ADR-0083):** A whole-repo audit ([analysis](/docs/research/dead-code-analysis.md)) found 16 zero-reference files, 4 dead-reference-chain route panels, 9 unused exports, 1 unused dependency, 8 unwired scripts, and ~50 export-only types/constants — all already eliminated from the production bundle by tree-shaking (zero runtime impact), so the cost was maintenance and doc drift. Deleted: legacy home feed components (`RecommendedFeed`/`FollowFeed`/`BookmarksFeed`/`HistoryFeed`/`CollapsedHeader`/`AgeGate`), four superseded skeletons (`FeedSkeleton`/`GridSkeleton`/`ListSkeleton`/`ProfileSkeleton`), the scroll primitives ADR-0023 had ordered deleted (`createScrollDirection`/`createScrolledPast`/`createScrollDrivenVisibility`/`scroll/index.ts`), `measureText`/`createNovelLoader`, dead-route panels (`IllustBookmarks`/`NovelBookmarks`/`NovelFollowFeed`/`NovelRecommendedFeed`), eight unwired scripts (incl. `release-github.mjs` and lynx `e2e-first-frame.mjs`/`e2e-me-scroll.mjs`), the `@capacitor/device` dependency, and three unused logo assets. See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md) and [Novel Reader](/openwiki/domain/novel-reader.md).
- **FluentDialog slot contract (ADR-0087):** The settings "switch engine" dialog (and 6+ other `FluentDialog` call sites) rendered as a full-width bar with no mask, no radius, and missing title/body/buttons because the app used a stale slot contract (`slot="content"`, `slot="actions"`, no body wrapper). `@fluentui/web-components@3`'s `<fluent-dialog>` has only an anonymous `<slot>`; the named slots (`title` / `action`) live on `<fluent-dialog-body>`. `FluentDialog.tsx` now wraps children in `<fluent-dialog-body>` and remaps `actions`→`action` / strips `content`, centralizing the contract. It also fixed the real dynamic-`showModal` failure: custom-element upgrade is async, so `show()` silently no-ops until the inner `<dialog>` is ready — `showWhenReady` polls via rAF (120-frame cap + unmount guard + `props.open` recheck to kill the "open true→false flip" race). See [Architecture Overview](/openwiki/architecture/overview.md#design-system).
- **app-lynx three-fix (ADR-0088):** (1) `apiClient.requestRaw` — a single dual-mode raw-response seam (`requestRaw(method, path, params): Promise<string>`) so novel HTML (`/webview/v2/novel`) works in build mode: web reuses `rewriteUrl`/Bearer, native routes through `PictelioApi` (Java attaches Bearer + 401 refresh, returns raw text). (2) Restricted list items switched from absolute `RestrictOverlay` to an in-stream mask card (`overlay=false` + `bg-scrim`), because real LynxView counts absolute children into list-item height (novel feed showed a full-screen scrim). (3) Global tabs 推荐/插画/小说/我的 in a single `navTabs.ts` source, new `/illusts` `IllustList` page, and a `createMixFeed` mixed feed (illust 4:1 novel) on the recommended tab. Lesson: simulator (Apple M4 OpenGL→Metal translation) rendering anomalies are not real-device defects — verify on device before touching CSS.
- **Update-check shared layer (ADR-0089):** Check logic extracted to `@pictelio/update-check` (`CheckResult`/`isNewer`/`checkForUpdate(localVersion, fetchImpl?)`) as the single source of truth; the local version is injected from `packages/app` package.json at build time, and the network layer is decoupled via a `fetchImpl` seam (webview = global fetch, lynx native = `PictelioAppModule.httpGet`, lynx web-core = `requestFetch`). The **update policy** is per-client: lynx forced update (`/update` with `backBehavior: 'exit'`, download-or-exit) vs webview soft update (dismissible dialog + `lastDismissedVersion`). See [glossary-update-check](/docs/adr/glossary-update-check.md).
- **Image cache three-layer controls (ADR-0090):** The old "图片缓存限制" LRU-entry slider had no effect on render speed, so the cache was split into three independent user switches on a new `/image-cache` route — A 磁盘缓存 (`ImageCachePlugin.setDiskCacheEnabled`), B 浏览器缓存 (`Cache-Control: public, max-age=31536000, immutable` header on `WebResourceResponse`), C 后台预取 (`imageCachePrefetch` gate in `VirtualFeed`) — plus a real disk-size cap slider (50–1000 MB). See [Image Loading Pipeline](/openwiki/architecture/image-pipeline.md).
- **Shared component/factory extraction (ADR-0091/0092/0095):** `HeartIcon` dedupes identical inline `HeartSvg`s in `ImageCard`/`NovelCard`; `createPersistedSet<T>()` collapses blockStore's Preferences+JSON persistence boilerplate to ~10 lines; `IllustDetail.tsx` shed its `IllustActionMenu` (follow/block/report actions).
- **TanStack Query adoption (ADR-0093):** Server state migrated from hand-written `createStore`/`createResource`/`createSignal`+try/catch patterns to `@tanstack/solid-query` v5 via thin-store wrappers (API surface unchanged). `queryKeys.ts` centralizes `as const` key factories with prefix-level invalidation; pagination uses `createInfiniteQuery` + `select` flatMap over Pixiv's `next_url` cursor; `normalizeQueryError` unifies `ApiError`/`Error`; defaults are `staleTime 5min` / `gcTime 30min` / full-jitter retry (`retry: 2`, AWS-style). See [API Layer](/openwiki/architecture/api-layer.md).
- **Browsing history (ADR-0094):** A new history tab records illust/novel visits in `@tanstack/solid-db` `localStorageCollectionOptions` (pure local, user-isolated via `${userId}_${type}_${id}` composite key, 30-day lazy expiry on write, dedup via visitCount). See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md#browsing-history).
- **Virtual scroll migration (ADR-0096):** The self-built virtual-scroll stack (`createVirtualScroll`, `computeMasonryLayout`, `createMasonryWorker`/`masonryWorker`, `createScrollRestoration`, `createTextListLayout`) was replaced by `@tanstack/solid-virtual` v3 — `createFeedVirtualizer` and `createNovelVirtualLayout` are now thin wrappers over TanStack `Virtualizer`, and scroll restoration uses `takeSnapshot`/`initialMeasurementsCache` instead of RAF polling. See [Feed & Browsing](/openwiki/domain/feed-and-browsing.md#virtual-scrolling--layout).
- **AI-generated test quality (ADR-0097/0098/0101):** A repo-localized `.agents/skills/code-review/SKILL.md` (shadowing the global skill) adds an **Oracle check** (expectation provenance: spec/sample/real data/property vs implementation-derived) and **Test strength** to the Spec review axis; `scripts/verify-agent-skills.mjs` (pre-push, `.agents/`-touch gated) enforces skill frontmatter/markers; `passWithNoTests: false` + `expect-expect: error` block empty-shell tests; a 6th hard constraint (expectation traceability) was added. Cross-engine consistency (ADR-0098) fixes the app's missing OAuth 400 `invalid_grant` string-form detection (aligning lynx), adds differential test suites + a shared R18 truth-table fixture, fast-check property tests, `ApiErrorType` case unification, and `update-check` CI gates. StrykerJS mutation testing (ADR-0101) is a local-only sensitivity gate for `ugoira`/`update-check` (`pnpm test:mutation`). See [Testing Strategy](/openwiki/testing/overview.md).
- **OpenWiki CI-only sync (ADR-0099):** Local `pnpm openwiki:update` was **forbidden** for agents (EPERM in sandboxes + it recreated the deprecated `CLAUDE.md`). The daily `.github/workflows/openwiki-update.yml` workflow is the sole regeneration path; agents must not hand-edit `openwiki/`.
- **URL rewrite trusted boundary (ADR-0100):** `rewriteUrl`'s web branch now uses strict boundary matching (`path === base || startsWith(base + "/")`, plus `?` for auth), so pseudo-suffix domains (`app-api.pixiv.net.evil.com`) are no longer mis-rewritten to attacker paths. A new `shouldAttachAuth(rewrittenUrl)` + `isTrustedPixivHost` guard (https-only, hostname-from-`__PUBLIC_CONFIG__` whitelist) ensures `devAccessToken` only rides `/pixiv-` proxy paths in web mode — never external URLs. See [API Layer](/openwiki/architecture/api-layer.md).
- **app-lynx list UX, pagination & account settings (ADR-0102 → ADR-0113):** A lynx-focused milestone fixed full-package task restore (the `singleTask` shell re-stacked a fresh `LynxActivity` on every launcher reopen; `isTaskRoot` guard, ADR-0102), moved R18/R18G to account-scoped shared `CapacitorStorage` keys and dropped the age gate (ADR-0103), root-caused native pagination 404 to absolute `next_url` double-domain and converged five list pages onto `createMixFeed` (ADR-0104), and standardized restricted novel cards (ADR-0105). A pull-to-refresh spike (ADR-0106) was abandoned when native `<refresh>` proved infeasible on device, landing a `RefreshableList` FAB refresh (ADR-0107) with a CSS-keyframe spin (ADR-0108), a persistent back-to-top FAB (ADR-0110, after ADR-0109's threshold design was blocked), an M3 FAB menu (ADR-0111), and M3 bookmark animation (ADR-0112). Work-type badges (ugoira/multi-image) were unified across both clients' illust cards (ADR-0113). See [Architecture Overview > app-lynx](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client).
- **OTA web bundle updates (ADR-0122, v4.22.0):** Web-layer fixes are decoupled from the APK — the web bundle is zipped + Ed25519-signed and distributed via GitHub Releases, checked at startup and applied on next launch with a `notifyReady` version-handshake rollback. The shared [`@pictelio/update-check`](/packages/update-check/) package gained `isBelowMin()` plus `minWebVersion`/`webBundle` fields on `CheckResult`; `packages/website/version.json` now carries a dual-coordinate schema (`version` = APK coordinate, `webBundle.version` = bundle coordinate) and a `minWebVersion` floor. Native side adds the Capacitor `OtaPlugin` (`install`/`prewarm`/`notifyReady`/`applyNow`) with a WorkManager slow channel (`OtaWorker`/`OtaInstaller`) switching via Capacitor `setServerBasePath`/`setServerAssetPath`; JS side adds [`otaService.ts`](/packages/app/src/services/otaService.ts) (single-fetch triple-consumption: APK dialog + floor gate + silent install). Release adds `release-bundle.mjs` + a `pnpm release --web-only` mode. See [Architecture Overview](/openwiki/architecture/overview.md#over-the-air-ota-web-bundle-updates) and [Android Native & Build](/openwiki/integrations/android-native.md#otaplugin).
- **app-lynx recommended carousel + global radial nav (ADR-0114 → ADR-0121, ADR-0123):** The recommended page moved from a waterfall list to a self-built immersive swipe carousel (ADR-0115, main-thread touch handlers + `display: linear`; `CoverImage` deep module ADR-0117; page-level scrim ADR-0119), and the bottom `NavigationBar` + per-page FABs were replaced by a radial double-ring `GlobalFab` (`createGlobalFab` deep module + thin `GlobalFab.vue`, ADR-0120/0121). ADR-0123 fixes the full-screen-container tap-swallowing bug and codifies the platform fact that native LynxView ignores `pointer-events`. See [Architecture Overview > app-lynx](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client).
- **Ugoira streaming playback + R8 hotfix (ADR-0124 → ADR-0128, v4.23.0):** The v4.22.0 release shipped a work-runtime startup crash that killed every release build on launch — Room's `WorkDatabase_Impl` no-arg constructor was stripped by R8, breaking `Class.forName` reflection inside the merged `InitializationProvider`; fixed with explicit member-spec keep rules plus a drift-guard consistency test (ADR-0124, v4.22.1). Then ugoira playback was made progressive on both clients: the app's fflate mode now streams frames via the shared [`@pictelio/ugoira`](/packages/ugoira/) `createStreamFrameSource` + `streamUgoiraFrames` (first frame ≈2% download vs 100%, ADR-0127), and lynx native mode gained a Java extract-to-disk pipeline (`ugoiraExtract` → `file://` frames, ADR-0125) then a pull-mode streaming engine (`UgoiraStreamEngine` + `ugoiraExtractStream`/`Poll`/`Cancel`, first batch ≈4.5–8.6%, ADR-0128). ADR-0126 fixed the lynx frame-swap flicker (`defer-src-invalidation`) and made the app's broken `range` mode degrade to fflate with a warn (the interceptor destroys 206 semantics). See [Image Loading Pipeline](/openwiki/architecture/image-pipeline.md#ugoira-animated-illust-pipeline).
- **app-lynx multi-image list + global search + viewport contract (ADR-0129 → ADR-0133, v4.27.0):** Three lynx milestones land in quick succession. (1) Multi-image works leave the button-paging `currentPage`/`nextPage`/`prevPage` model for a **full-width continuous image list** — all pages stacked vertically, each sized to its own aspect ratio via the `<image>` `@load` width/height event (Pixiv `meta_pages` carries no per-page dimensions, and `auto-size` is unimplemented in web-core 0.23.1); the capability is folded into the `CoverImage` deep module as an opt-in per-page ratio correction. (2) **Global search** closes the #60 gap-list's largest remaining item: a bottom-sheet command palette (`SearchSheet.vue`) reachable from a FAB dual-form entry (radial-FAB search item on the 4 tab pages, FAB-as-search on all other content pages), with 300ms-debounced type-to-search, AbortController rotation, and device-level `searchHistoryStore` (10-item, idbKV). (3) A **viewport-size contract** fixes the radial FAB clipping on gesture-nav devices: `LynxActivity` records the LynxView content-area size via `OnLayoutChangeListener` and exposes it through `PictelioAppModule.getViewportSize(cb)`, so `GlobalFab` bottom geometry derives from content area rather than full-screen `SystemInfo`. Tag taps (ADR-0133) now open the search sheet prefilled with the raw `tag.name`. The webview Settings page was regrouped from 7 to 8 function-domain cards (ADR-0130), extracting `SettingsUpdate.tsx`. See [Architecture Overview > app-lynx](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client), [Feed & Browsing > Search](/openwiki/domain/feed-and-browsing.md#search), and [Android Native & Build](/openwiki/integrations/android-native.md#pictelioappmodule).
- **app-lynx foundation modernization — vue-router + Pinia (ADR-0138 → ADR-0140, v4.30.0):** The lynx client's two hand-rolled foundations were replaced with official Vue 3 libraries in a pure-refactor pass. Routing moved from the self-built in-memory router to `vue-router@4.6.4` + `createMemoryHistory()` — the old "RouterView renders empty" blocker was root-caused to the kebab-case `<router-view>` tag being compiled as a native custom element (PascalCase `<RouterView />` works); `router.ts` is now a thin shim keeping the page call surface unchanged, and `routerCore.ts` survives as the back-adjudication test anchor (ADR-0138). State management moved from hand-written module-level `ref` singletons to **Pinia setup stores** — eight stores (`auth`/`settings`/`searchSheet`/`searchHistory`/`modalStack`/`clientSwitch`/`update`/`globalFab`) each expose a single `useXStore()` wired through a shared [`stores/pinia.ts`](/packages/app-lynx/src/stores/pinia.ts) `createPinia()` seam; `watchlistStore` stays non-Pinia and `getGlobalFab()` was deleted (ADR-0139, ADR-0140). Scroll UX landed alongside (ADR-0134 → ADR-0137): novel-list virtualization via `<list single>` + main-thread scroll signal, a scroll indicator, the benchNav deep-link hook, and in-scroll UI sampling. See [Architecture Overview > app-lynx](/openwiki/architecture/overview.md#app-lynx-vue-lynx-client).

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
